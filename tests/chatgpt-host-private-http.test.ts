import { afterEach, describe, expect, it, vi } from "vitest";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

class FakeRuntime {
  readonly listeners = new Set<(value: unknown) => void>();
  readonly closeMock = vi.fn(async () => {
    this.closeAttempted = true;
    if (this.closeFailure) throw Error("close failed");
    this.closed = true;
  });
  readonly getCredentialSnapshot = vi.fn(async () => ({
    cache: new TextEncoder().encode(
      this.closed ? "rotated-after-close" : "before-close",
    ),
  }));
  readonly startCalled = deferred<void>();
  closed = false;
  closeAttempted = false;
  closeFailure = false;
  accountConnected = true;
  startGate?: Deferred<unknown>;

  async request(method: string): Promise<unknown> {
    if (method === "account/login/start") {
      this.startCalled.resolve(undefined);
      if (this.startGate) return this.startGate.promise;
      return {
        type: "chatgptDeviceCode",
        loginId: "login-1",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.openai.com/codex/device",
      };
    }
    if (method === "account/read")
      return this.accountConnected
        ? { account: { type: "chatgpt", label: "Fixture" } }
        : { account: { type: "api", label: "Fixture" } };
    if (method === "account/login/cancel" || method === "account/logout")
      return {};
    throw Error(`Unexpected method ${method}`);
  }

  subscribe(listener: (value: unknown) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(value: unknown) {
    for (const listener of this.listeners) listener(value);
  }

  async close() {
    await this.closeMock();
  }
}

const mocks = vi.hoisted(() => ({ createRuntime: vi.fn() }));
vi.mock("../src/lib/server/chatgpt-runtime", () => ({
  createIsolatedChatGPTRpc: mocks.createRuntime,
}));

import { startChatGPTHostServer } from "../scripts/chatgpt-host-server";

const token = "h".repeat(64);

async function callHost(
  host: { port: number },
  path: string,
  init: RequestInit = {},
) {
  const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    json: text ? (JSON.parse(text) as Record<string, unknown>) : undefined,
  };
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("private ChatGPT host HTTP lifecycle", () => {
  it("seals a completed login through HTTP and returns the post-close cache", async () => {
    const runtime = new FakeRuntime();
    mocks.createRuntime.mockResolvedValue(runtime);
    const host = await startChatGPTHostServer({ token, hostname: "127.0.0.1" });
    try {
      await expect(
        callHost(host, "/private/login/seal", json({})),
      ).resolves.toMatchObject({ status: 409 });
      await callHost(host, "/login/start", { method: "POST" });
      const pending = await callHost(host, "/private/login/seal", json({}));
      expect(pending.status).toBe(409);

      runtime.notify({
        method: "account/login/completed",
        params: { loginId: "login-1", success: true },
      });
      const sealed = await callHost(host, "/private/login/seal", json({}));
      expect(sealed.status).toBe(200);
      expect(sealed.json).toEqual({
        cache: Buffer.from("rotated-after-close").toString("base64"),
      });
      expect(runtime.closeMock).toHaveBeenCalledOnce();
      expect(runtime.getCredentialSnapshot).toHaveBeenCalledOnce();
      const legacy = await callHost(host, "/login/status", { method: "GET" });
      expect(legacy.status).toBe(409);
    } finally {
      await host.close();
    }
  });

  it("poisons legacy admission when process close fails", async () => {
    const runtime = new FakeRuntime();
    runtime.closeFailure = true;
    mocks.createRuntime.mockResolvedValue(runtime);
    const host = await startChatGPTHostServer({ token, hostname: "127.0.0.1" });
    try {
      await callHost(host, "/login/start", { method: "POST" });
      runtime.notify({
        method: "account/login/completed",
        params: { loginId: "login-1", success: true },
      });
      const failed = await callHost(host, "/private/login/seal", json({}));
      expect(failed.status).toBe(503);
      const retry = await callHost(host, "/private/login/seal", json({}));
      expect(retry.status).toBe(409);
      const legacy = await callHost(host, "/login/status", { method: "GET" });
      expect(legacy.status).toBe(409);
    } finally {
      await host.close().catch(() => undefined);
    }
  });

  it("keeps managed adoption sticky after clear and closes the legacy runtime first", async () => {
    const legacy = new FakeRuntime();
    const managed = new FakeRuntime();
    legacy.accountConnected = false;
    mocks.createRuntime
      .mockResolvedValueOnce(legacy)
      .mockResolvedValueOnce(managed);
    const host = await startChatGPTHostServer({ token, hostname: "127.0.0.1" });
    try {
      const initialized = await callHost(
        host,
        "/private/operation/initialize",
        json({
          operationId: "managed-http",
          epoch: 1,
          deadlineAt: Date.now() + 60_000,
        }),
      );
      expect(initialized.status).toBe(200);
      expect(legacy.closeMock).toHaveBeenCalledOnce();
      const cleared = await callHost(
        host,
        "/private/operation/clear",
        json({ operationId: "managed-http", epoch: 1 }),
      );
      expect(cleared.status).toBe(200);
      const legacyAfterClear = await callHost(host, "/login/status", {
        method: "GET",
      });
      expect(legacyAfterClear.status).toBe(409);
      expect(managed.closeMock).toHaveBeenCalledOnce();
    } finally {
      await host.close();
    }
  });

  it("serializes an in-flight legacy login before managed initialization", async () => {
    const runtime = new FakeRuntime();
    const login = deferred<unknown>();
    runtime.startGate = login;
    mocks.createRuntime.mockResolvedValue(runtime);
    const host = await startChatGPTHostServer({ token, hostname: "127.0.0.1" });
    try {
      const starting = callHost(host, "/login/start", { method: "POST" });
      await runtime.startCalled.promise;
      const initializing = callHost(
        host,
        "/private/operation/initialize",
        json({
          operationId: "racing-managed",
          epoch: 1,
          deadlineAt: Date.now() + 60_000,
        }),
      );
      login.resolve({
        type: "chatgptDeviceCode",
        loginId: "login-1",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.openai.com/codex/device",
      });
      await expect(starting).resolves.toMatchObject({ status: 200 });
      await expect(initializing).resolves.toMatchObject({ status: 409 });
      expect(mocks.createRuntime).toHaveBeenCalledOnce();
    } finally {
      await host.close();
    }
  });
});
