export const GENERATION_OBSERVABILITY_VERSION = 1 as const;
export const GENERATION_DIAGNOSTIC_MAX_RUNS = 20;
export const GENERATION_DIAGNOSTIC_MAX_BYTES = 64 * 1024;

const MAX_DURATION_MS = 30 * 60 * 1000;
const MAX_COUNTER = 1_000_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL_PATTERN = /^[A-Za-z0-9._:/~+-]{1,256}$/;
const BUILD_PATTERN =
  /^(?:[a-f0-9]{7,64}|local(?:[._-][A-Za-z0-9._-]{1,64})?)$/i;

export const generationObservationProviders = [
  "openrouter",
  "gateway",
  "chatgpt",
  "free",
] as const;
export type GenerationObservationProvider =
  (typeof generationObservationProviders)[number];

export const generationObservationLayers = [
  "route",
  "provider",
  "hosted",
] as const;
export type GenerationObservationLayer =
  (typeof generationObservationLayers)[number];

export const generationObservationPhases = [
  "admission",
  "provider-start",
  "first-byte",
  "first-valid-command",
  "commit",
] as const;
export type GenerationObservationPhase =
  (typeof generationObservationPhases)[number];

export const generationObservationTerminalReasons = [
  "completed",
  "clean-eof-without-commit",
  "parser-failure",
  "provider-error",
  "stream-error",
  "transport-error",
  "completion-record-failure",
  "client-abort",
  "deadline",
  "observation-limit",
  "output-limit",
  "stale-run",
  "credential-finalization-failed",
  "unknown",
] as const;
export type GenerationObservationTerminalReason =
  (typeof generationObservationTerminalReasons)[number];

/** Safe terminal markers carried only on server-generated failure records. */
export const generationStreamFailureReasons = [
  "clean-eof-without-commit",
  "parser-failure",
  "provider-error",
  "stream-error",
  "transport-error",
  "completion-record-failure",
  "deadline",
  "output-limit",
] as const;
export type GenerationStreamFailureReason =
  (typeof generationStreamFailureReasons)[number];

export function validatedGenerationStreamFailure(
  value: unknown,
): GenerationStreamFailureReason | undefined {
  return (generationStreamFailureReasons as readonly unknown[]).includes(value)
    ? (value as GenerationStreamFailureReason)
    : undefined;
}

export const generationObservationAbortSources = [
  "client",
  "deadline",
  "provider",
  "server",
  "unknown",
] as const;
export type GenerationObservationAbortSource =
  (typeof generationObservationAbortSources)[number];

export const generationObservationCredentialOutcomes = [
  "not-applicable",
  "saved",
  "failed",
  "unknown",
] as const;
export type GenerationObservationCredentialOutcome =
  (typeof generationObservationCredentialOutcomes)[number];

export const generationObservationFailureCodes = [
  "invalid-input",
  "provider-rejected",
  "quota",
  "connection-required",
  "host-unavailable",
  "timeout",
  "cancelled",
  "observation-limit",
  "output-limit",
  "parser",
  "transport",
  "unknown",
] as const;
export type GenerationObservationFailureCode =
  (typeof generationObservationFailureCodes)[number];

const reasoningEfforts = ["low", "medium", "high"] as const;
const finishReasons = [
  "stop",
  "length",
  "tool_calls",
  "content_filter",
  "error",
  "other",
  "unknown",
] as const;

export type GenerationObservationCorrelation = {
  requestId: string;
  clientRunId?: string;
};

export type GenerationObservationEvent = {
  schemaVersion: typeof GENERATION_OBSERVABILITY_VERSION;
  event: "phase" | "terminal";
  layer: GenerationObservationLayer;
  requestId: string;
  clientRunId?: string;
  provider?: GenerationObservationProvider;
  model?: string;
  serviceTier?: "default";
  reasoningEffort?: "low" | "medium" | "high";
  buildId?: string;
  phase?: GenerationObservationPhase;
  terminalReason?: GenerationObservationTerminalReason;
  abortSource?: GenerationObservationAbortSource;
  credentialFinalization?: GenerationObservationCredentialOutcome;
  failureCode?: GenerationObservationFailureCode;
  httpStatus?: number;
  durationMs: number;
  inputBytes: number;
  outputBytes: number;
  commandCount: number;
  timestamp: string;
  finishReason?:
    | "stop"
    | "length"
    | "tool_calls"
    | "content_filter"
    | "error"
    | "other"
    | "unknown";
};

function boundedInteger(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_COUNTER, Math.floor(value)));
}

function boundedDuration(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_DURATION_MS, Math.floor(value)));
}

function safeRequestId(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : undefined;
}

export function validatedGenerationRequestId(
  value: unknown,
): string | undefined {
  return safeRequestId(value);
}

/** A client run is correlation only; it is never used as an owner or lease key. */
export function validatedClientRunId(value: unknown): string | undefined {
  return safeRequestId(value);
}

export function validatedBuildId(value: unknown): string | undefined {
  return typeof value === "string" && BUILD_PATTERN.test(value)
    ? value
    : undefined;
}

function safeProvider(
  value: unknown,
): GenerationObservationProvider | undefined {
  return (generationObservationProviders as readonly unknown[]).includes(value)
    ? (value as GenerationObservationProvider)
    : undefined;
}

function safeModel(value: unknown): string | undefined {
  return typeof value === "string" && MODEL_PATTERN.test(value)
    ? value
    : undefined;
}

function safeLayer(value: unknown): GenerationObservationLayer {
  return (generationObservationLayers as readonly unknown[]).includes(value)
    ? (value as GenerationObservationLayer)
    : "provider";
}

function safePhase(value: unknown): GenerationObservationPhase | undefined {
  return (generationObservationPhases as readonly unknown[]).includes(value)
    ? (value as GenerationObservationPhase)
    : undefined;
}

function safeServiceTier(
  value: unknown,
): GenerationObservationEvent["serviceTier"] {
  return value === "default" ? "default" : undefined;
}

function safeReasoningEffort(
  value: unknown,
): GenerationObservationEvent["reasoningEffort"] {
  return (reasoningEfforts as readonly unknown[]).includes(value)
    ? (value as GenerationObservationEvent["reasoningEffort"])
    : undefined;
}

function safeFinishReason(
  value: unknown,
): GenerationObservationEvent["finishReason"] {
  return (finishReasons as readonly unknown[]).includes(value)
    ? (value as GenerationObservationEvent["finishReason"])
    : undefined;
}

export type GenerationObservation = {
  readonly requestId: string;
  readonly clientRunId?: string;
  phase(phase: GenerationObservationPhase): void;
  noteInputBytes(bytes: number): void;
  noteOutputBytes(bytes: number): void;
  noteCommand(): void;
  commit(): void;
  terminal(options: {
    reason: GenerationObservationTerminalReason;
    abortSource?: GenerationObservationAbortSource;
    credentialFinalization?: GenerationObservationCredentialOutcome;
    failureCode?: GenerationObservationFailureCode;
    httpStatus?: number;
    finishReason?: GenerationObservationEvent["finishReason"];
  }): void;
  child(layer: GenerationObservationLayer): GenerationObservation;
};

export type GenerationObservationOptions = {
  layer: GenerationObservationLayer;
  requestId: string;
  clientRunId?: string;
  provider?: GenerationObservationProvider;
  /** Only pass an ID obtained from a server-admitted model catalog. */
  admittedModel?: string;
  serviceTier?: GenerationObservationEvent["serviceTier"];
  reasoningEffort?: GenerationObservationEvent["reasoningEffort"];
  buildId?: string;
  now?: () => number;
  sink?: (event: GenerationObservationEvent) => void;
};

export function createGenerationObservation(
  options: GenerationObservationOptions,
): GenerationObservation {
  const requestId = safeRequestId(options.requestId);
  if (!requestId) throw new Error("A valid generation request ID is required.");
  const clientRunId = validatedClientRunId(options.clientRunId);
  const provider = safeProvider(options.provider);
  const model = safeModel(options.admittedModel);
  const buildId = validatedBuildId(options.buildId);
  const now = options.now ?? (() => performance.now());
  const sink = options.sink ?? ((event) => console.info(JSON.stringify(event)));
  const emitted = new Set<GenerationObservationPhase>();
  let terminalEmitted = false;
  let startedAt = now();
  let inputBytes = 0;
  let outputBytes = 0;
  let commandCount = 0;

  const emit = (event: GenerationObservationEvent) => {
    try {
      sink(event);
    } catch {
      // Observability is deliberately best effort and must never affect a stream.
    }
  };
  const base = (): Omit<GenerationObservationEvent, "event"> => ({
    schemaVersion: GENERATION_OBSERVABILITY_VERSION,
    layer: safeLayer(options.layer),
    requestId,
    ...(clientRunId ? { clientRunId } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(safeServiceTier(options.serviceTier)
      ? { serviceTier: safeServiceTier(options.serviceTier) }
      : {}),
    ...(safeReasoningEffort(options.reasoningEffort)
      ? { reasoningEffort: safeReasoningEffort(options.reasoningEffort) }
      : {}),
    ...(buildId ? { buildId } : {}),
    durationMs: boundedDuration(now() - startedAt),
    inputBytes: boundedInteger(inputBytes),
    outputBytes: boundedInteger(outputBytes),
    commandCount: boundedInteger(commandCount),
    timestamp: new Date().toISOString(),
  });
  const makeChild = (
    layer: GenerationObservationLayer,
  ): GenerationObservation =>
    createGenerationObservation({
      ...options,
      layer,
      requestId,
      clientRunId,
      sink,
      now,
    });
  const observation: GenerationObservation = {
    requestId,
    ...(clientRunId ? { clientRunId } : {}),
    phase(phase) {
      const safe = safePhase(phase);
      if (!safe || terminalEmitted || emitted.has(safe)) return;
      emitted.add(safe);
      emit({ ...base(), event: "phase", phase: safe });
    },
    noteInputBytes(bytes) {
      inputBytes = boundedInteger(inputBytes + boundedInteger(bytes));
    },
    noteOutputBytes(bytes) {
      outputBytes = boundedInteger(outputBytes + boundedInteger(bytes));
    },
    noteCommand() {
      commandCount = boundedInteger(commandCount + 1);
      if (commandCount === 1) observation.phase("first-valid-command");
    },
    commit() {
      observation.phase("commit");
    },
    terminal({
      reason,
      abortSource,
      credentialFinalization,
      failureCode,
      httpStatus,
      finishReason,
    }) {
      if (terminalEmitted) return;
      terminalEmitted = true;
      emit({
        ...base(),
        event: "terminal",
        terminalReason: (
          generationObservationTerminalReasons as readonly unknown[]
        ).includes(reason)
          ? reason
          : "unknown",
        ...(abortSource &&
        (generationObservationAbortSources as readonly unknown[]).includes(
          abortSource,
        )
          ? { abortSource }
          : {}),
        ...(credentialFinalization &&
        (
          generationObservationCredentialOutcomes as readonly unknown[]
        ).includes(credentialFinalization)
          ? { credentialFinalization }
          : {}),
        ...(generationObservationFailureCodes.includes(failureCode as never)
          ? { failureCode }
          : {}),
        ...(typeof httpStatus === "number" &&
        Number.isSafeInteger(httpStatus) &&
        httpStatus >= 400 &&
        httpStatus <= 599
          ? { httpStatus }
          : {}),
        ...(safeFinishReason(finishReason)
          ? { finishReason: safeFinishReason(finishReason) }
          : {}),
      });
    },
    child: makeChild,
  };
  observation.phase("admission");
  return observation;
}

/** Observe the existing output reader without cloning or buffering its body. */
export function observeGenerationStream(
  source: ReadableStream<Uint8Array>,
  observation: GenerationObservation,
  signal?: AbortSignal,
) {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let streamError = false;
  let malformedRecord = false;
  let streamFailure: GenerationStreamFailureReason | undefined;
  let sawCommit = false;
  let observationLimit = false;
  let discardingLine = false;
  let settled = false;
  const inspectText = (text: string) => {
    if (discardingLine) {
      const newline = text.indexOf("\n");
      if (newline < 0) return;
      discardingLine = false;
      text = text.slice(newline + 1);
    }
    if (!text) return;
    pending += text;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      if (line.length > 64 * 1024) {
        // Do not parse arbitrarily large records merely to decide whether a
        // stream committed. The bounded observer must fail closed.
        observationLimit = true;
        continue;
      }
      try {
        const item = JSON.parse(line) as unknown;
        if (
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          typeof (item as Record<string, unknown>).error === "string"
        ) {
          streamError = true;
          streamFailure = validatedGenerationStreamFailure(
            (item as Record<string, unknown>).failure,
          );
        }
        if (
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          (item as Record<string, unknown>).type === "commit_revision"
        )
          sawCommit = true;
      } catch {
        malformedRecord = true;
      }
    }
    if (pending.length > 64 * 1024) {
      pending = "";
      observationLimit = true;
      discardingLine = true;
    }
  };
  const terminal = (
    reason: GenerationObservationTerminalReason,
    abortSource?: GenerationObservationAbortSource,
    failureCode?: GenerationObservationFailureCode,
  ) => {
    if (settled) return;
    settled = true;
    observation.terminal({ reason, abortSource, failureCode });
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          inspectText(decoder.decode());
          if (pending.trim() && !discardingLine) inspectText("\n");
          terminal(
            signal?.aborted
              ? signal.reason?.name === "TimeoutError"
                ? "deadline"
                : "client-abort"
              : observationLimit
                ? "observation-limit"
                : streamFailure
                  ? streamFailure
                  : malformedRecord
                    ? "parser-failure"
                    : streamError
                      ? "stream-error"
                      : sawCommit
                        ? "completed"
                        : "clean-eof-without-commit",
            signal?.aborted
              ? signal.reason?.name === "TimeoutError"
                ? "deadline"
                : "client"
              : streamFailure === "deadline"
                ? "deadline"
                : undefined,
            signal?.aborted
              ? signal.reason?.name === "TimeoutError"
                ? "timeout"
                : "cancelled"
              : observationLimit
                ? "observation-limit"
                : streamFailure === "deadline"
                  ? "timeout"
                  : streamFailure === "output-limit"
                    ? "output-limit"
                    : streamFailure === "provider-error"
                      ? "provider-rejected"
                      : streamFailure === "completion-record-failure"
                        ? "host-unavailable"
                        : streamFailure === "parser-failure" ||
                            streamFailure === "clean-eof-without-commit"
                          ? "parser"
                          : streamFailure === "stream-error"
                            ? "transport"
                            : malformedRecord
                              ? "parser"
                              : streamError
                                ? "transport"
                                : sawCommit
                                  ? undefined
                                  : "parser",
          );
          reader.releaseLock();
          controller.close();
        } else {
          observation.noteOutputBytes(next.value.byteLength);
          inspectText(decoder.decode(next.value, { stream: true }));
          controller.enqueue(next.value);
        }
      } catch (error) {
        const timedOut =
          signal?.aborted && signal.reason?.name === "TimeoutError";
        terminal(
          signal?.aborted
            ? timedOut
              ? "deadline"
              : "client-abort"
            : "transport-error",
          signal?.aborted ? (timedOut ? "deadline" : "client") : undefined,
          timedOut ? "timeout" : signal?.aborted ? "cancelled" : "transport",
        );
        reader.releaseLock();
        controller.error(error);
      }
    },
    async cancel(reason) {
      terminal("client-abort", "client", "cancelled");
      await reader.cancel(reason).catch(() => undefined);
      reader.releaseLock();
    },
  });
}
