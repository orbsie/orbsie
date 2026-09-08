import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "node:http";
import { blankProject } from "../src/lib/protocol";
import {
  companionOrigin,
  startChatGPTCompanion,
  type CompanionClient,
} from "../scripts/chatgpt-companion";
const origin = "https://orbsie.com";
const token = "a".repeat(43);
const headers = {
  Origin: origin,
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
const body = () =>
  JSON.stringify({ prompt: "Make a garden", project: blankProject() });
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
});
async function setup(
  generate: CompanionClient["generate"] = async (_s, _i, emit) => {
    emit('{"type":"commit_revision","message":"Ready"}\n');
  },
  deadlineMs?: number,
) {
  const client = { generate: vi.fn(generate), close: vi.fn() };
  const companion = await startChatGPTCompanion({
    client,
    model: "gpt-6-astra",
    token,
    deadlineMs,
  });
  stops.push(companion.close);
  return { ...companion, client };
}
describe("trusted local ChatGPT companion", () => {
  it("requires an exact safe configured origin", () => {
    for (const value of [
      "https://orbsie.com/",
      "http://evil.example",
      "https://orbsie.com/path",
      "null",
    ])
      expect(() => companionOrigin(value)).toThrow();
    expect(companionOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });
  it("exposes only an authenticated health summary and never infers at startup", async () => {
    const c = await setup();
    expect(await (await fetch(c.url + "/health", { headers })).json()).toEqual({
      protocolVersion: 1,
      model: "gpt-6-astra",
      effort: "low",
      status: "ready",
    });
    expect(c.client.generate).not.toHaveBeenCalled();
    const wrongHostStatus = await new Promise<number | undefined>((resolve) => {
      const req = request(
        c.url + "/health",
        { headers: { ...headers, Host: "localhost:" + new URL(c.url).port } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.end();
    });
    expect(wrongHostStatus).toBe(403);
    for (const h of [
      { Origin: origin },
      { ...headers, Origin: "https://evil.example" },
    ]) {
      expect([401, 403]).toContain(
        (await fetch(c.url + "/health", { headers: h })).status,
      );
    }
  });
  it("allows only constrained preflights including private-network opt-in", async () => {
    const c = await setup();
    const h = {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type",
      "Access-Control-Request-Private-Network": "true",
    };
    const res = await fetch(c.url + "/generate", {
      method: "OPTIONS",
      headers: h,
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(res.headers.get("access-control-allow-private-network")).toBe(
      "true",
    );
    expect(
      (
        await fetch(c.url + "/generate", {
          method: "OPTIONS",
          headers: { ...h, "Access-Control-Request-Headers": "x-secret" },
        })
      ).status,
    ).toBe(403);
    const denied = await fetch(c.url + "/generate", {
      method: "OPTIONS",
      headers: { ...h, Origin: "https://evil.example" },
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("rejects invalid bodies, selected IDs, and excessive bodies without inference", async () => {
    const c = await setup();
    for (const data of [
      "{",
      JSON.stringify({ prompt: "", project: blankProject() }),
      JSON.stringify({
        prompt: "hello",
        project: blankProject(),
        selected: "missing",
      }),
    ])
      expect(
        (
          await fetch(c.url + "/generate", {
            method: "POST",
            headers,
            body: data,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await fetch(c.url + "/generate", {
          method: "POST",
          headers,
          body: "x".repeat(1024 * 1024 + 1),
        })
      ).status,
    ).toBe(413);
    expect(c.client.generate).not.toHaveBeenCalled();
  });
  it("streams validated complete commands and withholds commit until provider completion", async () => {
    let finish!: () => void;
    const c = await setup(async (_s, input, emit) => {
      expect(input).toMatchObject({
        instruction: "Make a garden",
        project: { messages: [] },
      });
      emit('{"type":"set_environment","sky":"#112233"}\n{"type":"commit_');
      emit('revision","message":"Ready"}\n');
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const res = await fetch(c.url + "/generate", {
      method: "POST",
      headers,
      body: body(),
    });
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      '{"type":"set_environment","sky":"#112233"}\n',
    );
    finish();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      '{"type":"commit_revision","message":"Ready"}\n',
    );
  });
  it.each([
    '{"type":"set_material","id":"missing","color":"#112233"}\n',
    '{"type":"set_environment","sky":"#112233"}\n',
    "x".repeat(100001),
  ])(
    "rejects invalid, incomplete and excessive model output",
    async (output) => {
      const c = await setup(async (_s, _i, emit) => {
        emit(output);
      });
      const res = await fetch(c.url + "/generate", {
        method: "POST",
        headers,
        body: body(),
      });
      const text = await res.text();
      expect(text).toContain('"error":');
      expect(text).not.toContain('"commit_revision"');
    },
  );
  it("preserves intermediate commits and requires a final commit", async () => {
    const first = '{"type":"commit_revision","message":"Checkpoint"}\n';
    const edit = '{"type":"set_environment","sky":"#112233"}\n';
    const final = '{"type":"commit_revision","message":"Ready"}\n';
    for (const completes of [false, true]) {
      const c = await setup(async (_s, _i, emit) => {
        emit(first + edit + (completes ? final : ""));
      });
      const text = await (
        await fetch(c.url + "/generate", {
          method: "POST",
          headers,
          body: body(),
        })
      ).text();
      expect(text).toContain(first + edit);
      if (completes) expect(text).toBe(first + edit + final);
      else expect(text).toContain('"error":');
    }
  });
  it("does not leak provider error details", async () => {
    const c = await setup(async () => {
      throw Error("SECRET account email token path");
    });
    const text = await (
      await fetch(c.url + "/generate", {
        method: "POST",
        headers,
        body: body(),
      })
    ).text();
    expect(text).toContain('"error":');
    expect(text).not.toMatch(/SECRET|email|token|path/);
  });
  it("rejects concurrent generation and cancels on disconnect", async () => {
    let aborted!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    const c = await setup(async (_s, _i, _emit, signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted();
            reject(Error("canceled"));
          },
          { once: true },
        );
      });
    });
    const req = request(c.url + "/generate", { method: "POST", headers });
    req.on("error", () => {});
    const response = new Promise<void>((resolve) =>
      req.on("response", () => resolve()),
    );
    req.end(body());
    await response;
    expect(
      (
        await fetch(c.url + "/generate", {
          method: "POST",
          headers,
          body: body(),
        })
      ).status,
    ).toBe(429);
    req.destroy();
    await cancellation;
  });
  it("aborts generation on deadline and revokes on shutdown", async () => {
    const c = await setup(async (_s, _i, _emit, signal) => {
      await new Promise<void>((_r, reject) =>
        signal.addEventListener("abort", () => reject(Error("deadline")), {
          once: true,
        }),
      );
    }, 25);
    const text = await (
      await fetch(c.url + "/generate", {
        method: "POST",
        headers,
        body: body(),
      })
    ).text();
    expect(text).toContain('"error":');
    await c.close();
    expect(c.client.close).toHaveBeenCalled();
    await expect(fetch(c.url + "/health", { headers })).rejects.toThrow();
  });
});
