import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request as httpRequest } from "node:http";

const mocks = vi.hoisted(() => ({
  createRuntime: vi.fn(),
  createHandler: vi.fn(),
  sessionClose: vi.fn(),
}));

vi.mock("../src/lib/server/chatgpt-runtime", () => ({
  createIsolatedChatGPTRpc: mocks.createRuntime,
}));
vi.mock("../src/lib/server/chatgpt-host", () => ({
  createChatGPTHostHandler: mocks.createHandler,
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
      return { lifecycle: "idle", authStatus: "disconnected" };
    }
    close = mocks.sessionClose;
  },
}));

import {
  CHATGPT_HOST_PROCESS_MAX_LIFETIME_MS,
  startChatGPTHostServer,
} from "../scripts/chatgpt-host-server";
import { CHATGPT_HOST_MAX_LIFETIME_MS } from "../src/lib/server/chatgpt-host-registry";

describe("host process lifetime", () => {
  let runtime: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    runtime = { close: vi.fn().mockResolvedValue(undefined) };
    mocks.createRuntime.mockResolvedValue(runtime);
    mocks.createHandler.mockReturnValue(async () => Response.json({}));
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
      | ReadableStreamDefaultController<Uint8Array>
      | undefined;
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
    await Promise.resolve();
    expect(runtime.close).toHaveBeenCalledOnce();
    await host.close();
  });
});
