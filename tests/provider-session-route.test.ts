import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkOrigin: vi.fn(),
  getAuth: vi.fn(),
  getSession: vi.fn(),
  handler: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  checkOrigin: mocks.checkOrigin,
  getAuth: mocks.getAuth,
}));

import { POST } from "../src/app/api/provider-session/route";

const origin = "https://orbsie.test";

function request() {
  return new Request(`${origin}/api/provider-session`, {
    method: "POST",
    headers: { origin, cookie: "better-auth.session_token=existing" },
  });
}

beforeEach(() => {
  mocks.checkOrigin.mockReset();
  mocks.getAuth.mockReset();
  mocks.getSession.mockReset();
  mocks.handler.mockReset();
  mocks.checkOrigin.mockImplementation(() => undefined);
  mocks.getAuth.mockReturnValue({
    api: { getSession: mocks.getSession },
    handler: mocks.handler,
  });
});

describe("provider session bootstrap", () => {
  it("reuses a validated session without invoking anonymous sign-in", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "user-1", name: "Marcos", isAnonymous: false },
      session: { id: "session-1" },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: "user-1", name: "Marcos", isAnonymous: false },
    });
    expect(mocks.handler).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("treats a legacy session without isAnonymous as a regular user", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "user-1", name: "Marcos" },
      session: { id: "session-1" },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: "user-1", name: "Marcos", isAnonymous: false },
    });
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("does not replace a present but invalid session with a guest", async () => {
    mocks.getSession.mockResolvedValue({ user: { name: "missing id" } });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized." });
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("forwards bootstrap cookies and strips Better Auth token fields", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.handler.mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "must-not-leak",
          user: { id: "guest-1", name: "Guest", isAnonymous: true },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": "better-auth.session_token=abc; Path=/; HttpOnly",
          },
        },
      ),
    );

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      user: { id: "guest-1", name: "Guest", isAnonymous: true },
    });
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
    expect(response.headers.get("set-cookie")).toContain(
      "better-auth.session_token=abc",
    );
    expect(mocks.handler).toHaveBeenCalledOnce();
    const bootstrapRequest = mocks.handler.mock.calls[0][0] as Request;
    expect(new URL(bootstrapRequest.url).pathname).toBe(
      "/api/auth/sign-in/anonymous",
    );
    expect(bootstrapRequest.headers.get("cookie")).toContain(
      "better-auth.session_token=existing",
    );
    expect(bootstrapRequest.headers.get("content-length")).toBeNull();
    expect(bootstrapRequest.headers.get("content-type")).toBeNull();
  });

  it("requires a bootstrap cookie before returning a guest session", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.handler.mockResolvedValue(
      Response.json({
        token: "must-not-leak",
        user: { id: "guest-1", name: "Guest", isAnonymous: true },
      }),
    );

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Could not start a private Orbsie session.",
    });
  });

  it("returns clean errors for unavailable and failed bootstrap", async () => {
    mocks.getAuth.mockReturnValueOnce(null);
    const unavailable = await POST(request());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      error: "Cloud accounts are not configured.",
    });

    mocks.getAuth.mockReturnValue({
      api: { getSession: mocks.getSession },
      handler: mocks.handler,
    });
    mocks.getSession.mockResolvedValue(null);
    mocks.handler.mockResolvedValue(
      Response.json({ error: "private database diagnostic" }, { status: 429 }),
    );
    const failed = await POST(request());
    expect(failed.status).toBe(429);
    expect(await failed.json()).toEqual({
      error: "Too many session attempts. Try again shortly.",
    });
  });

  it("rejects cross-origin requests before reading session state", async () => {
    mocks.checkOrigin.mockImplementation(() => {
      throw new Error("cross-origin");
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "This request must come from your Orbsie app.",
    });
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});
