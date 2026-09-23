import { randomUUID } from "node:crypto";
import {
  admitLegacyChatGPTCredentialIntent,
  beginChatGPTCredentialIntent,
  bindChatGPTCredentialIntentHost,
  canUseLegacyChatGPTHost,
  cancelChatGPTCredentialIntent,
  completeChatGPTCredentialIntent,
  leaseChatGPTCredentialCache,
  ChatGPTCredentialVaultError,
  readPendingChatGPTCredentialIntent,
  rememberChatGPTCredentialCache,
  releaseChatGPTCredentialLease,
  restartExpiredChatGPTCredentialIntent,
  revokeChatGPTCredentialAuthorityAndCaptureHosts,
  saveChatGPTCredentialCache,
  withChatGPTCredentialLeaseAdmission,
  type ChatGPTCredentialIntent,
  type ChatGPTCredentialIntentRecoverySource,
  type ChatGPTCredentialLease,
} from "./chatgpt-credential-vault";
import { validateChatGPTModels, type ChatGPTModel } from "./chatgpt-models";
import { ChatGPTHostStaleError } from "./chatgpt-host-service";
import { CHATGPT_MANAGED_OPERATION_MAX_MS } from "./chatgpt-managed-operation";
import {
  PRIVATE_SCENE_COMPLETION_HEADER,
  PRIVATE_SCENE_COMPLETION_VERSION,
  parsePrivateSceneCompletion,
  type PrivateSceneCompletion,
} from "./chatgpt-scene-completion";
import {
  PRIVATE_SCENE_REVIEW_HEADER,
  PRIVATE_SCENE_REVIEW_VERSION,
  parsePrivateSceneReviewRequest,
  parsePrivateSceneReviewResult,
  type PrivateSceneReviewResult,
} from "./chatgpt-scene-review";
import type {
  AuthoritativeSceneBinding,
  AuthoringReviewAdmission,
  InitialAuthoringAdmission,
} from "./authoring-run-admission";
import { replayChatGPTSceneReview } from "./chatgpt-scene-review-replay";
import type { ModelCommand } from "../protocol";
import {
  createGenerationObservation,
  type GenerationObservationCorrelation,
} from "./generation-observability";

const CLEANUP_HEADROOM_MS = 12_000;
const PRIVATE_RESPONSE_MAX_BYTES = 256 * 1024;
const CACHE_MAX_BYTES = 64 * 1024;
const PRIVATE_GENERATION_RESPONSE_MAX_BYTES = 512 * 1024;

export type DurableIdentity = { ownerId: string; sessionId: string };
type Host = {
  attemptId: string;
  sandboxName: string;
  capability: string;
  expiresAt: Date;
  artifactDigest?: string | null;
};
type DurableManager = {
  ensure(
    identity: DurableIdentity,
    options?: { signal?: AbortSignal },
  ): Promise<Host>;
  acquireForOperation?(
    identity: DurableIdentity,
    minHeadroomMs: number,
    options?: { signal?: AbortSignal },
  ): Promise<Host | null>;
  privateOperation(
    host: Host,
    operation:
      | "initialize"
      | "status"
      | "models"
      | "generate"
      | "review"
      | "seal"
      | "clear"
      | "loginSeal",
    input: unknown,
    options?: {
      signal?: AbortSignal;
      correlation?: GenerationObservationCorrelation;
      sceneCompletionVersion?: typeof PRIVATE_SCENE_COMPLETION_VERSION;
      sceneReviewVersion?: typeof PRIVATE_SCENE_REVIEW_VERSION;
    },
  ): Promise<Response>;
  request(
    host: Host,
    operation: "start" | "status" | "cancel" | "logout" | "models" | "generate",
    options?: { signal?: AbortSignal; input?: unknown },
  ): Promise<Response>;
  disconnect(identity: DurableIdentity): Promise<boolean>;
  read?(
    identity: DurableIdentity,
    options?: { signal?: AbortSignal },
  ): Promise<Host | null>;
  captureOwnerHosts?(identity: DurableIdentity): Promise<
    {
      ownerId: string;
      sessionId: string;
      attemptId: string;
      sandboxName: string;
    }[]
  >;
  teardownSession?(identity: DurableIdentity): Promise<boolean>;
  destroyHost?(name: string, signal?: AbortSignal): Promise<void>;
  releaseHost?(identity: DurableIdentity, attemptId: string): Promise<boolean>;
};

export class ChatGPTDurableServiceError extends Error {
  constructor(
    public readonly code:
      | "missing"
      | "revoked"
      | "busy"
      | "login-pending"
      | "expired"
      | "insufficient-headroom"
      | "unavailable"
      | "invalid-response"
      | "finalization",
    message: string,
  ) {
    super(message);
    this.name = "ChatGPTDurableServiceError";
  }
}

const loginPendingMessage =
  "A ChatGPT sign-in is still active. Check its status or finish it in the tab that started it.";

function loginPending() {
  return new ChatGPTDurableServiceError("login-pending", loginPendingMessage);
}

function responseRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

function sameCorrectionBatch(
  left: readonly ModelCommand[],
  right: readonly ModelCommand[],
) {
  return (
    JSON.stringify(canonicalValue(left)) ===
    JSON.stringify(canonicalValue(right))
  );
}

async function readJSON(response: Response): Promise<unknown> {
  if (!response.body)
    throw new ChatGPTDurableServiceError(
      "unavailable",
      "ChatGPT managed operation failed.",
    );
  if (!response.ok) {
    await response.body.cancel().catch(() => undefined);
    throw new ChatGPTDurableServiceError(
      "unavailable",
      "ChatGPT managed operation failed.",
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let complete = false;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > PRIVATE_RESPONSE_MAX_BYTES)
        throw new ChatGPTDurableServiceError(
          "invalid-response",
          "ChatGPT managed operation returned an invalid response.",
        );
      chunks.push(part.value);
    }
    complete = true;
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const raw = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new ChatGPTDurableServiceError(
      "invalid-response",
      "ChatGPT managed operation returned an invalid response.",
    );
  }
}

function binding(value: unknown) {
  const item = responseRecord(value);
  if (
    !item ||
    typeof item.operationId !== "string" ||
    !Number.isSafeInteger(item.epoch) ||
    !Number.isSafeInteger(item.deadlineAt)
  )
    throw new ChatGPTDurableServiceError(
      "invalid-response",
      "ChatGPT managed operation returned an invalid binding.",
    );
  return {
    operationId: item.operationId,
    epoch: item.epoch as number,
    deadlineAt: item.deadlineAt as number,
  };
}

function operationIdentity(value: ReturnType<typeof binding>) {
  return { operationId: value.operationId, epoch: value.epoch };
}

type HostedAuthoringCompletion = Pick<
  InitialAuthoringAdmission,
  "complete" | "fail"
>;
type HostedReviewCompletion = Pick<
  AuthoringReviewAdmission,
  "complete" | "fail"
>;

function invalidPrivateCompletion() {
  return new ChatGPTDurableServiceError(
    "invalid-response",
    "ChatGPT managed operation returned an invalid completion.",
  );
}

/** Remove negotiated authority metadata before exposing the scene stream. */
export function filterPrivateCompletion(
  source: ReadableStream<Uint8Array>,
  expected: {
    operationId: string;
    epoch: number;
    projectId: string;
    minimumRevision: number;
  },
  authoring: HostedAuthoringCompletion,
  signal: AbortSignal | undefined,
) {
  const reader = source.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const encoder = new TextEncoder();
  let buffer = "";
  let bytes = 0;
  let completion: PrivateSceneCompletion | undefined;
  let state: "open" | "completing" | "completed" | "failed" = "open";
  let released = false;
  let failurePromise: Promise<void> | undefined;
  const completionAbortController = new AbortController();
  const completionSignal = completionAbortController.signal;
  const release = () => {
    if (!released) {
      reader.releaseLock();
      released = true;
    }
  };
  const fail = (error: unknown) => {
    if (state === "completed" || state === "failed")
      return failurePromise ?? Promise.resolve();
    state = "failed";
    completionAbortController.abort();
    failurePromise = Promise.resolve()
      .then(() => authoring.fail(error))
      .catch(() => undefined);
    return failurePromise;
  };
  const onAbort = () => {
    void fail(
      signal?.reason instanceof Error
        ? signal.reason
        : Error("Generation cancelled."),
    );
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  const cleanup = () => signal?.removeEventListener("abort", onAbort);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) {
    onAbort();
    cleanup();
  }
  const processLine = (value: string) => {
    if (!value.trim()) return encoder.encode(`${value}\n`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw invalidPrivateCompletion();
    }
    const record = responseRecord(parsed);
    const type = record?.type;
    if (type === "orbsie.private.scene-completion") {
      if (completion) throw invalidPrivateCompletion();
      completion = parsePrivateSceneCompletion(value, expected);
      return undefined;
    }
    if (type === "error" || (record && "error" in record))
      throw invalidPrivateCompletion();
    if (typeof type === "string" && type.startsWith("orbsie.private."))
      throw invalidPrivateCompletion();
    if (completion) throw invalidPrivateCompletion();
    return encoder.encode(`${value}\n`);
  };
  const completeAuthoring = async (record: PrivateSceneCompletion) => {
    if (state !== "open" || completionSignal.aborted)
      throw invalidPrivateCompletion();
    state = "completing";
    const completionPromise = Promise.resolve().then(() =>
      authoring.complete(
        {
          version: record.bindingVersion,
          projectId: record.projectId,
          revision: record.revision,
          digest: record.digest,
        },
        completionSignal,
      ),
    );
    // A completion writer must not be allowed to become an unhandled rejection
    // if cancellation wins while it is waiting on durable storage.
    void completionPromise.catch(() => undefined);
    try {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          completionSignal.removeEventListener("abort", abort);
          reject(invalidPrivateCompletion());
        };
        if (completionSignal.aborted) {
          abort();
          return;
        }
        completionSignal.addEventListener("abort", abort, { once: true });
        completionPromise.then(
          () => {
            completionSignal.removeEventListener("abort", abort);
            resolve();
          },
          (error) => {
            completionSignal.removeEventListener("abort", abort);
            reject(error);
          },
        );
      });
      if (state !== "completing" || completionSignal.aborted)
        throw invalidPrivateCompletion();
      state = "completed";
    } catch (error) {
      const safeError = invalidPrivateCompletion();
      await fail(safeError);
      throw safeError;
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) {
            release();
            buffer += decoder.decode();
            if (buffer) {
              const output = processLine(buffer);
              if (output) controller.enqueue(output);
            }
            if (!completion) throw invalidPrivateCompletion();
            completionSignal.throwIfAborted();
            await completeAuthoring(completion);
            cleanup();
            controller.close();
            return;
          }
          bytes += next.value.byteLength;
          if (bytes > PRIVATE_GENERATION_RESPONSE_MAX_BYTES)
            throw invalidPrivateCompletion();
          buffer += decoder.decode(next.value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const value = buffer.slice(0, newline).replace(/\r$/u, "");
            buffer = buffer.slice(newline + 1);
            const output = processLine(value);
            if (output) controller.enqueue(output);
            newline = buffer.indexOf("\n");
          }
        }
      } catch (error) {
        // Private stream failures must never expose provider or persistence
        // messages through the public body or framework error logging.
        const safeError = invalidPrivateCompletion();
        await fail(safeError);
        await reader.cancel().catch(() => undefined);
        cleanup();
        release();
        controller.error(safeError);
      }
    },
    async cancel(reason) {
      await fail(invalidPrivateCompletion());
      await reader.cancel(reason).catch(() => undefined);
      cleanup();
      release();
    },
  });
}

function cache(value: unknown): Uint8Array | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value) ||
    value.length > Math.ceil((CACHE_MAX_BYTES * 4) / 3)
  )
    throw new ChatGPTDurableServiceError(
      "invalid-response",
      "ChatGPT managed operation returned an invalid cache.",
    );
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.length === 0 ||
    bytes.length > CACHE_MAX_BYTES ||
    bytes.toString("base64") !== value
  )
    throw new ChatGPTDurableServiceError(
      "invalid-response",
      "ChatGPT managed operation returned an invalid cache.",
    );
  return Uint8Array.from(bytes);
}

function operationDeadline(
  lease: ChatGPTCredentialLease,
  host: Host,
  now: number,
  routeDeadlineAt?: number,
) {
  const deadline = Math.min(
    now + CHATGPT_MANAGED_OPERATION_MAX_MS - CLEANUP_HEADROOM_MS,
    routeDeadlineAt === undefined
      ? Number.POSITIVE_INFINITY
      : routeDeadlineAt - CLEANUP_HEADROOM_MS,
    lease.leaseUntil.getTime() - CLEANUP_HEADROOM_MS,
    host.expiresAt.getTime() - CLEANUP_HEADROOM_MS,
  );
  if (!Number.isSafeInteger(deadline) || deadline <= now + 1000)
    throw new ChatGPTDurableServiceError(
      "expired",
      "ChatGPT connection cleanup time is unavailable.",
    );
  return deadline;
}

function cleanupSignal() {
  return AbortSignal.timeout(CLEANUP_HEADROOM_MS);
}

export function createChatGPTDurableService(options: {
  manager: DurableManager;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const manager = options.manager;

  async function ensureHost(
    identity: DurableIdentity,
    signal?: AbortSignal,
    options: { rejectStale?: boolean } = {},
  ) {
    try {
      return await manager.ensure(identity, { signal });
    } catch (error) {
      if (
        !(error instanceof ChatGPTHostStaleError) ||
        options.rejectStale ||
        !manager.teardownSession
      )
        throw error;
      // A changed deployment cannot use the old runtime, but its durable
      // provider cache is still valid. Destroy that runtime before rebuilding.
      await manager.teardownSession(identity);
      return manager.ensure(identity, { signal });
    }
  }

  async function acquire(
    identity: DurableIdentity,
    signal?: AbortSignal,
    routeDeadlineAt?: number,
    sceneCompletionVersion?: typeof PRIVATE_SCENE_COMPLETION_VERSION,
    sceneReviewVersion?: typeof PRIVATE_SCENE_REVIEW_VERSION,
  ): Promise<{
    lease: ChatGPTCredentialLease;
    host: Host;
    binding: ReturnType<typeof binding>;
  }> {
    signal?.throwIfAborted();
    const leased = await leaseChatGPTCredentialCache(identity, undefined, {
      signal,
    });
    if (leased.kind !== "leased")
      throw new ChatGPTDurableServiceError(
        leased.kind === "busy"
          ? "busy"
          : leased.kind === "revoked"
            ? "revoked"
            : leased.kind,
        leased.kind === "busy"
          ? "Another ChatGPT operation is already using this connection."
          : leased.kind === "missing"
            ? "Connect your ChatGPT account first."
            : leased.kind === "revoked"
              ? "ChatGPT was disconnected. Connect again to continue."
              : "ChatGPT connection cleanup time is unavailable.",
      );
    let host: Host | undefined;
    try {
      host = await ensureHost(identity, signal, {
        rejectStale: sceneReviewVersion !== undefined,
      });
      if (manager.acquireForOperation) {
        let renewed: Host | null;
        try {
          renewed = await manager.acquireForOperation(
            identity,
            180_000 + CLEANUP_HEADROOM_MS,
            { signal },
          );
        } catch (error) {
          // The registry row can outlive a provider-side sandbox deletion.
          // Reconstruct that stale host once from the same fenced cache; this
          // does not retry the model operation.
          signal?.throwIfAborted();
          if (sceneReviewVersion !== undefined) throw error;
          await destroyAfterFailure(identity, host);
          host = await manager.ensure(identity, { signal });
          renewed = await manager.acquireForOperation(
            identity,
            180_000 + CLEANUP_HEADROOM_MS,
            { signal },
          );
        }
        if (!renewed)
          throw new ChatGPTDurableServiceError(
            "expired",
            "ChatGPT connection cleanup time is unavailable.",
          );
        host = renewed;
      }
      const deadlineAt = operationDeadline(
        leased.lease,
        host,
        now(),
        routeDeadlineAt,
      );
      const operationId = randomUUID();
      const admitted = await withChatGPTCredentialLeaseAdmission(
        identity,
        leased.lease,
        async () => {
          const initialized = await manager.privateOperation(
            host!,
            "initialize",
            {
              operationId,
              epoch: leased.lease.leaseEpoch,
              deadlineAt,
              initialCredentialCache: Buffer.from(leased.lease.cache).toString(
                "base64",
              ),
            },
            { signal },
          );
          const initializedBinding = binding(await readJSON(initialized));
          if (
            sceneCompletionVersion !== undefined ||
            sceneReviewVersion !== undefined
          ) {
            const preflight = await manager.privateOperation(
              host!,
              "status",
              operationIdentity(initializedBinding),
              {
                signal,
                ...(sceneCompletionVersion === undefined
                  ? {}
                  : { sceneCompletionVersion }),
                ...(sceneReviewVersion === undefined
                  ? {}
                  : { sceneReviewVersion }),
              },
            );
            const negotiatedHeader =
              sceneReviewVersion === undefined
                ? PRIVATE_SCENE_COMPLETION_HEADER
                : PRIVATE_SCENE_REVIEW_HEADER;
            const negotiatedVersion =
              sceneReviewVersion === undefined
                ? sceneCompletionVersion
                : sceneReviewVersion;
            if (
              preflight.headers.get(negotiatedHeader) !==
              String(negotiatedVersion)
            )
              throw new ChatGPTDurableServiceError(
                "unavailable",
                sceneReviewVersion === undefined
                  ? "ChatGPT host does not support scene completion authority."
                  : "ChatGPT host does not support scene review authority.",
              );
            const status = responseRecord(await readJSON(preflight));
            if (
              !status ||
              !["connected", "disconnected", "unknown"].includes(
                status.status as string,
              )
            )
              throw new ChatGPTDurableServiceError(
                "invalid-response",
                "ChatGPT managed operation returned an invalid status.",
              );
            if (
              sceneReviewVersion !== undefined &&
              status.status !== "connected"
            )
              throw new ChatGPTDurableServiceError(
                "unavailable",
                "ChatGPT account is not connected.",
              );
          }
          return initializedBinding;
        },
        { signal },
      );
      if (admitted.kind !== "admitted")
        throw new ChatGPTDurableServiceError(
          admitted.kind === "stale" ? "unavailable" : "expired",
          "ChatGPT connection authority is no longer available.",
        );
      const operationBinding = admitted.value;
      if (
        operationBinding.operationId !== operationId ||
        operationBinding.epoch !== leased.lease.leaseEpoch ||
        operationBinding.deadlineAt !== deadlineAt
      )
        throw new ChatGPTDurableServiceError(
          "invalid-response",
          "ChatGPT managed operation returned an invalid binding.",
        );
      return { lease: leased.lease, host, binding: operationBinding };
    } catch (error) {
      if (host) {
        try {
          await destroyAfterFailure(identity, host);
          await releaseChatGPTCredentialLease(identity, leased.lease);
        } catch {
          throw new ChatGPTDurableServiceError(
            "finalization",
            "ChatGPT operation cleanup is still pending.",
          );
        }
      } else {
        await releaseChatGPTCredentialLease(identity, leased.lease).catch(
          () => undefined,
        );
      }
      throw error;
    }
  }

  async function destroyAfterFailure(
    identity: DurableIdentity,
    host: Host,
    signal?: AbortSignal,
  ) {
    if (manager.destroyHost) {
      await manager.destroyHost(host.sandboxName, signal);
      await manager.releaseHost?.(identity, host.attemptId);
      return;
    }
    await manager.disconnect(identity);
  }

  async function finalize(
    identity: DurableIdentity,
    lease: ChatGPTCredentialLease,
    host: Host,
    operationBinding: ReturnType<typeof binding>,
  ) {
    const signal = cleanupSignal();
    let sealed: { cache: Uint8Array | null };
    try {
      const value = responseRecord(
        await readJSON(
          await manager.privateOperation(
            host,
            "seal",
            operationIdentity(operationBinding),
            {
              signal,
            },
          ),
        ),
      );
      if (
        !value ||
        value.operationId !== operationBinding.operationId ||
        value.epoch !== operationBinding.epoch ||
        value.deadlineAt !== operationBinding.deadlineAt ||
        typeof value.expired !== "boolean"
      )
        throw new ChatGPTDurableServiceError(
          "invalid-response",
          "ChatGPT managed operation returned an invalid seal.",
        );
      sealed = { cache: cache(value.cache) };
      if (!sealed.cache)
        throw new ChatGPTDurableServiceError(
          "finalization",
          "ChatGPT credential rotation could not be captured.",
        );
      const saved = await saveChatGPTCredentialCache(
        identity,
        lease,
        sealed.cache,
        { signal },
      );
      if (saved.kind !== "saved")
        throw new ChatGPTDurableServiceError(
          "finalization",
          "ChatGPT credential rotation could not be saved.",
        );
      const cleared = responseRecord(
        await readJSON(
          await manager.privateOperation(
            host,
            "clear",
            operationIdentity(operationBinding),
            {
              signal,
            },
          ),
        ),
      );
      if (cleared?.cleared !== true)
        throw new ChatGPTDurableServiceError(
          "invalid-response",
          "ChatGPT managed operation returned an invalid clear response.",
        );
      const released = await releaseChatGPTCredentialLease(identity, lease, {
        signal,
      });
      if (released.kind !== "released")
        throw new ChatGPTDurableServiceError(
          "finalization",
          "ChatGPT operation authority could not be released.",
        );
    } catch (error) {
      // A failed seal or clear leaves uncertainty about the managed process.
      // Destroy the sandbox before releasing its lease; never report Ready
      // while a refresh-capable process may still be alive.
      try {
        await destroyAfterFailure(identity, host, signal);
        await releaseChatGPTCredentialLease(identity, lease, { signal });
      } catch {
        throw new ChatGPTDurableServiceError(
          "finalization",
          "ChatGPT operation cleanup is still pending.",
        );
      }
      throw error;
    }
  }

  /** Seal and clear a review operation while its lease remains available to
   * the ledger completion fence. Release is performed only after completion. */
  async function prepareReviewFinalization(
    identity: DurableIdentity,
    lease: ChatGPTCredentialLease,
    host: Host,
    operationBinding: ReturnType<typeof binding>,
  ) {
    const signal = cleanupSignal();
    try {
      const value = responseRecord(
        await readJSON(
          await manager.privateOperation(
            host,
            "seal",
            operationIdentity(operationBinding),
            { signal },
          ),
        ),
      );
      if (
        !value ||
        value.operationId !== operationBinding.operationId ||
        value.epoch !== operationBinding.epoch ||
        value.deadlineAt !== operationBinding.deadlineAt ||
        typeof value.expired !== "boolean"
      )
        throw new ChatGPTDurableServiceError(
          "invalid-response",
          "ChatGPT managed operation returned an invalid seal.",
        );
      const sealedCache = cache(value.cache);
      if (!sealedCache)
        throw new ChatGPTDurableServiceError(
          "finalization",
          "ChatGPT credential rotation could not be captured.",
        );
      const saved = await saveChatGPTCredentialCache(
        identity,
        lease,
        sealedCache,
        { signal },
      );
      if (saved.kind !== "saved")
        throw new ChatGPTDurableServiceError(
          "finalization",
          "ChatGPT credential rotation could not be saved.",
        );
      const cleared = responseRecord(
        await readJSON(
          await manager.privateOperation(
            host,
            "clear",
            operationIdentity(operationBinding),
            { signal },
          ),
        ),
      );
      if (cleared?.cleared !== true)
        throw new ChatGPTDurableServiceError(
          "invalid-response",
          "ChatGPT managed operation returned an invalid clear response.",
        );
    } catch (error) {
      const finalizationError =
        error instanceof ChatGPTDurableServiceError &&
        error.code === "finalization"
          ? error
          : new ChatGPTDurableServiceError(
              "finalization",
              "ChatGPT credential finalization could not be completed.",
            );
      try {
        await destroyAfterFailure(identity, host, signal);
        await releaseChatGPTCredentialLease(identity, lease, { signal });
      } catch {
        throw new ChatGPTDurableServiceError(
          "finalization",
          "ChatGPT operation cleanup is still pending.",
        );
      }
      throw finalizationError;
    }
  }

  async function releaseReviewFinalization(
    identity: DurableIdentity,
    lease: ChatGPTCredentialLease,
  ) {
    const released = await releaseChatGPTCredentialLease(identity, lease, {
      signal: cleanupSignal(),
    });
    if (released.kind !== "released")
      throw new ChatGPTDurableServiceError(
        "finalization",
        "ChatGPT operation authority could not be released.",
      );
  }

  async function withJSONOperation<T>(
    identity: DurableIdentity,
    signal: AbortSignal | undefined,
    operation: (
      host: Host,
      operationBinding: ReturnType<typeof binding>,
      signal?: AbortSignal,
    ) => Promise<T>,
    routeDeadlineAt?: number,
  ) {
    const active = await acquire(identity, signal, routeDeadlineAt);
    let finalized = false;
    const finalizeOnce = async () => {
      if (finalized) return;
      finalized = true;
      await finalize(identity, active.lease, active.host, active.binding);
    };
    try {
      const value = await operation(active.host, active.binding, signal);
      await finalizeOnce();
      return value;
    } catch (error) {
      try {
        await finalizeOnce();
      } catch (finalizationError) {
        throw finalizationError;
      }
      throw error;
    }
  }

  async function status(
    identity: DurableIdentity,
    signal?: AbortSignal,
    routeDeadlineAt?: number,
  ) {
    try {
      return await withJSONOperation(
        identity,
        signal,
        async (host, op, requestSignal) => {
          const value = responseRecord(
            await readJSON(
              await manager.privateOperation(
                host,
                "status",
                operationIdentity(op),
                {
                  signal: requestSignal,
                },
              ),
            ),
          );
          if (
            value?.status !== "connected" &&
            value?.status !== "disconnected" &&
            value?.status !== "unknown"
          )
            throw new ChatGPTDurableServiceError(
              "invalid-response",
              "ChatGPT account status is invalid.",
            );
          return { lifecycle: "idle" as const, authStatus: value.status };
        },
        routeDeadlineAt,
      );
    } catch (error) {
      if (
        error instanceof ChatGPTDurableServiceError &&
        error.code === "missing"
      )
        return null;
      if (
        error instanceof ChatGPTDurableServiceError &&
        error.code === "revoked"
      )
        return {
          lifecycle: "idle" as const,
          authStatus: "disconnected" as const,
        };
      throw error;
    }
  }

  async function models(
    identity: DurableIdentity,
    signal?: AbortSignal,
    routeDeadlineAt?: number,
  ): Promise<ChatGPTModel[] | null> {
    try {
      return await withJSONOperation(
        identity,
        signal,
        async (host, op, requestSignal) => {
          const value = responseRecord(
            await readJSON(
              await manager.privateOperation(
                host,
                "models",
                operationIdentity(op),
                {
                  signal: requestSignal,
                },
              ),
            ),
          );
          return validateChatGPTModels(value?.models);
        },
        routeDeadlineAt,
      );
    } catch (error) {
      if (
        error instanceof ChatGPTDurableServiceError &&
        error.code === "missing"
      )
        return null;
      throw error;
    }
  }

  async function generate(
    identity: DurableIdentity,
    input: unknown,
    signal?: AbortSignal,
    routeDeadlineAt?: number,
    correlation?: GenerationObservationCorrelation,
    authoring?: HostedAuthoringCompletion,
  ): Promise<ReadableStream<Uint8Array> | null> {
    const hostedObservation = correlation
      ? createGenerationObservation({
          layer: "hosted",
          requestId: correlation.requestId,
          clientRunId: correlation.clientRunId,
          provider: "chatgpt",
          serviceTier: "default",
        })
      : undefined;
    let active: Awaited<ReturnType<typeof acquire>>;
    try {
      active = await acquire(
        identity,
        signal,
        routeDeadlineAt,
        authoring ? PRIVATE_SCENE_COMPLETION_VERSION : undefined,
      );
    } catch (error) {
      hostedObservation?.terminal({
        reason: signal?.aborted
          ? signal.reason?.name === "TimeoutError"
            ? "deadline"
            : "client-abort"
          : "transport-error",
        abortSource: signal?.aborted
          ? signal.reason?.name === "TimeoutError"
            ? "deadline"
            : "client"
          : undefined,
        failureCode: signal?.aborted
          ? signal.reason?.name === "TimeoutError"
            ? "timeout"
            : "cancelled"
          : error instanceof ChatGPTDurableServiceError &&
              (error.code === "missing" || error.code === "revoked")
            ? "connection-required"
            : "host-unavailable",
      });
      throw error;
    }
    let source: ReadableStream<Uint8Array>;
    try {
      hostedObservation?.phase("provider-start");
      const response = await manager.privateOperation(
        active.host,
        "generate",
        {
          ...operationIdentity(active.binding),
          input,
        },
        {
          signal,
          correlation,
          ...(authoring
            ? { sceneCompletionVersion: PRIVATE_SCENE_COMPLETION_VERSION }
            : {}),
        },
      );
      if (
        !response.ok ||
        !response.body ||
        response.headers.get("content-type")?.split(";")[0] !==
          "application/x-ndjson"
      )
        throw new ChatGPTDurableServiceError(
          "unavailable",
          "ChatGPT generation could not start.",
        );
      if (
        authoring &&
        response.headers.get(PRIVATE_SCENE_COMPLETION_HEADER) !==
          String(PRIVATE_SCENE_COMPLETION_VERSION)
      )
        throw new ChatGPTDurableServiceError(
          "unavailable",
          "ChatGPT host does not support scene completion authority.",
        );
      source = response.body;
      if (authoring) {
        source = filterPrivateCompletion(
          source,
          {
            operationId: active.binding.operationId,
            epoch: active.binding.epoch,
            projectId:
              typeof input === "object" && input
                ? String((input as { project?: { id?: unknown } }).project?.id)
                : "",
            minimumRevision:
              typeof input === "object" && input
                ? Number(
                    (input as { project?: { revision?: unknown } }).project
                      ?.revision,
                  )
                : -1,
          },
          authoring,
          signal,
        );
      }
    } catch (error) {
      const timedOut =
        signal?.aborted && signal.reason?.name === "TimeoutError";
      try {
        await finalize(identity, active.lease, active.host, active.binding);
        hostedObservation?.terminal({
          reason: timedOut
            ? "deadline"
            : signal?.aborted
              ? "client-abort"
              : "transport-error",
          abortSource: timedOut
            ? "deadline"
            : signal?.aborted
              ? "client"
              : undefined,
          failureCode: timedOut
            ? "timeout"
            : signal?.aborted
              ? "cancelled"
              : "host-unavailable",
          credentialFinalization: "saved",
        });
      } catch (finalizationError) {
        hostedObservation?.terminal({
          reason: "credential-finalization-failed",
          failureCode: "host-unavailable",
          credentialFinalization: "failed",
        });
        throw finalizationError;
      }
      throw error;
    }
    const reader = source.getReader();
    let abortHandler: (() => void) | undefined;
    let finalization: Promise<void> | undefined;
    let locallyCancelled = false;
    let streamReadFailed = false;
    const finish = async () => {
      if (!finalization) {
        if (abortHandler) signal?.removeEventListener("abort", abortHandler);
        finalization = finalize(
          identity,
          active.lease,
          active.host,
          active.binding,
        );
      }
      try {
        await finalization;
        hostedObservation?.terminal({
          reason:
            locallyCancelled || signal?.aborted
              ? signal?.reason?.name === "TimeoutError"
                ? "deadline"
                : "client-abort"
              : streamReadFailed
                ? "transport-error"
                : "completed",
          abortSource:
            locallyCancelled || signal?.aborted
              ? signal?.reason?.name === "TimeoutError"
                ? "deadline"
                : "client"
              : undefined,
          credentialFinalization: "saved",
          failureCode:
            locallyCancelled || signal?.aborted
              ? signal?.reason?.name === "TimeoutError"
                ? "timeout"
                : "cancelled"
              : streamReadFailed
                ? "transport"
                : undefined,
        });
      } catch (error) {
        hostedObservation?.terminal({
          reason: "credential-finalization-failed",
          failureCode: "host-unavailable",
          credentialFinalization: "failed",
        });
        throw error;
      }
    };
    abortHandler = () => {
      locallyCancelled = true;
      // Begin cleanup before asking an untrusted/stalled upstream reader to
      // cancel; request abort must never postpone the authority release.
      void finish().catch(() => undefined);
      void Promise.race([
        reader.cancel(signal?.reason).catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
      ]);
    };
    signal?.addEventListener("abort", abortHandler, { once: true });
    if (signal?.aborted) abortHandler();
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            await finish();
            controller.close();
          } else {
            hostedObservation?.noteInputBytes(next.value.byteLength);
            hostedObservation?.phase("first-byte");
            controller.enqueue(next.value);
          }
        } catch (error) {
          streamReadFailed = !(locallyCancelled || signal?.aborted);
          await finish().catch(() => undefined);
          controller.error(error);
        }
      },
      async cancel(reason) {
        locallyCancelled = true;
        const cleanup = finish();
        await Promise.race([
          reader.cancel(reason).catch(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
        ]);
        await cleanup;
      },
    });
  }

  async function review(
    identity: DurableIdentity,
    input: unknown,
    signal: AbortSignal | undefined,
    routeDeadlineAt: number | undefined,
    correlation: GenerationObservationCorrelation | undefined,
    admit: () => Promise<HostedReviewCompletion>,
  ): Promise<{
    review: PrivateSceneReviewResult["review"];
    corrections: readonly ModelCommand[];
    binding: AuthoritativeSceneBinding;
  }> {
    const hostedObservation = correlation
      ? createGenerationObservation({
          layer: "hosted",
          requestId: correlation.requestId,
          clientRunId: correlation.clientRunId,
          provider: "chatgpt",
          serviceTier: "default",
        })
      : undefined;
    let active: Awaited<ReturnType<typeof acquire>>;
    try {
      active = await acquire(
        identity,
        signal,
        routeDeadlineAt,
        undefined,
        PRIVATE_SCENE_REVIEW_VERSION,
      );
    } catch (error) {
      hostedObservation?.terminal({
        reason: signal?.aborted
          ? signal.reason?.name === "TimeoutError"
            ? "deadline"
            : "client-abort"
          : "transport-error",
        abortSource: signal?.aborted
          ? signal.reason?.name === "TimeoutError"
            ? "deadline"
            : "client"
          : undefined,
        failureCode: signal?.aborted
          ? signal.reason?.name === "TimeoutError"
            ? "timeout"
            : "cancelled"
          : error instanceof ChatGPTDurableServiceError &&
              (error.code === "missing" || error.code === "revoked")
            ? "connection-required"
            : "host-unavailable",
      });
      throw error;
    }

    let admission: HostedReviewCompletion | undefined;
    const operationSignal = signal ?? new AbortController().signal;
    let reviewFinalizationAttempted = false;
    let reviewPrepared = false;
    let reviewReleased = false;
    let ledgerCompleted = false;
    const finalizeOnce = async () => {
      await finalize(identity, active.lease, active.host, active.binding);
    };
    try {
      // The callback runs only after lease admission and the negotiated status
      // response have fenced the host deployment.
      admission = await admit();
      hostedObservation?.phase("provider-start");
      const privateInput = parsePrivateSceneReviewRequest({
        ...(input && typeof input === "object" ? input : {}),
        ...operationIdentity(active.binding),
      });
      const response = await manager.privateOperation(
        active.host,
        "review",
        privateInput,
        {
          signal,
          correlation,
          sceneReviewVersion: PRIVATE_SCENE_REVIEW_VERSION,
        },
      );
      if (
        !response.ok ||
        !response.body ||
        response.headers.get("content-type")?.split(";")[0] !==
          "application/json"
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new ChatGPTDurableServiceError(
          "unavailable",
          "ChatGPT scene review could not start.",
        );
      }
      if (
        response.headers.get(PRIVATE_SCENE_REVIEW_HEADER) !==
        String(PRIVATE_SCENE_REVIEW_VERSION)
      ) {
        await response.body.cancel().catch(() => undefined);
        throw new ChatGPTDurableServiceError(
          "unavailable",
          "ChatGPT host does not support scene review authority.",
        );
      }
      const parsed = await (async () => {
        try {
          return parsePrivateSceneReviewResult(await readJSON(response), {
            operationId: active.binding.operationId,
            epoch: active.binding.epoch,
            projectId: privateInput.project.id,
            revision: privateInput.project.revision,
            phase: privateInput.phase,
            browserModeling: privateInput.browserModeling,
          });
        } catch {
          throw new ChatGPTDurableServiceError(
            "invalid-response",
            "ChatGPT scene review returned an invalid response.",
          );
        }
      })();
      const expectedScope = privateInput.reviewImage
        ? "visual+structural"
        : "structural-only";
      if (parsed.review.scope !== expectedScope)
        throw new ChatGPTDurableServiceError(
          "invalid-response",
          "ChatGPT scene review returned an invalid scope.",
        );
      const replayed = await replayChatGPTSceneReview({
        result: parsed,
        project: privateInput.project,
        prompt: privateInput.prompt,
        ...(privateInput.selected === undefined
          ? {}
          : { selected: privateInput.selected }),
        browserModeling: privateInput.browserModeling,
        phase: privateInput.phase,
        scope: expectedScope,
        signal: operationSignal,
      });
      if (!sameCorrectionBatch(parsed.corrections, replayed.corrections))
        throw new ChatGPTDurableServiceError(
          "invalid-response",
          "ChatGPT scene review returned a non-canonical correction batch.",
        );
      if (
        parsed.binding.version !== replayed.binding.version ||
        parsed.binding.projectId !== replayed.binding.projectId ||
        parsed.binding.revision !== replayed.binding.revision ||
        parsed.binding.digest !== replayed.binding.digest
      )
        throw new ChatGPTDurableServiceError(
          "invalid-response",
          "ChatGPT scene review returned an invalid binding.",
        );
      signal?.throwIfAborted();
      reviewFinalizationAttempted = true;
      await prepareReviewFinalization(
        identity,
        active.lease,
        active.host,
        active.binding,
      );
      reviewPrepared = true;
      await admission.complete(
        replayed.binding,
        parsed.review.verdict === "accept",
        operationSignal,
      );
      ledgerCompleted = true;
      await releaseReviewFinalization(identity, active.lease);
      reviewReleased = true;
      signal?.throwIfAborted();
      hostedObservation?.terminal({ reason: "completed" });
      return {
        review: parsed.review,
        corrections: replayed.corrections,
        binding: replayed.binding,
      };
    } catch (error) {
      if (admission) await admission.fail(error).catch(() => undefined);
      if (!reviewFinalizationAttempted) {
        try {
          await finalizeOnce();
        } catch (finalizationError) {
          hostedObservation?.terminal({
            reason: "credential-finalization-failed",
            failureCode: "host-unavailable",
            credentialFinalization: "failed",
          });
          throw finalizationError;
        }
      } else if (reviewPrepared && !reviewReleased) {
        try {
          await releaseReviewFinalization(identity, active.lease);
        } catch (releaseError) {
          try {
            await destroyAfterFailure(identity, active.host, cleanupSignal());
            await releaseChatGPTCredentialLease(identity, active.lease, {
              signal: cleanupSignal(),
            });
          } catch {
            hostedObservation?.terminal({
              reason: "credential-finalization-failed",
              failureCode: "host-unavailable",
              credentialFinalization: "failed",
            });
            throw new ChatGPTDurableServiceError(
              "finalization",
              "ChatGPT operation cleanup is still pending.",
            );
          }
          if (!ledgerCompleted) throw releaseError;
          hostedObservation?.terminal({
            reason: "credential-finalization-failed",
            failureCode: "host-unavailable",
            credentialFinalization: "failed",
          });
          throw releaseError;
        }
      }
      hostedObservation?.terminal({
        reason:
          signal?.aborted && signal.reason?.name === "TimeoutError"
            ? "deadline"
            : signal?.aborted
              ? "client-abort"
              : "transport-error",
        abortSource: signal?.aborted
          ? signal.reason?.name === "TimeoutError"
            ? "deadline"
            : "client"
          : undefined,
        failureCode: signal?.aborted
          ? signal.reason?.name === "TimeoutError"
            ? "timeout"
            : "cancelled"
          : "host-unavailable",
        credentialFinalization: "saved",
      });
      throw error;
    }
  }

  async function recoverExpiredLoginIntent(
    identity: DurableIdentity,
    intent: ChatGPTCredentialIntent,
    signal?: AbortSignal,
  ): Promise<{
    intent: ChatGPTCredentialIntent;
    hostIdentity?: DurableIdentity;
  } | null> {
    const attemptId = intent.pendingAttemptId;
    if (!attemptId || attemptId === `pending:${intent.epoch}`) return null;
    const captureOwnerHosts = manager.captureOwnerHosts;
    const readHost = manager.read;
    if (!captureOwnerHosts || !readHost) return null;
    const ownerHosts = await captureOwnerHosts(identity);
    const matching = ownerHosts.filter((host) => host.attemptId === attemptId);
    if (matching.length > 1) return null;

    let hostIdentity: DurableIdentity | undefined;
    let source: ChatGPTCredentialIntentRecoverySource | undefined;
    if (!matching.length) {
      source = "host-missing";
    } else {
      const prior = matching[0]!;
      hostIdentity = { ownerId: prior.ownerId, sessionId: prior.sessionId };
      let previousHost: Host | null;
      try {
        previousHost = await readHost(hostIdentity, { signal });
      } catch (error) {
        if (!(error instanceof ChatGPTHostStaleError)) throw error;
        source = "terminal-host";
        previousHost = null;
      }
      if (previousHost) {
        const status = responseRecord(
          await readJSON(
            await manager.request(previousHost, "status", { signal }),
          ),
        );
        const terminal =
          status?.lifecycle === "expired" ||
          status?.lifecycle === "failed" ||
          status?.lifecycle === "cancelled";
        if (!terminal || status.authStatus === "connected") return null;
        source = "terminal-host";
      } else if (!source) {
        source = "host-missing";
      }
    }

    if (!source) return null;

    const replacement = await restartExpiredChatGPTCredentialIntent(
      identity,
      { epoch: intent.epoch, pendingAttemptId: attemptId },
      source,
      { signal },
    );
    return replacement ? { intent: replacement, hostIdentity } : null;
  }

  async function start(identity: DurableIdentity, signal?: AbortSignal) {
    let intent: ChatGPTCredentialIntent;
    let expiredHostIdentity: DurableIdentity | undefined;
    try {
      intent = await beginChatGPTCredentialIntent(identity, { signal });
    } catch (error) {
      if (
        !(error instanceof ChatGPTCredentialVaultError) ||
        error.code !== "active-connection"
      )
        throw error;
      const pending = await readPendingChatGPTCredentialIntent(identity, {
        signal,
      });
      if (!pending) throw error;
      const recovered = await recoverExpiredLoginIntent(
        identity,
        pending,
        signal,
      );
      if (!recovered) {
        const stillPending = await readPendingChatGPTCredentialIntent(
          identity,
          {
            signal,
          },
        );
        if (stillPending) throw loginPending();
        throw error;
      }
      intent = recovered.intent;
      expiredHostIdentity = recovered.hostIdentity;
    }
    let host: Host | undefined;
    try {
      if (expiredHostIdentity) await manager.disconnect(expiredHostIdentity);
      host = await ensureHost(identity, signal);
      const existing = responseRecord(
        await readJSON(await manager.request(host, "status", { signal })),
      );
      if (
        existing?.authStatus === "connected" ||
        existing?.lifecycle === "completed"
      )
        throw new ChatGPTDurableServiceError(
          "busy",
          "Disconnect the existing ChatGPT account before replacing it.",
        );
      if (existing?.lifecycle === "pending") {
        await bindChatGPTCredentialIntentHost(
          identity,
          intent.epoch,
          host.attemptId,
          { signal },
        );
        throw loginPending();
      }
      if (
        !existing ||
        !["idle", "expired", "failed", "cancelled"].includes(
          String(existing.lifecycle),
        )
      )
        throw new ChatGPTDurableServiceError(
          "unavailable",
          "ChatGPT account status could not be checked.",
        );
      await bindChatGPTCredentialIntentHost(
        identity,
        intent.epoch,
        host.attemptId,
        { signal },
      );
      return { host, intent };
    } catch (error) {
      if (
        !(error instanceof ChatGPTDurableServiceError) ||
        error.code !== "login-pending"
      )
        await cancelChatGPTCredentialIntent(identity, intent.epoch).catch(
          () => undefined,
        );
      if (
        host &&
        !(
          error instanceof ChatGPTDurableServiceError &&
          (error.code === "busy" || error.code === "login-pending")
        )
      )
        await manager.disconnect(identity).catch(() => undefined);
      throw error;
    }
  }

  async function migrateLegacyLogin(
    identity: DurableIdentity,
    host: Host,
    signal?: AbortSignal,
  ) {
    const intent = await admitLegacyChatGPTCredentialIntent(
      identity,
      host.attemptId,
      {
        signal,
      },
    );
    return saveLoginCache(identity, host, intent, signal);
  }

  async function completeAdmittedLogin(
    identity: DurableIdentity,
    host: Host,
    signal?: AbortSignal,
  ) {
    const intent = await completeChatGPTCredentialIntent(
      identity,
      host.attemptId,
      { signal },
    );
    if (!intent) return false;
    await saveLoginCache(identity, host, intent, signal);
    return true;
  }

  async function saveLoginCache(
    identity: DurableIdentity,
    host: Host,
    intent: { epoch: number; pendingAttemptId: string | null },
    signal?: AbortSignal,
  ) {
    try {
      const sealed = responseRecord(
        await readJSON(
          await manager.privateOperation(host, "loginSeal", {}, { signal }),
        ),
      );
      const sealedCache = cache(sealed?.cache);
      if (!sealedCache)
        throw new ChatGPTDurableServiceError(
          "invalid-response",
          "ChatGPT credential cache could not be saved.",
        );
      await rememberChatGPTCredentialCache(identity, sealedCache, {
        expectedIntentEpoch: intent.epoch,
        expectedHostAttemptId: host.attemptId,
      });
    } catch (error) {
      // A completed login that cannot be atomically persisted must not leave a
      // refresh-capable legacy runtime behind.
      await manager.disconnect(identity).catch(() => undefined);
      throw error;
    }
  }

  async function legacyAccessAllowed(
    identity: DurableIdentity,
    signal?: AbortSignal,
  ) {
    return canUseLegacyChatGPTHost(identity, { signal });
  }

  return {
    status,
    models,
    generate,
    review,
    start,
    completeAdmittedLogin,
    migrateLegacyLogin,
    legacyAccessAllowed,
    cancelIntent: cancelChatGPTCredentialIntent,
    disconnect: revokeChatGPTCredentialAuthorityAndCaptureHosts,
  };
}
