import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { database } from "../src/lib/server/auth";
import {
  claimTrial,
  trialIdentity,
  trialRemaining,
  TrialExhausted,
} from "../src/lib/server/trial";
afterEach(() => vi.unstubAllEnvs());
it("signs the visitor cookie and rejects tampering without trusting arbitrary forwarded headers", () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-secret");
  vi.stubEnv("VERCEL", "");
  const first = trialIdentity(new Request("https://orbsie.test"));
  expect(first.cookie).toContain("HttpOnly; SameSite=Lax");
  expect(first.cookie).toContain("Secure");
  const next = trialIdentity(
    new Request("https://orbsie.test", {
      headers: { cookie: first.cookie, "x-forwarded-for": "1.2.3.4" },
    }),
  );
  expect(next.buckets).toEqual(first.buckets);
  const altered = trialIdentity(
    new Request("https://orbsie.test", {
      headers: {
        cookie: first.cookie.replace("orbsie_trial=", "orbsie_trial=broken"),
      },
    }),
  );
  expect(altered.buckets[0]).not.toEqual(first.buckets[0]);
  expect(altered.buckets[1]).toEqual(first.buckets[1]);
});
it.runIf(process.env.RUN_TRIAL_DATABASE_TEST === "1")(
  "admits only 3 of 12 concurrent claims and blocks a reset cookie on the same network",
  async () => {
    const prefix = `test:${randomUUID()}`;
    const identity = {
      cookie: "synthetic",
      buckets: [
        { key: `${prefix}:visitor`, limit: 3 },
        { key: `${prefix}:network`, limit: 3 },
        { key: `${prefix}:global`, limit: 100 },
      ],
    };
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () => claimTrial(identity)),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
      expect(
        results.filter(
          (r) => r.status === "rejected" && r.reason instanceof TrialExhausted,
        ),
      ).toHaveLength(9);
      expect(await trialRemaining(identity)).toBe(0);
      const reset = {
        ...identity,
        buckets: identity.buckets.map((b, i) =>
          i === 0 ? { ...b, key: `${prefix}:reset` } : b,
        ),
      };
      await expect(claimTrial(reset)).rejects.toBeInstanceOf(TrialExhausted);
      const rows = await database().query(
        "SELECT used FROM orbsie_trial_usage WHERE bucket=ANY($1::text[])",
        [identity.buckets.map((b) => b.key)],
      );
      expect(rows.rows.map((r) => r.used)).toEqual([3, 3, 3]);
    } finally {
      await database().query(
        "DELETE FROM orbsie_trial_usage WHERE bucket LIKE $1",
        [`${prefix}:%`],
      );
      await database().end();
    }
  },
  30000,
);
