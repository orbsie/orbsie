import { beforeEach, expect, it, vi } from "vitest";
import { resetRecentTrialUsage } from "../src/lib/server/trial";

const db = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("../src/lib/server/auth", async () => ({
  ...(await vi.importActual("../src/lib/server/auth")),
  database: () => ({ connect: async () => db }),
}));

beforeEach(() => {
  db.query.mockReset();
  db.release.mockReset();
});

it("deletes only recent visitor and network rows and reports the breakdown", async () => {
  db.query.mockImplementation(async (sql: string) => {
    if (sql === "BEGIN" || sql === "COMMIT") return {};
    if (sql.includes("DELETE FROM orbsie_trial_usage"))
      return {
        rows: [
          { bucket: "visitor:abc" },
          { bucket: "network:2026-09-11:def" },
          { bucket: "visitor:ghi" },
        ],
      };
    throw new Error(`unexpected query: ${sql}`);
  });
  const result = await resetRecentTrialUsage();
  expect(result).toEqual({ cleared: 3, visitors: 2, networks: 1 });
  expect(db.query.mock.calls[0][0]).toBe("BEGIN");
  expect(db.query.mock.calls.at(-2)?.[0]).toContain(
    "AND updated_at >= now() - interval '5 minutes'",
  );
  expect(db.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
});

it("rolls back and rethrows when the delete fails", async () => {
  db.query.mockImplementation(async (sql: string) => {
    if (sql === "BEGIN") return {};
    if (sql.startsWith("DELETE")) throw new Error("connection reset");
    return {};
  });
  await expect(resetRecentTrialUsage()).rejects.toThrow("connection");
  expect(db.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
});

it("returns zero counts when no rows match the window", async () => {
  db.query.mockImplementation(async (sql: string) => {
    if (sql === "BEGIN" || sql === "COMMIT") return {};
    if (sql.startsWith("DELETE")) return { rows: [] };
    return {};
  });
  expect(await resetRecentTrialUsage()).toEqual({
    cleared: 0,
    visitors: 0,
    networks: 0,
  });
});
