import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
  issueAuthoringRun,
  readAuthoringRun,
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

beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-authoring-secret");
  if (!pool) return;
  state.database.mockReturnValue(pool);
  await pool.query(await readFile("scripts/trial-schema.sql", "utf8"));
  await pool.query(await readFile("scripts/authoring-run-schema.sql", "utf8"));
});

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
});
