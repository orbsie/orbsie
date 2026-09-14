import { beforeEach, describe, expect, it, vi } from "vitest";

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
  readAuthoringRun,
} from "../src/lib/server/authoring-run-ledger";
import { withDatabaseTransaction } from "../src/lib/server/trial";

const binding = {
  identityHash: "a".repeat(64),
  projectId: "project-1",
  provider: "openrouter" as const,
  model: "openai/gpt-5.6-luna",
  effort: "medium" as const,
  requestFingerprint: "b".repeat(64),
};

function fakeDatabase(
  options: {
    failLedgerInsert?: boolean;
    expired?: boolean;
    rollbackFails?: boolean;
  } = {},
) {
  let ledger: Record<string, unknown> | null = null;
  let trialUsage = new Map<string, number>();
  let snapshot: {
    ledger: Record<string, unknown> | null;
    trialUsage: Map<string, number>;
  } | null = null;
  let rolledBack = false;
  const query = vi.fn(async (text: string, params: unknown[] = []) => {
    if (text === "BEGIN") {
      snapshot = {
        ledger: ledger && { ...ledger },
        trialUsage: new Map(trialUsage),
      };
      return { rows: [] };
    }
    if (text === "COMMIT") {
      snapshot = null;
      return { rows: [] };
    }
    if (text === "ROLLBACK") {
      if (options.rollbackFails) throw Error("synthetic rollback failure");
      rolledBack = true;
      if (snapshot) {
        ledger = snapshot.ledger && { ...snapshot.ledger };
        trialUsage = new Map(snapshot.trialUsage);
      }
      snapshot = null;
      return { rows: [] };
    }
    if (text.startsWith("SET LOCAL ")) return { rows: [] };
    if (text.startsWith("INSERT INTO orbsie_trial_usage")) {
      const key = String(params[0]);
      if (!trialUsage.has(key)) trialUsage.set(key, 0);
      return { rows: [] };
    }
    if (text.startsWith("SELECT used FROM orbsie_trial_usage")) {
      const key = String(params[0]);
      return { rows: [{ used: trialUsage.get(key) ?? 0 }] };
    }
    if (text.startsWith("UPDATE orbsie_trial_usage")) {
      const keys = params[0] as string[];
      const units = Number(params[1]);
      const rows = keys.map((key) => {
        const next =
          (trialUsage.get(key) ?? 0) + (key.startsWith("global:") ? units : 1);
        trialUsage.set(key, next);
        return { bucket: key, used: next };
      });
      return { rows, rowCount: rows.length };
    }
    if (text.startsWith("INSERT INTO orbsie_authoring_runs")) {
      if (options.failLedgerInsert) throw Error("synthetic ledger failure");
      ledger = {
        run_id: String(params[0]),
        identity_hash: String(params[1]),
        project_id: String(params[2]),
        provider: String(params[3]),
        model: String(params[4]),
        effort: params[5] ?? null,
        request_fingerprint: String(params[6]),
        initial_revision: Number(params[7]),
        initial_scene_digest: String(params[8]),
        phase: "active",
        remaining_review_slots: Number(params[9]),
        phase_token_hash: String(params[10]),
        phase_token_expires_at: new Date(Date.now() + 900_000),
        completed_revision: null,
        completed_scene_digest: null,
        expires_at: new Date(Date.now() + 900_000),
      };
      return { rowCount: 1, rows: [{ expires_at: ledger.expires_at }] };
    }
    if (
      text.includes("FROM orbsie_authoring_runs") &&
      text.includes("FOR UPDATE")
    ) {
      if (!ledger) return { rows: [] };
      return {
        rows: [
          {
            ...ledger,
            live: !options.expired,
            token_live: !options.expired && !!ledger.phase_token_hash,
          },
        ],
      };
    }
    if (
      text.includes("FROM orbsie_authoring_runs") &&
      text.includes("WHERE run_id=$1")
    ) {
      return ledger ? { rows: [{ ...ledger, live: true }] } : { rows: [] };
    }
    if (text.includes("SET phase='completed'")) {
      if (!ledger) return { rowCount: 0, rows: [] };
      ledger.phase = "completed";
      ledger.completed_revision = Number(params[1]);
      ledger.completed_scene_digest = String(params[2]);
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("SET phase='failed'")) {
      if (!ledger) return { rowCount: 0, rows: [] };
      ledger.phase = "failed";
      ledger.phase_token_hash = null;
      return { rowCount: 1, rows: [] };
    }
    if (
      text.includes(
        "SET phase=$2,remaining_review_slots=remaining_review_slots-1",
      )
    ) {
      if (!ledger) return { rowCount: 0, rows: [] };
      ledger.phase = String(params[1]);
      ledger.remaining_review_slots = Number(ledger.remaining_review_slots) - 1;
      ledger.phase_token_hash = String(params[2]);
      return { rowCount: 1, rows: [] };
    }
    if (
      text.includes("SET phase=$2,remaining_review_slots=$3,completed_revision")
    ) {
      if (!ledger) return { rowCount: 0, rows: [] };
      ledger.phase = String(params[1]);
      ledger.remaining_review_slots = Number(params[2]);
      ledger.completed_revision = Number(params[3]);
      ledger.completed_scene_digest = String(params[4]);
      ledger.phase_token_hash = null;
      return { rowCount: 1, rows: [] };
    }
    throw Error(`Unhandled synthetic query: ${text}`);
  });
  const client = { query, release: vi.fn() };
  state.database.mockReturnValue({
    connect: vi.fn(async () => client),
    query,
    release: client.release,
  });
  return {
    query,
    release: client.release,
    get ledger() {
      return ledger;
    },
    get trialUsage() {
      return trialUsage;
    },
    get rolledBack() {
      return rolledBack;
    },
  };
}

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-authoring-secret");
});

describe("internal authoring-run ledger", () => {
  it("fences initial completion, review admission, and finalization by phase token", async () => {
    const database = fakeDatabase();
    const issued = await issueAuthoringRun({
      ...binding,
      initialRevision: 1,
      initialSceneDigest: "c".repeat(64),
    });
    expect(database.ledger?.phase_token_hash).not.toBe(issued.phaseToken);

    await expect(
      completeInitialAuthoringRun({
        ...binding,
        runId: issued.runId,
        phaseToken: "wrong-token-that-is-long-enough-000000000000",
        revision: 2,
        sceneBindingDigest: "d".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "token-mismatch" });
    await completeInitialAuthoringRun({
      ...binding,
      runId: issued.runId,
      phaseToken: issued.phaseToken,
      revision: 2,
      sceneBindingDigest: "d".repeat(64),
    });
    expect((await readAuthoringRun(issued.runId)).phase).toBe("completed");

    const first = await admitAuthoringReview({
      ...binding,
      runId: issued.runId,
      reviewPhase: "review",
      expectedRevision: 2,
      expectedSceneBindingDigest: "d".repeat(64),
    });
    await expect(
      completeAuthoringReview({
        ...binding,
        runId: issued.runId,
        phaseToken: first.phaseToken,
        reviewPhase: "unexpected" as unknown as "review",
        revision: 2,
        sceneBindingDigest: "d".repeat(64),
        accepted: "yes" as unknown as boolean,
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      completeAuthoringReview({
        ...binding,
        runId: issued.runId,
        phaseToken: first.phaseToken,
        reviewPhase: "review",
        revision: 2,
        sceneBindingDigest: "d".repeat(64),
        accepted: "yes" as unknown as boolean,
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      admitAuthoringReview({
        ...binding,
        runId: issued.runId,
        reviewPhase: "review",
        expectedRevision: 2,
        expectedSceneBindingDigest: "d".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "phase-conflict" });
    await expect(
      completeInitialAuthoringRun({
        ...binding,
        runId: issued.runId,
        phaseToken: issued.phaseToken,
        revision: 2,
        sceneBindingDigest: "d".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "token-mismatch" });
    await completeAuthoringReview({
      ...binding,
      runId: issued.runId,
      phaseToken: first.phaseToken,
      reviewPhase: "review",
      revision: 3,
      sceneBindingDigest: "e".repeat(64),
      accepted: false,
    });
    const final = await admitAuthoringReview({
      ...binding,
      runId: issued.runId,
      reviewPhase: "final-review",
      expectedRevision: 3,
      expectedSceneBindingDigest: "e".repeat(64),
    });
    await completeAuthoringReview({
      ...binding,
      runId: issued.runId,
      phaseToken: final.phaseToken,
      reviewPhase: "final-review",
      revision: 3,
      sceneBindingDigest: "e".repeat(64),
      accepted: true,
    });
    await expect(
      admitAuthoringReview({
        ...binding,
        runId: issued.runId,
        reviewPhase: "final-review",
        expectedRevision: 3,
        expectedSceneBindingDigest: "e".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "phase-conflict" });
  });

  it("terminalizes an accepted first review so it cannot open a final call", async () => {
    const database = fakeDatabase();
    const issued = await issueAuthoringRun({
      ...binding,
      initialRevision: 1,
      initialSceneDigest: "c".repeat(64),
    });
    await completeInitialAuthoringRun({
      ...binding,
      runId: issued.runId,
      phaseToken: issued.phaseToken,
      revision: 1,
      sceneBindingDigest: "d".repeat(64),
    });
    const review = await admitAuthoringReview({
      ...binding,
      runId: issued.runId,
      reviewPhase: "review",
      expectedRevision: 1,
      expectedSceneBindingDigest: "d".repeat(64),
    });
    await completeAuthoringReview({
      ...binding,
      runId: issued.runId,
      phaseToken: review.phaseToken,
      reviewPhase: "review",
      revision: 1,
      sceneBindingDigest: "d".repeat(64),
      accepted: true,
    });
    expect(database.ledger?.phase).toBe("finalized");
    expect(database.ledger?.remaining_review_slots).toBe(0);
    await expect(
      admitAuthoringReview({
        ...binding,
        runId: issued.runId,
        reviewPhase: "final-review",
        expectedRevision: 1,
        expectedSceneBindingDigest: "d".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "phase-conflict" });
  });

  it("keeps the final review verdict-only", async () => {
    const issued = await issueAuthoringRun({
      ...binding,
      initialRevision: 1,
      initialSceneDigest: "c".repeat(64),
    });
    await completeInitialAuthoringRun({
      ...binding,
      runId: issued.runId,
      phaseToken: issued.phaseToken,
      revision: 1,
      sceneBindingDigest: "d".repeat(64),
    });
    const first = await admitAuthoringReview({
      ...binding,
      runId: issued.runId,
      reviewPhase: "review",
      expectedRevision: 1,
      expectedSceneBindingDigest: "d".repeat(64),
    });
    await completeAuthoringReview({
      ...binding,
      runId: issued.runId,
      phaseToken: first.phaseToken,
      reviewPhase: "review",
      revision: 2,
      sceneBindingDigest: "e".repeat(64),
      accepted: false,
    });
    const final = await admitAuthoringReview({
      ...binding,
      runId: issued.runId,
      reviewPhase: "final-review",
      expectedRevision: 2,
      expectedSceneBindingDigest: "e".repeat(64),
    });
    await expect(
      completeAuthoringReview({
        ...binding,
        runId: issued.runId,
        phaseToken: final.phaseToken,
        reviewPhase: "final-review",
        revision: 3,
        sceneBindingDigest: "f".repeat(64),
        accepted: false,
      }),
    ).rejects.toMatchObject({ code: "revision-mismatch" });
  });

  it("rejects full binding and backwards-revision substitutions", async () => {
    const database = fakeDatabase();
    const issued = await issueAuthoringRun({
      ...binding,
      initialRevision: 4,
      initialSceneDigest: "c".repeat(64),
    });
    const mismatches = [
      { identityHash: "c".repeat(64) },
      { projectId: "other-project" },
      { provider: "gateway" as const },
      { model: "openai/other" },
      { effort: "low" },
      { requestFingerprint: "d".repeat(64) },
    ];
    for (const mismatch of mismatches)
      await expect(
        completeInitialAuthoringRun({
          ...binding,
          ...mismatch,
          runId: issued.runId,
          phaseToken: issued.phaseToken,
          revision: 4,
          sceneBindingDigest: "d".repeat(64),
        }),
      ).rejects.toMatchObject({ code: "binding-mismatch" });
    await completeInitialAuthoringRun({
      ...binding,
      runId: issued.runId,
      phaseToken: issued.phaseToken,
      revision: 4,
      sceneBindingDigest: "d".repeat(64),
    });
    await expect(
      admitAuthoringReview({
        ...binding,
        runId: issued.runId,
        reviewPhase: "review",
        expectedRevision: 3,
        expectedSceneBindingDigest: "d".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "revision-mismatch" });
    expect(database.rolledBack).toBe(true);
  });

  it("rolls back the three-unit free reservation when ledger insertion fails", async () => {
    const database = fakeDatabase({ failLedgerInsert: true });
    const trialIdentity = {
      identityHash: binding.identityHash,
      cookie: "synthetic",
      buckets: [
        { key: "visitor:test", limit: 3 },
        { key: "network:test", limit: 3 },
        { key: "global:test", limit: 3 },
      ],
    };
    await expect(
      issueAuthoringRun({
        ...binding,
        provider: "free",
        trialIdentity,
        initialRevision: 0,
        initialSceneDigest: "c".repeat(64),
      }),
    ).rejects.toThrow("synthetic ledger failure");
    expect(database.rolledBack).toBe(true);
    expect([...database.trialUsage.values()]).toEqual([]);
  });

  it("does not accept a free run without the server trial identity", async () => {
    const database = fakeDatabase();
    await expect(
      issueAuthoringRun({
        ...binding,
        provider: "free",
        initialRevision: 0,
        initialSceneDigest: "c".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "binding-mismatch" });
    expect(database.query).not.toHaveBeenCalledWith("BEGIN");
  });

  it("rejects an explicitly empty effort before opening a transaction", async () => {
    const database = fakeDatabase();
    await expect(
      issueAuthoringRun({
        ...binding,
        effort: "",
        initialRevision: 0,
        initialSceneDigest: "c".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(database.query).not.toHaveBeenCalledWith("BEGIN");
  });

  it("permanently fails an incomplete initial phase and rejects review admission", async () => {
    const database = fakeDatabase();
    const issued = await issueAuthoringRun({
      ...binding,
      initialRevision: 0,
      initialSceneDigest: "c".repeat(64),
    });
    const failed = await failAuthoringRun({
      ...binding,
      runId: issued.runId,
      phaseToken: issued.phaseToken,
      revision: 0,
      sceneBindingDigest: "c".repeat(64),
    });
    expect(failed.phase).toBe("failed");
    expect(database.ledger?.phase).toBe("failed");
    await expect(
      admitAuthoringReview({
        ...binding,
        runId: issued.runId,
        reviewPhase: "review",
        expectedRevision: 0,
        expectedSceneBindingDigest: "c".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "phase-conflict" });
  });

  it("retains the initial fence for cancellation after completion and replaces it on review admission", async () => {
    const database = fakeDatabase();
    const issued = await issueAuthoringRun({
      ...binding,
      initialRevision: 0,
      initialSceneDigest: "c".repeat(64),
    });
    await completeInitialAuthoringRun({
      ...binding,
      runId: issued.runId,
      phaseToken: issued.phaseToken,
      revision: 1,
      sceneBindingDigest: "d".repeat(64),
    });
    await failAuthoringRun({
      ...binding,
      runId: issued.runId,
      phaseToken: issued.phaseToken,
      revision: 1,
      sceneBindingDigest: "d".repeat(64),
    });
    expect(database.ledger?.phase).toBe("failed");

    const reviewed = await issueAuthoringRun({
      ...binding,
      initialRevision: 0,
      initialSceneDigest: "c".repeat(64),
    });
    await completeInitialAuthoringRun({
      ...binding,
      runId: reviewed.runId,
      phaseToken: reviewed.phaseToken,
      revision: 1,
      sceneBindingDigest: "d".repeat(64),
    });
    await admitAuthoringReview({
      ...binding,
      runId: reviewed.runId,
      reviewPhase: "review",
      expectedRevision: 1,
      expectedSceneBindingDigest: "d".repeat(64),
    });
    await expect(
      failAuthoringRun({
        ...binding,
        runId: reviewed.runId,
        phaseToken: reviewed.phaseToken,
        revision: 1,
        sceneBindingDigest: "d".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "token-mismatch" });
    expect(database.ledger?.phase).toBe("reviewing");
  });

  it("rejects a phase transition after the bounded run TTL", async () => {
    const database = fakeDatabase({ expired: true });
    const issued = await issueAuthoringRun({
      ...binding,
      initialRevision: 0,
      initialSceneDigest: "c".repeat(64),
    });
    await expect(
      completeInitialAuthoringRun({
        ...binding,
        runId: issued.runId,
        phaseToken: issued.phaseToken,
        revision: 0,
        sceneBindingDigest: "c".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "expired" });
    expect(database.ledger?.phase).toBe("active");
  });

  it("evicts a pooled client when rollback itself fails", async () => {
    const database = fakeDatabase({ rollbackFails: true });
    await expect(
      withDatabaseTransaction(async () => {
        throw Error("synthetic work failure");
      }),
    ).rejects.toThrow("synthetic work failure");
    expect(database.release).toHaveBeenCalledWith(
      expect.objectContaining({ message: "synthetic rollback failure" }),
    );
  });
});
