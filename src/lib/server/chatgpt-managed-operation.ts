import { ChatGPTDeviceSession } from "./chatgpt-device-session";
import { createChatGPTGeneration } from "./chatgpt-generation";
import { listChatGPTModels, type ChatGPTModel } from "./chatgpt-models";
import { createChatGPTSceneStream } from "./chatgpt-scene-stream";
import { CHATGPT_MANAGED_CREDENTIAL_CACHE_MAX_BYTES } from "./chatgpt-managed-credential-store";
import { imageInputSupport } from "../input-modalities";
import {
  executeSceneReview,
  type SceneReviewExecutionInput,
} from "./scene-review-execution";
import {
  parsePrivateSceneReviewRequest,
  parsePrivateSceneReviewResult,
  privateSceneReviewResult,
  type PrivateSceneReviewResult,
} from "./chatgpt-scene-review";
import {
  PRIVATE_SCENE_COMPLETION_VERSION,
  type PrivateSceneCompletion,
} from "./chatgpt-scene-completion";
import type { ChatGPTRuntime } from "./chatgpt-runtime";
import {
  createGenerationObservation,
  type GenerationObservationCorrelation,
} from "./generation-observability";

export const CHATGPT_MANAGED_OPERATION_MAX_MS = 180_000;

export type ManagedOperationBinding = {
  operationId: string;
  epoch: number;
};

export type ChatGPTManagedOperationInitialize = ManagedOperationBinding & {
  deadlineAt: number;
  initialCredentialCache?: Uint8Array;
};

export type ChatGPTManagedOperationResult = ManagedOperationBinding & {
  deadlineAt: number;
};

export type ChatGPTManagedOperationSeal = ManagedOperationBinding & {
  deadlineAt: number;
  expired: boolean;
  cache: Uint8Array | null;
};

export type ChatGPTManagedOperationRuntimeFactory = (options: {
  allowGeneration: true;
  initialCredentialCache?: Uint8Array;
}) => Promise<ChatGPTRuntime>;

export type ChatGPTManagedOperationController = {
  initialize(
    input: ChatGPTManagedOperationInitialize,
    signal?: AbortSignal,
  ): Promise<ChatGPTManagedOperationResult>;
  status(
    binding: ManagedOperationBinding,
    signal?: AbortSignal,
  ): Promise<{ status: "unknown" | "connected" | "disconnected" }>;
  models(
    binding: ManagedOperationBinding,
    signal?: AbortSignal,
  ): Promise<ChatGPTModel[]>;
  generate(
    binding: ManagedOperationBinding,
    input: unknown,
    signal?: AbortSignal,
    correlation?: GenerationObservationCorrelation,
    sceneCompletionVersion?: typeof PRIVATE_SCENE_COMPLETION_VERSION,
  ): Promise<ReadableStream<Uint8Array>>;
  review?(
    binding: ManagedOperationBinding,
    input: unknown,
    signal?: AbortSignal,
    correlation?: GenerationObservationCorrelation,
  ): Promise<PrivateSceneReviewResult>;
  seal(
    binding: ManagedOperationBinding,
    signal?: AbortSignal,
  ): Promise<ChatGPTManagedOperationSeal>;
  clear(binding: ManagedOperationBinding): Promise<void>;
  /** True while an operation is initialized, ready, sealing, or sealed. */
  hasActiveOperation(): boolean;
  close(): Promise<void>;
};

export class ChatGPTManagedOperationError extends Error {
  constructor(
    public readonly code:
      | "invalid"
      | "busy"
      | "stale"
      | "replay"
      | "expired"
      | "closed"
      | "aborted"
      | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "ChatGPTManagedOperationError";
  }
}

type Phase = "initializing" | "ready" | "sealing" | "sealed" | "cleared";

type Slot = {
  operationId: string;
  epoch: number;
  deadlineAt: number;
  phase: Phase;
  expired: boolean;
  invalidated: boolean;
  runtime?: ChatGPTRuntime;
  runtimePromise?: Promise<ChatGPTRuntime>;
  runtimeClosePromise?: Promise<void>;
  session?: ChatGPTDeviceSession;
  generator?: ReturnType<typeof createChatGPTGeneration>;
  cache?: Uint8Array | null;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  sealPromise?: Promise<void>;
  abortController: AbortController;
};

const invalid = (message = "The managed ChatGPT operation is invalid.") =>
  new ChatGPTManagedOperationError("invalid", message);
const sameBinding = (
  slot: Pick<Slot, "operationId" | "epoch">,
  binding: ManagedOperationBinding,
) => slot.operationId === binding.operationId && slot.epoch === binding.epoch;
const validOperationId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= 128 &&
  /^[A-Za-z0-9_-]+$/.test(value);
const validEpoch = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const validDeadline = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

function checkedBinding(
  value: unknown,
): asserts value is ManagedOperationBinding {
  if (
    !value ||
    typeof value !== "object" ||
    !validOperationId((value as ManagedOperationBinding).operationId) ||
    !validEpoch((value as ManagedOperationBinding).epoch)
  )
    throw invalid("The managed ChatGPT operation identity is invalid.");
}

function copyCache(value: Uint8Array | null | undefined): Uint8Array | null {
  if (value === null || value === undefined) return null;
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > CHATGPT_MANAGED_CREDENTIAL_CACHE_MAX_BYTES
  )
    throw invalid("The managed ChatGPT credential cache is invalid.");
  return Uint8Array.from(value);
}

function combinedSignal(
  slot: Slot,
  signal: AbortSignal | undefined,
  now: () => number,
): AbortSignal {
  const remaining = Math.max(1, slot.deadlineAt - now());
  return AbortSignal.any([
    slot.abortController.signal,
    AbortSignal.timeout(remaining),
    ...(signal ? [signal] : []),
  ]);
}

async function awaitAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted)
    throw new ChatGPTManagedOperationError(
      "aborted",
      "The managed ChatGPT operation was canceled.",
    );
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      finish();
      reject(
        new ChatGPTManagedOperationError(
          "aborted",
          "The managed ChatGPT operation was canceled.",
        ),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        finish();
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        finish();
        reject(
          new ChatGPTManagedOperationError(
            "unavailable",
            "The managed ChatGPT operation failed.",
          ),
        );
      },
    );
  });
}

function publicBinding(slot: Slot): ChatGPTManagedOperationResult {
  return {
    operationId: slot.operationId,
    epoch: slot.epoch,
    deadlineAt: slot.deadlineAt,
  };
}

export function createChatGPTManagedOperationController(options: {
  createRuntime: ChatGPTManagedOperationRuntimeFactory;
  now?: () => number;
}): ChatGPTManagedOperationController {
  if (!options || typeof options.createRuntime !== "function")
    throw Error("A managed ChatGPT runtime factory is required.");
  const now = options.now ?? Date.now;
  let slot: Slot | undefined;
  const retired = new Map<string, number>();

  const rememberRetired = (operationId: string, epoch: number) => {
    retired.set(operationId, epoch);
  };

  const clearDeadline = (current: Slot) => {
    if (current.deadlineTimer !== undefined) {
      clearTimeout(current.deadlineTimer);
      current.deadlineTimer = undefined;
    }
  };

  const closeRuntime = async (current: Slot) => {
    if (!current.runtime) return;
    current.runtimeClosePromise ??= Promise.resolve().then(() =>
      current.runtime!.close(),
    );
    await current.runtimeClosePromise;
  };

  const stopAndSeal = async (current: Slot): Promise<void> => {
    if (current.phase === "cleared" || current.phase === "sealed") return;
    if (current.sealPromise) return current.sealPromise;
    current.phase = "sealing";
    current.abortController.abort();
    const promise = (async () => {
      let runtime = current.runtime;
      if (!runtime && current.runtimePromise) {
        runtime = await current.runtimePromise;
        current.runtime = runtime;
        current.runtimePromise = undefined;
      }
      if (runtime) {
        await closeRuntime(current);
        const snapshot = await runtime.getCredentialSnapshot();
        current.cache = copyCache(snapshot?.cache);
      } else current.cache = null;
      clearDeadline(current);
      if (!current.invalidated) current.phase = "sealed";
    })();
    current.sealPromise = promise;
    try {
      await promise;
    } catch (error) {
      current.sealPromise = undefined;
      throw error instanceof ChatGPTManagedOperationError
        ? error
        : new ChatGPTManagedOperationError(
            "unavailable",
            "The managed ChatGPT operation could not be sealed.",
          );
    }
  };

  const expire = (current: Slot) => {
    if (
      slot !== current ||
      current.phase === "cleared" ||
      current.phase === "sealed"
    )
      return;
    current.expired = true;
    void stopAndSeal(current).catch(() => undefined);
  };

  const matchingSlot = (
    binding: ManagedOperationBinding,
    allowSealed = false,
  ): Slot => {
    checkedBinding(binding);
    const current = slot;
    if (
      !current ||
      !sameBinding(current, binding) ||
      (!allowSealed && current.phase !== "ready")
    )
      throw new ChatGPTManagedOperationError(
        current && sameBinding(current, binding)
          ? current.expired && !allowSealed
            ? "expired"
            : "closed"
          : "stale",
        current && sameBinding(current, binding)
          ? current.expired && !allowSealed
            ? "The managed ChatGPT operation deadline has expired."
            : "The managed ChatGPT operation is closed."
          : "The managed ChatGPT operation is stale.",
      );
    return current;
  };

  const readySlot = async (binding: ManagedOperationBinding): Promise<Slot> => {
    const current = matchingSlot(binding);
    if (current.expired || now() >= current.deadlineAt) {
      current.expired = true;
      await stopAndSeal(current);
      throw new ChatGPTManagedOperationError(
        "expired",
        "The managed ChatGPT operation deadline has expired.",
      );
    }
    if (!current.runtime || !current.session || !current.generator)
      throw new ChatGPTManagedOperationError(
        "unavailable",
        "The managed ChatGPT operation is not ready.",
      );
    return current;
  };

  const initialize = async (
    input: ChatGPTManagedOperationInitialize,
    signal?: AbortSignal,
  ): Promise<ChatGPTManagedOperationResult> => {
    checkedBinding(input);
    if (signal?.aborted)
      throw new ChatGPTManagedOperationError(
        "aborted",
        "The managed ChatGPT operation was canceled.",
      );
    if (!validDeadline(input.deadlineAt))
      throw invalid("The managed ChatGPT deadline is invalid.");
    const startedAt = now();
    if (input.deadlineAt <= startedAt)
      throw new ChatGPTManagedOperationError(
        "expired",
        "The managed ChatGPT deadline has expired.",
      );
    if (input.deadlineAt - startedAt > CHATGPT_MANAGED_OPERATION_MAX_MS)
      throw invalid("The managed ChatGPT deadline is too far away.");
    if (
      input.initialCredentialCache !== undefined &&
      copyCache(input.initialCredentialCache) === null
    )
      throw invalid("The managed ChatGPT credential cache is invalid.");
    if (slot) {
      if (sameBinding(slot, input))
        throw new ChatGPTManagedOperationError(
          "replay",
          "The managed ChatGPT operation was already initialized.",
        );
      throw new ChatGPTManagedOperationError(
        "busy",
        "Another managed ChatGPT operation is active.",
      );
    }
    if (retired.has(input.operationId))
      throw new ChatGPTManagedOperationError(
        "replay",
        "The managed ChatGPT operation was already retired.",
      );
    if (retired.size >= 64)
      throw new ChatGPTManagedOperationError(
        "busy",
        "The managed ChatGPT operation capacity is exhausted.",
      );
    if (signal?.aborted)
      throw new ChatGPTManagedOperationError(
        "aborted",
        "The managed ChatGPT operation was canceled.",
      );

    const current: Slot = {
      operationId: input.operationId,
      epoch: input.epoch,
      deadlineAt: input.deadlineAt,
      phase: "initializing",
      expired: false,
      invalidated: false,
      abortController: new AbortController(),
    };
    slot = current;
    const cancelInitialization = () => {
      current.invalidated = true;
      current.abortController.abort();
      void stopAndSeal(current).catch(() => undefined);
    };
    signal?.addEventListener("abort", cancelInitialization, { once: true });
    // Recheck after registering the listener but before scheduling the
    // factory. An already-aborted request must never start a late runtime.
    if (signal?.aborted) {
      signal.removeEventListener("abort", cancelInitialization);
      current.invalidated = true;
      current.phase = "cleared";
      rememberRetired(current.operationId, current.epoch);
      if (slot === current) slot = undefined;
      throw new ChatGPTManagedOperationError(
        "aborted",
        "The managed ChatGPT operation was canceled.",
      );
    }
    current.deadlineTimer = setTimeout(
      () => {
        current.expired = true;
        expire(current);
      },
      Math.max(1, input.deadlineAt - startedAt),
    );
    const initialCredentialCache =
      input.initialCredentialCache === undefined
        ? undefined
        : copyCache(input.initialCredentialCache)!;
    try {
      const runtimePromise = Promise.resolve().then(() =>
        options.createRuntime({
          allowGeneration: true,
          ...(initialCredentialCache ? { initialCredentialCache } : {}),
        }),
      );
      current.runtimePromise = runtimePromise;
      const runtime = await runtimePromise;
      current.runtimePromise = undefined;
      current.runtime = runtime;
      if (
        current.phase !== "initializing" ||
        current.expired ||
        current.invalidated ||
        signal?.aborted ||
        now() >= current.deadlineAt
      ) {
        await closeRuntime(current);
        throw new ChatGPTManagedOperationError(
          signal?.aborted ? "aborted" : "expired",
          signal?.aborted
            ? "The managed ChatGPT operation was canceled."
            : "The managed ChatGPT operation deadline has expired.",
        );
      }
      const session = new ChatGPTDeviceSession({
        ownerId: "managed-operation",
        sessionId: current.operationId,
        rpc: runtime,
      });
      current.session = session;
      current.generator = createChatGPTGeneration({
        rpc: runtime,
        models: () => listChatGPTModels(runtime, session),
        dispose: () => closeRuntime(current),
        timeoutMs: Math.min(
          CHATGPT_MANAGED_OPERATION_MAX_MS,
          Math.max(1, current.deadlineAt - now()),
        ),
      });
      if (current.expired || now() >= current.deadlineAt) {
        await stopAndSeal(current);
        throw new ChatGPTManagedOperationError(
          "expired",
          "The managed ChatGPT operation deadline has expired.",
        );
      }
      current.phase = "ready";
      signal?.removeEventListener("abort", cancelInitialization);
      return publicBinding(current);
    } catch (error) {
      current.runtimePromise = undefined;
      if (current.runtime) {
        try {
          await closeRuntime(current);
        } catch {
          current.invalidated = true;
          current.phase = "sealing";
          throw new ChatGPTManagedOperationError(
            "unavailable",
            "The managed ChatGPT operation could not be stopped.",
          );
        }
      }
      signal?.removeEventListener("abort", cancelInitialization);
      if (current.phase === "initializing") {
        clearDeadline(current);
        current.invalidated = true;
        current.phase = "cleared";
        rememberRetired(current.operationId, current.epoch);
        if (slot === current) slot = undefined;
      } else if (current.phase === "sealing" && !current.runtime) {
        // The factory rejected before it could create a process. There is no
        // late runtime to clean up, so retire this failed initialization.
        clearDeadline(current);
        current.phase = "cleared";
        rememberRetired(current.operationId, current.epoch);
        if (slot === current) slot = undefined;
      }
      if (error instanceof ChatGPTManagedOperationError) throw error;
      throw new ChatGPTManagedOperationError(
        "unavailable",
        "The managed ChatGPT operation could not be initialized.",
      );
    }
  };

  const run = async <T>(
    binding: ManagedOperationBinding,
    signal: AbortSignal | undefined,
    operation: (current: Slot, signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    const current = await readySlot(binding);
    const operationSignal = combinedSignal(current, signal, now);
    const onAbort = () => {
      void stopAndSeal(current).catch(() => undefined);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await awaitAbort(
        operation(current, operationSignal),
        operationSignal,
      );
    } catch (error) {
      if (
        error instanceof ChatGPTManagedOperationError &&
        error.code === "aborted"
      ) {
        void stopAndSeal(current).catch(() => undefined);
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  };

  const status = (binding: ManagedOperationBinding, signal?: AbortSignal) =>
    run(binding, signal, (current) => current.session!.readAuthStatus()).then(
      (result) => result,
    );

  const models = (binding: ManagedOperationBinding, signal?: AbortSignal) =>
    run(binding, signal, (current) =>
      listChatGPTModels(current.runtime!, current.session!),
    );

  const review = async (
    binding: ManagedOperationBinding,
    input: unknown,
    signal?: AbortSignal,
    correlation?: GenerationObservationCorrelation,
  ): Promise<PrivateSceneReviewResult> => {
    const current = await readySlot(binding);
    const operationSignal = combinedSignal(current, signal, now);
    const onAbort = () => {
      void stopAndSeal(current).catch(() => undefined);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const observation = correlation
      ? createGenerationObservation({
          layer: "provider",
          requestId: correlation.requestId,
          clientRunId: correlation.clientRunId,
          provider: "chatgpt",
          serviceTier: "default",
        })
      : undefined;
    try {
      let request: ReturnType<typeof parsePrivateSceneReviewRequest>;
      try {
        request = parsePrivateSceneReviewRequest(input);
      } catch {
        throw invalid("The private scene review request is invalid.");
      }
      if (
        request.operationId !== current.operationId ||
        request.epoch !== current.epoch
      )
        throw new ChatGPTManagedOperationError(
          "stale",
          "The managed ChatGPT operation is stale.",
        );
      operationSignal.throwIfAborted();

      // The catalog is read from this exact managed runtime before inference.
      // A caller cannot claim support for a model, effort, or image input.
      const catalog = await awaitAbort(
        listChatGPTModels(current.runtime!, current.session!),
        operationSignal,
      );
      const selected = catalog.find(
        (candidate) => candidate.model === request.model,
      );
      if (
        !selected ||
        !selected.supportedReasoningEfforts.includes(request.effort)
      )
        throw new ChatGPTManagedOperationError(
          "unavailable",
          "The requested ChatGPT review capability is unavailable.",
        );
      const imageSupport = imageInputSupport(selected.inputModalities);
      if (request.reviewImage && imageSupport !== true)
        throw new ChatGPTManagedOperationError(
          "unavailable",
          "The requested ChatGPT review image capability is unavailable.",
        );
      const capabilities: NonNullable<
        SceneReviewExecutionInput["capabilities"]
      > = {
        text: { supported: true, source: "catalog" },
        streamingText: { supported: true, source: "catalog" },
        tools: { supported: false, source: "catalog" },
        structuredOutput: { supported: false, source: "catalog" },
        imageInput: {
          supported: imageSupport,
          source: imageSupport === "unknown" ? "unspecified" : "catalog",
        },
      };
      const result = await awaitAbort(
        executeSceneReview({
          provider: "chatgpt",
          model: selected.model,
          effort: request.effort,
          project: request.project,
          prompt: request.prompt,
          ...(request.selected === undefined
            ? {}
            : { selected: request.selected }),
          browserModeling: request.browserModeling,
          phase: request.phase,
          ...(request.reviewImage ? { reviewImage: request.reviewImage } : {}),
          ...(request.feedback === undefined
            ? {}
            : { feedback: request.feedback }),
          capabilities,
          signal: operationSignal,
          hostedGenerator: current.generator,
        }),
        operationSignal,
      );
      operationSignal.throwIfAborted();
      if (
        current.invalidated ||
        current.phase !== "ready" ||
        !sameBinding(current, binding)
      )
        throw new ChatGPTManagedOperationError(
          "aborted",
          "The managed ChatGPT operation was canceled.",
        );
      const privateResult = parsePrivateSceneReviewResult(
        privateSceneReviewResult(binding, result),
        {
          operationId: binding.operationId,
          epoch: binding.epoch,
          projectId: request.project.id,
          revision: request.project.revision,
          phase: request.phase,
          browserModeling: request.browserModeling,
        },
      );
      observation?.terminal({ reason: "completed" });
      return privateResult;
    } catch (error) {
      observation?.terminal({
        reason:
          operationSignal.aborted && signal?.reason?.name === "TimeoutError"
            ? "deadline"
            : operationSignal.aborted
              ? "client-abort"
              : "provider-error",
        abortSource: operationSignal.aborted ? "client" : undefined,
        failureCode: operationSignal.aborted ? "cancelled" : "host-unavailable",
      });
      if (error instanceof ChatGPTManagedOperationError) throw error;
      if (operationSignal.aborted)
        throw new ChatGPTManagedOperationError(
          "aborted",
          "The managed ChatGPT operation was canceled.",
        );
      throw new ChatGPTManagedOperationError(
        "unavailable",
        "The managed ChatGPT scene review failed.",
      );
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  };

  const generate = async (
    binding: ManagedOperationBinding,
    input: unknown,
    signal?: AbortSignal,
    correlation?: GenerationObservationCorrelation,
    sceneCompletionVersion?: typeof PRIVATE_SCENE_COMPLETION_VERSION,
  ): Promise<ReadableStream<Uint8Array>> => {
    const current = await readySlot(binding);
    const operationSignal = combinedSignal(current, signal, now);
    const onAbort = () => {
      void stopAndSeal(current).catch(() => undefined);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const observation = correlation
      ? createGenerationObservation({
          layer: "provider",
          requestId: correlation.requestId,
          clientRunId: correlation.clientRunId,
          provider: "chatgpt",
          serviceTier: "default",
        })
      : undefined;
    try {
      let completion: PrivateSceneCompletion | undefined;
      const source = createChatGPTSceneStream(
        input,
        current.generator!,
        operationSignal,
        {
          observability: observation,
          ...(sceneCompletionVersion === PRIVATE_SCENE_COMPLETION_VERSION
            ? {
                lifecycle: {
                  onComplete: async ({ binding, signal }) => {
                    signal.throwIfAborted();
                    completion = {
                      type: "orbsie.private.scene-completion",
                      version: PRIVATE_SCENE_COMPLETION_VERSION,
                      operationId: current.operationId,
                      epoch: current.epoch,
                      projectId: binding.projectId,
                      revision: binding.revision,
                      bindingVersion: binding.version,
                      digest: binding.digest,
                    };
                  },
                },
              }
            : {}),
        },
      );
      if (sceneCompletionVersion !== PRIVATE_SCENE_COMPLETION_VERSION)
        return source;
      const reader = source.getReader();
      const encoder = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (!next.done) {
              controller.enqueue(next.value);
              return;
            }
            reader.releaseLock();
            if (!completion)
              throw new ChatGPTManagedOperationError(
                "unavailable",
                "The scene completion record was not produced.",
              );
            operationSignal.throwIfAborted();
            if (current.invalidated || current.phase !== "ready")
              throw new ChatGPTManagedOperationError(
                "aborted",
                "The managed ChatGPT operation was canceled.",
              );
            controller.enqueue(
              encoder.encode(`${JSON.stringify(completion)}\n`),
            );
            controller.close();
          } catch (error) {
            reader.releaseLock();
            controller.error(error);
          }
        },
        async cancel(reason) {
          current.abortController.abort(reason);
          await reader.cancel(reason).catch(() => undefined);
          reader.releaseLock();
        },
      });
    } catch (error) {
      signal?.removeEventListener("abort", onAbort);
      observation?.terminal({
        reason: "parser-failure",
        failureCode: "invalid-input",
      });
      throw error;
    }
  };

  const seal = async (
    binding: ManagedOperationBinding,
    signal?: AbortSignal,
  ): Promise<ChatGPTManagedOperationSeal> => {
    const current = matchingSlot(binding, true);
    if (current.invalidated || current.phase === "cleared")
      throw new ChatGPTManagedOperationError(
        "stale",
        "The managed ChatGPT operation is stale.",
      );
    if (current.phase !== "sealed") {
      if (signal?.aborted)
        throw new ChatGPTManagedOperationError(
          "aborted",
          "The managed ChatGPT operation was canceled.",
        );
      await stopAndSeal(current);
    }
    if (current.invalidated || current.phase !== "sealed")
      throw new ChatGPTManagedOperationError(
        "closed",
        "The managed ChatGPT operation is closed.",
      );
    return {
      operationId: current.operationId,
      epoch: current.epoch,
      deadlineAt: current.deadlineAt,
      expired: current.expired,
      cache: copyCache(current.cache),
    };
  };

  const clear = async (binding: ManagedOperationBinding): Promise<void> => {
    const current = matchingSlot(binding, true);
    if (current.invalidated || current.phase === "cleared")
      throw new ChatGPTManagedOperationError(
        "stale",
        "The managed ChatGPT operation is stale.",
      );
    current.invalidated = true;
    await stopAndSeal(current);
    current.cache = null;
    current.phase = "cleared";
    clearDeadline(current);
    rememberRetired(current.operationId, current.epoch);
    if (slot === current) slot = undefined;
  };

  const close = async () => {
    if (!slot) return;
    const current = slot;
    current.invalidated = true;
    await stopAndSeal(current);
    current.cache = null;
    current.phase = "cleared";
    clearDeadline(current);
    rememberRetired(current.operationId, current.epoch);
    if (slot === current) slot = undefined;
  };

  const hasActiveOperation = () => slot !== undefined;

  return {
    initialize,
    status,
    models,
    generate,
    review,
    seal,
    clear,
    hasActiveOperation,
    close,
  };
}
