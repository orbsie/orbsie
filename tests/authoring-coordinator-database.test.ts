import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
const state = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("../src/lib/server/auth", async (original) => ({
  ...(await original<typeof import("../src/lib/server/auth")>()),
  database: state.database,
}));
import { blankProject } from "../src/lib/protocol";
import {
  createAuthoringLifecycle,
  initialSceneProvenance,
} from "../src/lib/scene-binding";
import { admitInitialAuthoringRun } from "../src/lib/server/authoring-run-admission";
import {
  admitAuthoringReview,
  readAuthoringRun,
} from "../src/lib/server/authoring-run-ledger";

const url = process.env.ORBSIE_LEDGER_TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-coordinator-secret");
  vi.stubEnv("ORBSIE_AUTHORING_REVIEW", "1");
  if (!pool) return;
  await pool.query(await readFile("scripts/trial-schema.sql", "utf8"));
  await pool.query(await readFile("scripts/authoring-run-schema.sql", "utf8"));
});
afterAll(async () => {
  await pool?.end();
  vi.unstubAllEnvs();
});

it.runIf(process.env.RUN_AUTHORING_LEDGER_DATABASE_TEST === "1")(
  "fences actual durable completion when cancellation precedes its acknowledgement",
  async () => {
    if (!pool) throw Error("Synthetic PostgreSQL URL required");
    let releaseAck!: () => void;
    let signalCommitted!: () => void;
    const acknowledgement = new Promise<void>((resolve) => {
      releaseAck = resolve;
    });
    const committed = new Promise<void>((resolve) => {
      signalCommitted = resolve;
    });
    state.database.mockReturnValue({
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect();
        let completionWrite = false;
        return {
          release: client.release.bind(client),
          query: async (sql: string, values?: unknown[]) => {
            if (
              sql.startsWith(
                "UPDATE orbsie_authoring_runs SET phase='completed'",
              )
            )
              completionWrite = true;
            const result = await client.query(sql, values);
            // Real COMMIT has succeeded. Only its acknowledgement is delayed.
            if (sql === "COMMIT" && completionWrite) {
              signalCommitted();
              await acknowledgement;
            }
            return result;
          },
        };
      },
    });
    const prefix = `coordinator:${Date.now()}`;
    const identityHash = "e".repeat(64);
    const trial = {
      identityHash,
      cookie: "synthetic",
      buckets: [
        { key: `${prefix}:visitor`, limit: 3 },
        { key: `${prefix}:network`, limit: 3 },
        { key: `global:${prefix}`, limit: 9 },
      ],
    };
    const abort = new AbortController();
    const project = blankProject();
    let completion: Promise<void> | undefined;
    try {
      const admission = await admitInitialAuthoringRun({
        request: new Request("https://orbsie.test/api/generate"),
        project,
        prompt: "A small garden",
        provider: "free",
        model: "openai/gpt-5.6-luna",
        localModeling: false,
        browserModeling: false,
        signal: abort.signal,
        trialIdentity: trial,
      });
      const finished = { ...project, revision: project.revision + 1 };
      const lifecycle = createAuthoringLifecycle(
        admission.lifecycle,
        abort.signal,
        () => ({
          project: finished,
          provenance: initialSceneProvenance(finished),
        }),
      );
      completion = lifecycle.complete();
      void completion.catch(() => undefined);
      await committed;
      expect(await readAuthoringRun(admission.runId)).toMatchObject({
        phase: "completed",
      });
      abort.abort(Error("synthetic cancel after commit"));
      await expect
        .poll(async () => (await readAuthoringRun(admission.runId)).phase, {
          timeout: 4000,
        })
        .toBe("failed");
      releaseAck();
      await expect(completion).rejects.toThrow("synthetic cancel after commit");
      const settled = await readAuthoringRun(admission.runId);
      expect(settled.phase).toBe("failed");
      await expect(
        admitAuthoringReview({
          ...settled,
          effort: settled.effort ?? undefined,
          reviewPhase: "review",
          expectedRevision: finished.revision,
          expectedSceneBindingDigest: settled.completedSceneBindingDigest!,
        }),
      ).rejects.toMatchObject({ code: "phase-conflict" });
    } finally {
      releaseAck();
      await completion?.catch(() => undefined);
      await pool.query(
        "DELETE FROM orbsie_authoring_runs WHERE identity_hash=$1",
        [identityHash],
      );
      await pool.query(
        "DELETE FROM orbsie_trial_usage WHERE bucket LIKE $1 OR bucket=$2",
        [`${prefix}%`, `global:${prefix}`],
      );
    }
  },
  15000,
);
