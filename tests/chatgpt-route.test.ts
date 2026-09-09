import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  checkOrigin: vi.fn(),
  readHost: vi.fn(),
  createManager: vi.fn(),
  ensure: vi.fn(),
  request: vi.fn(),
  disconnect: vi.fn(),
  getSession: vi.fn(),
  HttpError: class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock(
  "@/lib/server/chatgpt-models",
  () => import("../src/lib/server/chatgpt-models"),
);

vi.mock("@/lib/server/auth", () => ({
  getAuth: mocks.getAuth,
  checkOrigin: mocks.checkOrigin,
  HttpError: mocks.HttpError,
}));
vi.mock("@/lib/server/chatgpt-host-registry", () => ({
  readChatGPTHost: mocks.readHost,
}));
vi.mock("@/lib/server/chatgpt-host-manager", () => ({
  createChatGPTHostManager: mocks.createManager,
}));

import { GET, POST } from "../src/app/api/chatgpt/[action]/route";

const identity = { ownerId: "user-1", sessionId: "session-1" };
const host = {
  attemptId: "attempt-1",
  sandboxName: "orbsie-chatgpt-attempt-1",
  capability: "capability-secret",
  expiresAt: new Date(Date.now() + 60_000),
};

function context(action: string) {
  return { params: Promise.resolve({ action }) };
}

function request(action: string, init: RequestInit = {}) {
  return new Request(`https://orbsie.test/api/chatgpt/${action}`, {
    ...init,
    headers: { Origin: "https://orbsie.test", ...init.headers },
  });
}

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("authenticated ChatGPT routes", () => {
  const previousHosted = process.env.ORBSIE_CHATGPT_HOSTED;

  beforeEach(() => {
    process.env.ORBSIE_CHATGPT_HOSTED = "1";
    mocks.getSession.mockResolvedValue({
      user: { id: identity.ownerId },
      session: { id: identity.sessionId },
    });
    mocks.getAuth.mockReturnValue({ api: { getSession: mocks.getSession } });
    mocks.checkOrigin.mockImplementation(() => undefined);
    mocks.readHost.mockResolvedValue(null);
    mocks.ensure.mockResolvedValue(host);
    mocks.request.mockResolvedValue(
      Response.json({ lifecycle: "idle", authStatus: "disconnected" }),
    );
    mocks.disconnect.mockResolvedValue(true);
    mocks.createManager.mockReturnValue({
      ensure: mocks.ensure,
      request: mocks.request,
      disconnect: mocks.disconnect,
    });
  });

  afterEach(() => {
    if (previousHosted === undefined) delete process.env.ORBSIE_CHATGPT_HOSTED;
    else process.env.ORBSIE_CHATGPT_HOSTED = previousHosted;
    vi.clearAllMocks();
  });

  it("is disabled unless hosted mode is explicitly enabled", async () => {
    delete process.env.ORBSIE_CHATGPT_HOSTED;
    const response = await GET(request("status"), context("status"));
    expect(response.status).toBe(404);
    expect(await body(response)).toEqual({ error: "Not found." });
    expect(mocks.getAuth).not.toHaveBeenCalled();
  });

  it("accepts empty POST streams as provided by the Next HTTP adapter", async () => {
    const input = new Request("https://orbsie.test/api/chatgpt/logout", {
      method: "POST",
      headers: { origin: "https://orbsie.test" },
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    const response = await POST(input, context("logout"));
    expect(response.status).toBe(200);
    expect(mocks.disconnect).toHaveBeenCalledWith(identity);
  });

  it("uses the authenticated user and session, and status never provisions", async () => {
    const response = await GET(request("status"), context("status"));
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      lifecycle: "idle",
      authStatus: "disconnected",
    });
    expect(mocks.readHost).toHaveBeenCalledWith(identity);
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([
    [null, "signed-out"],
    [{ user: { id: identity.ownerId } }, "malformed"],
  ])(
    "rejects %s sessions before touching host state",
    async (session, _label) => {
      mocks.getSession.mockResolvedValueOnce(session);
      const response = await GET(request("status"), context("status"));
      expect(response.status).toBe(401);
      expect(await body(response)).toEqual({ error: "Unauthorized." });
      expect(mocks.readHost).not.toHaveBeenCalled();
      expect(mocks.ensure).not.toHaveBeenCalled();
    },
  );

  it("does not provision when model access is requested without a host", async () => {
    const response = await GET(request("models"), context("models"));
    expect(response.status).toBe(409);
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("starts through one private host and returns only a validated challenge", async () => {
    mocks.request.mockResolvedValueOnce(
      Response.json({
        loginId: "login-1",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.openai.com/codex/device",
        expiresAt: 123,
        capability: "must-not-leak",
        sandboxName: "must-not-leak",
      }),
    );
    const response = await POST(
      request("start", { method: "POST" }),
      context("start"),
    );
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/codex/device",
      expiresAt: 123,
    });
    expect(mocks.ensure).toHaveBeenCalledWith(identity);
    expect(mocks.request).toHaveBeenCalledWith(host, "start");
  });

  it("sanitizes status fields and strips host metadata and provider errors", async () => {
    mocks.readHost.mockResolvedValue(host);
    mocks.request.mockResolvedValueOnce(
      Response.json({
        lifecycle: "pending",
        authStatus: "unknown",
        pending: {
          loginId: "login-1",
          userCode: "ABCD-EFGH",
          verificationUrl: "https://auth.openai.com/codex/device",
          expiresAt: 123,
        },
        error: "access_token=provider-secret",
        capability: "must-not-leak",
        sandboxName: "must-not-leak",
      }),
    );
    const response = await GET(request("status"), context("status"));
    expect(await body(response)).toEqual({
      lifecycle: "pending",
      authStatus: "unknown",
      pending: {
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.openai.com/codex/device",
        expiresAt: 123,
      },
    });
    expect(mocks.request).toHaveBeenCalledWith(host, "status");
  });

  it("always disconnects after cancel RPC failure without claiming revocation", async () => {
    mocks.readHost.mockResolvedValue(host);
    mocks.request.mockRejectedValueOnce(new Error("provider token leaked"));
    const response = await POST(
      request("cancel", { method: "POST" }),
      context("cancel"),
    );
    expect(response.status).toBe(502);
    expect(await body(response)).toEqual({
      error: "ChatGPT request could not be completed.",
    });
    expect(mocks.disconnect).toHaveBeenCalledWith(identity);
  });

  it("cleans up logout and returns a disconnected public state", async () => {
    mocks.readHost.mockResolvedValue(host);
    mocks.request.mockResolvedValueOnce(
      Response.json({ lifecycle: "cancelled", authStatus: "disconnected" }),
    );
    const response = await POST(
      request("logout", { method: "POST" }),
      context("logout"),
    );
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      lifecycle: "idle",
      authStatus: "disconnected",
    });
    expect(mocks.disconnect).toHaveBeenCalledWith(identity);
  });

  it("rejects origins, query strings, bodies, and wrong actions or methods", async () => {
    mocks.checkOrigin.mockImplementation(() => {
      throw new mocks.HttpError(403, "provider origin detail");
    });
    expect(
      (await POST(request("start", { method: "POST" }), context("start")))
        .status,
    ).toBe(403);
    mocks.checkOrigin.mockImplementation(() => undefined);
    expect(
      (
        await POST(
          new Request("https://orbsie.test/api/chatgpt/start?x=1", {
            method: "POST",
          }),
          context("start"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request("start", { method: "POST", body: "unexpected" }),
          context("start"),
        )
      ).status,
    ).toBe(400);
    expect((await GET(request("start"), context("start"))).status).toBe(405);
    expect(
      (await POST(request("unknown", { method: "POST" }), context("unknown")))
        .status,
    ).toBe(404);
  });

  it("rejects malformed host responses without returning their contents", async () => {
    mocks.readHost.mockResolvedValue(host);
    mocks.request.mockResolvedValueOnce(
      Response.json({ lifecycle: "invalid", authStatus: "unknown" }),
    );
    const response = await GET(request("status"), context("status"));
    expect(response.status).toBe(502);
    expect(await body(response)).toEqual({
      error: "ChatGPT host returned an invalid response.",
    });
  });

  it("rejects a pending challenge attached to another lifecycle", async () => {
    mocks.readHost.mockResolvedValue(host);
    mocks.request.mockResolvedValueOnce(
      Response.json({
        lifecycle: "cancelled",
        authStatus: "unknown",
        pending: {
          loginId: "login-1",
          userCode: "ABCD-EFGH",
          verificationUrl: "https://auth.openai.com/codex/device",
          expiresAt: 123,
        },
      }),
    );
    const response = await GET(request("status"), context("status"));
    expect(response.status).toBe(502);
    expect(await body(response)).toEqual({
      error: "ChatGPT host returned an invalid response.",
    });
  });

  it("bounds host response bodies before parsing them", async () => {
    mocks.readHost.mockResolvedValue(host);
    mocks.request.mockResolvedValueOnce(
      new Response("x".repeat(65 * 1024), { status: 200 }),
    );
    const response = await GET(request("status"), context("status"));
    expect(response.status).toBe(502);
    expect(await body(response)).toEqual({
      error: "ChatGPT host is unavailable.",
    });
  });
});
