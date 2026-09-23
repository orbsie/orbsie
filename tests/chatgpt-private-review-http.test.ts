import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@vercel/sandbox", () => ({
  Sandbox: sdk,
  APIError: class extends Error {},
}));

import { blankProject } from "../src/lib/protocol";
import { createChatGPTHostHandler } from "../src/lib/server/chatgpt-host";
import { createChatGPTManagedOperationController } from "../src/lib/server/chatgpt-managed-operation";
import {
  PRIVATE_SCENE_REVIEW_HEADER,
  PRIVATE_SCENE_REVIEW_VERSION,
} from "../src/lib/server/chatgpt-scene-review";
import { createChatGPTSandboxBackend } from "../src/lib/server/chatgpt-sandbox-backend";
import type {
  ChatGPTRuntime,
  ChatGPTRuntimeCredentialSnapshot,
} from "../src/lib/server/chatgpt-runtime";

const token = "private-review-token-012345678901234567890123";
const sandboxName = "orbsie-chatgpt-11111111-1111-4111-8111-111111111111";
const host = {
  sandboxName,
  capability: token,
  expiresAt: new Date(Date.now() + 600_000),
};

class HttpReviewRuntime implements ChatGPTRuntime {
  readonly holdTurn: boolean;
  private releaseHeldTurn?: () => void;
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly listeners = new Set<(value: unknown) => void>();
  readonly closeMock = vi.fn(async () => {
    this.closed = true;
    for (const listener of this.listeners)
      listener({ method: "orbsie/runtime/closed", params: {} });
  });
  closed = false;
  cache = new TextEncoder().encode("rotated-cache");

  constructor(options: { holdTurn?: boolean } = {}) {
    this.holdTurn = options.holdTurn ?? false;
  }

  emitTurn() {
    const output = JSON.stringify({
      version: 1,
      projectId: "http-review-project",
      reviewedRevision: 0,
      scope: "structural-only",
      verdict: "accept",
      summary: "The scene is ready.",
      issues: [],
      corrections: [],
    });
    for (const listener of this.listeners) {
      listener({
        method: "item/agentMessage/delta",
        params: { threadId: "thread-1", turnId: "turn-1", delta: output },
      });
      listener({
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1", status: "completed" },
        },
      });
    }
  }

  releaseTurn() {
    this.emitTurn();
    this.releaseHeldTurn?.();
    this.releaseHeldTurn = undefined;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) throw Error("closed");
    this.requests.push({ method, params });
    if (method === "account/read")
      return { account: { type: "chatgpt", label: "Managed" } };
    if (method === "model/list")
      return {
        data: [
          {
            id: "gpt-5.6-luna",
            model: "gpt-5.6-luna",
            displayName: "Luna",
            hidden: false,
            supportedReasoningEfforts: [{ reasoningEffort: "low" }],
            defaultReasoningEffort: "low",
          },
        ],
        nextCursor: null,
      };
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "turn/start") {
      if (this.holdTurn)
        await new Promise<void>((resolve) => {
          this.releaseHeldTurn = resolve;
        });
      this.emitTurn();
      return { turn: { id: "turn-1" } };
    }
    if (method === "turn/interrupt") return {};
    return {};
  }

  subscribe(listener: (value: unknown) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close() {
    await this.closeMock();
  }

  async getCredentialSnapshot(): Promise<ChatGPTRuntimeCredentialSnapshot> {
    return { cache: Uint8Array.from(this.cache) };
  }
}

function reviewInput(binding: { operationId: string; epoch: number }) {
  const project = blankProject();
  project.id = "http-review-project";
  return {
    operationId: binding.operationId,
    epoch: binding.epoch,
    model: "gpt-5.6-luna",
    effort: "low",
    project,
    prompt: "Create a small world",
    browserModeling: false,
    phase: "review" as const,
  };
}

function createFixture(options: { holdTurn?: boolean } = {}) {
  const runtime = new HttpReviewRuntime(options);
  const controller = createChatGPTManagedOperationController({
    createRuntime: vi.fn(async () => runtime),
  });
  const session = {
    start: vi.fn(),
    getSnapshot: vi.fn(() => ({
      lifecycle: "idle",
      authStatus: "disconnected",
    })),
    readAuthStatus: vi.fn(),
    cancel: vi.fn(),
    logout: vi.fn(),
  } as unknown as Parameters<typeof createChatGPTHostHandler>[0]["session"];
  const handler = createChatGPTHostHandler({
    session,
    token,
    managedOperation: controller,
  });
  const backend = createChatGPTSandboxBackend({
    artifactDirectory: "/unused-test-artifacts",
  });
  sdk.get.mockResolvedValue({
    status: "running",
    domain: () => "https://sandbox.test",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) =>
      handler(
        new Request(url, {
          method: init.method,
          headers: init.headers,
          body: init.body,
          signal: init.signal,
        }),
      ),
    ),
  );
  return { backend, controller, runtime };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("private scene review HTTP chain", () => {
  it("accepts a typed review and rejects a stale epoch before model turn", async () => {
    const { backend, controller, runtime } = createFixture();
    const binding = {
      operationId: "http-review",
      epoch: 1,
      deadlineAt: Date.now() + 60_000,
    };

    await expect(
      backend.privateOperation(host, "initialize", binding),
    ).resolves.toHaveProperty("status", 200);
    const status = await backend.privateOperation(
      host,
      "status",
      { operationId: binding.operationId, epoch: binding.epoch },
      undefined,
      undefined,
      undefined,
      PRIVATE_SCENE_REVIEW_VERSION,
    );
    expect(status.status).toBe(200);
    expect(status.headers.get(PRIVATE_SCENE_REVIEW_HEADER)).toBe("1");

    const stale = await backend.privateOperation(
      host,
      "review",
      reviewInput({ ...binding, epoch: binding.epoch + 1 }),
      undefined,
      undefined,
      undefined,
      PRIVATE_SCENE_REVIEW_VERSION,
    );
    expect(stale.status).toBe(409);
    expect(runtime.requests.map(({ method }) => method)).not.toContain(
      "thread/start",
    );

    const accepted = await backend.privateOperation(
      host,
      "review",
      reviewInput(binding),
      undefined,
      {
        requestId: "11111111-1111-4111-8111-111111111111",
        clientRunId: "22222222-2222-4222-8222-222222222222",
      },
      undefined,
      PRIVATE_SCENE_REVIEW_VERSION,
    );
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get(PRIVATE_SCENE_REVIEW_HEADER)).toBe("1");
    const result = await accepted.json();
    expect(result).toMatchObject({
      type: "orbsie.private.scene-review",
      version: 1,
      operationId: binding.operationId,
      epoch: binding.epoch,
      review: {
        verdict: "accept",
        projectId: "http-review-project",
        reviewedRevision: 0,
      },
      binding: { projectId: "http-review-project", revision: 0 },
      corrections: [],
    });
    expect(result).not.toHaveProperty("project");
    expect(result).not.toHaveProperty("runtime");
    expect(runtime.requests.map(({ method }) => method)).toContain(
      "thread/start",
    );
    expect(runtime.requests.map(({ method }) => method)).toContain(
      "turn/start",
    );

    await controller.clear(binding);
  });

  it("fences a dropped review request from a late RPC reply", async () => {
    const { backend, controller, runtime } = createFixture({ holdTurn: true });
    const binding = {
      operationId: "http-review-abort",
      epoch: 1,
      deadlineAt: Date.now() + 60_000,
    };
    await backend.privateOperation(host, "initialize", binding);
    await backend.privateOperation(
      host,
      "status",
      { operationId: binding.operationId, epoch: binding.epoch },
      undefined,
      undefined,
      undefined,
      PRIVATE_SCENE_REVIEW_VERSION,
    );

    const abort = new AbortController();
    const pending = backend.privateOperation(
      host,
      "review",
      reviewInput(binding),
      abort.signal,
      undefined,
      undefined,
      PRIVATE_SCENE_REVIEW_VERSION,
    );
    await vi.waitFor(() => {
      expect(runtime.requests.map(({ method }) => method)).toContain(
        "turn/start",
      );
    });
    abort.abort();

    const canceled = await pending;
    expect(canceled.status).toBe(408);
    expect(await canceled.json()).toEqual({
      error: "The private ChatGPT operation was canceled.",
    });
    expect(runtime.closeMock).toHaveBeenCalled();

    // The RPC can still settle and publish its late reply after the caller
    // has disconnected. The retired handler must not turn it into a result.
    runtime.releaseTurn();
    await Promise.resolve();
    expect(runtime.requests.map(({ method }) => method)).toContain(
      "turn/start",
    );
    const lateReview = await backend.privateOperation(
      host,
      "review",
      reviewInput(binding),
      undefined,
      undefined,
      undefined,
      PRIVATE_SCENE_REVIEW_VERSION,
    );
    expect(lateReview.status).toBe(503);
    expect(await lateReview.json()).not.toHaveProperty(
      "type",
      "orbsie.private.scene-review",
    );
    await expect(controller.clear(binding)).resolves.toBeUndefined();
  });
});
