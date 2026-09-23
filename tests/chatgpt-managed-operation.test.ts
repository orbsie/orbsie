import { blankProject } from "../src/lib/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatGPTManagedOperationError,
  CHATGPT_MANAGED_OPERATION_MAX_MS,
  createChatGPTManagedOperationController,
  type ChatGPTManagedOperationController,
  type ChatGPTManagedOperationInitialize,
} from "../src/lib/server/chatgpt-managed-operation";
import type {
  ChatGPTRuntime,
  ChatGPTRuntimeCredentialSnapshot,
} from "../src/lib/server/chatgpt-runtime";

class FakeRuntime implements ChatGPTRuntime {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly listeners = new Set<(value: unknown) => void>();
  readonly closeMock = vi.fn(async () => {
    this.closed = true;
    this.pendingTurnReject?.(Error("closed"));
    this.pendingTurnReject = undefined;
    for (const listener of this.listeners)
      listener({ method: "orbsie/runtime/closed", params: {} });
  });
  closed = false;
  pendingTurnReject?: (error: Error) => void;
  cache: Uint8Array | null = new TextEncoder().encode("rotated-cache");

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
    if (method === "turn/start")
      return new Promise((_, reject) => {
        this.pendingTurnReject = reject;
      });
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

  async getCredentialSnapshot(): Promise<ChatGPTRuntimeCredentialSnapshot | null> {
    return this.cache ? { cache: Uint8Array.from(this.cache) } : null;
  }
}

class ReviewRuntime extends FakeRuntime {
  override async request(method: string, params?: unknown): Promise<unknown> {
    if (method !== "turn/start") return super.request(method, params);
    this.requests.push({ method, params });
    const threadId =
      params && typeof params === "object" && "threadId" in params
        ? String((params as { threadId: unknown }).threadId)
        : "thread-1";
    const output = JSON.stringify({
      version: 1,
      projectId: "review-project",
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
        params: { threadId, turnId: "turn-1", delta: output },
      });
      listener({
        method: "turn/completed",
        params: {
          threadId,
          turn: { id: "turn-1", status: "completed" },
        },
      });
    }
    return { turn: { id: "turn-1" } };
  }
}

const base = (
  operationId: string,
  epoch = 1,
): ChatGPTManagedOperationInitialize => ({
  operationId,
  epoch,
  deadlineAt: Date.now() + CHATGPT_MANAGED_OPERATION_MAX_MS,
});

function fixture(options: { now?: () => number } = {}) {
  const runtime = new FakeRuntime();
  const createRuntime = vi.fn(async () => runtime);
  const controller = createChatGPTManagedOperationController({
    createRuntime,
    ...options,
  });
  return { controller, createRuntime, runtime };
}

async function clear(
  controller: ChatGPTManagedOperationController,
  binding: { operationId: string; epoch: number },
) {
  await controller.clear(binding);
}

afterEach(() => vi.restoreAllMocks());

describe("private managed ChatGPT operation controller", () => {
  it("serializes initialization and binds calls to the exact operation epoch", async () => {
    let release!: (runtime: FakeRuntime) => void;
    const runtime = new FakeRuntime();
    const createRuntime = vi.fn(
      () => new Promise<ChatGPTRuntime>((resolve) => (release = resolve)),
    );
    const controller = createChatGPTManagedOperationController({
      createRuntime,
    });
    const first = base("operation-a");
    const initializing = controller.initialize(first);
    await expect(
      controller.initialize(base("operation-b")),
    ).rejects.toMatchObject({ code: "busy" });
    await expect(controller.initialize(first)).rejects.toMatchObject({
      code: "replay",
    });
    release(runtime);
    await expect(initializing).resolves.toMatchObject(first);
    await expect(
      controller.status({ operationId: "operation-a", epoch: 2 }),
    ).rejects.toMatchObject({ code: "stale" });
    await expect(
      controller.status({ operationId: "other", epoch: 1 }),
    ).rejects.toMatchObject({ code: "stale" });
    await expect(
      controller.status({ operationId: "operation-a", epoch: 1 }),
    ).resolves.toEqual({ status: "connected" });
    await clear(controller, first);
  });

  it("imports a copied cache, seals idempotently, and rejects operation replay", async () => {
    const { controller, createRuntime } = fixture();
    const initial = new TextEncoder().encode("initial-cache");
    const input = {
      ...base("operation-copy"),
      initialCredentialCache: initial,
    };
    await controller.initialize(input);
    initial[0] ^= 1;
    expect(createRuntime).toHaveBeenCalledWith({
      allowGeneration: true,
      initialCredentialCache: expect.any(Uint8Array),
    });
    const supplied = (
      createRuntime.mock.calls[0] as unknown as [
        { initialCredentialCache: Uint8Array },
      ]
    )[0].initialCredentialCache;
    expect(supplied).toEqual(new TextEncoder().encode("initial-cache"));
    const sealed = await controller.seal(input);
    expect(sealed.cache).toEqual(new TextEncoder().encode("rotated-cache"));
    sealed.cache![0] ^= 1;
    await expect(controller.seal(input)).resolves.toMatchObject({
      cache: new TextEncoder().encode("rotated-cache"),
    });
    await expect(controller.initialize(input)).rejects.toMatchObject({
      code: "replay",
    });
    await clear(controller, input);
    await expect(controller.initialize(input)).rejects.toMatchObject({
      code: "replay",
    });
  });

  it("retires an operation identity even when its runtime factory fails", async () => {
    const createRuntime = vi.fn().mockRejectedValue(new Error("startup"));
    const controller = createChatGPTManagedOperationController({
      createRuntime,
    });
    const binding = base("operation-failed-start");
    await expect(controller.initialize(binding)).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(controller.initialize(binding)).rejects.toMatchObject({
      code: "replay",
    });
  });

  it("keeps retired operation identities fenced after the bounded history fills", async () => {
    const createRuntime = vi.fn().mockRejectedValue(new Error("startup"));
    const controller = createChatGPTManagedOperationController({
      createRuntime,
    });
    for (let index = 0; index < 64; index++) {
      await expect(
        controller.initialize(base(`operation-retired-${index}`)),
      ).rejects.toMatchObject({ code: "unavailable" });
    }
    await expect(
      controller.initialize(base("operation-retired-over-cap")),
    ).rejects.toMatchObject({ code: "busy" });
    await expect(
      controller.initialize(base("operation-retired-0")),
    ).rejects.toMatchObject({ code: "replay" });
  });

  it("does not call the runtime factory for a pre-aborted initialization", async () => {
    const createRuntime = vi.fn(async () => new FakeRuntime());
    const controller = createChatGPTManagedOperationController({
      createRuntime,
    });
    const signal = AbortSignal.abort();
    await expect(
      controller.initialize(base("operation-pre-aborted"), signal),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(createRuntime).not.toHaveBeenCalled();
    await expect(
      controller.initialize(base("operation-pre-aborted")),
    ).resolves.toMatchObject({ operationId: "operation-pre-aborted" });
    await controller.close();
  });

  it("terminates provider observation when scene stream creation rejects synchronously", async () => {
    const { controller } = fixture();
    const binding = base("operation-sync-input");
    await controller.initialize(binding);
    const events: unknown[] = [];
    const info = vi
      .spyOn(console, "info")
      .mockImplementation((line?: unknown) => {
        if (typeof line === "string") events.push(JSON.parse(line));
      });
    await expect(
      controller.generate(binding, { invalid: true }, undefined, {
        requestId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toThrow();
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "terminal",
        layer: "provider",
        terminalReason: "parser-failure",
        failureCode: "invalid-input",
      }),
    );
    info.mockRestore();
    await controller.clear(binding);
  });

  it("stops and seals at the operation deadline before admitting another RPC", async () => {
    let clock = 10_000;
    const { controller, runtime } = fixture({ now: () => clock });
    const input = { ...base("operation-deadline"), deadlineAt: clock + 10_000 };
    await controller.initialize(input);
    clock += 10_001;
    await expect(controller.status(input)).rejects.toMatchObject({
      code: "expired",
    });
    expect(runtime.closeMock).toHaveBeenCalledOnce();
    await expect(controller.seal(input)).resolves.toMatchObject({
      expired: true,
    });
    await controller.close();
  });

  it("seals while generation is active and terminates the runtime", async () => {
    const { controller, runtime } = fixture();
    const binding = base("operation-generation");
    await controller.initialize(binding);
    const stream = await controller.generate(binding, {
      model: "gpt-5.6-luna",
      effort: "low",
      prompt: "Create a small scene",
      project: blankProject(),
    });
    const reader = stream.getReader();
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    const sealed = await controller.seal(binding);
    expect(sealed.cache).toEqual(new TextEncoder().encode("rotated-cache"));
    expect(runtime.closeMock).toHaveBeenCalledOnce();
    await reader.cancel();
  });

  it("does not release a slot while initialization may still create a runtime", async () => {
    let release!: (runtime: FakeRuntime) => void;
    const runtime = new FakeRuntime();
    const createRuntime = vi.fn(
      () => new Promise<ChatGPTRuntime>((resolve) => (release = resolve)),
    );
    const controller = createChatGPTManagedOperationController({
      createRuntime,
    });
    const binding = base("operation-deferred");
    const initializing = controller.initialize(binding);
    const clearing = controller.clear(binding);
    let cleared = false;
    void clearing.then(() => {
      cleared = true;
    });
    await Promise.resolve();
    expect(cleared).toBe(false);
    release(runtime);
    await expect(clearing).resolves.toBeUndefined();
    await expect(initializing).rejects.toBeInstanceOf(
      ChatGPTManagedOperationError,
    );
    expect(runtime.closeMock).toHaveBeenCalledOnce();
    createRuntime.mockResolvedValueOnce(new FakeRuntime());
    await expect(
      controller.initialize(base("operation-next")),
    ).resolves.toMatchObject({ operationId: "operation-next" });
  });

  it("does not report a sealed deferred initialization before its runtime is closed", async () => {
    let release!: (runtime: FakeRuntime) => void;
    const runtime = new FakeRuntime();
    const createRuntime = vi.fn(
      () => new Promise<ChatGPTRuntime>((resolve) => (release = resolve)),
    );
    const controller = createChatGPTManagedOperationController({
      createRuntime,
    });
    const binding = base("operation-deferred-seal");
    const initializing = controller.initialize(binding);
    const sealing = controller.seal(binding);
    let settled = false;
    void sealing.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    release(runtime);
    await expect(sealing).resolves.toMatchObject({
      operationId: binding.operationId,
      cache: new TextEncoder().encode("rotated-cache"),
    });
    await expect(initializing).rejects.toMatchObject({ code: "expired" });
    expect(runtime.closeMock).toHaveBeenCalledOnce();
    await controller.close();
  });

  it("executes a typed review through the managed catalog and generation runtime", async () => {
    const runtime = new ReviewRuntime();
    const controller = createChatGPTManagedOperationController({
      createRuntime: vi.fn(async () => runtime),
    });
    const binding = base("operation-review");
    await controller.initialize(binding);
    const project = blankProject();
    project.id = "review-project";
    const result = await controller.review!(binding, {
      operationId: binding.operationId,
      epoch: binding.epoch,
      model: "gpt-5.6-luna",
      effort: "low",
      project,
      prompt: "Create a small world",
      browserModeling: false,
      phase: "review",
    });
    expect(result).toMatchObject({
      type: "orbsie.private.scene-review",
      operationId: binding.operationId,
      epoch: binding.epoch,
      review: { verdict: "accept", projectId: project.id },
      binding: { projectId: project.id, revision: 0 },
    });
    expect(runtime.requests.map(({ method }) => method)).toContain(
      "thread/start",
    );
    expect(runtime.requests.map(({ method }) => method)).toContain(
      "turn/start",
    );
    expect(result).not.toHaveProperty("project");
    expect(result).not.toHaveProperty("provenance");
    await controller.clear(binding);
  });

  it("rejects unsupported effort before starting model inference", async () => {
    const { controller, runtime } = fixture();
    const binding = base("operation-review-unsupported");
    await controller.initialize(binding);
    const project = blankProject();
    await expect(
      controller.review!(binding, {
        operationId: binding.operationId,
        epoch: binding.epoch,
        model: "gpt-5.6-luna",
        effort: "high",
        project,
        prompt: "Create a small world",
        browserModeling: false,
        phase: "review",
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(runtime.requests.map(({ method }) => method)).not.toContain(
      "thread/start",
    );
    await controller.clear(binding);
  });

  it("fences stale epochs and aborts a late review reply", async () => {
    const { controller, runtime } = fixture();
    const binding = base("operation-review-stale");
    await controller.initialize(binding);
    const project = blankProject();
    await expect(
      controller.review!(
        { ...binding, epoch: binding.epoch + 1 },
        {
          operationId: binding.operationId,
          epoch: binding.epoch,
          model: "gpt-5.6-luna",
          effort: "low",
          project,
          prompt: "Create a small world",
          browserModeling: false,
          phase: "review",
        },
      ),
    ).rejects.toMatchObject({ code: "stale" });

    const abort = new AbortController();
    const pending = controller.review!(
      binding,
      {
        operationId: binding.operationId,
        epoch: binding.epoch,
        model: "gpt-5.6-luna",
        effort: "low",
        project,
        prompt: "Create a small world",
        browserModeling: false,
        phase: "review",
      },
      abort.signal,
    );
    await vi.waitFor(() => {
      expect(runtime.requests.map(({ method }) => method)).toContain(
        "turn/start",
      );
    });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(runtime.closeMock).toHaveBeenCalled();
  });
});
