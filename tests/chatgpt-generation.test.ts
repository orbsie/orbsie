import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ChatGPTDeviceRpc } from "../src/lib/server/chatgpt-device-session";
import type { ChatGPTModel } from "../src/lib/server/chatgpt-models";
import {
  CHATGPT_GENERATION_CONFIG,
  CHATGPT_READ_POLICY,
} from "../src/lib/server/chatgpt-generation-policy";
import { createChatGPTGeneration } from "../src/lib/server/chatgpt-generation";
import {
  ChatGPTRpcError,
  generationDiagnostic,
} from "../src/lib/generation-diagnostics";

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

const model: ChatGPTModel = {
  id: "catalog-1",
  model: "gpt-5.1",
  displayName: "GPT 5.1",
  supportedReasoningEfforts: ["low", "medium"],
  defaultReasoningEffort: "low",
};

function fixture() {
  const listeners = new Set<(notification: unknown) => void>();
  const calls: Array<{ method: string; params: unknown }> = [];
  const turn = deferred<unknown>();
  const request = vi.fn((method: string, params?: unknown) => {
    calls.push({ method, params });
    if (method === "thread/start")
      return Promise.resolve({ thread: { id: "thread-1" } });
    if (method === "turn/start") return turn.promise;
    if (method === "turn/interrupt") return Promise.resolve({});
    return Promise.reject(Error("unexpected provider request"));
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
    calls,
    turn,
    notify(value: unknown) {
      for (const listener of [...listeners]) listener(value);
    },
    listenerCount: () => listeners.size,
  };
}

function options(fixtureValue: ReturnType<typeof fixture>, catalog = [model]) {
  return {
    rpc: fixtureValue.rpc,
    models: vi.fn(async () => catalog),
    dispose: vi.fn(async () => undefined),
  };
}

function input(onText: (delta: string) => void = () => undefined) {
  return {
    model: model.model,
    effort: "low",
    instructions: "Return scene commands.",
    input: "Make a small garden.",
    onText,
  };
}

async function flush() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

function delta(text: string, turnId = "turn-1", threadId = "thread-1") {
  return {
    method: "item/agentMessage/delta",
    params: { threadId, turnId, delta: text },
  };
}

function completed(
  status = "completed",
  turnId = "turn-1",
  threadId = "thread-1",
) {
  return {
    method: "turn/completed",
    params: {
      threadId,
      turn: { id: turnId, status },
    },
  };
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw Error("Expected generation to fail.");
}

describe("ChatGPT generation lifecycle", () => {
  afterEach(() => vi.useRealTimers());

  it("uses the fixed ephemeral read-only request policy and streams text", async () => {
    const f = fixture();
    const deps = options(f);
    const generation = createChatGPTGeneration(deps);
    const chunks: string[] = [];
    const run = generation.generate(input((value) => chunks.push(value)));
    await flush();
    expect(f.calls[0]).toEqual({
      method: "thread/start",
      params: {
        model: model.model,
        serviceTier: "default",
        ephemeral: true,
        approvalPolicy: "never",
        sandbox: "read-only",
        baseInstructions: "Return scene commands.",
        config: CHATGPT_GENERATION_CONFIG,
      },
    });
    expect(f.listenerCount()).toBe(1);
    expect(f.calls[1]).toEqual({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        model: model.model,
        effort: "low",
        serviceTier: "default",
        input: [{ type: "text", text: "Make a small garden." }],
        sandboxPolicy: CHATGPT_READ_POLICY,
        approvalPolicy: "never",
      },
    });
    f.notify(delta("hello "));
    f.notify(delta("world"));
    f.notify(completed());
    f.turn.resolve({ turn: { id: "turn-1" } });
    await expect(run).resolves.toBeUndefined();
    expect(chunks).toEqual(["hello ", "world"]);
    expect(f.listenerCount()).toBe(0);
    expect(deps.dispose).not.toHaveBeenCalled();
  });

  it("requires the exact catalog model and supported effort without fallback", async () => {
    const f = fixture();
    const generation = createChatGPTGeneration(options(f, [model]));
    await expect(
      generation.generate({ ...input(), model: "unlisted-model" }),
    ).rejects.toThrow("requested ChatGPT model is unavailable");
    await expect(
      generation.generate({ ...input(), effort: "high" }),
    ).rejects.toThrow("requested ChatGPT model is unavailable");
    expect(f.calls).toHaveLength(0);
  });

  it("rejects a second active generation and allows another after completion", async () => {
    const f = fixture();
    const generation = createChatGPTGeneration(options(f));
    const first = generation.generate(input());
    await flush();
    await expect(generation.generate(input())).rejects.toThrow(
      "already running",
    );
    f.turn.resolve({ turn: { id: "turn-1" } });
    f.notify(completed());
    await first;
    const secondFixture = fixture();
    const second = createChatGPTGeneration(options(secondFixture)).generate(
      input(),
    );
    await flush();
    secondFixture.turn.resolve({ turn: { id: "turn-1" } });
    secondFixture.notify(completed());
    await second;
  });

  it("does no provider work when already aborted", async () => {
    const f = fixture();
    const deps = options(f);
    const generation = createChatGPTGeneration(deps);
    const controller = new AbortController();
    controller.abort();
    await expect(
      generation.generate({ ...input(), signal: controller.signal }),
    ).rejects.toThrow("canceled");
    expect(deps.models).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(0);
    expect(deps.dispose).not.toHaveBeenCalled();
  });

  it("handles early, stale, cross-thread, and duplicate notifications", async () => {
    const f = fixture();
    const chunks: string[] = [];
    const generation = createChatGPTGeneration(options(f));
    const run = generation.generate(input((value) => chunks.push(value)));
    await flush();
    f.notify(delta("stale", "old-turn"));
    f.notify(delta("other-thread", "turn-1", "other-thread"));
    f.notify(delta("current"));
    f.notify(completed("completed", "old-turn"));
    f.notify(completed());
    f.notify(completed());
    f.turn.resolve({ turn: { id: "turn-1" } });
    await expect(run).resolves.toBeUndefined();
    expect(chunks).toEqual(["current"]);
  });

  it("requires an explicit turn id on streamed notifications", async () => {
    const f = fixture();
    const deps = options(f);
    const generation = createChatGPTGeneration(deps);
    const run = generation.generate(input());
    await flush();
    f.notify({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", delta: "missing id" },
    });
    await expect(run).rejects.toThrow("generation could not be completed");
    expect(deps.dispose).toHaveBeenCalledOnce();
  });

  it("interrupts a known turn and disposes when output delivery fails", async () => {
    const f = fixture();
    const deps = options(f);
    const generation = createChatGPTGeneration(deps);
    const run = generation.generate(
      input(() => {
        throw Error("ui callback diagnostic");
      }),
    );
    await flush();
    f.turn.resolve({ turn: { id: "turn-1" } });
    await flush();
    f.notify(delta("hello"));
    await expect(run).rejects.toThrow("generation could not be completed");
    expect(f.calls.at(-1)).toEqual({
      method: "turn/interrupt",
      params: { threadId: "thread-1", turnId: "turn-1" },
    });
    expect(deps.dispose).toHaveBeenCalledOnce();
  });

  it("disposes when buffered output delivery fails after an early terminal", async () => {
    const f = fixture();
    const deps = options(f);
    const generation = createChatGPTGeneration(deps);
    const run = generation.generate(
      input(() => {
        throw Error("ui callback diagnostic");
      }),
    );
    await flush();
    f.notify(delta("hello"));
    f.notify(completed());
    f.turn.resolve({ turn: { id: "turn-1" } });
    await expect(run).rejects.toThrow("generation could not be completed");
    expect(deps.dispose).toHaveBeenCalledOnce();
  });

  it("bounds aggregate output before the turn is acknowledged", async () => {
    const f = fixture();
    const deps = options(f);
    const generation = createChatGPTGeneration(deps);
    const run = generation.generate(input());
    await flush();
    f.notify(delta("x".repeat(64 * 1024)));
    f.notify(delta("y".repeat(64 * 1024)));
    f.notify(delta("z".repeat(64 * 1024)));
    f.notify(delta("a".repeat(64 * 1024)));
    f.notify(delta("b".repeat(64 * 1024)));
    f.notify(delta("c".repeat(64 * 1024)));
    f.notify(delta("d".repeat(64 * 1024)));
    f.notify(delta("e".repeat(64 * 1024)));
    f.notify(delta("f".repeat(1)));
    await expect(run).rejects.toThrow("generation could not be completed");
    expect(deps.dispose).toHaveBeenCalledOnce();
  });

  it("bounds the number of empty deltas", async () => {
    const f = fixture();
    const deps = options(f);
    const generation = createChatGPTGeneration(deps);
    const run = generation.generate(input());
    await flush();
    for (let index = 0; index < 8193; index++) f.notify(delta(""));
    await expect(run).rejects.toThrow("generation could not be completed");
    expect(deps.dispose).toHaveBeenCalledOnce();
  });

  it("disposes when cancellation arrives before a turn id is known", async () => {
    const f = fixture();
    const deps = options(f);
    const generation = createChatGPTGeneration(deps);
    const controller = new AbortController();
    const run = generation.generate({ ...input(), signal: controller.signal });
    await flush();
    controller.abort();
    await expect(run).rejects.toThrow("canceled");
    expect(f.calls.some((call) => call.method === "turn/interrupt")).toBe(
      false,
    );
    expect(deps.dispose).toHaveBeenCalledOnce();
  });

  it("does not reuse a runtime after interrupt acknowledgement without a terminal event", async () => {
    const f = fixture();
    const deps = options(f);
    const generation = createChatGPTGeneration(deps);
    const controller = new AbortController();
    const run = generation.generate({ ...input(), signal: controller.signal });
    await flush();
    f.turn.resolve({ turn: { id: "turn-1" } });
    await flush();
    controller.abort();
    await expect(run).rejects.toThrow("canceled");
    expect(f.calls.at(-1)).toEqual({
      method: "turn/interrupt",
      params: { threadId: "thread-1", turnId: "turn-1" },
    });
    expect(deps.dispose).toHaveBeenCalledOnce();
    await expect(generation.generate(input())).rejects.toThrow(
      "generation could not be completed",
    );
  });

  it("keeps the instance unusable when disposal itself fails", async () => {
    const f = fixture();
    const deps = options(f);
    deps.dispose.mockRejectedValue(Error("private cleanup detail"));
    const generation = createChatGPTGeneration(deps);
    const controller = new AbortController();
    const run = generation.generate({ ...input(), signal: controller.signal });
    await flush();
    f.turn.resolve({ turn: { id: "turn-1" } });
    await flush();
    controller.abort();
    await expect(run).rejects.toThrow("canceled");
    await expect(generation.generate(input())).rejects.toThrow(
      "generation could not be completed",
    );
  });

  it("interrupts and disposes on timeout when the turn is active", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const deps = options(f);
    const generation = createChatGPTGeneration({ ...deps, timeoutMs: 20 });
    const run = generation.generate(input());
    const result = expect(run).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(1);
    f.turn.resolve({ turn: { id: "turn-1" } });
    await flush();
    await vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(50);
    await result;
    expect(f.calls.at(-1)).toEqual({
      method: "turn/interrupt",
      params: { threadId: "thread-1", turnId: "turn-1" },
    });
    expect(deps.dispose).toHaveBeenCalledOnce();
  });

  it("fails and disposes on runtime tool execution or runtime close", async () => {
    const f = fixture();
    const deps = options(f);
    const generation = createChatGPTGeneration(deps);
    const run = generation.generate(input());
    await flush();
    f.notify({
      method: "item/started",
      params: {
        threadId: "thread-1",
        item: { type: "commandExecution", command: "cat secret" },
      },
    });
    await expect(run).rejects.toThrow("generation could not be completed");
    expect(deps.dispose).toHaveBeenCalledOnce();

    const secondFixture = fixture();
    const secondDeps = options(secondFixture);
    const second = createChatGPTGeneration(secondDeps);
    const secondRun = second.generate(input());
    await flush();
    secondFixture.notify({ method: "orbsie/runtime/closed", params: {} });
    await expect(secondRun).rejects.toThrow(
      "generation could not be completed",
    );
    expect(secondDeps.dispose).toHaveBeenCalledOnce();
  });

  it("redacts transport errors and cleans up on malformed terminal events", async () => {
    const f = fixture();
    f.request.mockImplementationOnce(async () => {
      throw Error("access_token=provider-secret");
    });
    const deps = options(f);
    const generation = createChatGPTGeneration(deps);
    await expect(generation.generate(input())).rejects.toThrow(
      "generation could not be completed",
    );

    const malformed = fixture();
    const malformedDeps = options(malformed);
    const malformedGeneration = createChatGPTGeneration(malformedDeps);
    const run = malformedGeneration.generate(input());
    await flush();
    malformed.notify({
      method: "turn/completed",
      params: { threadId: "thread-1", turnId: "turn-1", turn: {} },
    });
    malformed.turn.resolve({ turn: { id: "turn-1" } });
    await expect(run).rejects.toThrow("generation could not be completed");
    expect(malformedDeps.dispose).toHaveBeenCalledOnce();
  });

  it("reports a safe catalog-stage rejection without preserving raw causes", async () => {
    const f = fixture();
    const deps = options(f);
    deps.models.mockRejectedValue(
      Error("access_token=private-secret prompt=private-prompt"),
    );
    const error = await failureOf(
      createChatGPTGeneration(deps).generate(input()),
    );
    expect(generationDiagnostic(error)).toEqual({
      code: "CHATGPT_GENERATION_ERROR",
      diagnostic: {
        operation: 0,
        issues: [],
        stage: "catalog",
        reason: "unknown",
      },
    });
    expect(JSON.stringify(error)).not.toContain("private-secret");
    expect(JSON.stringify(error)).not.toContain("private-prompt");
  });

  it("reports bounded RPC codes at thread and turn start", async () => {
    const threadFailure = fixture();
    threadFailure.request.mockImplementationOnce(async () => {
      throw new ChatGPTRpcError(401);
    });
    const threadError = await failureOf(
      createChatGPTGeneration(options(threadFailure)).generate(input()),
    );
    expect(generationDiagnostic(threadError)).toEqual({
      code: "CHATGPT_GENERATION_ERROR",
      diagnostic: {
        operation: 0,
        issues: [],
        stage: "thread-start",
        reason: "rpc-rejection",
        rpcCode: 401,
      },
    });

    const turnFailure = fixture();
    turnFailure.turn.reject(new ChatGPTRpcError(999_999));
    const turnError = await failureOf(
      createChatGPTGeneration(options(turnFailure)).generate(input()),
    );
    expect(generationDiagnostic(turnError)).toEqual({
      code: "CHATGPT_GENERATION_ERROR",
      diagnostic: {
        operation: 0,
        issues: [],
        stage: "turn-start",
        reason: "rpc-rejection",
      },
    });
  });

  it("uses the official nested turn identity for pre-ack terminal events", async () => {
    const f = fixture();
    const generation = createChatGPTGeneration(options(f));
    const run = generation.generate(input());
    await flush();
    f.notify(completed("failed"));
    f.turn.resolve({ turn: { id: "turn-1" } });
    const error = await failureOf(run);
    expect(generationDiagnostic(error)).toEqual({
      code: "CHATGPT_GENERATION_ERROR",
      diagnostic: {
        operation: 0,
        issues: [],
        stage: "stream",
        reason: "terminal-failure",
      },
    });
  });

  it("does not attribute an unrelated pre-ack terminal to a turn RPC failure", async () => {
    const f = fixture();
    const generation = createChatGPTGeneration(options(f));
    const run = generation.generate(input());
    await flush();
    f.notify(completed("failed", "other-turn"));
    f.turn.reject(new ChatGPTRpcError(409));
    const error = await failureOf(run);
    expect(generationDiagnostic(error)).toMatchObject({
      code: "CHATGPT_GENERATION_ERROR",
      diagnostic: {
        stage: "stream",
        reason: "rpc-rejection",
        rpcCode: 409,
      },
    });
  });

  it("rejects conflicting top-level and nested terminal identities", async () => {
    const f = fixture();
    const generation = createChatGPTGeneration(options(f));
    const run = generation.generate(input());
    await flush();
    f.notify({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        turn: { id: "other-turn", status: "completed" },
      },
    });
    const error = await failureOf(run);
    expect(generationDiagnostic(error)).toMatchObject({
      code: "CHATGPT_GENERATION_ERROR",
      diagnostic: { stage: "stream", reason: "unknown" },
    });
  });

  it("reports callback scene validation with only bounded cause fields", async () => {
    const f = fixture();
    const validation = new z.ZodError([
      {
        code: "custom",
        path: ["geometry", "privateNode"],
        message: "access_token=private-secret",
      },
    ]);
    const generation = createChatGPTGeneration(options(f));
    const run = generation.generate(
      input(() => {
        throw validation;
      }),
    );
    await flush();
    f.turn.resolve({ turn: { id: "turn-1" } });
    await flush();
    f.notify(delta("private scene text"));
    const error = await failureOf(run);
    const diagnostic = generationDiagnostic(error, 7, null);
    expect(diagnostic).toEqual({
      code: "INVALID_SCENE_UPDATE",
      diagnostic: {
        operation: 7,
        issues: [{ code: "custom", path: ["geometry", "?"] }],
        stage: "stream",
        reason: "callback-validation",
      },
    });
    expect(JSON.stringify(diagnostic)).not.toContain("private");
  });

  it("classifies tool, output, cancellation, timeout, and runtime closure safely", async () => {
    const tool = fixture();
    const toolRun = createChatGPTGeneration(options(tool)).generate(input());
    await flush();
    tool.notify({
      method: "item/commandExecution/request",
      params: { item: { type: "commandExecution", command: "cat secret" } },
    });
    expect(generationDiagnostic(await failureOf(toolRun))).toMatchObject({
      diagnostic: {
        stage: "stream",
        reason: "tool-rejection",
      },
    });

    const output = fixture();
    const outputRun = createChatGPTGeneration(options(output)).generate(
      input(),
    );
    await flush();
    output.notify(delta("x".repeat(64 * 1024)));
    output.notify(delta("y".repeat(64 * 1024)));
    output.notify(delta("z".repeat(64 * 1024)));
    output.notify(delta("a".repeat(64 * 1024)));
    output.notify(delta("b".repeat(64 * 1024)));
    output.notify(delta("c".repeat(64 * 1024)));
    output.notify(delta("d".repeat(64 * 1024)));
    output.notify(delta("e".repeat(64 * 1024)));
    output.notify(delta("f"));
    expect(generationDiagnostic(await failureOf(outputRun))).toMatchObject({
      diagnostic: {
        stage: "stream",
        reason: "output-bound",
      },
    });

    const closed = fixture();
    const closedRun = createChatGPTGeneration(options(closed)).generate(
      input(),
    );
    await flush();
    closed.notify({ method: "orbsie/runtime/closed", params: {} });
    expect(generationDiagnostic(await failureOf(closedRun))).toMatchObject({
      diagnostic: {
        stage: "stream",
        reason: "runtime-closed",
      },
    });

    const cancelled = fixture();
    const cancelController = new AbortController();
    const cancelRun = createChatGPTGeneration(options(cancelled)).generate({
      ...input(),
      signal: cancelController.signal,
    });
    await flush();
    cancelController.abort();
    expect(generationDiagnostic(await failureOf(cancelRun))).toMatchObject({
      diagnostic: { reason: "cancelled" },
    });

    vi.useFakeTimers();
    try {
      const timed = fixture();
      const timedRun = createChatGPTGeneration({
        ...options(timed),
        timeoutMs: 20,
      }).generate(input());
      const timedFailure = failureOf(timedRun);
      await vi.advanceTimersByTimeAsync(20);
      expect(generationDiagnostic(await timedFailure)).toMatchObject({
        diagnostic: { reason: "timeout" },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
