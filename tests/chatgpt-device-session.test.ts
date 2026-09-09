import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHATGPT_DEVICE_LOGIN_TTL_MS,
  CHATGPT_DEVICE_VERIFICATION_URL,
  ChatGPTDeviceSession,
  type ChatGPTDeviceRpc,
} from "../src/lib/server/chatgpt-device-session";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function rpcFixture() {
  const listeners = new Set<(notification: unknown) => void>();
  const requests: Array<{ method: string; params: unknown }> = [];
  const request = vi.fn<ChatGPTDeviceRpc["request"]>(async (method, params) => {
    requests.push({ method, params });
    if (method === "account/read") return { account: null };
    return {};
  });
  const rpc: ChatGPTDeviceRpc = {
    request,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    rpc,
    request,
    requests,
    notify(notification: unknown) {
      for (const listener of listeners) listener(notification);
    },
  };
}

function response(loginId = "login-1") {
  return {
    type: "chatgptDeviceCode",
    loginId,
    userCode: "ABCD-EFGH",
    verificationUrl: CHATGPT_DEVICE_VERIFICATION_URL,
  };
}

describe("ChatGPT device login session", () => {
  const sessions: ChatGPTDeviceSession[] = [];
  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.close()));
  });

  function make(
    fixture = rpcFixture(),
    options: { now?: () => number; ttlMs?: number } = {},
  ) {
    const session = new ChatGPTDeviceSession({
      ownerId: "owner-1",
      sessionId: "session-1",
      rpc: fixture.rpc,
      ...options,
    });
    sessions.push(session);
    return { ...fixture, session };
  }

  it("starts one bounded device login and rejects a concurrent start", async () => {
    const fixture = make();
    fixture.request.mockImplementationOnce(async () => response());
    const challenge = await fixture.session.start();

    expect(challenge).toEqual({
      loginId: "login-1",
      userCode: "ABCD-EFGH",
      verificationUrl: CHATGPT_DEVICE_VERIFICATION_URL,
      expiresAt: expect.any(Number),
    });
    expect(fixture.request.mock.calls[0]).toEqual([
      "account/login/start",
      { type: "chatgptDeviceCode" },
    ]);
    await expect(fixture.session.start()).rejects.toMatchObject({
      code: "already-pending",
    });
  });

  it("cancels while start is unresolved and cleans up a late login response", async () => {
    const fixture = make();
    const pendingStart = deferred<unknown>();
    fixture.request.mockImplementationOnce(() => pendingStart.promise);
    const start = fixture.session.start();
    await fixture.session.cancel();
    pendingStart.resolve(response("late-login"));

    await expect(start).rejects.toMatchObject({ code: "cancelled" });
    await Promise.resolve();
    expect(fixture.requests).toContainEqual({
      method: "account/login/cancel",
      params: { loginId: "late-login" },
    });
    expect(
      fixture.session.handleNotification({
        method: "account/login/completed",
        params: { loginId: "late-login", success: true },
      }),
    ).toBeNull();
  });

  it("ignores a stale completion after a new login replaces a canceled one", async () => {
    const fixture = make();
    let login = 0;
    fixture.request.mockImplementation(async (method) =>
      method === "account/login/start"
        ? response(login++ === 0 ? "first" : "second")
        : {},
    );
    await fixture.session.start();
    await fixture.session.cancel();
    await fixture.session.start();

    expect(
      fixture.session.handleNotification({
        loginId: "first",
        success: true,
      }),
    ).toBeNull();
    expect(
      fixture.session.handleNotification({
        method: "account/login/completed",
        params: { loginId: "second", success: true },
      }),
    ).toEqual({ status: "completed" });
    expect(fixture.session.getSnapshot()).toMatchObject({
      lifecycle: "completed",
      authStatus: "unknown",
    });
  });

  it("expires pending login codes using the injected clock", async () => {
    let now = 10_000;
    const fixture = make(rpcFixture(), { now: () => now });
    fixture.request.mockImplementationOnce(async () => response());
    const challenge = await fixture.session.start();
    now = challenge.expiresAt;

    expect(
      fixture.session.handleNotification({ loginId: "login-1", success: true }),
    ).toBeNull();
    expect(fixture.session.getSnapshot()).toMatchObject({
      lifecycle: "expired",
      error: "The ChatGPT sign-in code expired. Start again.",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(
      fixture.request.mock.calls.some(
        ([method, params]) =>
          method === "account/login/cancel" &&
          JSON.stringify(params) === JSON.stringify({ loginId: "login-1" }),
      ),
    ).toBe(true);
  });

  it("requires the exact device verification URL and sanitizes malformed responses", async () => {
    const fixture = make();
    fixture.request.mockImplementationOnce(async () => ({
      ...response(),
      verificationUrl: `${CHATGPT_DEVICE_VERIFICATION_URL}/?token=provider-secret`,
    }));

    await expect(fixture.session.start()).rejects.toMatchObject({
      code: "invalid-response",
      message: "ChatGPT returned an invalid sign-in response.",
    });
    expect(fixture.request.mock.calls).toContainEqual([
      "account/login/cancel",
      { loginId: "login-1" },
    ]);
    await expect(fixture.session.start()).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  it("does not expose provider errors or infer connected auth from success", async () => {
    const fixture = make();
    fixture.request.mockImplementationOnce(async () => {
      throw Error("access_token=provider-secret; internal diagnostic");
    });
    await expect(fixture.session.start()).rejects.toMatchObject({
      code: "start-failed",
      message: "ChatGPT sign-in could not be started.",
    });
    expect(fixture.session.getSnapshot().error).not.toContain(
      "provider-secret",
    );

    fixture.request.mockImplementationOnce(async () => response());
    await fixture.session.start();
    fixture.notify({ loginId: "login-1", success: true, error: "ignored" });
    expect(fixture.session.getSnapshot().authStatus).toBe("unknown");
    fixture.request.mockImplementationOnce(async () => ({
      account: { type: "chatgpt", email: "private@example.test" },
      accessToken: "provider-secret",
    }));
    await expect(fixture.session.readAuthStatus()).resolves.toEqual({
      status: "connected",
    });
  });

  it("keeps cancellation successful when remote cleanup rejects", async () => {
    const fixture = make();
    fixture.request.mockImplementationOnce(async () => response());
    await fixture.session.start();
    fixture.request.mockImplementationOnce(async () => {
      throw Error("provider secret cleanup diagnostic");
    });

    await expect(fixture.session.cancel()).resolves.toBeUndefined();
    await Promise.resolve();
    expect(fixture.session.getSnapshot().lifecycle).toBe("cancelled");
    expect(
      fixture.session.handleNotification({ loginId: "login-1", success: true }),
    ).toBeNull();
  });

  it("bounds a transport that never resolves", async () => {
    const fixture = make(rpcFixture(), { ttlMs: 1000 });
    fixture.request.mockImplementationOnce(() => new Promise(() => {}));
    const session = new ChatGPTDeviceSession({
      ownerId: "owner-timeout",
      sessionId: "session-timeout",
      rpc: fixture.rpc,
      rpcTimeoutMs: 5,
    });
    sessions.push(session);
    await expect(session.start()).rejects.toMatchObject({
      code: "start-failed",
      message: "ChatGPT sign-in could not be started.",
    });
  });

  it("closes permanently, cancels known login, and ignores a late account read", async () => {
    const fixture = make();
    const accountRead = deferred<unknown>();
    fixture.request.mockImplementation(async (method) => {
      if (method === "account/login/start") return response();
      if (method === "account/read") return accountRead.promise;
      return {};
    });
    await fixture.session.start();
    const read = fixture.session.readAuthStatus();
    await fixture.session.close();
    accountRead.resolve({ account: { type: "chatgpt" } });
    await expect(read).resolves.toEqual({ status: "unknown" });
    await expect(fixture.session.start()).rejects.toMatchObject({
      code: "closed",
    });
    await Promise.resolve();
    expect(fixture.request.mock.calls).toContainEqual([
      "account/login/cancel",
      { loginId: "login-1" },
    ]);
    expect(fixture.session.getSnapshot()).toMatchObject({
      authStatus: "unknown",
      lifecycle: "cancelled",
    });
  });

  it("logs out the isolated RPC account and sanitizes logout failures", async () => {
    const fixture = make();
    fixture.request.mockImplementationOnce(async () => response());
    await fixture.session.start();
    await fixture.session.logout();
    expect(fixture.requests).toContainEqual({
      method: "account/logout",
      params: undefined,
    });
    expect(fixture.session.getSnapshot()).toMatchObject({
      lifecycle: "cancelled",
      authStatus: "disconnected",
    });

    fixture.request.mockImplementationOnce(async () => {
      throw Error("private logout provider failure");
    });
    await expect(fixture.session.logout()).rejects.toMatchObject({
      code: "logout-failed",
      message: "ChatGPT sign-out could not be completed.",
    });
  });

  it("uses the documented default expiry budget", async () => {
    const fixture = make(rpcFixture(), { now: () => 1_700_000_000_000 });
    fixture.request.mockImplementationOnce(async () => response());
    const challenge = await fixture.session.start();
    expect(challenge.expiresAt).toBe(
      1_700_000_000_000 + CHATGPT_DEVICE_LOGIN_TTL_MS,
    );
  });

  it("copies challenges so callers cannot change the pending login identity", async () => {
    const fixture = make();
    fixture.request.mockResolvedValueOnce(response());
    const challenge = await fixture.session.start();
    challenge.loginId = "changed";
    fixture.session.getSnapshot().pending!.loginId = "changed-again";
    expect(fixture.session.getSnapshot().pending?.loginId).toBe("login-1");
  });

  it("blocks new work during logout and invalidates an earlier account read", async () => {
    const fixture = make();
    const account = deferred<unknown>();
    const logout = deferred<unknown>();
    fixture.request.mockImplementation((method) =>
      method === "account/read" ? account.promise : logout.promise,
    );
    const read = fixture.session.readAuthStatus();
    const signingOut = fixture.session.logout();
    await expect(fixture.session.start()).rejects.toMatchObject({
      code: "already-pending",
    });
    await expect(fixture.session.logout()).rejects.toMatchObject({
      code: "already-pending",
    });
    await expect(fixture.session.readAuthStatus()).rejects.toMatchObject({
      code: "already-pending",
    });
    account.resolve({ account: { type: "chatgpt" } });
    await expect(read).resolves.toEqual({ status: "unknown" });
    logout.resolve({});
    await signingOut;
    expect(fixture.session.getSnapshot().authStatus).toBe("disconnected");
  });

  it("cancels a login response that arrives after the RPC deadline", async () => {
    const fixture = rpcFixture();
    const pending = deferred<unknown>();
    fixture.request.mockImplementationOnce(() => pending.promise);
    const session = new ChatGPTDeviceSession({
      ownerId: "owner",
      sessionId: "late",
      rpc: fixture.rpc,
      rpcTimeoutMs: 5,
    });
    sessions.push(session);
    await expect(session.start()).rejects.toMatchObject({
      code: "start-failed",
    });
    pending.resolve(response("late"));
    await vi.waitFor(() =>
      expect(fixture.request.mock.calls).toContainEqual([
        "account/login/cancel",
        { loginId: "late" },
      ]),
    );
  });

  it("does not reuse a session after uncertain logout", async () => {
    const fixture = make();
    fixture.request.mockRejectedValueOnce(Error("private"));
    await expect(fixture.session.logout()).rejects.toMatchObject({
      code: "logout-failed",
    });
    expect(fixture.session.getSnapshot().authStatus).toBe("unknown");
    await expect(fixture.session.start()).rejects.toMatchObject({
      code: "closed",
    });
  });

  it("invalidates account reads started before login completion", async () => {
    const fixture = make();
    fixture.request.mockResolvedValueOnce(response());
    await fixture.session.start();
    const pending = deferred<unknown>();
    fixture.request.mockImplementationOnce(() => pending.promise);
    const read = fixture.session.readAuthStatus();
    fixture.notify({
      method: "account/login/completed",
      params: { loginId: "login-1", success: true },
    });
    pending.resolve({ account: null });
    await expect(read).resolves.toEqual({ status: "unknown" });
  });
});
