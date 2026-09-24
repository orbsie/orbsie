import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";

const state = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("../src/lib/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/server/auth")>()),
  database: state.database,
}));

import {
  admitAuthoringReview,
  AuthoringRunLedgerError,
  completeAuthoringReview,
  completeInitialAuthoringRun,
  failAuthoringRun,
  issueAuthoringRun,
  issueReviewOnlyAuthoringRun,
  readAuthoringRun,
  readReviewOnlyAuthoringRunForParent,
} from "../src/lib/server/authoring-run-ledger";
import { TrialExhausted, trialRemaining } from "../src/lib/server/trial";

const url = process.env.ORBSIE_LEDGER_TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 8 }) : null;
const run = it.runIf(process.env.RUN_AUTHORING_LEDGER_DATABASE_TEST === "1");

function identity(prefix: string, globalLimit = 12) {
  const identityHash = "a".repeat(64);
  return {
    identityHash,
    cookie: "synthetic",
    buckets: [
      { key: `${prefix}:visitor`, limit: 3 },
      { key: `${prefix}:network`, limit: 3 },
      { key: `global:${prefix}`, limit: globalLimit },
    ],
  };
}

function binding(trialIdentity: ReturnType<typeof identity>) {
  return {
    identityHash: trialIdentity.identityHash,
    projectId: "project-ledger-test",
    provider: "free" as const,
    model: "openai/gpt-5.6-luna",
    effort: "xhigh",
    requestFingerprint: "b".repeat(64),
    trialIdentity,
    initialRevision: 0,
    initialSceneDigest: "c".repeat(64),
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-authoring-secret");
  if (!pool) return;
  state.database.mockReturnValue(pool);
  await pool.query(await readFile("scripts/trial-schema.sql", "utf8"));
  await pool.query(await readFile("scripts/authoring-run-schema.sql", "utf8"));
});

async function holdNextCommitAcknowledgement() {
  if (!pool) throw Error("The PostgreSQL test pool is unavailable.");
  const gate = deferred<void>();
  const committed = deferred<void>();
  let hold = true;
  state.database.mockReturnValue({
    query: pool.query.bind(pool),
    connect: async () => {
      const client = await pool.connect();
      if (!hold) return client;
      hold = false;
      const query = client.query.bind(client) as (
        text: string,
        values?: unknown[],
      ) => Promise<unknown>;
      return new Proxy(client, {
        get(target, property, receiver) {
          if (property !== "query")
            return Reflect.get(target, property, receiver);
          return (text: string, values?: unknown[]) => {
            const result = query(text, values);
            if (text !== "COMMIT") return result;
            return result.then(async (value) => {
              committed.resolve();
              await gate.promise;
              return value;
            });
          };
        },
      });
    },
  });
  return {
    committed: committed.promise,
    release: () => gate.resolve(),
    restore: () => state.database.mockReturnValue(pool),
  };
}

afterAll(async () => {
  if (pool) await pool.end();
  vi.unstubAllEnvs();
});

describe("authoring run ledger PostgreSQL contention", () => {
  run(
    "charges one prompt while reserving three global units and admits one concurrent run at capacity three",
    async () => {
      const prefix = `ledger:${Date.now()}:capacity`;
      const trial = identity(prefix, 5);
      try {
        const results = await Promise.allSettled(
          Array.from({ length: 4 }, () => issueAuthoringRun(binding(trial))),
        );
        expect(
          results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        expect(
          results.filter(
            (result) =>
              result.status === "rejected" &&
              result.reason instanceof TrialExhausted,
          ),
        ).toHaveLength(3);
        const buckets = await pool!.query(
          "SELECT bucket,used FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2 ORDER BY bucket",
          [`${prefix}%`, `global:${prefix}`],
        );
        expect(buckets.rows).toEqual([
          { bucket: `global:${prefix}`, used: 3 },
          { bucket: `${prefix}:network`, used: 1 },
          { bucket: `${prefix}:visitor`, used: 1 },
        ]);
        expect(await trialRemaining(trial, 1)).toBe(2);
        expect(await trialRemaining(trial, 3)).toBe(0);
      } finally {
        await pool!.query(
          "DELETE FROM orbsie_authoring_runs WHERE identity_hash=$1",
          ["a".repeat(64)],
        );
        await pool!.query(
          "DELETE FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2",
          [`${prefix}%`, `global:${prefix}`],
        );
      }
    },
    30000,
  );

  run(
    "rolls back trial buckets when the ledger insert fails after reservation",
    async () => {
      const prefix = `ledger:${Date.now()}:rollback`;
      const trial = identity(prefix);
      await pool!.query(
        "CREATE OR REPLACE FUNCTION orbsie_test_fail_authoring_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.model = 'fail-ledger-insert' THEN RAISE EXCEPTION 'synthetic ledger insert failure'; END IF; RETURN NEW; END $$",
      );
      await pool!.query(
        "DROP TRIGGER IF EXISTS orbsie_test_fail_authoring_insert ON orbsie_authoring_runs",
      );
      await pool!.query(
        "CREATE TRIGGER orbsie_test_fail_authoring_insert BEFORE INSERT ON orbsie_authoring_runs FOR EACH ROW EXECUTE FUNCTION orbsie_test_fail_authoring_insert()",
      );
      try {
        await expect(
          issueAuthoringRun({
            ...binding(trial),
            model: "fail-ledger-insert",
          }),
        ).rejects.toThrow("synthetic ledger insert failure");
        const buckets = await pool!.query(
          "SELECT count(*)::int AS count FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2",
          [`${prefix}%`, `global:${prefix}`],
        );
        expect(buckets.rows[0].count).toBe(0);
        const runs = await pool!.query(
          "SELECT count(*)::int AS count FROM orbsie_authoring_runs WHERE project_id=$1",
          ["project-ledger-test"],
        );
        expect(runs.rows[0].count).toBe(0);
      } finally {
        await pool!.query(
          "DROP TRIGGER IF EXISTS orbsie_test_fail_authoring_insert ON orbsie_authoring_runs",
        );
        await pool!.query(
          "DROP FUNCTION IF EXISTS orbsie_test_fail_authoring_insert()",
        );
        await pool!.query(
          "DELETE FROM orbsie_authoring_runs WHERE identity_hash=$1",
          [trial.identityHash],
        );
        await pool!.query(
          "DELETE FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2",
          [`${prefix}%`, `global:${prefix}`],
        );
      }
    },
    30000,
  );

  run(
    "persists correction and final verdict phases, while an accepted first review closes the run",
    async () => {
      const prefix = `ledger:${Date.now()}:final`;
      const trial = identity(prefix);
      const firstRun = await issueAuthoringRun(binding(trial));
      try {
        await completeInitialAuthoringRun({
          ...binding(trial),
          runId: firstRun.runId,
          phaseToken: firstRun.phaseToken,
          revision: 1,
          sceneBindingDigest: "d".repeat(64),
        });
        const review = await admitAuthoringReview({
          ...binding(trial),
          runId: firstRun.runId,
          reviewPhase: "review",
          expectedRevision: 1,
          expectedSceneBindingDigest: "d".repeat(64),
        });
        await completeAuthoringReview({
          ...binding(trial),
          runId: firstRun.runId,
          phaseToken: review.phaseToken,
          reviewPhase: "review",
          revision: 2,
          sceneBindingDigest: "e".repeat(64),
          accepted: false,
        });
        const secondReview = await admitAuthoringReview({
          ...binding(trial),
          runId: firstRun.runId,
          reviewPhase: "review",
          expectedRevision: 2,
          expectedSceneBindingDigest: "e".repeat(64),
        });
        await completeAuthoringReview({
          ...binding(trial),
          runId: firstRun.runId,
          phaseToken: secondReview.phaseToken,
          reviewPhase: "review",
          revision: 2,
          sceneBindingDigest: "e".repeat(64),
          accepted: false,
        });
        const final = await admitAuthoringReview({
          ...binding(trial),
          runId: firstRun.runId,
          reviewPhase: "final-review",
          expectedRevision: 2,
          expectedSceneBindingDigest: "e".repeat(64),
        });
        await completeAuthoringReview({
          ...binding(trial),
          runId: firstRun.runId,
          phaseToken: final.phaseToken,
          reviewPhase: "final-review",
          revision: 2,
          sceneBindingDigest: "e".repeat(64),
          accepted: false,
        });
        await expect(
          admitAuthoringReview({
            ...binding(trial),
            runId: firstRun.runId,
            reviewPhase: "final-review",
            expectedRevision: 2,
            expectedSceneBindingDigest: "e".repeat(64),
          }),
        ).rejects.toMatchObject({ code: "phase-conflict" });
        await expect(readAuthoringRun(firstRun.runId)).resolves.toMatchObject({
          phase: "finalized",
          remainingReviewSlots: 0,
          completedRevision: 2,
        });

        const acceptedRun = await issueAuthoringRun(binding(trial));
        await completeInitialAuthoringRun({
          ...binding(trial),
          runId: acceptedRun.runId,
          phaseToken: acceptedRun.phaseToken,
          revision: 1,
          sceneBindingDigest: "f".repeat(64),
        });
        const acceptedReview = await admitAuthoringReview({
          ...binding(trial),
          runId: acceptedRun.runId,
          reviewPhase: "review",
          expectedRevision: 1,
          expectedSceneBindingDigest: "f".repeat(64),
        });
        await completeAuthoringReview({
          ...binding(trial),
          runId: acceptedRun.runId,
          phaseToken: acceptedReview.phaseToken,
          reviewPhase: "review",
          revision: 1,
          sceneBindingDigest: "f".repeat(64),
          accepted: true,
        });
        await expect(
          readAuthoringRun(acceptedRun.runId),
        ).resolves.toMatchObject({
          phase: "finalized",
          remainingReviewSlots: 0,
        });
        await pool!.query(
          "DELETE FROM orbsie_authoring_runs WHERE run_id=$1 OR run_id=$2",
          [firstRun.runId, acceptedRun.runId],
        );
      } finally {
        await pool!.query(
          "DELETE FROM orbsie_authoring_runs WHERE identity_hash=$1",
          [trial.identityHash],
        );
        await pool!.query(
          "DELETE FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2",
          [`${prefix}%`, `global:${prefix}`],
        );
      }
    },
    30000,
  );

  run(
    "locks a completed row so duplicate review admission has one winner and rejects stale bindings",
    async () => {
      const prefix = `ledger:${Date.now()}:review`;
      const trial = identity(prefix);
      const issued = await issueAuthoringRun(binding(trial));
      try {
        await completeInitialAuthoringRun({
          ...binding(trial),
          runId: issued.runId,
          phaseToken: issued.phaseToken,
          revision: 1,
          sceneBindingDigest: "d".repeat(64),
        });
        const results = await Promise.allSettled(
          [0, 1].map(() =>
            admitAuthoringReview({
              ...binding(trial),
              runId: issued.runId,
              reviewPhase: "review",
              expectedRevision: 1,
              expectedSceneBindingDigest: "d".repeat(64),
            }),
          ),
        );
        expect(
          results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        expect(
          results.filter(
            (result) =>
              result.status === "rejected" &&
              result.reason instanceof AuthoringRunLedgerError &&
              result.reason.code === "phase-conflict",
          ),
        ).toHaveLength(1);
        await expect(
          admitAuthoringReview({
            ...binding(trial),
            model: "openai/other",
            runId: issued.runId,
            reviewPhase: "final-review",
            expectedRevision: 1,
            expectedSceneBindingDigest: "d".repeat(64),
          }),
        ).rejects.toMatchObject({ code: "binding-mismatch" });
      } finally {
        await pool!.query("DELETE FROM orbsie_authoring_runs WHERE run_id=$1", [
          issued.runId,
        ]);
        await pool!.query(
          "DELETE FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2",
          [`${prefix}%`, `global:${prefix}`],
        );
      }
    },
    30000,
  );

  run(
    "rejects a three-unit reservation when the shared daily bucket has only two units",
    async () => {
      const prefix = `ledger:${Date.now()}:small`;
      const trial = identity(prefix, 2);
      try {
        await expect(issueAuthoringRun(binding(trial))).rejects.toBeInstanceOf(
          TrialExhausted,
        );
        const rows = await pool!.query(
          "SELECT count(*)::int AS count FROM orbsie_authoring_runs WHERE identity_hash=$1",
          [trial.identityHash],
        );
        expect(rows.rows[0].count).toBe(0);
      } finally {
        await pool!.query(
          "DELETE FROM orbsie_authoring_runs WHERE identity_hash=$1",
          [trial.identityHash],
        );
        await pool!.query(
          "DELETE FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2",
          [`${prefix}%`, `global:${prefix}`],
        );
      }
    },
    30000,
  );

  run(
    "cancellation while completion waits on a row lock leaves the run active and the initial fence cannot fail a newer review",
    async () => {
      const prefix = `ledger:${Date.now()}:cancel-fence`;
      const trial = identity(prefix, 30);
      const issued = await issueAuthoringRun(binding(trial));
      const holder = await pool!.connect();
      try {
        await holder.query("BEGIN");
        await holder.query(
          "SELECT run_id FROM orbsie_authoring_runs WHERE run_id=$1 FOR UPDATE",
          [issued.runId],
        );
        const abort = new AbortController();
        const completion = completeInitialAuthoringRun({
          ...binding(trial),
          runId: issued.runId,
          phaseToken: issued.phaseToken,
          revision: 1,
          sceneBindingDigest: "d".repeat(64),
          signal: abort.signal,
        });
        let lockObserved = false;
        for (let attempt = 0; attempt < 100 && !lockObserved; attempt++) {
          const waiting = await pool!.query<{ waiting: boolean }>(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type='Lock' AND state='active' AND query ILIKE '%orbsie_authoring_runs%') AS waiting",
          );
          lockObserved = waiting.rows[0]?.waiting === true;
          if (!lockObserved)
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (!lockObserved) {
          abort.abort(Error("synthetic cancellation"));
          await holder.query("ROLLBACK");
          await completion.catch(() => undefined);
          throw Error(
            "The completion transaction never reached row-lock wait.",
          );
        }
        abort.abort(Error("synthetic cancellation"));
        await holder.query("ROLLBACK");
        await expect(completion).rejects.toThrow("synthetic cancellation");
        await expect(readAuthoringRun(issued.runId)).resolves.toMatchObject({
          phase: "active",
        });

        const durable = await completeInitialAuthoringRun({
          ...binding(trial),
          runId: issued.runId,
          phaseToken: issued.phaseToken,
          revision: 1,
          sceneBindingDigest: "d".repeat(64),
        });
        expect(durable.phase).toBe("completed");
        await failAuthoringRun({
          ...binding(trial),
          runId: issued.runId,
          phaseToken: issued.phaseToken,
          revision: 1,
          sceneBindingDigest: "d".repeat(64),
        });
        await expect(readAuthoringRun(issued.runId)).resolves.toMatchObject({
          phase: "failed",
        });

        const reviewed = await issueAuthoringRun(binding(trial));
        await completeInitialAuthoringRun({
          ...binding(trial),
          runId: reviewed.runId,
          phaseToken: reviewed.phaseToken,
          revision: 1,
          sceneBindingDigest: "d".repeat(64),
        });
        await admitAuthoringReview({
          ...binding(trial),
          runId: reviewed.runId,
          reviewPhase: "review",
          expectedRevision: 1,
          expectedSceneBindingDigest: "d".repeat(64),
        });
        await expect(
          failAuthoringRun({
            ...binding(trial),
            runId: reviewed.runId,
            phaseToken: reviewed.phaseToken,
            revision: 1,
            sceneBindingDigest: "d".repeat(64),
          }),
        ).rejects.toMatchObject({ code: "token-mismatch" });
        await expect(readAuthoringRun(reviewed.runId)).resolves.toMatchObject({
          phase: "reviewing",
        });
      } finally {
        await holder.query("ROLLBACK").catch(() => undefined);
        holder.release();
        await pool!.query(
          "DELETE FROM orbsie_authoring_runs WHERE identity_hash=$1",
          [trial.identityHash],
        );
        await pool!.query(
          "DELETE FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2",
          [`${prefix}%`, `global:${prefix}`],
        );
      }
    },
    30000,
  );

  run(
    "cancellation while review admission waits on a row lock rolls back without admitting a call",
    async () => {
      const prefix = `ledger:${Date.now()}:review-admission-cancel`;
      const trial = identity(prefix, 30);
      const issued = await issueAuthoringRun(binding(trial));
      const holder = await pool!.connect();
      try {
        await completeInitialAuthoringRun({
          ...binding(trial),
          runId: issued.runId,
          phaseToken: issued.phaseToken,
          revision: 1,
          sceneBindingDigest: "d".repeat(64),
        });
        await holder.query("BEGIN");
        await holder.query(
          "SELECT run_id FROM orbsie_authoring_runs WHERE run_id=$1 FOR UPDATE",
          [issued.runId],
        );
        const abort = new AbortController();
        const admission = admitAuthoringReview({
          ...binding(trial),
          runId: issued.runId,
          reviewPhase: "review",
          expectedRevision: 1,
          expectedSceneBindingDigest: "d".repeat(64),
          signal: abort.signal,
        });
        let lockObserved = false;
        for (let attempt = 0; attempt < 100 && !lockObserved; attempt++) {
          const waiting = await pool!.query<{ waiting: boolean }>(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type='Lock' AND state='active' AND query ILIKE '%orbsie_authoring_runs%') AS waiting",
          );
          lockObserved = waiting.rows[0]?.waiting === true;
          if (!lockObserved)
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (!lockObserved) {
          abort.abort(Error("synthetic review admission cancellation"));
          await holder.query("ROLLBACK");
          await admission.catch(() => undefined);
          throw Error("The review admission never reached row-lock wait.");
        }
        abort.abort(Error("synthetic review admission cancellation"));
        await holder.query("ROLLBACK");
        await expect(admission).rejects.toThrow(
          "synthetic review admission cancellation",
        );
        await expect(readAuthoringRun(issued.runId)).resolves.toMatchObject({
          phase: "completed",
          remainingReviewSlots: 3,
        });
        await expect(
          admitAuthoringReview({
            ...binding(trial),
            runId: issued.runId,
            reviewPhase: "review",
            expectedRevision: 1,
            expectedSceneBindingDigest: "d".repeat(64),
          }),
        ).resolves.toMatchObject({ reviewPhase: "review" });
      } finally {
        await holder.query("ROLLBACK").catch(() => undefined);
        holder.release();
        await pool!.query(
          "DELETE FROM orbsie_authoring_runs WHERE identity_hash=$1",
          [trial.identityHash],
        );
        await pool!.query(
          "DELETE FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2",
          [`${prefix}%`, `global:${prefix}`],
        );
      }
    },
    30000,
  );

  run(
    "cancellation while review completion waits on a row lock fails the exact admitted phase",
    async () => {
      const prefix = `ledger:${Date.now()}:review-complete-cancel`;
      const trial = identity(prefix, 30);
      const issued = await issueAuthoringRun(binding(trial));
      const holder = await pool!.connect();
      try {
        await completeInitialAuthoringRun({
          ...binding(trial),
          runId: issued.runId,
          phaseToken: issued.phaseToken,
          revision: 1,
          sceneBindingDigest: "d".repeat(64),
        });
        const review = await admitAuthoringReview({
          ...binding(trial),
          runId: issued.runId,
          reviewPhase: "review",
          expectedRevision: 1,
          expectedSceneBindingDigest: "d".repeat(64),
        });
        await holder.query("BEGIN");
        await holder.query(
          "SELECT run_id FROM orbsie_authoring_runs WHERE run_id=$1 FOR UPDATE",
          [issued.runId],
        );
        const abort = new AbortController();
        const completion = completeAuthoringReview({
          ...binding(trial),
          runId: issued.runId,
          phaseToken: review.phaseToken,
          reviewPhase: "review",
          revision: 2,
          sceneBindingDigest: "e".repeat(64),
          accepted: false,
          signal: abort.signal,
        });
        let lockObserved = false;
        for (let attempt = 0; attempt < 100 && !lockObserved; attempt++) {
          const waiting = await pool!.query<{ waiting: boolean }>(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type='Lock' AND state='active' AND query ILIKE '%orbsie_authoring_runs%') AS waiting",
          );
          lockObserved = waiting.rows[0]?.waiting === true;
          if (!lockObserved)
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (!lockObserved) {
          abort.abort(Error("synthetic review completion cancellation"));
          await holder.query("ROLLBACK");
          await completion.catch(() => undefined);
          throw Error("The review completion never reached row-lock wait.");
        }
        abort.abort(Error("synthetic review completion cancellation"));
        await holder.query("ROLLBACK");
        await expect(completion).rejects.toThrow(
          "synthetic review completion cancellation",
        );
        await expect(readAuthoringRun(issued.runId)).resolves.toMatchObject({
          phase: "failed",
        });
        await expect(
          admitAuthoringReview({
            ...binding(trial),
            runId: issued.runId,
            reviewPhase: "review",
            expectedRevision: 1,
            expectedSceneBindingDigest: "d".repeat(64),
          }),
        ).rejects.toMatchObject({ code: "phase-conflict" });
      } finally {
        await holder.query("ROLLBACK").catch(() => undefined);
        holder.release();
        await pool!.query(
          "DELETE FROM orbsie_authoring_runs WHERE identity_hash=$1",
          [trial.identityHash],
        );
        await pool!.query(
          "DELETE FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2",
          [`${prefix}%`, `global:${prefix}`],
        );
      }
    },
    30000,
  );

  run(
    "cancellation after a review COMMIT but before acknowledgement fails admission and both completion phases",
    async () => {
      const prefix = `ledger:${Date.now()}:review-commit-cancel`;
      const trial = identity(prefix, 60);
      const runIds: string[] = [];
      try {
        const prepared = async () => {
          const issued = await issueAuthoringRun(binding(trial));
          runIds.push(issued.runId);
          await completeInitialAuthoringRun({
            ...binding(trial),
            runId: issued.runId,
            phaseToken: issued.phaseToken,
            revision: 1,
            sceneBindingDigest: "d".repeat(64),
          });
          return issued;
        };
        const cancelAfterCommit = async (
          operation: (signal: AbortSignal) => Promise<unknown>,
          message: string,
        ) => {
          const held = await holdNextCommitAcknowledgement();
          const abort = new AbortController();
          try {
            const pending = operation(abort.signal);
            await held.committed;
            abort.abort(Error(message));
            held.release();
            await expect(pending).rejects.toThrow(message);
          } finally {
            held.release();
            held.restore();
          }
        };

        const admissionRun = await prepared();
        await cancelAfterCommit(
          (signal) =>
            admitAuthoringReview({
              ...binding(trial),
              runId: admissionRun.runId,
              reviewPhase: "review",
              expectedRevision: 1,
              expectedSceneBindingDigest: "d".repeat(64),
              signal,
            }),
          "synthetic admission COMMIT cancellation",
        );
        await expect(
          readAuthoringRun(admissionRun.runId),
        ).resolves.toMatchObject({ phase: "failed" });

        const correctionRun = await prepared();
        const correction = await admitAuthoringReview({
          ...binding(trial),
          runId: correctionRun.runId,
          reviewPhase: "review",
          expectedRevision: 1,
          expectedSceneBindingDigest: "d".repeat(64),
        });
        await cancelAfterCommit(
          (signal) =>
            completeAuthoringReview({
              ...binding(trial),
              runId: correctionRun.runId,
              phaseToken: correction.phaseToken,
              reviewPhase: "review",
              revision: 2,
              sceneBindingDigest: "e".repeat(64),
              accepted: false,
              signal,
            }),
          "synthetic correction COMMIT cancellation",
        );
        await expect(
          readAuthoringRun(correctionRun.runId),
        ).resolves.toMatchObject({ phase: "failed" });

        const finalRun = await prepared();
        const first = await admitAuthoringReview({
          ...binding(trial),
          runId: finalRun.runId,
          reviewPhase: "review",
          expectedRevision: 1,
          expectedSceneBindingDigest: "d".repeat(64),
        });
        await completeAuthoringReview({
          ...binding(trial),
          runId: finalRun.runId,
          phaseToken: first.phaseToken,
          reviewPhase: "review",
          revision: 2,
          sceneBindingDigest: "e".repeat(64),
          accepted: false,
        });
        const second = await admitAuthoringReview({
          ...binding(trial),
          runId: finalRun.runId,
          reviewPhase: "review",
          expectedRevision: 2,
          expectedSceneBindingDigest: "e".repeat(64),
        });
        await completeAuthoringReview({
          ...binding(trial),
          runId: finalRun.runId,
          phaseToken: second.phaseToken,
          reviewPhase: "review",
          revision: 2,
          sceneBindingDigest: "e".repeat(64),
          accepted: false,
        });
        const final = await admitAuthoringReview({
          ...binding(trial),
          runId: finalRun.runId,
          reviewPhase: "final-review",
          expectedRevision: 2,
          expectedSceneBindingDigest: "e".repeat(64),
        });
        await cancelAfterCommit(
          (signal) =>
            completeAuthoringReview({
              ...binding(trial),
              runId: finalRun.runId,
              phaseToken: final.phaseToken,
              reviewPhase: "final-review",
              revision: 2,
              sceneBindingDigest: "e".repeat(64),
              accepted: true,
              signal,
            }),
          "synthetic final COMMIT cancellation",
        );
        await expect(readAuthoringRun(finalRun.runId)).resolves.toMatchObject({
          phase: "failed",
        });
      } finally {
        state.database.mockReturnValue(pool);
        await pool!.query(
          "DELETE FROM orbsie_authoring_runs WHERE identity_hash=$1",
          [trial.identityHash],
        );
        await pool!.query(
          "DELETE FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2",
          [`${prefix}%`, `global:${prefix}`],
        );
      }
    },
    30000,
  );

  run(
    "expires review tokens and rejects replay after a retained completion fence",
    async () => {
      const prefix = `ledger:${Date.now()}:review-token-fence`;
      const trial = identity(prefix, 30);
      const issued = await issueAuthoringRun(binding(trial));
      try {
        await completeInitialAuthoringRun({
          ...binding(trial),
          runId: issued.runId,
          phaseToken: issued.phaseToken,
          revision: 1,
          sceneBindingDigest: "d".repeat(64),
        });
        const expired = await admitAuthoringReview({
          ...binding(trial),
          runId: issued.runId,
          reviewPhase: "review",
          expectedRevision: 1,
          expectedSceneBindingDigest: "d".repeat(64),
        });
        await pool!.query(
          "UPDATE orbsie_authoring_runs SET phase_token_expires_at=clock_timestamp()-interval '1 second' WHERE run_id=$1",
          [issued.runId],
        );
        await expect(
          completeAuthoringReview({
            ...binding(trial),
            runId: issued.runId,
            phaseToken: expired.phaseToken,
            reviewPhase: "review",
            revision: 1,
            sceneBindingDigest: "d".repeat(64),
            accepted: true,
          }),
        ).rejects.toMatchObject({ code: "expired" });

        await pool!.query(
          "UPDATE orbsie_authoring_runs SET phase_token_expires_at=clock_timestamp()+interval '1 minute' WHERE run_id=$1",
          [issued.runId],
        );
        const replayRun = await issueAuthoringRun(binding(trial));
        await completeInitialAuthoringRun({
          ...binding(trial),
          runId: replayRun.runId,
          phaseToken: replayRun.phaseToken,
          revision: 1,
          sceneBindingDigest: "d".repeat(64),
        });
        const review = await admitAuthoringReview({
          ...binding(trial),
          runId: replayRun.runId,
          reviewPhase: "review",
          expectedRevision: 1,
          expectedSceneBindingDigest: "d".repeat(64),
        });
        await completeAuthoringReview({
          ...binding(trial),
          runId: replayRun.runId,
          phaseToken: review.phaseToken,
          reviewPhase: "review",
          revision: 2,
          sceneBindingDigest: "e".repeat(64),
          accepted: false,
        });
        await expect(
          completeAuthoringReview({
            ...binding(trial),
            runId: replayRun.runId,
            phaseToken: review.phaseToken,
            reviewPhase: "review",
            revision: 2,
            sceneBindingDigest: "e".repeat(64),
            accepted: false,
          }),
        ).rejects.toMatchObject({ code: "phase-conflict" });
        await failAuthoringRun({
          ...binding(trial),
          runId: replayRun.runId,
          phaseToken: review.phaseToken,
          revision: 2,
          sceneBindingDigest: "e".repeat(64),
        });
      } finally {
        await pool!.query(
          "DELETE FROM orbsie_authoring_runs WHERE identity_hash=$1",
          [trial.identityHash],
        );
        await pool!.query(
          "DELETE FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2",
          [`${prefix}%`, `global:${prefix}`],
        );
      }
    },
    30000,
  );

  run(
    "issues review-only runs for an exact saved scene and charges one free trial unit",
    async () => {
      const prefix = `ledger:${Date.now()}:review-only`;
      const trial = identity(prefix, 2);
      const savedBinding = {
        ...binding(trial),
        requestFingerprint: "f".repeat(64),
        initialRevision: 7,
        initialSceneDigest: "d".repeat(64),
      };
      const firstRecovery = {
        ...savedBinding,
        priorRunId: randomUUID(),
      };
      const freshPriorRunId = randomUUID();
      const exhaustedPriorRunId = randomUUID();
      const runIds: string[] = [];
      try {
        const { trialIdentity: _trialIdentity, ...withoutTrial } =
          firstRecovery;
        await expect(
          issueReviewOnlyAuthoringRun(withoutTrial),
        ).rejects.toMatchObject({ code: "binding-mismatch" });
        const beforeClaim = await pool!.query(
          "SELECT count(*)::int AS count FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2",
          [`${prefix}%`, `global:${prefix}`],
        );
        expect(beforeClaim.rows[0].count).toBe(0);

        const first = await issueReviewOnlyAuthoringRun(firstRecovery);
        runIds.push(first.runId);
        expect(first.trialRemaining).toBe(1);
        await expect(readAuthoringRun(first.runId)).resolves.toMatchObject({
          phase: "completed",
          initialRevision: 7,
          initialSceneDigest: "d".repeat(64),
          completedRevision: 7,
          completedSceneBindingDigest: "d".repeat(64),
          remainingReviewSlots: 3,
        });
        await expect(
          readReviewOnlyAuthoringRunForParent(firstRecovery.priorRunId),
        ).resolves.toMatchObject({
          runId: first.runId,
          identityHash: savedBinding.identityHash,
          projectId: savedBinding.projectId,
          provider: savedBinding.provider,
          model: savedBinding.model,
          effort: savedBinding.effort,
          requestFingerprint: savedBinding.requestFingerprint,
          phase: "completed",
          remainingReviewSlots: 3,
          completedRevision: 7,
          completedSceneBindingDigest: "d".repeat(64),
          live: true,
        });
        await expect(
          issueReviewOnlyAuthoringRun(firstRecovery),
        ).rejects.toMatchObject({ code: "phase-conflict" });
        const afterDuplicate = await pool!.query(
          "SELECT count(*)::int AS count FROM orbsie_authoring_runs WHERE recovered_from_run_id=$1",
          [firstRecovery.priorRunId],
        );
        expect(afterDuplicate.rows[0].count).toBe(1);
        const usageAfterDuplicate = await pool!.query(
          "SELECT bucket,used FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2 ORDER BY bucket",
          [`${prefix}%`, `global:${prefix}`],
        );
        expect(usageAfterDuplicate.rows).toEqual([
          { bucket: `global:${prefix}`, used: 1 },
          { bucket: `${prefix}:network`, used: 1 },
          { bucket: `${prefix}:visitor`, used: 1 },
        ]);

        await expect(
          admitAuthoringReview({
            ...savedBinding,
            runId: first.runId,
            reviewPhase: "review",
            expectedRevision: 6,
            expectedSceneBindingDigest: "d".repeat(64),
          }),
        ).rejects.toMatchObject({ code: "revision-mismatch" });
        await expect(
          admitAuthoringReview({
            ...savedBinding,
            runId: first.runId,
            reviewPhase: "review",
            expectedRevision: 7,
            expectedSceneBindingDigest: "e".repeat(64),
          }),
        ).rejects.toMatchObject({ code: "binding-mismatch" });
        await expect(
          admitAuthoringReview({
            ...savedBinding,
            runId: first.runId,
            reviewPhase: "final-review",
            expectedRevision: 7,
            expectedSceneBindingDigest: "d".repeat(64),
          }),
        ).rejects.toMatchObject({ code: "phase-conflict" });

        const firstReview = await admitAuthoringReview({
          ...savedBinding,
          runId: first.runId,
          reviewPhase: "review",
          expectedRevision: 7,
          expectedSceneBindingDigest: "d".repeat(64),
        });
        await completeAuthoringReview({
          ...savedBinding,
          runId: first.runId,
          phaseToken: firstReview.phaseToken,
          reviewPhase: "review",
          revision: 7,
          sceneBindingDigest: "d".repeat(64),
          accepted: false,
        });
        await expect(
          admitAuthoringReview({
            ...savedBinding,
            runId: first.runId,
            reviewPhase: "final-review",
            expectedRevision: 7,
            expectedSceneBindingDigest: "d".repeat(64),
          }),
        ).rejects.toMatchObject({ code: "phase-conflict" });

        const secondReview = await admitAuthoringReview({
          ...savedBinding,
          runId: first.runId,
          reviewPhase: "review",
          expectedRevision: 7,
          expectedSceneBindingDigest: "d".repeat(64),
        });
        await completeAuthoringReview({
          ...savedBinding,
          runId: first.runId,
          phaseToken: secondReview.phaseToken,
          reviewPhase: "review",
          revision: 7,
          sceneBindingDigest: "d".repeat(64),
          accepted: false,
        });
        const finalReview = await admitAuthoringReview({
          ...savedBinding,
          runId: first.runId,
          reviewPhase: "final-review",
          expectedRevision: 7,
          expectedSceneBindingDigest: "d".repeat(64),
        });
        await completeAuthoringReview({
          ...savedBinding,
          runId: first.runId,
          phaseToken: finalReview.phaseToken,
          reviewPhase: "final-review",
          revision: 7,
          sceneBindingDigest: "d".repeat(64),
          accepted: false,
        });

        const fresh = await issueReviewOnlyAuthoringRun({
          ...firstRecovery,
          priorRunId: freshPriorRunId,
        });
        runIds.push(fresh.runId);
        expect(fresh.runId).not.toBe(first.runId);
        expect(fresh.trialRemaining).toBe(0);
        await expect(readAuthoringRun(fresh.runId)).resolves.toMatchObject({
          phase: "completed",
          remainingReviewSlots: 3,
          completedRevision: 7,
          completedSceneBindingDigest: "d".repeat(64),
        });

        await expect(
          issueReviewOnlyAuthoringRun({
            ...firstRecovery,
            priorRunId: exhaustedPriorRunId,
          }),
        ).rejects.toBeInstanceOf(TrialExhausted);
        const persisted = await pool!.query(
          "SELECT count(*)::int AS count FROM orbsie_authoring_runs WHERE identity_hash=$1 AND project_id=$2 AND request_fingerprint=$3",
          [
            savedBinding.identityHash,
            savedBinding.projectId,
            savedBinding.requestFingerprint,
          ],
        );
        expect(persisted.rows[0].count).toBe(2);
        await expect(readAuthoringRun(fresh.runId)).resolves.toMatchObject({
          phase: "completed",
          remainingReviewSlots: 3,
        });
        await pool!.query(
          "UPDATE orbsie_authoring_runs SET expires_at=clock_timestamp()-interval '1 second' WHERE run_id=$1",
          [fresh.runId],
        );
        await expect(
          readReviewOnlyAuthoringRunForParent(freshPriorRunId),
        ).resolves.toMatchObject({ runId: fresh.runId, live: false });
      } finally {
        await pool!.query(
          "DELETE FROM orbsie_authoring_runs WHERE run_id = ANY($1::uuid[]) OR recovered_from_run_id = ANY($2::uuid[])",
          [
            runIds,
            [firstRecovery.priorRunId, freshPriorRunId, exhaustedPriorRunId],
          ],
        );
        await pool!.query(
          "DELETE FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2",
          [`${prefix}%`, `global:${prefix}`],
        );
      }
    },
    30000,
  );

  run(
    "admits only one concurrent recovery per prior run and rolls back the duplicate free claim",
    async () => {
      const prefix = `ledger:${Date.now()}:review-only-concurrent`;
      const trial = identity(prefix, 5);
      const priorRunId = randomUUID();
      const recovery = { ...binding(trial), priorRunId };
      const runIds: string[] = [];
      try {
        const results = await Promise.allSettled([
          issueReviewOnlyAuthoringRun(recovery),
          issueReviewOnlyAuthoringRun(recovery),
        ]);
        const admitted = results.filter(
          (
            result,
          ): result is PromiseFulfilledResult<
            Awaited<ReturnType<typeof issueReviewOnlyAuthoringRun>>
          > => result.status === "fulfilled",
        );
        const rejected = results.filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        expect(admitted).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason).toMatchObject({ code: "phase-conflict" });
        runIds.push(admitted[0].value.runId);

        const persisted = await pool!.query(
          "SELECT count(*)::int AS count FROM orbsie_authoring_runs WHERE recovered_from_run_id=$1",
          [priorRunId],
        );
        expect(persisted.rows[0].count).toBe(1);
        await expect(
          readReviewOnlyAuthoringRunForParent(priorRunId),
        ).resolves.toMatchObject({
          runId: admitted[0].value.runId,
          phase: "completed",
          remainingReviewSlots: 3,
          live: true,
        });
        const buckets = await pool!.query(
          "SELECT bucket,used FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2 ORDER BY bucket",
          [`${prefix}%`, `global:${prefix}`],
        );
        expect(buckets.rows).toEqual([
          { bucket: `global:${prefix}`, used: 1 },
          { bucket: `${prefix}:network`, used: 1 },
          { bucket: `${prefix}:visitor`, used: 1 },
        ]);
      } finally {
        await pool!.query(
          "DELETE FROM orbsie_authoring_runs WHERE recovered_from_run_id=$1 OR run_id = ANY($2::uuid[])",
          [priorRunId, runIds],
        );
        await pool!.query(
          "DELETE FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2",
          [`${prefix}%`, `global:${prefix}`],
        );
      }
    },
    30000,
  );

  run(
    "can rerun the recovery-column schema migration",
    async () => {
      const schema = await readFile("scripts/authoring-run-schema.sql", "utf8");
      await pool!.query(schema);
      await pool!.query(schema);
      const column = await pool!.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name='orbsie_authoring_runs' AND column_name='recovered_from_run_id'",
      );
      const index = await pool!.query(
        "SELECT indexname FROM pg_indexes WHERE tablename='orbsie_authoring_runs' AND indexname='orbsie_authoring_runs_recovered_from_run_id_idx'",
      );
      expect(column.rows).toHaveLength(1);
      expect(index.rows).toHaveLength(1);
    },
    30000,
  );
});
