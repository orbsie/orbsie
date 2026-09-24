import {
  validatedClientRunId,
  validatedGenerationRequestId,
} from "../generation-observability";

export const AUTHORING_REVIEW_DIAGNOSTIC_VERSION = 1 as const;

export const authoringReviewDiagnosticPhases = [
  "review",
  "final-review",
] as const;
export type AuthoringReviewDiagnosticPhase =
  (typeof authoringReviewDiagnosticPhases)[number];

export const authoringReviewDiagnosticScopes = [
  "structural-only",
  "visual+structural",
] as const;
export type AuthoringReviewDiagnosticScope =
  (typeof authoringReviewDiagnosticScopes)[number];

export const authoringReviewDiagnosticStates = [
  "admission",
  "terminal",
] as const;
export type AuthoringReviewDiagnosticState =
  (typeof authoringReviewDiagnosticStates)[number];

export const authoringReviewDiagnosticOutcomes = [
  "admitted",
  "accepted",
  "revised",
  "partial",
  "failed",
  "cancelled",
] as const;
export type AuthoringReviewDiagnosticOutcome =
  (typeof authoringReviewDiagnosticOutcomes)[number];

export const authoringReviewDiagnosticFailureKinds = [
  "invalid-input",
  "unsupported-image",
  "provider-rejected",
  "provider-response",
  "semantic-validation",
  "aborted",
  "route-aborted",
  "http-error",
  "authoring-ledger",
  "review-image-validation",
  "generation-format-config",
  "unknown",
] as const;
export type AuthoringReviewDiagnosticFailureKind =
  (typeof authoringReviewDiagnosticFailureKinds)[number];

export type AuthoringReviewDiagnostic = {
  schemaVersion: typeof AUTHORING_REVIEW_DIAGNOSTIC_VERSION;
  event: "authoring-review";
  state: AuthoringReviewDiagnosticState;
  requestId: string;
  clientRunId?: string;
  phase: AuthoringReviewDiagnosticPhase;
  callIndex: 2 | 3;
  scope: AuthoringReviewDiagnosticScope;
  outcome: AuthoringReviewDiagnosticOutcome;
  failureKind?: AuthoringReviewDiagnosticFailureKind;
  timestamp: string;
};

function safePhase(value: unknown): AuthoringReviewDiagnosticPhase | undefined {
  return (authoringReviewDiagnosticPhases as readonly unknown[]).includes(value)
    ? (value as AuthoringReviewDiagnosticPhase)
    : undefined;
}

function safeScope(value: unknown): AuthoringReviewDiagnosticScope | undefined {
  return (authoringReviewDiagnosticScopes as readonly unknown[]).includes(value)
    ? (value as AuthoringReviewDiagnosticScope)
    : undefined;
}

function safeState(value: unknown): AuthoringReviewDiagnosticState | undefined {
  return (authoringReviewDiagnosticStates as readonly unknown[]).includes(value)
    ? (value as AuthoringReviewDiagnosticState)
    : undefined;
}

function safeOutcome(
  value: unknown,
): AuthoringReviewDiagnosticOutcome | undefined {
  return (authoringReviewDiagnosticOutcomes as readonly unknown[]).includes(
    value,
  )
    ? (value as AuthoringReviewDiagnosticOutcome)
    : undefined;
}

function safeFailureKind(
  value: unknown,
): AuthoringReviewDiagnosticFailureKind | undefined {
  return (authoringReviewDiagnosticFailureKinds as readonly unknown[]).includes(
    value,
  )
    ? (value as AuthoringReviewDiagnosticFailureKind)
    : undefined;
}

export function createAuthoringReviewDiagnostic(input: {
  requestId: string;
  clientRunId?: string;
  phase: AuthoringReviewDiagnosticPhase;
  scope: AuthoringReviewDiagnosticScope;
  state: AuthoringReviewDiagnosticState;
  outcome: AuthoringReviewDiagnosticOutcome;
  failureKind?: unknown;
  timestamp?: string;
}): AuthoringReviewDiagnostic | undefined {
  const requestId = validatedGenerationRequestId(input.requestId);
  const phase = safePhase(input.phase);
  const scope = safeScope(input.scope);
  const state = safeState(input.state);
  const outcome = safeOutcome(input.outcome);
  if (!requestId || !phase || !scope || !state || !outcome) return undefined;
  const failureKind =
    state === "terminal" && (outcome === "failed" || outcome === "cancelled")
      ? safeFailureKind(input.failureKind)
      : undefined;
  return {
    schemaVersion: AUTHORING_REVIEW_DIAGNOSTIC_VERSION,
    event: "authoring-review",
    state,
    requestId,
    ...(validatedClientRunId(input.clientRunId)
      ? { clientRunId: validatedClientRunId(input.clientRunId) }
      : {}),
    phase,
    callIndex: phase === "review" ? 2 : 3,
    scope,
    outcome,
    ...(failureKind ? { failureKind } : {}),
    timestamp:
      typeof input.timestamp === "string" && input.timestamp.length <= 64
        ? input.timestamp
        : new Date().toISOString(),
  };
}

export function emitAuthoringReviewDiagnostic(
  input: Parameters<typeof createAuthoringReviewDiagnostic>[0],
  sink: (event: AuthoringReviewDiagnostic) => void = (event) =>
    console.info(JSON.stringify(event)),
) {
  const event = createAuthoringReviewDiagnostic(input);
  if (!event) return;
  try {
    sink(event);
  } catch {
    // Diagnostics are best effort and never affect an authoring request.
  }
}
