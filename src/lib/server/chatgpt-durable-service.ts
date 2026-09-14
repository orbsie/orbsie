import { randomUUID } from "node:crypto";
import {
  admitLegacyChatGPTCredentialIntent,
  beginChatGPTCredentialIntent,
  bindChatGPTCredentialIntentHost,
  canUseLegacyChatGPTHost,
  cancelChatGPTCredentialIntent,
  completeChatGPTCredentialIntent,
  leaseChatGPTCredentialCache,
  rememberChatGPTCredentialCache,
  releaseChatGPTCredentialLease,
  revokeChatGPTCredentialAuthorityAndCaptureHosts,
  saveChatGPTCredentialCache,
  withChatGPTCredentialLeaseAdmission,
  type ChatGPTCredentialLease,
} from "./chatgpt-credential-vault";
import { validateChatGPTModels, type ChatGPTModel } from "./chatgpt-models";
import { ChatGPTHostStaleError } from "./chatgpt-host-service";
import { CHATGPT_MANAGED_OPERATION_MAX_MS } from "./chatgpt-managed-operation";
import {
  createGenerationObservation,
  type GenerationObservationCorrelation,
} from "./generation-observability";

const CLEANUP_HEADROOM_MS = 12_000;
const PRIVATE_RESPONSE_MAX_BYTES = 256 * 1024;
const CACHE_MAX_BYTES = 64 * 1024;

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
      | "seal"
      | "clear"
      | "loginSeal",
    input: unknown,
    options?: {
      signal?: AbortSignal;
      correlation?: GenerationObservationCorrelation;
    },
  ): Promise<Response>;
  request(
    host: Host,
    operation: "start" | "status" | "cancel" | "logout" | "models" | "generate",
    options?: { signal?: AbortSignal; input?: unknown },
  ): Promise<Response>;
  disconnect(identity: DurableIdentity): Promise<boolean>;
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

function responseRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

  async function ensureHost(identity: DurableIdentity, signal?: AbortSignal) {
    try {
      return await manager.ensure(identity, { signal });
    } catch (error) {
      if (!(error instanceof ChatGPTHostStaleError) || !manager.teardownSession)
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
      host = await ensureHost(identity, signal);
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
          return binding(await readJSON(initialized));
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
      active = await acquire(identity, signal, routeDeadlineAt);
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
        { signal, correlation },
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
      source = response.body;
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

  async function start(identity: DurableIdentity, signal?: AbortSignal) {
    const intent = await beginChatGPTCredentialIntent(identity, { signal });
    let host: Host | undefined;
    try {
      host = await ensureHost(identity, signal);
      const existing = responseRecord(
        await readJSON(await manager.request(host, "status", { signal })),
      );
      if (existing?.authStatus === "connected")
        throw new ChatGPTDurableServiceError(
          "busy",
          "Disconnect the existing ChatGPT account before replacing it.",
        );
      await bindChatGPTCredentialIntentHost(
        identity,
        intent.epoch,
        host.attemptId,
        { signal },
      );
      return { host, intent };
    } catch (error) {
      await cancelChatGPTCredentialIntent(identity, intent.epoch).catch(
        () => undefined,
      );
      if (
        host &&
        !(error instanceof ChatGPTDurableServiceError && error.code === "busy")
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
    start,
    completeAdmittedLogin,
    migrateLegacyLogin,
    legacyAccessAllowed,
    cancelIntent: cancelChatGPTCredentialIntent,
    disconnect: revokeChatGPTCredentialAuthorityAndCaptureHosts,
  };
}
