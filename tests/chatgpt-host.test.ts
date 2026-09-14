import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatGPTDeviceSessionError,
  type ChatGPTDeviceSession,
} from "../src/lib/server/chatgpt-device-session";
import {
  ChatGPTPrivateLoginSealError,
  createChatGPTHostHandler,
  type ChatGPTPrivateLoginSeal,
} from "../src/lib/server/chatgpt-host";
import type {
  ChatGPTManagedOperationController,
  ChatGPTManagedOperationInitialize,
} from "../src/lib/server/chatgpt-managed-operation";

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

function privateFixture() {
  const { session, request } = fixture();
  const managed = {
    initialize: vi.fn(async (input: ChatGPTManagedOperationInitialize) => ({
      operationId: input.operationId,
      epoch: input.epoch,
      deadlineAt: input.deadlineAt,
    })),
    status: vi.fn(async () => ({ status: "connected" as const })),
    models: vi.fn(async () => []),
    generate: vi.fn(
      async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        }),
    ),
    seal: vi.fn(async (binding: { operationId: string; epoch: number }) => ({
      ...binding,
      deadlineAt: Date.now() + 1_000,
      expired: false,
      cache: new TextEncoder().encode("managed-cache"),
    })),
    clear: vi.fn(async () => undefined),
    hasActiveOperation: vi.fn(() => false),
    close: vi.fn(async () => undefined),
  } satisfies ChatGPTManagedOperationController;
  const privateLoginSeal: ChatGPTPrivateLoginSeal = vi.fn(async () =>
    new TextEncoder().encode("login-cache"),
  );
  const handler = createChatGPTHostHandler({
    session,
    token,
    managedOperation: managed,
    privateLoginSeal,
    legacyRouteAllowed: () => !managed.hasActiveOperation(),
  });
  return { handler, request, managed, privateLoginSeal };
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

  it("serves private operation transport and privately seals a legacy login", async () => {
    const { handler, request, managed, privateLoginSeal } = privateFixture();
    const binding = { operationId: "operation-private", epoch: 3 };
    const init = await handler(
      request("/private/operation/initialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...binding,
          deadlineAt: Date.now() + 60_000,
        }),
      }),
    );
    expect(init.status).toBe(200);
    expect(await body(init)).toMatchObject(binding);
    expect(managed.initialize).toHaveBeenCalledWith(
      expect.objectContaining(binding),
      expect.any(AbortSignal),
    );

    const sealed = await handler(
      request("/private/login/seal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(sealed.status).toBe(200);
    expect(await body(sealed)).toEqual({
      cache: Buffer.from("login-cache").toString("base64"),
    });
    expect(privateLoginSeal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("bounds and authenticates every private route without exposing credentials", async () => {
    const { handler, request, managed } = privateFixture();
    const invalidMethod = await handler(
      request("/private/operation/status", { method: "GET" }),
    );
    expect(invalidMethod.status).toBe(405);
    const origin = await handler(
      request("/private/login/seal", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(origin.status).toBe(403);
    const query = await handler(
      request("/private/login/seal?retry=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(query.status).toBe(400);
    const oversized = await handler(
      request("/private/login/seal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(130 * 1024) }),
      }),
    );
    expect(oversized.status).toBe(413);
    const malformed = await handler(
      request("/private/login/seal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unexpected: true }),
      }),
    );
    expect(malformed.status).toBe(400);
    const failure = await handler(
      request("/private/operation/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationId: "old", epoch: 1 }),
      }),
    );
    expect(failure.status).toBe(200);
    expect(managed.status).toHaveBeenCalled();
    const unauthorized = await handler(
      request(
        "/private/operation/status",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operationId: "old", epoch: 1 }),
        },
        "wrong",
      ),
    );
    expect(unauthorized.status).toBe(401);

    managed.hasActiveOperation.mockReturnValue(true);
    const legacyBypass = await handler(
      request("/login/status", { method: "GET" }),
    );
    expect(legacyBypass.status).toBe(409);
    expect(await body(legacyBypass)).toEqual({
      error: "The private ChatGPT operation must be used.",
    });
  });

  it.each([
    ["pending", 409, "Complete or cancel"],
    ["unverified", 409, "Verify the ChatGPT"],
    ["managed", 409, "already managed"],
    ["closed", 410, "already sealed"],
  ] as const)(
    "maps private login seal %s safely",
    async (code, status, message) => {
      const { session, request } = fixture();
      const privateLoginSeal = vi.fn(async () => {
        throw new ChatGPTPrivateLoginSealError(code, "provider secret");
      });
      const handler = createChatGPTHostHandler({
        session,
        token,
        privateLoginSeal,
      });
      const result = await handler(
        request("/private/login/seal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
      expect(result.status).toBe(status);
      const text = await result.text();
      expect(JSON.parse(text)).toEqual({
        error: expect.stringContaining(message),
      });
      expect(text).not.toContain("provider secret");
    },
  );
});
