import { generatedGLBBounds } from "../src/lib/generated-glb";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
const save = vi.hoisted(() =>
  vi.fn(async (_glb: Uint8Array, _provenance: unknown) => ({
    sha256: "saved",
  })),
);
vi.mock("../src/lib/generated-models", () => ({
  MAX_GENERATED_MODEL_BYTES: 2 * 1024 * 1024,
  saveGeneratedModel: save,
}));
import {
  buildLocalModel,
  checkModelingConnection,
  readModelingLink,
} from "../src/lib/modeling-connection";
import { modelingJobSchema } from "../src/lib/modeling";
const connection = { url: "http://127.0.0.1:43210", token: "a".repeat(43) };
const job = modelingJobSchema.parse({
  version: 1,
  parts: [{ id: "box", shape: "box", color: "#ffffff" }],
});
afterEach(() => {
  vi.unstubAllGlobals();
  save.mockClear();
});
async function result() {
  const bytes = await readFile(
    "public/models/kenney/nature-kit/tree_default.glb",
  );
  return {
    type: "result",
    glb: bytes.toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bounds: { ...generatedGLBBounds(bytes), size: [1, 2, 1] },
    blenderVersion: "validator-fixture-only",
  };
}
it("accepts only capability links to an exact loopback endpoint", () => {
  const link = (value: unknown) =>
    "#builder=" + encodeURIComponent(JSON.stringify(value));
  expect(readModelingLink(link(connection))).toEqual(connection);
  expect(readModelingLink("#unrelated")).toBeNull();
  for (const url of [
    "https://example.com",
    "http://localhost:1234",
    "http://127.0.0.1:1234/path",
    "http://user:secret@127.0.0.1:1234",
  ])
    expect(() => readModelingLink(link({ ...connection, url }))).toThrow();
  expect(() =>
    readModelingLink(link({ ...connection, token: "short" })),
  ).toThrow();
});
it("checks health without sending cookies or following redirects", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          protocolVersion: 1,
          capability: "local-blender",
          status: "ready",
        }),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  expect((await checkModelingConnection(connection)).status).toBe("ready");
  expect(fetcher).toHaveBeenCalledWith(
    connection.url + "/health",
    expect.objectContaining({
      credentials: "omit",
      redirect: "error",
      headers: expect.objectContaining({
        Authorization: `Bearer ${connection.token}`,
      }),
    }),
  );
});
it("validates stream and digest before persisting complete output", async () => {
  const final = await result();
  const progress = {
    type: "progress",
    stage: "modeling",
    progress: 0.5,
    message: "Building",
  };
  const onProgress = vi.fn();
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify(progress) + "\n" + JSON.stringify(final) + "\n",
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  await buildLocalModel(connection, job, { onProgress });
  expect(onProgress).toHaveBeenCalledWith(progress);
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0]).toEqual(
    new Uint8Array(Buffer.from(final.glb, "base64")),
  );
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(job);
  expect(String(fetcher.mock.calls[0][1]?.body)).not.toContain(
    connection.token,
  );
});
it("never saves forged, incomplete or trailing-error results", async () => {
  const final = await result();
  for (const text of [
    JSON.stringify({ ...final, sha256: "0".repeat(64) }),
    "",
    JSON.stringify(final) + '\n{"type":"error","error":"failure"}',
    '{"type":"progress","stage":"modeling","progress":2,"message":"bad"}',
  ]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(text)),
    );
    await expect(buildLocalModel(connection, job)).rejects.toThrow();
  }
  expect(save).not.toHaveBeenCalled();
});
it("rejects arbitrary hosts before making a request", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    buildLocalModel({ ...connection, url: "https://example.com" }, job),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
