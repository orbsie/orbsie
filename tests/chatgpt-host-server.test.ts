import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request as httpRequest } from "node:http";

const mocks = vi.hoisted(() => ({
  createRuntime: vi.fn(),
  createHandler: vi.fn(),
  sessionClose: vi.fn(),
  sessionReadAuthStatus: vi.fn(),
  sessionSnapshot: {
    lifecycle: "idle",
    authStatus: "disconnected",
  },
}));

vi.mock("../src/lib/server/chatgpt-runtime", () => ({
  createIsolatedChatGPTRpc: mocks.createRuntime,
}));
vi.mock("../src/lib/server/chatgpt-host", () => ({
  createChatGPTHostHandler: mocks.createHandler,
  ChatGPTPrivateLoginSealError: class extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("../src/lib/server/chatgpt-generation", () => ({
  createChatGPTGeneration: vi.fn(),
}));
vi.mock("../src/lib/server/chatgpt-scene-stream", () => ({
  createChatGPTSceneStream: vi.fn(),
}));
vi.mock("../src/lib/server/chatgpt-models", () => ({
  listChatGPTModels: vi.fn(),
}));
vi.mock("../src/lib/server/chatgpt-device-session", () => ({
  ChatGPTDeviceSession: class {
    getSnapshot() {
      return mocks.sessionSnapshot;
    }
    readAuthStatus = mocks.sessionReadAuthStatus;
    close = mocks.sessionClose;
  },
}));

import {
  CHATGPT_HOST_PROCESS_MAX_LIFETIME_MS,
  startChatGPTHostServer,
} from "../scripts/chatgpt-host-server";
import { CHATGPT_HOST_MAX_LIFETIME_MS } from "../src/lib/server/chatgpt-host-registry";

describe("host process lifetime", () => {
  let runtime: {
    close: ReturnType<typeof vi.fn>;
    getCredentialSnapshot: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    runtime = {
      close: vi.fn().mockResolvedValue(undefined),
      getCredentialSnapshot: vi
        .fn()
        .mockResolvedValue({ cache: new TextEncoder().encode("login-cache") }),
    };
    mocks.createRuntime.mockResolvedValue(runtime);
    mocks.createHandler.mockReturnValue(async () => Response.json({}));
    mocks.sessionSnapshot = {
      lifecycle: "idle",
      authStatus: "disconnected",
    };
    mocks.sessionReadAuthStatus.mockResolvedValue({ status: "disconnected" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("keeps a renewed host process alive past the initial ten-minute allowance", async () => {
    expect(CHATGPT_HOST_PROCESS_MAX_LIFETIME_MS).toBe(
      CHATGPT_HOST_MAX_LIFETIME_MS,
    );
    const host = await startChatGPTHostServer({
      token: "a".repeat(32),
      hostname: "127.0.0.1",
      port: 0,
    });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(runtime.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(
      CHATGPT_HOST_PROCESS_MAX_LIFETIME_MS - 10 * 60 * 1000,
    );
    expect(runtime.close).toHaveBeenCalledOnce();
    await host.close();
  });

  it("does not cut off an active generation stream at ten minutes", async () => {
    vi.useRealTimers();
    let streamController:
      ReadableStreamDefaultController<Uint8Array> | undefined;
    let scheduledDelay = 0;
    let expire: (() => void) | undefined;
    mocks.createHandler.mockReturnValue(async (request: Request) => {
      if (new URL(request.url).pathname !== "/generate")
        return Response.json({});
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
      });
      return new Response(body, {
        headers: { "Content-Type": "application/x-ndjson" },
      });
    });
    const host = await startChatGPTHostServer({
      token: "b".repeat(32),
      hostname: "127.0.0.1",
      port: 0,
      allowGeneration: true,
      setTimeoutFn: ((callback: () => void, delay: number) => {
        scheduledDelay = delay;
        expire = callback;
        return undefined as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
    });
    expect(scheduledDelay).toBe(CHATGPT_HOST_PROCESS_MAX_LIFETIME_MS);
    expect(expire).toBeDefined();
    const runtime = (await mocks.createRuntime.mock.results.at(-1)!.value) as {
      close: ReturnType<typeof vi.fn>;
    };
    const responsePromise = new Promise<import("node:http").IncomingMessage>(
      (resolve, reject) => {
        const request = httpRequest(
          {
            hostname: "127.0.0.1",
            port: host.port,
            path: "/generate",
            method: "POST",
            headers: {
              authorization: "Bearer test",
              "content-type": "application/json",
            },
          },
          resolve,
        );
        request.once("error", reject);
        request.end("{}");
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(streamController).toBeDefined();
    streamController!.enqueue(new TextEncoder().encode('{"started":true}\n'));
    const response = await responsePromise;
    expect(response.statusCode).toBe(200);
    const responseBody = new Promise<string>((resolve, reject) => {
      const chunks: string[] = [];
      response.setEncoding("utf8");
      response.on("data", (chunk) => chunks.push(String(chunk)));
      response.once("end", () => resolve(chunks.join("")));
      response.once("error", reject);
    });
    // The real HTTP stream remains open while the bounded forty-minute
    // process deadline is pending. The fake-clock test above covers the
    // ten-minute boundary itself without coupling this network assertion to
    // undici's timer implementation.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runtime.close).not.toHaveBeenCalled();
    streamController!.enqueue(new TextEncoder().encode('{"done":true}\n'));
    streamController!.close();
    await expect(responseBody).resolves.toBe(
      '{"started":true}\n{"done":true}\n',
    );
    expect(runtime.close).not.toHaveBeenCalled();
    expire!();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(runtime.close).toHaveBeenCalledOnce();
    await host.close();
  });

  it("forwards bounded private control bodies through the local HTTP adapter", async () => {
    vi.useRealTimers();
    const seen: { path?: string; body?: unknown } = {};
    mocks.createHandler.mockReturnValue(async (request: Request) => {
      seen.path = new URL(request.url).pathname;
      seen.body = await request.json();
      return Response.json({ cache: "private-test" });
    });
    const token = "c".repeat(32);
    const host = await startChatGPTHostServer({
      token,
      hostname: "127.0.0.1",
      port: 0,
    });
    try {
      const response = await new Promise<import("node:http").IncomingMessage>(
        (resolve, reject) => {
          const request = httpRequest(
            {
              hostname: "127.0.0.1",
              port: host.port,
              path: "/private/operation/initialize",
              method: "POST",
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
              },
            },
            resolve,
          );
          request.once("error", reject);
          request.end(JSON.stringify({ operationId: "http-op", epoch: 1 }));
        },
      );
      const responseBody = new Promise<string>((resolve, reject) => {
        const chunks: string[] = [];
        response.setEncoding("utf8");
        response.on("data", (chunk) => chunks.push(String(chunk)));
        response.once("end", () => resolve(chunks.join("")));
        response.once("error", reject);
      });
      expect(response.statusCode).toBe(200);
      await expect(responseBody).resolves.toContain("private-test");
      expect(seen).toEqual({
        path: "/private/operation/initialize",
        body: { operationId: "http-op", epoch: 1 },
      });
    } finally {
      await host.close();
    }
  });

  it("only exports a verified legacy login and then closes legacy RPC reuse", async () => {
    vi.useRealTimers();
    mocks.sessionSnapshot = { lifecycle: "pending", authStatus: "unknown" };
    mocks.sessionReadAuthStatus.mockResolvedValue({ status: "connected" });
    const pendingHost = await startChatGPTHostServer({
      token: "d".repeat(32),
      hostname: "127.0.0.1",
      port: 0,
    });
    const pendingSeal = mocks.createHandler.mock.calls.at(-1)![0]
      .privateLoginSeal as (signal: AbortSignal) => Promise<Uint8Array>;
    await expect(
      pendingSeal(new AbortController().signal),
    ).rejects.toMatchObject({ code: "pending" });
    expect(runtime.close).not.toHaveBeenCalled();
    await pendingHost.close();

    mocks.sessionSnapshot = { lifecycle: "completed", authStatus: "unknown" };
    mocks.sessionReadAuthStatus.mockResolvedValue({ status: "connected" });
    const verifiedRuntime = {
      close: vi.fn().mockResolvedValue(undefined),
      getCredentialSnapshot: vi
        .fn()
        .mockResolvedValue({ cache: new TextEncoder().encode("login-cache") }),
    };
    mocks.createRuntime.mockResolvedValueOnce(verifiedRuntime);
    const verifiedHost = await startChatGPTHostServer({
      token: "e".repeat(32),
      hostname: "127.0.0.1",
      port: 0,
    });
    const verifiedSeal = mocks.createHandler.mock.calls.at(-1)![0]
      .privateLoginSeal as (signal: AbortSignal) => Promise<Uint8Array>;
    await expect(verifiedSeal(new AbortController().signal)).resolves.toEqual(
      new TextEncoder().encode("login-cache"),
    );
    expect(verifiedRuntime.close).toHaveBeenCalledOnce();
    expect(mocks.sessionClose).toHaveBeenCalled();
    await verifiedHost.close();
  });
});
