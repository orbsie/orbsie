import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
  claimTrialInTransaction,
  type TrialIdentity,
  withDatabaseTransaction,
} from "./trial";
import { database } from "./auth";

export const AUTHORING_RUN_TTL_MS = 15 * 60 * 1000;
export const AUTHORING_RUN_REVIEW_SLOTS = 2;
export const FREE_AUTHORING_GLOBAL_UNITS = 3;

export type AuthoringProvider = "free" | "openrouter" | "gateway" | "chatgpt";
// Provider catalogs may add values such as xhigh, minimal, or none. Keep the
// ledger bounded and catalog-admitted without narrowing that provider-owned set.
export type AuthoringEffort = string;
export type AuthoringReviewPhase = "review" | "final-review";

export class AuthoringRunLedgerError extends Error {
  constructor(
    public readonly code:
      | "invalid-input"
      | "not-found"
      | "expired"
      | "binding-mismatch"
      | "token-mismatch"
      | "phase-conflict"
      | "revision-mismatch",
    message: string,
  ) {
    super(message);
  }
}

export type AuthoringRunBinding = {
  identityHash: string;
  projectId: string;
  provider: AuthoringProvider;
  model: string;
  effort?: AuthoringEffort;
  requestFingerprint: string;
};

export type IssueAuthoringRunInput = AuthoringRunBinding & {
  initialRevision: number;
  initialSceneDigest: string;
  /** Present only for a free run; the caller must obtain it from trialIdentity. */
  trialIdentity?: TrialIdentity;
};

export type CompleteInitialAuthoringRunInput = AuthoringRunBinding & {
  runId: string;
  phaseToken: string;
  revision: number;
  sceneBindingDigest: string;
  signal?: AbortSignal;
};

export type AdmitAuthoringReviewInput = AuthoringRunBinding & {
  runId: string;
  reviewPhase: AuthoringReviewPhase;
  expectedRevision: number;
  expectedSceneBindingDigest: string;
  signal?: AbortSignal;
};

export type CompleteAuthoringReviewInput = AuthoringRunBinding & {
  runId: string;
  phaseToken: string;
  reviewPhase: AuthoringReviewPhase;
  revision: number;
  sceneBindingDigest: string;
  accepted: boolean;
  signal?: AbortSignal;
};

type LedgerRow = {
  run_id: string;
  identity_hash: string;
  project_id: string;
  provider: AuthoringProvider;
  model: string;
  effort: AuthoringEffort | null;
  request_fingerprint: string;
  initial_revision: number;
  initial_scene_digest: string;
  phase:
    | "active"
    | "completed"
    | "reviewing"
    | "final-review"
    | "finalized"
    | "failed";
  remaining_review_slots: number;
  phase_token_hash: string | null;
  phase_token_expires_at: Date | string | null;
  completed_revision: number | null;
  completed_scene_digest: string | null;
  expires_at: Date | string;
  live: boolean;
  token_live: boolean;
};
type RawLedgerRow = Omit<
  LedgerRow,
  "initial_revision" | "remaining_review_slots" | "completed_revision"
> & {
  initial_revision: number | string;
  remaining_review_slots: number | string;
  completed_revision: number | string | null;
};

const HEX_DIGEST = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_MODEL = /^[\p{L}\p{N}._:/~+@-]{1,256}$/u;
const SAFE_EFFORT = /^[\p{L}\p{N}._:-]{1,32}$/u;
const PROVIDERS = new Set<AuthoringProvider>([
  "free",
  "openrouter",
  "gateway",
  "chatgpt",
]);
const REVIEW_TRANSACTION_OPTIONS = {
  acquireTimeoutMs: 5000,
  lockTimeoutMs: 5000,
  statementTimeoutMs: 10000,
} as const;

function secret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || value.length < 16)
    throw new AuthoringRunLedgerError(
      "invalid-input",
      "Authoring run signing is not configured.",
    );
  return value;
}

function tokenHash(value: string) {
  return createHmac("sha256", secret())
    .update(`orbsie-authoring-run-token:${value}`)
    .digest("hex");
}

function isToken(value: string) {
  return typeof value === "string" && value.length >= 32 && value.length <= 128;
}

function assertDigest(value: string, label: string) {
  if (!HEX_DIGEST.test(value))
    throw new AuthoringRunLedgerError("invalid-input", `${label} is invalid.`);
}

function assertBinding(value: AuthoringRunBinding) {
  assertDigest(value.identityHash, "identity");
  assertDigest(value.requestFingerprint, "request fingerprint");
  if (
    !value.projectId ||
    value.projectId.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(value.projectId)
  )
    throw new AuthoringRunLedgerError(
      "invalid-input",
      "Project binding is invalid.",
    );
  if (!SAFE_MODEL.test(value.model))
    throw new AuthoringRunLedgerError(
      "invalid-input",
      "Model binding is invalid.",
    );
  if (!PROVIDERS.has(value.provider))
    throw new AuthoringRunLedgerError(
      "invalid-input",
      "Provider binding is invalid.",
    );
  if (value.effort !== undefined && !SAFE_EFFORT.test(value.effort))
    throw new AuthoringRunLedgerError(
      "invalid-input",
      "Reasoning effort is invalid.",
    );
}

function assertRevision(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new AuthoringRunLedgerError("invalid-input", `${label} is invalid.`);
}

function assertRunId(value: string) {
  if (!UUID.test(value))
    throw new AuthoringRunLedgerError(
      "invalid-input",
      "Run identifier is invalid.",
    );
}

function assertPrivateToken(value: string) {
  if (!isToken(value))
    throw new AuthoringRunLedgerError(
      "token-mismatch",
      "Authoring phase token is invalid.",
    );
}

function sameSecret(a: string | null, b: string) {
  if (!a) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function errorForExpired(
  row: Pick<LedgerRow, "live" | "token_live" | "phase_token_hash">,
) {
  if (!row.live || (row.phase_token_hash && !row.token_live))
    return new AuthoringRunLedgerError("expired", "Authoring run has expired.");
  return null;
}

async function lockedRun(client: PoolClient, runId: string) {
  const result = await client.query<RawLedgerRow>(
    "SELECT *, expires_at > clock_timestamp() AS live, (phase_token_expires_at IS NOT NULL AND phase_token_expires_at > clock_timestamp()) AS token_live FROM orbsie_authoring_runs WHERE run_id=$1 FOR UPDATE",
    [runId],
  );
  const row = result.rows[0];
  if (!row)
    throw new AuthoringRunLedgerError(
      "not-found",
      "Authoring run was not found.",
    );
  const expired = errorForExpired(row);
  if (expired) throw expired;
  const initialRevision = Number(row.initial_revision);
  const remainingReviewSlots = Number(row.remaining_review_slots);
  const completedRevision =
    row.completed_revision === null ? null : Number(row.completed_revision);
  if (
    !Number.isSafeInteger(initialRevision) ||
    !Number.isSafeInteger(remainingReviewSlots) ||
    (completedRevision !== null && !Number.isSafeInteger(completedRevision))
  )
    throw new AuthoringRunLedgerError(
      "invalid-input",
      "Authoring run revision is outside the supported range.",
    );
  return {
    ...row,
    initial_revision: initialRevision,
    remaining_review_slots: remainingReviewSlots,
    completed_revision: completedRevision,
  } satisfies LedgerRow;
}

function assertSameBinding(row: LedgerRow, input: AuthoringRunBinding) {
  if (
    row.identity_hash !== input.identityHash ||
    row.project_id !== input.projectId ||
    row.provider !== input.provider ||
    row.model !== input.model ||
    row.effort !== (input.effort ?? null) ||
    row.request_fingerprint !== input.requestFingerprint
  )
    throw new AuthoringRunLedgerError(
      "binding-mismatch",
      "Authoring run binding does not match.",
    );
}

function assertPhaseToken(row: LedgerRow, token: string) {
  assertPrivateToken(token);
  if (!sameSecret(row.phase_token_hash, tokenHash(token)) || !row.token_live)
    throw new AuthoringRunLedgerError(
      "token-mismatch",
      "Authoring phase token does not match.",
    );
}

function cancellationReason(signal: AbortSignal) {
  return signal.reason ?? Error("Generation cancelled.");
}

async function failCancelledReview(
  input: AuthoringRunBinding,
  runId: string,
  phaseToken: string,
  revision: number,
  sceneBindingDigest: string,
) {
  // The finishing token is intentionally passed to the independent cleanup
  // transaction. If a later phase has replaced it, this exact-token fence
  // rejects the stale cleanup and leaves the newer phase untouched.
  await failAuthoringRun({
    ...input,
    runId,
    phaseToken,
    revision,
    sceneBindingDigest,
  });
}

export async function issueAuthoringRun(input: IssueAuthoringRunInput) {
  assertBinding(input);
  assertRevision(input.initialRevision, "Initial revision");
  assertDigest(input.initialSceneDigest, "Initial scene digest");
  if (input.provider === "free") {
    if (
      !input.trialIdentity?.identityHash ||
      input.trialIdentity.identityHash !== input.identityHash
    )
      throw new AuthoringRunLedgerError(
        "binding-mismatch",
        "Free authoring runs require the server trial identity.",
      );
  } else if (input.trialIdentity) {
    throw new AuthoringRunLedgerError(
      "invalid-input",
      "A trial identity is only valid for a free run.",
    );
  }
  const runId = randomUUID();
  const phaseToken = randomUUID();
  const result = await withDatabaseTransaction(async (client) => {
    const trialRemaining =
      input.provider === "free"
        ? await claimTrialInTransaction(
            client,
            input.trialIdentity!,
            FREE_AUTHORING_GLOBAL_UNITS,
          )
        : null;
    const inserted = await client.query<{ expires_at: Date }>(
      "INSERT INTO orbsie_authoring_runs (run_id,identity_hash,project_id,provider,model,effort,request_fingerprint,initial_revision,initial_scene_digest,phase,remaining_review_slots,phase_token_hash,phase_token_expires_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11,clock_timestamp()+$12 * interval '1 minute',clock_timestamp()+$12 * interval '1 minute') RETURNING expires_at",
      [
        runId,
        input.identityHash,
        input.projectId,
        input.provider,
        input.model,
        input.effort ?? null,
        input.requestFingerprint,
        input.initialRevision,
        input.initialSceneDigest,
        AUTHORING_RUN_REVIEW_SLOTS,
        tokenHash(phaseToken),
        AUTHORING_RUN_TTL_MS / 60_000,
      ],
    );
    if (inserted.rowCount !== 1)
      throw new AuthoringRunLedgerError(
        "phase-conflict",
        "Authoring run could not be admitted.",
      );
    return { trialRemaining, expiresAt: inserted.rows[0].expires_at };
  });
  return {
    runId,
    phaseToken,
    trialRemaining: result.trialRemaining,
    expiresAt: result.expiresAt,
  };
}

export async function completeInitialAuthoringRun(
  input: CompleteInitialAuthoringRunInput,
) {
  assertBinding(input);
  assertRunId(input.runId);
  assertPrivateToken(input.phaseToken);
  assertRevision(input.revision, "Completed revision");
  assertDigest(input.sceneBindingDigest, "Scene binding digest");
  return withDatabaseTransaction(
    async (client) => {
      if (input.signal?.aborted)
        throw input.signal.reason ?? Error("Generation cancelled.");
      const row = await lockedRun(client, input.runId);
      if (input.signal?.aborted)
        throw input.signal.reason ?? Error("Generation cancelled.");
      assertSameBinding(row, input);
      assertPhaseToken(row, input.phaseToken);
      if (row.phase !== "active")
        throw new AuthoringRunLedgerError(
          "phase-conflict",
          "The initial authoring phase is no longer active.",
        );
      if (input.revision < row.initial_revision)
        throw new AuthoringRunLedgerError(
          "revision-mismatch",
          "The completed revision moved backwards.",
        );
      if (input.signal?.aborted)
        throw input.signal.reason ?? Error("Generation cancelled.");
      const updated = await client.query(
        "UPDATE orbsie_authoring_runs SET phase='completed',completed_revision=$2,completed_scene_digest=$3,updated_at=clock_timestamp() WHERE run_id=$1 AND phase='active' AND expires_at > clock_timestamp()",
        [input.runId, input.revision, input.sceneBindingDigest],
      );
      if (updated.rowCount !== 1)
        throw new AuthoringRunLedgerError(
          "phase-conflict",
          "The initial authoring phase changed before completion.",
        );
      return {
        runId: input.runId,
        phase: "completed" as const,
        revision: input.revision,
      };
    },
    {
      signal: input.signal,
      acquireTimeoutMs: 5000,
      lockTimeoutMs: 5000,
      statementTimeoutMs: 10000,
    },
  );
}

export async function failAuthoringRun(
  input: CompleteInitialAuthoringRunInput,
) {
  assertBinding(input);
  assertRunId(input.runId);
  assertPrivateToken(input.phaseToken);
  return withDatabaseTransaction(
    async (client) => {
      const row = await lockedRun(client, input.runId);
      assertSameBinding(row, input);
      assertPhaseToken(row, input.phaseToken);
      if (
        !["active", "reviewing", "final-review", "finalized"].includes(
          row.phase,
        ) &&
        !(
          row.phase === "completed" &&
          (row.remaining_review_slots === AUTHORING_RUN_REVIEW_SLOTS ||
            row.remaining_review_slots === AUTHORING_RUN_REVIEW_SLOTS - 1)
        )
      )
        throw new AuthoringRunLedgerError(
          "phase-conflict",
          "The authoring phase cannot be failed now.",
        );
      const updated = await client.query(
        "UPDATE orbsie_authoring_runs SET phase='failed',failed_at=clock_timestamp(),phase_token_hash=NULL,phase_token_expires_at=NULL,updated_at=clock_timestamp() WHERE run_id=$1 AND phase=$2 AND expires_at > clock_timestamp() AND (phase <> 'completed' OR remaining_review_slots IN ($3,$4))",
        [
          input.runId,
          row.phase,
          AUTHORING_RUN_REVIEW_SLOTS,
          AUTHORING_RUN_REVIEW_SLOTS - 1,
        ],
      );
      if (updated.rowCount !== 1)
        throw new AuthoringRunLedgerError(
          "phase-conflict",
          "Authoring phase changed before failure.",
        );
      return { runId: input.runId, phase: "failed" as const };
    },
    {
      acquireTimeoutMs: 5000,
      lockTimeoutMs: 5000,
      statementTimeoutMs: 10000,
    },
  );
}

export async function admitAuthoringReview(input: AdmitAuthoringReviewInput) {
  assertBinding(input);
  assertRunId(input.runId);
  if (input.reviewPhase !== "review" && input.reviewPhase !== "final-review")
    throw new AuthoringRunLedgerError(
      "invalid-input",
      "Review phase is invalid.",
    );
  assertRevision(input.expectedRevision, "Expected revision");
  assertDigest(
    input.expectedSceneBindingDigest,
    "Expected scene binding digest",
  );
  const phaseToken = randomUUID();
  let cancellationCleanupAttempted = false;
  try {
    const result = await withDatabaseTransaction(
      async (client) => {
        if (input.signal?.aborted) throw cancellationReason(input.signal);
        const row = await lockedRun(client, input.runId);
        if (input.signal?.aborted) throw cancellationReason(input.signal);
        assertSameBinding(row, input);
        if (row.phase !== "completed")
          throw new AuthoringRunLedgerError(
            "phase-conflict",
            "The authoring run is already in a review phase or is terminal.",
          );
        if (row.completed_revision !== input.expectedRevision)
          throw new AuthoringRunLedgerError(
            "revision-mismatch",
            "Review revision is stale.",
          );
        if (row.completed_scene_digest !== input.expectedSceneBindingDigest)
          throw new AuthoringRunLedgerError(
            "binding-mismatch",
            "Review scene binding is stale.",
          );
        const expectedSlots = input.reviewPhase === "review" ? 2 : 1;
        if (row.remaining_review_slots !== expectedSlots)
          throw new AuthoringRunLedgerError(
            "phase-conflict",
            "This review phase has already been consumed.",
          );
        const nextPhase =
          input.reviewPhase === "review" ? "reviewing" : "final-review";
        if (input.signal?.aborted) throw cancellationReason(input.signal);
        const updated = await client.query(
          "UPDATE orbsie_authoring_runs SET phase=$2,remaining_review_slots=remaining_review_slots-1,phase_token_hash=$3,phase_token_expires_at=LEAST(expires_at,clock_timestamp()+$5 * interval '1 minute'),updated_at=clock_timestamp() WHERE run_id=$1 AND phase='completed' AND remaining_review_slots=$4 AND expires_at > clock_timestamp()",
          [
            input.runId,
            nextPhase,
            tokenHash(phaseToken),
            expectedSlots,
            AUTHORING_RUN_TTL_MS / 60_000,
          ],
        );
        if (updated.rowCount !== 1)
          throw new AuthoringRunLedgerError(
            "phase-conflict",
            "Review admission changed before commit.",
          );
        return {
          runId: input.runId,
          reviewPhase: input.reviewPhase,
          phaseToken,
          remainingReviewSlots: expectedSlots - 1,
        };
      },
      { ...REVIEW_TRANSACTION_OPTIONS, signal: input.signal },
    );
    if (input.signal?.aborted && !cancellationCleanupAttempted) {
      cancellationCleanupAttempted = true;
      try {
        await failCancelledReview(
          input,
          input.runId,
          phaseToken,
          input.expectedRevision,
          input.expectedSceneBindingDigest,
        );
      } catch {
        // Preserve cancellation while the exact-token fence prevents stale
        // cleanup from touching a newer phase.
      }
      throw cancellationReason(input.signal);
    }
    return result;
  } catch (error) {
    if (input.signal?.aborted && !cancellationCleanupAttempted) {
      cancellationCleanupAttempted = true;
      try {
        await failCancelledReview(
          input,
          input.runId,
          phaseToken,
          input.expectedRevision,
          input.expectedSceneBindingDigest,
        );
      } catch {
        // The transaction may have rolled back, or a newer phase may already
        // own the token. Either outcome must preserve the original cancel.
      }
      throw cancellationReason(input.signal);
    }
    throw error;
  }
}

/** Complete one internal review phase before a later final admission. */
export async function completeAuthoringReview(
  input: CompleteAuthoringReviewInput,
) {
  assertBinding(input);
  assertRunId(input.runId);
  assertPrivateToken(input.phaseToken);
  if (input.reviewPhase !== "review" && input.reviewPhase !== "final-review")
    throw new AuthoringRunLedgerError(
      "invalid-input",
      "Review phase is invalid.",
    );
  if (typeof input.accepted !== "boolean")
    throw new AuthoringRunLedgerError(
      "invalid-input",
      "Review verdict is invalid.",
    );
  assertRevision(input.revision, "Review revision");
  assertDigest(input.sceneBindingDigest, "Review scene binding digest");
  let cancellationCleanupAttempted = false;
  try {
    const result = await withDatabaseTransaction(
      async (client) => {
        if (input.signal?.aborted) throw cancellationReason(input.signal);
        const row = await lockedRun(client, input.runId);
        if (input.signal?.aborted) throw cancellationReason(input.signal);
        assertSameBinding(row, input);
        assertPhaseToken(row, input.phaseToken);
        const expectedPhase =
          input.reviewPhase === "review" ? "reviewing" : "final-review";
        if (row.phase !== expectedPhase)
          throw new AuthoringRunLedgerError(
            "phase-conflict",
            "Review phase is no longer active.",
          );
        if (
          row.completed_revision !== null &&
          input.revision < row.completed_revision
        )
          throw new AuthoringRunLedgerError(
            "revision-mismatch",
            "Review revision moved backwards.",
          );
        const sameCompletedScene =
          input.revision === row.completed_revision &&
          input.sceneBindingDigest === row.completed_scene_digest;
        if (input.reviewPhase === "final-review" && !sameCompletedScene)
          throw new AuthoringRunLedgerError(
            "revision-mismatch",
            "The final review cannot mutate the reviewed scene.",
          );
        if (
          input.reviewPhase === "review" &&
          input.accepted &&
          !sameCompletedScene
        )
          throw new AuthoringRunLedgerError(
            "revision-mismatch",
            "An accepted review cannot mutate the reviewed scene.",
          );
        const terminal =
          input.reviewPhase === "final-review" ||
          (input.reviewPhase === "review" && input.accepted);
        const nextPhase = terminal ? "finalized" : "completed";
        const nextSlots = terminal ? 0 : row.remaining_review_slots;
        if (input.signal?.aborted) throw cancellationReason(input.signal);
        const updated = await client.query(
          "UPDATE orbsie_authoring_runs SET phase=$2,remaining_review_slots=$3,completed_revision=$4,completed_scene_digest=$5,updated_at=clock_timestamp() WHERE run_id=$1 AND phase=$6 AND expires_at > clock_timestamp()",
          [
            input.runId,
            nextPhase,
            nextSlots,
            input.revision,
            input.sceneBindingDigest,
            expectedPhase,
          ],
        );
        if (updated.rowCount !== 1)
          throw new AuthoringRunLedgerError(
            "phase-conflict",
            "Review phase changed before completion.",
          );
        return {
          runId: input.runId,
          phase: nextPhase as "completed" | "finalized",
        };
      },
      { ...REVIEW_TRANSACTION_OPTIONS, signal: input.signal },
    );
    if (input.signal?.aborted && !cancellationCleanupAttempted) {
      cancellationCleanupAttempted = true;
      try {
        await failCancelledReview(
          input,
          input.runId,
          input.phaseToken,
          input.revision,
          input.sceneBindingDigest,
        );
      } catch {
        // Preserve cancellation while the exact-token fence prevents stale
        // cleanup from touching a newer phase.
      }
      throw cancellationReason(input.signal);
    }
    return result;
  } catch (error) {
    if (input.signal?.aborted && !cancellationCleanupAttempted) {
      cancellationCleanupAttempted = true;
      try {
        await failCancelledReview(
          input,
          input.runId,
          input.phaseToken,
          input.revision,
          input.sceneBindingDigest,
        );
      } catch {
        // The update may have rolled back, or a newer phase may already own
        // the token. Either outcome must preserve the original cancel.
      }
      throw cancellationReason(input.signal);
    }
    throw error;
  }
}

export async function readAuthoringRun(runId: string) {
  assertRunId(runId);
  const result = await databaseQuery<RawLedgerRow>(
    "SELECT run_id,identity_hash,project_id,provider,model,effort,request_fingerprint,initial_revision,initial_scene_digest,phase,remaining_review_slots,completed_revision,completed_scene_digest,expires_at,expires_at > clock_timestamp() AS live FROM orbsie_authoring_runs WHERE run_id=$1",
    [runId],
  );
  const row = result.rows[0];
  if (!row)
    throw new AuthoringRunLedgerError(
      "not-found",
      "Authoring run was not found.",
    );
  const initialRevision = Number(row.initial_revision);
  const remainingReviewSlots = Number(row.remaining_review_slots);
  const completedRevision =
    row.completed_revision === null ? null : Number(row.completed_revision);
  if (
    !Number.isSafeInteger(initialRevision) ||
    !Number.isSafeInteger(remainingReviewSlots) ||
    (completedRevision !== null && !Number.isSafeInteger(completedRevision))
  )
    throw new AuthoringRunLedgerError(
      "invalid-input",
      "Authoring run revision is outside the supported range.",
    );
  return {
    runId: row.run_id,
    identityHash: row.identity_hash,
    projectId: row.project_id,
    provider: row.provider,
    model: row.model,
    effort: row.effort,
    requestFingerprint: row.request_fingerprint,
    initialRevision,
    initialSceneDigest: row.initial_scene_digest,
    phase: row.phase,
    remainingReviewSlots,
    completedRevision,
    completedSceneBindingDigest: row.completed_scene_digest,
    live: row.live,
  };
}

async function databaseQuery<T extends QueryResultRow>(
  text: string,
  values: unknown[],
) {
  // Keep metadata reads outside the transaction helper so they never hold a
  // row lock. All mutations above use the shared transaction primitive.
  return database().query<T>(text, values);
}
