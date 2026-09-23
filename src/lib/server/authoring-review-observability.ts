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

export function createAuthoringReviewDiagnostic(input: {
  requestId: string;
  clientRunId?: string;
  phase: AuthoringReviewDiagnosticPhase;
  scope: AuthoringReviewDiagnosticScope;
  state: AuthoringReviewDiagnosticState;
  outcome: AuthoringReviewDiagnosticOutcome;
  timestamp?: string;
}): AuthoringReviewDiagnostic | undefined {
  const requestId = validatedGenerationRequestId(input.requestId);
  const phase = safePhase(input.phase);
  const scope = safeScope(input.scope);
  const state = safeState(input.state);
  const outcome = safeOutcome(input.outcome);
  if (!requestId || !phase || !scope || !state || !outcome) return undefined;
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
