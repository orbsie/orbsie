import {
  GENERATION_DIAGNOSTIC_MAX_BYTES,
  GENERATION_DIAGNOSTIC_MAX_RUNS,
  type GenerationObservationFailureCode,
  type GenerationObservationProvider,
  type GenerationObservationTerminalReason,
  validatedBuildId,
  validatedClientRunId,
  validatedGenerationRequestId,
} from "./generation-observability";

export const CLIENT_GENERATION_DIAGNOSTIC_VERSION = 1 as const;
export const CLIENT_GENERATION_DIAGNOSTIC_STORAGE_KEY =
  "orbsie-generation-diagnostics-v1";

const MAX_PHASES = 8;
const MAX_DURATION_MS = 30 * 60 * 1000;
const MAX_COUNTER = 1_000_000;
const MAX_STATUS = 599;
const MIN_STATUS = 400;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const commandTypes = [
  "set_game",
  "reserve_entity",
  "set_geometry",
  "set_material",
  "set_label",
  "set_transform",
  "create_group",
  "remove_group",
  "set_group_transform",
  "set_parent",
  "set_behavior",
  "remove_entity",
  "set_environment",
  "commit_revision",
] as const;
type ClientDiagnosticCommandType = (typeof commandTypes)[number];
type ClientDiagnosticCommandCounts = Partial<
  Record<ClientDiagnosticCommandType, number>
>;
const diagnosticProviders = new Set<GenerationObservationProvider>([
  "openrouter",
  "gateway",
  "chatgpt",
  "free",
]);
const terminalReasons = new Set<GenerationObservationTerminalReason>([
  "completed",
  "clean-eof-without-commit",
  "parser-failure",
  "provider-error",
  "stream-error",
  "completion-record-failure",
  "client-abort",
  "deadline",
  "observation-limit",
  "output-limit",
  "transport-error",
  "stale-run",
  "credential-finalization-failed",
  "unknown",
]);
const failureCodes = new Set<GenerationObservationFailureCode>([
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
]);
const abortSources = new Set([
  "client",
  "deadline",
  "provider",
  "server",
  "unknown",
]);
const credentialOutcomes = new Set([
  "not-applicable",
  "saved",
  "failed",
  "unknown",
]);
const finishReasons = new Set([
  "stop",
  "length",
  "tool_calls",
  "content_filter",
  "error",
  "other",
  "unknown",
]);
const storageListeners = new Set<() => void>();
let loaded = false;
let loadedStorage: Storage | undefined;
let clearGeneration = 0;
let entries: ClientDiagnosticEntry[] = [];

export type ClientDiagnosticRenderer = "webgl" | "software" | "unknown";
export type ClientDiagnosticQuality = "Quality" | "Balanced" | "Budget";
export type ClientDiagnosticPhase =
  | "admission"
  | "provider-start"
  | "response-headers"
  | "first-byte"
  | "first-valid-command"
  | "apply"
  | "commit"
  | "finalization";
export type ClientDiagnosticStartupStage =
  "configuration" | "session" | "status" | "catalog";
export type ClientDiagnosticStartupOutcome =
  "ready" | "transient" | "reconnect" | "selection-required";

type DiagnosticPhase = {
  phase: ClientDiagnosticPhase;
  elapsedMs: number;
};

type DiagnosticTerminal = {
  reason: GenerationObservationTerminalReason;
  failureCode?: GenerationObservationFailureCode;
  abortSource?: "client" | "deadline" | "provider" | "server" | "unknown";
  credentialFinalization?: "not-applicable" | "saved" | "failed" | "unknown";
  httpStatus?: number;
  finishReason?:
    | "stop"
    | "length"
    | "tool_calls"
    | "content_filter"
    | "error"
    | "other"
    | "unknown";
};

export type ClientGenerationDiagnostic = {
  schemaVersion: typeof CLIENT_GENERATION_DIAGNOSTIC_VERSION;
  kind: "generation";
  buildId?: string;
  runId: string;
  requestId?: string;
  provider: GenerationObservationProvider;
  quality?: ClientDiagnosticQuality;
  reasoningEffort?: "low" | "medium" | "high";
  serviceTier?: "default";
  renderer: ClientDiagnosticRenderer;
  coarseCapabilities: {
    touch: boolean;
    coarsePointer: boolean;
    online: boolean;
  };
  startedAt: string;
  durationMs: number;
  phases: DiagnosticPhase[];
  initialRevision: number;
  inputBytes: number;
  outputBytes: number;
  commandCount: number;
  commandCounts: ClientDiagnosticCommandCounts;
  lastCommittedRevision?: number;
  inProgress?: true;
  terminal?: DiagnosticTerminal;
};

export type ClientStartupDiagnostic = {
  schemaVersion: typeof CLIENT_GENERATION_DIAGNOSTIC_VERSION;
  kind: "startup";
  buildId?: string;
  id: string;
  stage: ClientDiagnosticStartupStage;
  outcome: ClientDiagnosticStartupOutcome;
  provider: "chatgpt";
  tier?: ClientDiagnosticQuality;
  durationMs: number;
  at: string;
};

export type ClientDiagnosticEntry =
  ClientGenerationDiagnostic | ClientStartupDiagnostic;

export type BeginClientGenerationDiagnosticOptions = {
  runId: string;
  provider: GenerationObservationProvider;
  quality?: ClientDiagnosticQuality;
  reasoningEffort?: "low" | "medium" | "high";
  serviceTier?: "default";
  renderer?: ClientDiagnosticRenderer;
  now?: () => number;
  wallClock?: () => number;
  capabilities?: Partial<ClientGenerationDiagnostic["coarseCapabilities"]>;
  initialRevision?: number;
};

export type ClientGenerationDiagnosticController = {
  readonly runId: string;
  phase(phase: ClientDiagnosticPhase): void;
  requestId(requestId: unknown): void;
  noteInputBytes(bytes: number): void;
  noteOutputBytes(bytes: number): void;
  noteCommand(type?: unknown): void;
  commit(revision: number): void;
  terminal(options: DiagnosticTerminal): void;
};

function boundedInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_COUNTER, Math.floor(value)));
}

function boundedDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_DURATION_MS, Math.floor(value)));
}

function boundedText(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : undefined;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !timestampPattern.test(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  try {
    return new Date(parsed).toISOString() === value;
  } catch {
    return false;
  }
}

function currentTimestamp(value?: unknown): string {
  if (validTimestamp(value)) return value;
  return new Date().toISOString();
}

function localUuid(): string {
  try {
    const browserCrypto = globalThis.crypto;
    if (typeof browserCrypto?.randomUUID === "function")
      return browserCrypto.randomUUID();
  } catch {
    // Use the valid fallback below when browser crypto is unavailable.
  }
  return "00000000-0000-4000-8000-000000000000";
}

function clientBuildId(): string | undefined {
  // Keep this as a direct static reference so Next can inline the public
  // build-time value into the browser bundle.
  const publicBuildId = process.env.NEXT_PUBLIC_ORBSIE_BUILD_ID;
  return validatedBuildId(
    (globalThis as { __ORBSIE_BUILD_ID__?: unknown }).__ORBSIE_BUILD_ID__ ??
      publicBuildId,
  );
}

function safeProvider(value: unknown): GenerationObservationProvider {
  return diagnosticProviders.has(value as GenerationObservationProvider)
    ? (value as GenerationObservationProvider)
    : "free";
}

function safeQuality(value: unknown): ClientDiagnosticQuality | undefined {
  return value === "Quality" || value === "Balanced" || value === "Budget"
    ? value
    : undefined;
}

function safeRenderer(value: unknown): ClientDiagnosticRenderer {
  return value === "webgl" || value === "software" ? value : "unknown";
}

function safeAbortSource(value: unknown): DiagnosticTerminal["abortSource"] {
  return abortSources.has(value as string)
    ? (value as DiagnosticTerminal["abortSource"])
    : undefined;
}

function safeCredentialFinalization(
  value: unknown,
): DiagnosticTerminal["credentialFinalization"] {
  return credentialOutcomes.has(value as string)
    ? (value as DiagnosticTerminal["credentialFinalization"])
    : undefined;
}

function safeFinishReason(value: unknown): DiagnosticTerminal["finishReason"] {
  return finishReasons.has(value as string)
    ? (value as DiagnosticTerminal["finishReason"])
    : undefined;
}

function safeCommandType(
  value: unknown,
): ClientDiagnosticCommandType | undefined {
  return (commandTypes as readonly unknown[]).includes(value)
    ? (value as ClientDiagnosticCommandType)
    : undefined;
}

function byteLength(value: string): number {
  try {
    return new TextEncoder().encode(value).byteLength;
  } catch {
    return value.length;
  }
}

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function validPhase(value: unknown): value is ClientDiagnosticPhase {
  return (
    value === "admission" ||
    value === "provider-start" ||
    value === "response-headers" ||
    value === "first-byte" ||
    value === "first-valid-command" ||
    value === "apply" ||
    value === "commit" ||
    value === "finalization"
  );
}

function validStage(value: unknown): value is ClientDiagnosticStartupStage {
  return (
    value === "configuration" ||
    value === "session" ||
    value === "status" ||
    value === "catalog"
  );
}

function validOutcome(value: unknown): value is ClientDiagnosticStartupOutcome {
  return (
    value === "ready" ||
    value === "transient" ||
    value === "reconnect" ||
    value === "selection-required"
  );
}

function validCapabilities(
  value: unknown,
): value is ClientGenerationDiagnostic["coarseCapabilities"] {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.touch === "boolean" &&
    typeof source.coarsePointer === "boolean" &&
    typeof source.online === "boolean"
  );
}

function validCommandCounts(
  value: unknown,
): value is ClientDiagnosticCommandCounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return Object.entries(source).every(
    ([key, count]) =>
      safeCommandType(key) !== undefined &&
      Number.isSafeInteger(count) &&
      Number(count) >= 0 &&
      Number(count) <= MAX_COUNTER,
  );
}

function validEntry(value: unknown): value is ClientDiagnosticEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== CLIENT_GENERATION_DIAGNOSTIC_VERSION)
    return false;
  if (source.kind === "startup") {
    return (
      validatedClientRunId(source.id) !== undefined &&
      validStage(source.stage) &&
      validOutcome(source.outcome) &&
      source.provider === "chatgpt" &&
      (source.buildId === undefined ||
        validatedBuildId(source.buildId) === source.buildId) &&
      (source.tier === undefined || safeQuality(source.tier) !== undefined) &&
      Number.isSafeInteger(source.durationMs) &&
      Number(source.durationMs) >= 0 &&
      Number(source.durationMs) <= MAX_DURATION_MS &&
      validTimestamp(source.at)
    );
  }
  if (source.kind !== "generation") return false;
  const phases = source.phases;
  const terminal = source.terminal;
  return (
    typeof source.runId === "string" &&
    validatedClientRunId(source.runId) !== undefined &&
    (source.buildId === undefined ||
      validatedBuildId(source.buildId) === source.buildId) &&
    (source.requestId === undefined ||
      validatedGenerationRequestId(source.requestId) !== undefined) &&
    diagnosticProviders.has(source.provider as GenerationObservationProvider) &&
    (source.quality === undefined ||
      safeQuality(source.quality) !== undefined) &&
    (source.reasoningEffort === undefined ||
      source.reasoningEffort === "low" ||
      source.reasoningEffort === "medium" ||
      source.reasoningEffort === "high") &&
    (source.serviceTier === undefined || source.serviceTier === "default") &&
    safeRenderer(source.renderer) === source.renderer &&
    validCapabilities(source.coarseCapabilities) &&
    validTimestamp(source.startedAt) &&
    Number.isSafeInteger(source.durationMs) &&
    Number(source.durationMs) >= 0 &&
    Number(source.durationMs) <= MAX_DURATION_MS &&
    Array.isArray(phases) &&
    phases.length <= MAX_PHASES &&
    phases.every(
      (phase) =>
        phase &&
        typeof phase === "object" &&
        validPhase((phase as Record<string, unknown>).phase) &&
        Number.isSafeInteger((phase as Record<string, unknown>).elapsedMs) &&
        Number((phase as Record<string, unknown>).elapsedMs) >= 0 &&
        Number((phase as Record<string, unknown>).elapsedMs) <= MAX_DURATION_MS,
    ) &&
    Number.isSafeInteger(source.initialRevision) &&
    Number(source.initialRevision) >= 0 &&
    Number(source.initialRevision) <= MAX_COUNTER &&
    Number.isSafeInteger(source.inputBytes) &&
    Number(source.inputBytes) >= 0 &&
    Number(source.inputBytes) <= MAX_COUNTER &&
    Number.isSafeInteger(source.outputBytes) &&
    Number(source.outputBytes) >= 0 &&
    Number(source.outputBytes) <= MAX_COUNTER &&
    Number.isSafeInteger(source.commandCount) &&
    Number(source.commandCount) >= 0 &&
    Number(source.commandCount) <= MAX_COUNTER &&
    validCommandCounts(source.commandCounts) &&
    (source.inProgress === undefined || source.inProgress === true) &&
    (source.lastCommittedRevision === undefined ||
      (Number.isSafeInteger(source.lastCommittedRevision) &&
        Number(source.lastCommittedRevision) >= 0 &&
        Number(source.lastCommittedRevision) <= MAX_COUNTER)) &&
    ((source.inProgress === true && terminal === undefined) ||
      (source.inProgress === undefined &&
        terminal !== undefined &&
        typeof terminal === "object" &&
        terminalReasons.has(
          (terminal as Record<string, unknown>)
            .reason as GenerationObservationTerminalReason,
        ) &&
        ((terminal as Record<string, unknown>).failureCode === undefined ||
          failureCodes.has(
            (terminal as Record<string, unknown>)
              .failureCode as GenerationObservationFailureCode,
          )) &&
        ((terminal as Record<string, unknown>).abortSource === undefined ||
          abortSources.has(
            (terminal as Record<string, unknown>).abortSource as string,
          )) &&
        ((terminal as Record<string, unknown>).credentialFinalization ===
          undefined ||
          credentialOutcomes.has(
            (terminal as Record<string, unknown>)
              .credentialFinalization as string,
          )) &&
        ((terminal as Record<string, unknown>).httpStatus === undefined ||
          (Number.isSafeInteger(
            (terminal as Record<string, unknown>).httpStatus,
          ) &&
            Number((terminal as Record<string, unknown>).httpStatus) >=
              MIN_STATUS &&
            Number((terminal as Record<string, unknown>).httpStatus) <=
              MAX_STATUS)) &&
        ((terminal as Record<string, unknown>).finishReason === undefined ||
          safeFinishReason(
            (terminal as Record<string, unknown>).finishReason,
          ) !== undefined)))
  );
}

function sanitizeEntry(value: unknown): ClientDiagnosticEntry | undefined {
  if (!validEntry(value)) return undefined;
  if (value.kind === "startup") {
    return {
      schemaVersion: CLIENT_GENERATION_DIAGNOSTIC_VERSION,
      kind: "startup",
      ...(value.buildId ? { buildId: value.buildId } : {}),
      id: value.id,
      stage: value.stage,
      outcome: value.outcome,
      provider: "chatgpt",
      ...(value.tier ? { tier: value.tier } : {}),
      durationMs: value.durationMs,
      at: value.at,
    };
  }

  const terminal = value.terminal;
  return {
    schemaVersion: CLIENT_GENERATION_DIAGNOSTIC_VERSION,
    kind: "generation",
    ...(value.buildId ? { buildId: value.buildId } : {}),
    runId: value.runId,
    ...(value.requestId ? { requestId: value.requestId } : {}),
    provider: value.provider,
    ...(value.quality ? { quality: value.quality } : {}),
    ...(value.reasoningEffort
      ? { reasoningEffort: value.reasoningEffort }
      : {}),
    ...(value.serviceTier ? { serviceTier: value.serviceTier } : {}),
    renderer: value.renderer,
    coarseCapabilities: {
      touch: value.coarseCapabilities.touch,
      coarsePointer: value.coarseCapabilities.coarsePointer,
      online: value.coarseCapabilities.online,
    },
    startedAt: value.startedAt,
    durationMs: value.durationMs,
    phases: value.phases.map((phase) => ({
      phase: phase.phase,
      elapsedMs: phase.elapsedMs,
    })),
    initialRevision: value.initialRevision,
    inputBytes: value.inputBytes,
    outputBytes: value.outputBytes,
    commandCount: value.commandCount,
    commandCounts: Object.fromEntries(
      Object.entries(value.commandCounts).flatMap(([key, count]) => {
        const type = safeCommandType(key);
        return type === undefined ? [] : [[type, count]];
      }),
    ) as ClientDiagnosticCommandCounts,
    ...(value.lastCommittedRevision === undefined
      ? {}
      : { lastCommittedRevision: value.lastCommittedRevision }),
    ...(value.inProgress ? { inProgress: true as const } : {}),
    ...(terminal
      ? {
          terminal: {
            reason: terminal.reason,
            ...(terminal.failureCode
              ? { failureCode: terminal.failureCode }
              : {}),
            ...(terminal.abortSource
              ? { abortSource: terminal.abortSource }
              : {}),
            ...(terminal.credentialFinalization
              ? { credentialFinalization: terminal.credentialFinalization }
              : {}),
            ...(terminal.httpStatus === undefined
              ? {}
              : { httpStatus: terminal.httpStatus }),
            ...(terminal.finishReason
              ? { finishReason: terminal.finishReason }
              : {}),
          },
        }
      : {}),
  };
}

function serialize(entriesToWrite: readonly ClientDiagnosticEntry[]): string {
  return JSON.stringify({
    schemaVersion: CLIENT_GENERATION_DIAGNOSTIC_VERSION,
    entries: entriesToWrite,
  });
}

function boundedEntries(input: readonly ClientDiagnosticEntry[]) {
  let next = input.slice(-GENERATION_DIAGNOSTIC_MAX_RUNS);
  while (
    next.length &&
    byteLength(serialize(next)) > GENERATION_DIAGNOSTIC_MAX_BYTES
  )
    next = next.slice(1);
  return next;
}

function notify() {
  for (const listener of storageListeners) {
    try {
      listener();
    } catch {
      // A diagnostic subscriber must never affect generation.
    }
  }
}

function load() {
  const storage = browserStorage();
  if (loaded && storage === loadedStorage) return;
  loaded = true;
  loadedStorage = storage;
  let raw: string | null = null;
  try {
    raw = storage?.getItem(CLIENT_GENERATION_DIAGNOSTIC_STORAGE_KEY) ?? null;
  } catch {
    return;
  }
  if (!raw || byteLength(raw) > GENERATION_DIAGNOSTIC_MAX_BYTES) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    const rawEntries = (parsed as Record<string, unknown>).entries;
    if (
      (parsed as Record<string, unknown>).schemaVersion !==
        CLIENT_GENERATION_DIAGNOSTIC_VERSION ||
      !Array.isArray(rawEntries)
    )
      return;
    entries = boundedEntries(
      rawEntries.flatMap((entry) => {
        const sanitized = sanitizeEntry(entry);
        return sanitized ? [sanitized] : [];
      }),
    );
  } catch {
    entries = [];
  }
}

function persist() {
  entries = boundedEntries(
    entries.flatMap((entry) => {
      const sanitized = sanitizeEntry(entry);
      return sanitized ? [sanitized] : [];
    }),
  );
  const storage = browserStorage();
  if (storage) {
    try {
      storage.setItem(
        CLIENT_GENERATION_DIAGNOSTIC_STORAGE_KEY,
        serialize(entries),
      );
    } catch {
      // Private browsing/storage quota failures keep the in-memory history usable.
    }
  }
  notify();
}

export function readGenerationDiagnostics(): readonly ClientDiagnosticEntry[] {
  load();
  return JSON.parse(JSON.stringify(entries)) as ClientDiagnosticEntry[];
}

export function subscribeGenerationDiagnostics(listener: () => void) {
  storageListeners.add(listener);
  return () => storageListeners.delete(listener);
}

export function clearGenerationDiagnostics() {
  const storage = browserStorage();
  clearGeneration += 1;
  entries = [];
  // Keep the in-memory clear authoritative for this storage instance even if
  // persistence is unavailable. A later browser-storage replacement (as can
  // happen after a test or a new document) is still loaded by load().
  loaded = true;
  loadedStorage = storage;
  try {
    storage?.removeItem(CLIENT_GENERATION_DIAGNOSTIC_STORAGE_KEY);
  } catch {}
  notify();
}

export function exportGenerationDiagnostics(): string {
  load();
  const buildId = clientBuildId();
  const document = {
    schemaVersion: CLIENT_GENERATION_DIAGNOSTIC_VERSION,
    ...(buildId ? { buildId } : {}),
    generatedAt: new Date().toISOString(),
    entries: boundedEntries(
      entries.flatMap((entry) => {
        const sanitized = sanitizeEntry(entry);
        return sanitized ? [sanitized] : [];
      }),
    ),
    manualReproduction: [
      "Record the provider, quality tier, renderer and failure stage shown by the app.",
      "Retry the same prompt once after confirming the selected provider connection.",
      "Content-free diagnostics locate lifecycle failures but cannot reconstruct a private scene.",
    ],
  };
  let output = JSON.stringify(document, null, 2);
  while (
    byteLength(output) > GENERATION_DIAGNOSTIC_MAX_BYTES &&
    document.entries.length
  ) {
    document.entries.shift();
    output = JSON.stringify(document, null, 2);
  }
  return JSON.stringify(document, null, 2);
}

function append(entry: ClientDiagnosticEntry) {
  load();
  const sanitized = sanitizeEntry(entry);
  if (!sanitized) return;
  const existingIndex =
    sanitized.kind === "generation"
      ? entries.findIndex(
          (entry) =>
            entry.kind === "generation" && entry.runId === sanitized.runId,
        )
      : -1;
  if (existingIndex >= 0) {
    entries = entries.slice();
    entries[existingIndex] = sanitized;
  } else entries = [...entries, sanitized];
  entries = boundedEntries(entries);
  persist();
}

export function recordStartupDiagnostic(options: {
  stage: ClientDiagnosticStartupStage;
  outcome: ClientDiagnosticStartupOutcome;
  tier?: ClientDiagnosticQuality;
  durationMs: number;
  at?: string;
}) {
  append({
    schemaVersion: CLIENT_GENERATION_DIAGNOSTIC_VERSION,
    kind: "startup",
    id: localUuid(),
    stage: options.stage,
    outcome: options.outcome,
    provider: "chatgpt",
    ...(clientBuildId() ? { buildId: clientBuildId() } : {}),
    ...(safeQuality(options.tier) ? { tier: safeQuality(options.tier) } : {}),
    durationMs: boundedDuration(options.durationMs),
    at: currentTimestamp(options.at),
  });
}

export function beginClientGenerationDiagnostic(
  options: BeginClientGenerationDiagnosticOptions,
): ClientGenerationDiagnosticController {
  const runId = validatedClientRunId(options.runId);
  if (!runId) throw new Error("A valid client run ID is required.");
  const now = options.now ?? (() => performance.now());
  const wallClock = options.wallClock ?? Date.now;
  const start = now();
  let startedAt: string;
  try {
    startedAt = currentTimestamp(new Date(wallClock()).toISOString());
  } catch {
    startedAt = currentTimestamp();
  }
  const provider = safeProvider(options.provider);
  const buildId = clientBuildId();
  const quality = safeQuality(options.quality);
  const reasoningEffort =
    options.reasoningEffort === "low" ||
    options.reasoningEffort === "medium" ||
    options.reasoningEffort === "high"
      ? options.reasoningEffort
      : undefined;
  const serviceTier = options.serviceTier === "default" ? "default" : undefined;
  const renderer = safeRenderer(options.renderer);
  const capabilities = {
    touch: options.capabilities?.touch === true,
    coarsePointer: options.capabilities?.coarsePointer === true,
    online: options.capabilities?.online !== false,
  };
  let requestId: string | undefined;
  let inputBytes = 0;
  let outputBytes = 0;
  let commandCount = 0;
  const commandCounts: ClientDiagnosticCommandCounts = {};
  const initialRevision = boundedInteger(options.initialRevision ?? 0);
  const historyGeneration = clearGeneration;
  let lastCommittedRevision: number | undefined;
  let terminalEmitted = false;
  const phases: DiagnosticPhase[] = [];
  let saveSnapshot: () => void = () => undefined;
  const snapshot = (): ClientGenerationDiagnostic => ({
    schemaVersion: CLIENT_GENERATION_DIAGNOSTIC_VERSION,
    kind: "generation",
    runId,
    ...(buildId ? { buildId } : {}),
    ...(requestId ? { requestId } : {}),
    provider,
    ...(quality ? { quality } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(serviceTier ? { serviceTier } : {}),
    renderer,
    coarseCapabilities: { ...capabilities },
    startedAt,
    durationMs: boundedDuration(now() - start),
    phases: phases.slice(0, MAX_PHASES),
    initialRevision,
    inputBytes,
    outputBytes,
    commandCount,
    commandCounts: { ...commandCounts },
    ...(lastCommittedRevision === undefined ? {} : { lastCommittedRevision }),
    inProgress: true,
  });
  const emitPhase = (phase: ClientDiagnosticPhase) => {
    if (terminalEmitted || phases.some((entry) => entry.phase === phase))
      return;
    phases.push({ phase, elapsedMs: boundedDuration(now() - start) });
    saveSnapshot();
  };
  const controller: ClientGenerationDiagnosticController = {
    runId,
    phase(phase) {
      if (validPhase(phase)) emitPhase(phase);
    },
    requestId(value) {
      const validated = validatedGenerationRequestId(value);
      if (validated) {
        requestId = validated;
        saveSnapshot();
      }
    },
    noteInputBytes(bytes) {
      inputBytes = boundedInteger(inputBytes + boundedInteger(bytes));
    },
    noteOutputBytes(bytes) {
      outputBytes = boundedInteger(outputBytes + boundedInteger(bytes));
    },
    noteCommand(type) {
      commandCount = boundedInteger(commandCount + 1);
      const commandType = safeCommandType(type);
      if (commandType)
        commandCounts[commandType] = boundedInteger(
          (commandCounts[commandType] ?? 0) + 1,
        );
      emitPhase("first-valid-command");
    },
    commit(revision) {
      if (Number.isSafeInteger(revision) && revision >= 0)
        lastCommittedRevision = revision;
      emitPhase("commit");
    },
    terminal(options) {
      if (terminalEmitted) return;
      emitPhase("finalization");
      terminalEmitted = true;
      if (historyGeneration !== clearGeneration) return;
      const terminalReason = terminalReasons.has(options.reason)
        ? options.reason
        : "unknown";
      append({
        schemaVersion: CLIENT_GENERATION_DIAGNOSTIC_VERSION,
        kind: "generation",
        runId,
        ...(buildId ? { buildId } : {}),
        ...(requestId ? { requestId } : {}),
        provider,
        ...(quality ? { quality } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(serviceTier ? { serviceTier } : {}),
        renderer,
        coarseCapabilities: capabilities,
        startedAt,
        durationMs: boundedDuration(now() - start),
        phases: phases.slice(0, MAX_PHASES),
        initialRevision,
        inputBytes,
        outputBytes,
        commandCount,
        commandCounts: { ...commandCounts },
        ...(lastCommittedRevision === undefined
          ? {}
          : { lastCommittedRevision }),
        terminal: {
          reason: terminalReason,
          ...(failureCodes.has(
            options.failureCode as GenerationObservationFailureCode,
          )
            ? { failureCode: options.failureCode }
            : {}),
          ...(typeof options.httpStatus === "number" &&
          Number.isSafeInteger(options.httpStatus) &&
          options.httpStatus >= MIN_STATUS &&
          options.httpStatus <= MAX_STATUS
            ? { httpStatus: options.httpStatus }
            : {}),
          ...(safeAbortSource(options.abortSource)
            ? { abortSource: safeAbortSource(options.abortSource) }
            : {}),
          ...(safeCredentialFinalization(options.credentialFinalization)
            ? {
                credentialFinalization: safeCredentialFinalization(
                  options.credentialFinalization,
                ),
              }
            : {}),
          ...(safeFinishReason(options.finishReason)
            ? { finishReason: safeFinishReason(options.finishReason) }
            : {}),
        },
      });
    },
  };
  saveSnapshot = () => {
    if (terminalEmitted || historyGeneration !== clearGeneration) return;
    append(snapshot());
  };
  emitPhase("admission");
  return controller;
}
