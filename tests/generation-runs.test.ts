import { beforeEach, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
const db = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("../src/lib/server/auth", async () => ({
  ...(await vi.importActual("../src/lib/server/auth")),
  database: () => ({ connect: async () => db }),
}));
import {
  startGenerationRun,
  appendGenerationRun,
  readGenerationRun,
  replayGenerationRun,
  cancelGenerationRun,
} from "../src/lib/server/generation-runs";
const id = "11111111-1111-4111-8111-111111111111";
const project = blankProject();
let row: any;
let operations: any[];
beforeEach(() => {
  row = {
    id,
    orb_id: project.id,
    sequence: 0,
    state: "running",
    checkpoint: project,
    starting_snapshot: project,
    prompt: "Build a garden",
    selected: null,
    base_revision: 0,
    expired: false,
  };
  operations = [];
  db.query.mockReset();
  db.release.mockClear();
  db.query.mockImplementation(async (sql: string, args: any[] = []) => {
    if (sql.startsWith("SELECT *,"))
      return { rows: args[1] === "owner" ? [structuredClone(row)] : [] };
    if (sql.startsWith("SELECT revision,snapshot FROM orbs"))
      return { rows: [{ revision: 0, snapshot: project }] };
    if (sql.startsWith("SELECT envelope"))
      return {
        rows: operations
          .filter((e) => e.sequence === args[1] || e.operationId === args[2])
          .map((envelope) => ({ envelope })),
      };
    if (sql.startsWith("INSERT INTO generation_operations")) {
      operations.push(JSON.parse(args[3]));
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE generation_runs SET sequence")) {
      row = {
        ...row,
        sequence: args[1],
        checkpoint: JSON.parse(args[2]),
        state: args[3],
      };
      return { rows: [row] };
    }
    if (sql.includes("SET state='cancelled'")) row.state = "cancelled";
    if (sql.includes("SET state='interrupted'")) row.state = "interrupted";
    return { rows: [] };
  });
});
function op(sequence = 1) {
  return {
    version: 1,
    projectId: project.id,
    runId: id,
    operationId: `operation-${sequence}`,
    sequence,
    baseRevision: sequence - 1,
    command: { type: "set_environment", sky: "#ffffff" },
  };
}
it("rejects cross-owner reads and appends without exposing a checkpoint", async () => {
  await expect(readGenerationRun("other", id)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    appendGenerationRun("other", { runId: id, envelope: op() }),
  ).rejects.toMatchObject({ status: 404 });
  expect(operations).toHaveLength(0);
});
it("durably appends once and acknowledges an identical retry", async () => {
  const first = await appendGenerationRun("owner", {
    runId: id,
    envelope: op(),
  });
  expect(first.sequence).toBe(1);
  expect(
    await appendGenerationRun("owner", { runId: id, envelope: op() }),
  ).toEqual(first);
  expect(operations).toHaveLength(1);
  expect(db.query).toHaveBeenCalledWith("COMMIT");
});
it("rejects conflicting duplicates and sequence gaps", async () => {
  await appendGenerationRun("owner", { runId: id, envelope: op() });
  await expect(
    appendGenerationRun("owner", {
      runId: id,
      envelope: {
        ...op(),
        command: { type: "set_environment", sky: "#000000" },
      },
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    appendGenerationRun("owner", { runId: id, envelope: op(3) }),
  ).rejects.toMatchObject({ status: 409 });
  expect(operations).toHaveLength(1);
});
it("cancellation rejects new operations but permits acknowledgement of saved ones", async () => {
  await appendGenerationRun("owner", { runId: id, envelope: op() });
  expect((await cancelGenerationRun("owner", id)).state).toBe("cancelled");
  await expect(
    appendGenerationRun("owner", { runId: id, envelope: op(2) }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await appendGenerationRun("owner", { runId: id, envelope: op() }))
      .sequence,
  ).toBe(1);
});
it("persists lease expiry even when rejecting a late append", async () => {
  row.expired = true;
  await expect(
    appendGenerationRun("owner", { runId: id, envelope: op() }),
  ).rejects.toMatchObject({ status: 409 });
  expect(row.state).toBe("interrupted");
  expect(db.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
});
it("commit ends the run and rejects further writes", async () => {
  const envelope = {
    ...op(),
    command: { type: "commit_revision", message: "Done" },
  };
  expect(
    (await appendGenerationRun("owner", { runId: id, envelope })).state,
  ).toBe("complete");
  await expect(
    appendGenerationRun("owner", { runId: id, envelope: op(2) }),
  ).rejects.toMatchObject({ status: 409 });
});
it("requires the exact owned cloud snapshot before run creation", async () => {
  db.query.mockImplementation(async (sql: string) => ({
    rows: sql.startsWith("SELECT revision")
      ? [{ revision: 0, snapshot: { ...project, title: "different" } }]
      : [],
  }));
  await expect(
    startGenerationRun("owner", { runId: id, project, prompt: "Build" }),
  ).rejects.toMatchObject({ status: 409 });
  expect(db.query.mock.calls.some(([s]) => s.startsWith("INSERT"))).toBe(false);
});

it("rejects append when the cloud revision changed without recording the operation", async () => {
  const implementation = db.query.getMockImplementation()!;
  db.query.mockImplementation(async (sql: string, args: any[]) =>
    sql.startsWith("SELECT revision,snapshot FROM orbs")
      ? { rows: [{ revision: 99 }] }
      : implementation(sql, args),
  );
  await expect(
    appendGenerationRun("owner", { runId: id, envelope: op() }),
  ).rejects.toMatchObject({ status: 409 });
  expect(operations).toHaveLength(0);
});
it("enforces account run quota under its advisory transaction lock", async () => {
  db.query.mockImplementation(async (sql: string) => ({
    rows: sql.startsWith("SELECT revision")
      ? [{ revision: 0, snapshot: project }]
      : sql.startsWith("SELECT count")
        ? [{ count: 64 }]
        : [],
  }));
  await expect(
    startGenerationRun("owner", { runId: id, project, prompt: "Build" }),
  ).rejects.toMatchObject({ status: 413 });
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("pg_advisory_xact_lock"),
    ["generation-runs:owner"],
  );
});
it("rejects oversized checkpoints before opening a transaction", async () => {
  const large = {
    ...project,
    messages: Array.from({ length: 150 }, () => ({
      role: "user",
      text: "x".repeat(4000),
    })),
  };
  await expect(
    startGenerationRun("owner", { runId: id, project: large, prompt: "Build" }),
  ).rejects.toThrow();
  expect(db.query).not.toHaveBeenCalled();
});

it("bounds replay pages and checks ownership before reading operations", async () => {
  await expect(replayGenerationRun("other", id, 0)).rejects.toMatchObject({
    status: 404,
  });
  await replayGenerationRun("owner", id, 0);
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("ORDER BY sequence LIMIT 50"),
    [id, 0],
  );
  await expect(replayGenerationRun("owner", id, 257)).rejects.toThrow();
});

it("rejects same-revision snapshot drift and exposes it on reads", async () => {
  const implementation = db.query.getMockImplementation()!;
  db.query.mockImplementation(async (sql: string, args: any[]) =>
    sql.startsWith("SELECT revision,snapshot FROM orbs")
      ? {
          rows: [
            {
              revision: 0,
              snapshot: { ...project, title: "changed without revision" },
            },
          ],
        }
      : implementation(sql, args),
  );
  await expect(
    appendGenerationRun("owner", { runId: id, envelope: op() }),
  ).rejects.toMatchObject({ status: 409 });
  expect(operations).toHaveLength(0);
  expect((await readGenerationRun("owner", id)).cloudBaselineCurrent).toBe(
    false,
  );
});
