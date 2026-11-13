import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";

vi.mock("../src/lib/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/server/auth")>()),
  database: vi.fn(),
}));

import {
  AUTHORING_RUN_REVIEW_SLOTS,
  FREE_AUTHORING_GLOBAL_UNITS,
} from "../src/lib/server/authoring-run-limits";
import {
  claimTrialInTransaction,
  trialRemainingFromCounts,
  TrialExhausted,
  type TrialIdentity,
} from "../src/lib/server/trial";

function identity(): TrialIdentity {
  return {
    cookie: "orbsie_trial=test",
    buckets: [
      { key: "visitor:a", limit: 3 },
      { key: "network:a", limit: 3 },
      { key: "global:day", limit: 100 },
    ],
  };
}

/** Minimal in-memory stand-in for the two statements the claim path issues. */
function ledgerClient(used: Record<string, number> = {}) {
  const counts = new Map(Object.entries(used));
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("INSERT")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("SELECT used")) {
        const key = String(params?.[0]);
        // The claim inserts the row before locking it, so an unseen key is 0.
        return { rows: [{ used: counts.get(key) ?? 0 }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE")) {
        const keys = params?.[0] as string[];
        const units = Number(params?.[1]);
        return {
          rows: keys.map((key) => {
            const increment = key.startsWith("global:") ? units : 1;
            const next = (counts.get(key) ?? 0) + increment;
            counts.set(key, next);
            return { bucket: key, used: next };
          }),
          rowCount: keys.length,
        };
      }
      throw new Error(`Unexpected statement: ${sql}`);
    }),
  };
  return { client: client as unknown as PoolClient, counts };
}

describe("free authoring-run accounting", () => {
  it("reserves one unit per possible inference call", () => {
    // initial generation + every admitted review slot
    expect(AUTHORING_RUN_REVIEW_SLOTS).toBe(3);
    expect(FREE_AUTHORING_GLOBAL_UNITS).toBe(1 + AUTHORING_RUN_REVIEW_SLOTS);
  });

  it("charges the full reservation to the shared daily ceiling", async () => {
    const { client, counts } = ledgerClient();
    await claimTrialInTransaction(client, identity(), FREE_AUTHORING_GLOBAL_UNITS);

    expect(counts.get("global:day")).toBe(FREE_AUTHORING_GLOBAL_UNITS);
    expect(counts.get("visitor:a")).toBe(1);
    expect(counts.get("network:a")).toBe(1);
  });

  it("refuses a claim the daily ceiling cannot cover at full cost", async () => {
    const start = 100 - (FREE_AUTHORING_GLOBAL_UNITS - 1);
    const { client } = ledgerClient({ "global:day": start });
    await expect(
      claimTrialInTransaction(
        client,
        identity(),
        FREE_AUTHORING_GLOBAL_UNITS,
      ),
    ).rejects.toBeInstanceOf(TrialExhausted);
  });

  it("admits exactly floor(limit / units) runs and no more", () => {
    const counts = new Map<string, number>();
    const subject = identity();
    const admitted = new Map<string, number>();

    // 25 runs of 4 units fit in a 100-unit day; a 26th does not.
    for (let run = 0; run < 25; run += 1) {
      for (const bucket of subject.buckets) {
        const increment = bucket.key.startsWith("global:") ? 4 : 1;
        admitted.set(bucket.key, (admitted.get(bucket.key) ?? 0) + increment);
      }
    }
    for (const [key, value] of admitted) counts.set(key, value);

    expect(trialRemainingFromCounts(subject, counts, 4)).toBe(0);
    counts.set("global:day", 96);
    counts.set("visitor:a", 0);
    counts.set("network:a", 0);
    expect(trialRemainingFromCounts(subject, counts, 4)).toBe(1);
  });

  it("rejects a reservation above the documented maximum", () => {
    const counts = new Map<string, number>();
    expect(() =>
      trialRemainingFromCounts(
        identity(),
        counts,
        FREE_AUTHORING_GLOBAL_UNITS + 1,
      ),
    ).toThrow(RangeError);
    expect(() =>
      trialRemainingFromCounts(identity(), counts, 0),
    ).toThrow(RangeError);
  });
});
