import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createHash } from "node:crypto";
import {
  startModelingCompanion,
  type ModelingBuilder,
} from "../scripts/modeling-companion";
const origin = "http://localhost:3000";
const token = "a".repeat(43);
const glb = new Uint8Array(
  readFileSync("public/models/kenney/nature-kit/tree_default.glb"),
);
const result = {
  glb,
  sha256: createHash("sha256").update(glb).digest("hex"),
  bounds: {
    min: [0, 0, 0] as [number, number, number],
    max: [1, 2, 1] as [number, number, number],
    size: [1, 2, 1] as [number, number, number],
  },
  blenderVersion: "test",
  materialStats: [],
  objects: [],
};
const job = {
  version: 1,
  parts: [{ id: "cube", shape: "box", color: "#ffffff" }],
};
const servers: Awaited<ReturnType<typeof startModelingCompanion>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
async function start(
  build: ModelingBuilder = async () => result,
  deadlineMs?: number,
) {
  const server = await startModelingCompanion({
    build,
    origin,
    token,
    deadlineMs,
  });
  servers.push(server);
  return server;
}
function headers(extra: Record<string, string> = {}) {
  return {
    Origin: origin,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
  };
}
function post(
  server: Awaited<ReturnType<typeof start>>,
  body: unknown = job,
  signal?: AbortSignal,
) {
  return fetch(server.url + "/model", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal,
  });
}
it("advertises authenticated capability without calling builder or exposing secrets", async () => {
  const build = vi.fn(async () => result),
    server = await start(build);
  const response = await fetch(server.url + "/health", { headers: headers() });
  expect(await response.json()).toEqual({
    protocolVersion: 1,
    capability: "local-blender",
    status: "ready",
  });
  expect(build).not.toHaveBeenCalled();
  const deniedHeaders: Record<string, string>[] = [
    { Origin: "https://evil.test" },
    { Origin: "" },
    { Authorization: "Bearer wrong" },
  ];
  for (const extra of deniedHeaders) {
    const denied = await fetch(server.url + "/health", {
      headers: headers(extra),
    });
    expect([401, 403]).toContain(denied.status);
    expect(await denied.text()).not.toContain(token);
  }
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(
      server.url + "/health",
      { headers: headers({ Host: "localhost:1" }) },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on("error", reject);
    request.end();
  });
  expect(status).toBe(403);
});
it("accepts only constrained allowed-origin preflight including private-network requests", async () => {
  const server = await start();
  const preflight = {
    Origin: origin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization, content-type",
    "Access-Control-Request-Private-Network": "true",
  };
  const response = await fetch(server.url + "/model", {
    method: "OPTIONS",
    headers: preflight,
  });
  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-private-network")).toBe(
    "true",
  );
  for (const patch of [
    { Origin: "https://evil.test" },
    { "Access-Control-Request-Method": "DELETE" },
    { "Access-Control-Request-Headers": "x-secret" },
  ])
    expect(
      (
        await fetch(server.url + "/model", {
          method: "OPTIONS",
          headers: { ...preflight, ...patch },
        })
      ).status,
    ).toBe(403);
});
it("validates job data and byte budget before builder admission", async () => {
  const build = vi.fn(async () => result),
    server = await start(build);
  for (const body of [
    { ...job, python: "evil" },
    { ...job, parts: [{ ...job.parts[0], path: "/etc/passwd" }] },
    null,
  ])
    expect((await post(server, body)).status).toBe(400);
  expect((await post(server, { payload: "x".repeat(512 * 1024) })).status).toBe(
    413,
  );
  expect(
    (
      await fetch(server.url + "/model", {
        method: "POST",
        headers: headers({ "Content-Type": "text/plain" }),
        body: "{}",
      })
    ).status,
  ).toBe(415);
  expect(build).not.toHaveBeenCalled();
});
it("streams builder progress and one verified base64 result with no diagnostic or extra fields", async () => {
  const build: ModelingBuilder = async (_job, options) => {
    options.onProgress?.({
      stage: "modeling",
      progress: 0.5,
      message: "/home/private/token secret",
    });
    return { ...result, output: "/work/model.glb" };
  };
  const server = await start(build);
  const response = await post(server);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain("/home/");
  expect(text).not.toContain("/work/");
  const lines = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(lines[0]).toEqual({
    type: "progress",
    stage: "modeling",
    progress: 0.5,
    message: "Building model",
  });
  expect(lines[1]).toMatchObject({
    type: "result",
    sha256: result.sha256,
    blenderVersion: "test",
    objects: [],
  });
  expect(Buffer.from(lines[1].glb, "base64")).toEqual(Buffer.from(glb));
  expect(lines).toHaveLength(2);
});
it("redacts builder errors and rejects corrupt artifacts without a result", async () => {
  for (const build of [
    async () => {
      throw Error("secret /home/credentials");
    },
    async () => ({ ...result, sha256: "0".repeat(64) }),
  ]) {
    const server = await start(build);
    const text = await (await post(server)).text();
    expect(text).toContain('"type":"error"');
    expect(text).not.toContain("secret");
    expect(text).not.toContain('"type":"result"');
  }
});
it("rejects overlapping jobs and cancels the builder when the HTTP consumer disconnects", async () => {
  let aborted = false;
  const server = await start(
    async (_job, { signal }) =>
      new Promise((_resolve, reject) => {
        signal!.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(Error("canceled"));
          },
          { once: true },
        );
      }),
  );
  const controller = new AbortController();
  const response = await post(server, job, controller.signal);
  expect((await post(server)).status).toBe(409);
  expect(
    (await (await fetch(server.url + "/health", { headers: headers() })).json())
      .status,
  ).toBe("busy");
  const body = response.text().catch(() => "");
  controller.abort();
  await body;
  await vi.waitFor(() => expect(aborted).toBe(true));
  await vi.waitFor(async () =>
    expect(
      (
        await (
          await fetch(server.url + "/health", { headers: headers() })
        ).json()
      ).status,
    ).toBe("ready"),
  );
});
it("deadlines terminate response and signal cancellation; shutdown revokes listener", async () => {
  let aborted = false;
  const server = await start(
    async (_job, { signal }) =>
      new Promise((_resolve, reject) => {
        signal!.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(Error("deadline"));
          },
          { once: true },
        );
      }),
    30,
  );
  expect(await (await post(server)).text()).toContain("deadline");
  expect(aborted).toBe(true);
  await server.close();
  await expect(
    fetch(server.url + "/health", { headers: headers() }),
  ).rejects.toThrow();
});
it("shutdown cancels an active builder", async () => {
  let aborted = false;
  const server = await start(
    async (_job, { signal }) =>
      new Promise((_resolve, reject) => {
        signal!.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(Error("stop"));
          },
          { once: true },
        );
      }),
  );
  const response = await post(server);
  const body = response.text().catch(() => "");
  await server.close();
  await body;
  expect(aborted).toBe(true);
});
it("waits for abort-aware builder cleanup before close resolves", async () => {
  let cleaned = false;
  const server = await start(
    async (_job, { signal }) =>
      new Promise((_resolve, reject) => {
        signal!.addEventListener(
          "abort",
          () => {
            setTimeout(() => {
              cleaned = true;
              reject(Error("stopped"));
            }, 20);
          },
          { once: true },
        );
      }),
  );
  const response = await post(server),
    body = response.text().catch(() => "");
  await server.close();
  await body;
  expect(cleaned).toBe(true);
});
