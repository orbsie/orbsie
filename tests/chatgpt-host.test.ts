import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatGPTDeviceSessionError,
  type ChatGPTDeviceSession,
} from "../src/lib/server/chatgpt-device-session";
import { createChatGPTHostHandler } from "../src/lib/server/chatgpt-host";

const token = "t".repeat(64);

function fixture() {
  const session = {
    start: vi.fn(async () => ({
      loginId: "login-1",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/codex/device" as const,
      expiresAt: 123,
    })),
    getSnapshot: vi.fn(() => ({
      lifecycle: "idle" as const,
      authStatus: "unknown" as const,
    })),
    readAuthStatus: vi.fn(async () => ({ status: "connected" as const })),
    cancel: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
  } satisfies Pick<
    ChatGPTDeviceSession,
    "start" | "getSnapshot" | "readAuthStatus" | "cancel" | "logout"
  >;
  const handler = createChatGPTHostHandler({ session, token });
  const request = (path: string, init: RequestInit = {}, auth = token) =>
    new Request(`https://host.internal${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${auth}`,
        ...init.headers,
      },
    });
  return { session, handler, request };
}

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("server-only ChatGPT host handler", () => {
  it("gates generation behind capability authorization and explicit support", async () => {
    const { session, handler, request } = fixture();
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "create" }),
    };
    expect((await handler(request("/generate", init))).status).toBe(503);
    const generate = vi.fn(
      () =>
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                '{"type":"commit_revision","message":"Ready"}\n',
              ),
            );
            c.close();
          },
        }),
    );
    const enabled = createChatGPTHostHandler({ session, token, generate });
    expect((await enabled(request("/generate", init, "wrong"))).status).toBe(
      401,
    );
    expect(generate).not.toHaveBeenCalled();
    const response = await enabled(request("/generate", init));
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect(await response.text()).toContain("commit_revision");
    expect(generate).toHaveBeenCalledWith(
      { prompt: "create" },
      expect.any(AbortSignal),
    );
  });
  it("bounds generation bodies and rejects malformed input", async () => {
    const { session, request } = fixture();
    const generate = vi.fn();
    const handler = createChatGPTHostHandler({ session, token, generate });
    for (const [body, status] of [
      ["x".repeat(513 * 1024), 413],
      ["not-json", 400],
    ] as const) {
      expect(
        (
          await handler(
            request("/generate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body,
            }),
          )
        ).status,
      ).toBe(status);
    }
    expect(generate).not.toHaveBeenCalled();
  });
  it("stops generation only after authenticated disconnect", async () => {
    const { session, request } = fixture();
    const stop = vi.fn();
    const handler = createChatGPTHostHandler({
      session,
      token,
      beforeDisconnect: stop,
    });
    await handler(request("/logout", { method: "POST" }, "wrong"));
    expect(stop).not.toHaveBeenCalled();
    await handler(request("/logout", { method: "POST" }));
    expect(stop).toHaveBeenCalledOnce();
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["/login/start", "POST", "start"],
    ["/login/status", "GET", "readAuthStatus"],
    ["/login/cancel", "POST", "cancel"],
    ["/logout", "POST", "logout"],
  ])("routes %s", async (path, method, called) => {
    const { handler, request, session } = fixture();
    const result = await handler(request(path, { method }));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("access-control-allow-origin")).toBeNull();
    expect(session[called as keyof typeof session]).toHaveBeenCalled();
  });

  it("returns status from an explicit account read", async () => {
    const { handler, request, session } = fixture();
    const result = await handler(request("/login/status", { method: "GET" }));
    expect(await body(result)).toEqual({
      lifecycle: "idle",
      authStatus: "connected",
    });
    expect(session.getSnapshot).toHaveBeenCalledOnce();
    expect(session.readAuthStatus).toHaveBeenCalledOnce();
  });

  it("requires a bearer token and does not reveal arbitrary failures", async () => {
    const { handler, request, session } = fixture();
    const noAuth = await handler(
      new Request("https://host.internal/login/start", { method: "POST" }),
    );
    expect(noAuth.status).toBe(401);
    expect(await body(noAuth)).toEqual({ error: "Unauthorized." });
    expect(session.start).not.toHaveBeenCalled();

    const wrong = await handler(
      request("/login/start", { method: "POST" }, "w".repeat(64)),
    );
    expect(wrong.status).toBe(401);

    session.start.mockRejectedValueOnce(
      new Error("access_token=provider-secret"),
    );
    const failed = await handler(request("/login/start", { method: "POST" }));
    expect(failed.status).toBe(502);
    expect(await body(failed)).toEqual({
      error: "ChatGPT connection could not be completed.",
    });
  });

  it("rejects browser origins, query strings, bodies, methods, and paths", async () => {
    const { handler, request } = fixture();
    const origin = await handler(
      request("/login/start", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      }),
    );
    expect(origin.status).toBe(403);
    expect(await body(origin)).toEqual({
      error: "This endpoint is server-to-server only.",
    });
    for (const [path, method, expected] of [
      ["/login/start?x=1", "POST", 400],
      ["/login/start", "POST", 400],
      ["/login/start", "GET", 405],
      ["/unknown", "POST", 404],
    ] as const) {
      const init: RequestInit = { method };
      if (path === "/login/start" && method === "POST")
        init.body = "unexpected";
      const result = await handler(request(path, init));
      expect(result.status).toBe(expected);
      expect(result.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("maps known session errors without exposing provider details", async () => {
    const { handler, request, session } = fixture();
    session.start.mockRejectedValueOnce(
      new ChatGPTDeviceSessionError(
        "already-pending",
        "provider diagnostic should not leak",
      ),
    );
    const result = await handler(request("/login/start", { method: "POST" }));
    expect(result.status).toBe(409);
    expect(await body(result)).toEqual({
      error: "A ChatGPT sign-in attempt is already in progress.",
    });
  });

  it("accepts the minimum token length and rejects invalid host construction", () => {
    const { session } = fixture();
    expect(() =>
      createChatGPTHostHandler({ session, token: "short" }),
    ).toThrow();
    expect(() =>
      createChatGPTHostHandler({ session, token: "x".repeat(257) }),
    ).toThrow();
    expect(() =>
      createChatGPTHostHandler({ session, token: "x".repeat(32) }),
    ).not.toThrow();
  });

  it("keeps concurrent start requests on the one injected session", async () => {
    const { handler, request, session } = fixture();
    let release!: () => void;
    session.start.mockImplementationOnce(
      () =>
        new Promise(
          (resolve) =>
            (release = () =>
              resolve({
                loginId: "login-2",
                userCode: "IJKL-MNOP",
                verificationUrl: "https://auth.openai.com/codex/device",
                expiresAt: 456,
              })),
        ),
    );
    const first = handler(request("/login/start", { method: "POST" }));
    session.start.mockRejectedValueOnce(
      new ChatGPTDeviceSessionError(
        "already-pending",
        "provider diagnostic should not leak",
      ),
    );
    const second = handler(request("/login/start", { method: "POST" }));
    release();
    await expect(first).resolves.toMatchObject({ status: 200 });
    await expect(second).resolves.toMatchObject({ status: 409 });
    expect(session.start).toHaveBeenCalledTimes(2);
  });
});
