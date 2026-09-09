import { beforeEach, expect, it, vi } from "vitest";
import { fixtureEntities } from "../src/lib/fixtures";
import { blankProject } from "../src/lib/protocol";
const db = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("../src/lib/server/auth", async () => ({
  ...(await vi.importActual("../src/lib/server/auth")),
  database: () => ({ connect: async () => db }),
}));
import {
  startGenerationRun,
  supersededGenerationRuns,
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
    recovery_checkpoint: project,
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
      return { rows: [{ revision: 0, snapshot: row.starting_snapshot }] };
    if (sql.includes("ORDER BY sequence LIMIT 257"))
      return { rows: operations.map((envelope) => ({ envelope })) };
    if (sql.includes("ORDER BY sequence LIMIT 50"))
      return {
        rows: operations
          .filter((envelope) => envelope.sequence > args[1])
          .slice(0, 50)
          .map((envelope) => ({ envelope })),
      };
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
        recovery_checkpoint: JSON.parse(args[4]),
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
const proceduralSource = {
  version: 1 as const,
  language: "quickjs" as const,
  seed: 4,
  code: `({version:1,revision:0,output:"box",nodes:[{id:"box",kind:"box",size:[2,2,2]}]})`,
};
const proceduralRecipe = {
  version: 1 as const,
  revision: 0,
  output: "box",
  nodes: [
    {
      id: "box",
      kind: "box" as const,
      size: [2, 2, 2] as [number, number, number],
    },
  ],
};
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

it("rejects a wrong procedural source hash before starting a journal transaction", async () => {
  const authored = {
    ...project,
    entities: [
      {
        id: "shape",
        label: "Shape",
        position: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        color: "#6ead60",
        stage: "ready" as const,
        geometry: {
          kind: "generated" as const,
          collision: "none" as const,
          detail: "refined" as const,
          job: {
            backend: "browser-manifold" as const,
            recipe: proceduralRecipe,
            authoring: {
              source: proceduralSource,
              sourceHash: "a".repeat(64),
            },
          },
        },
      },
    ],
  };
  await expect(
    startGenerationRun("owner", {
      runId: id,
      project: authored,
      prompt: "Build",
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(db.query).not.toHaveBeenCalled();
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
it("rejects malformed retained authoring before journal admission", async () => {
  const entity = {
    id: "shape",
    label: "Shape",
    position: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    color: "#6ead60",
    stage: "ready" as const,
  };
  row.checkpoint = { ...project, entities: [entity] };
  row.starting_snapshot = row.checkpoint;
  row.recovery_checkpoint = row.checkpoint;
  const before = structuredClone(row.checkpoint);
  const envelope = {
    ...op(),
    command: {
      type: "set_geometry" as const,
      id: "shape",
      geometry: {
        kind: "generated" as const,
        collision: "none" as const,
        detail: "refined" as const,
        job: {
          backend: "browser-manifold" as const,
          recipe: proceduralRecipe,
          authoring: {
            source: proceduralSource,
            sourceHash: "a".repeat(64),
          },
        },
      },
    },
  };
  await expect(
    appendGenerationRun("owner", { runId: id, envelope }),
  ).rejects.toMatchObject({ status: 400 });
  expect(row.checkpoint).toEqual(before);
  expect(operations).toHaveLength(0);
  expect(
    db.query.mock.calls.some(([sql]) =>
      String(sql).startsWith("INSERT INTO generation_operations"),
    ),
  ).toBe(false);
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

it("retention preserves newest per world and every live run while pruning oldest eligible history", () => {
  const runs = [
    { id: "a-new", orb_id: "a", state: "complete", expired: true },
    { id: "b-only", orb_id: "b", state: "cancelled", expired: true },
    { id: "a-active", orb_id: "a", state: "running", expired: false },
    { id: "a-old", orb_id: "a", state: "complete", expired: true },
    { id: "a-expired", orb_id: "a", state: "running", expired: true },
  ];
  expect(supersededGenerationRuns(runs, 1)).toEqual(["a-expired"]);
  expect(supersededGenerationRuns(runs, 64)).toEqual(["a-expired", "a-old"]);
  expect(supersededGenerationRuns(runs, 0)).toEqual([]);
});
it("at quota prunes only enough owner-scoped superseded terminal rows to admit one run", async () => {
  db.query.mockImplementation(async (sql: string, args: any[] = []) => {
    if (sql.startsWith("SELECT revision"))
      return { rows: [{ revision: 0, snapshot: row.starting_snapshot }] };
    if (sql.startsWith("SELECT count")) return { rows: [{ count: 64 }] };
    if (sql.startsWith("SELECT id,orb_id,state"))
      return {
        rows: [
          { id: "new", orb_id: project.id, state: "running", expired: false },
          { id: "old", orb_id: project.id, state: "complete", expired: true },
        ],
      };
    if (sql.startsWith("INSERT INTO generation_runs"))
      return { rows: [{ ...row, id: args[0] }] };
    return { rows: [] };
  });
  await startGenerationRun("owner", { runId: id, project, prompt: "Build" });
  expect(db.query).toHaveBeenCalledWith(
    "DELETE FROM generation_runs WHERE owner_id=$1 AND id=ANY($2::text[])",
    ["owner", ["old"]],
  );
  expect(db.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
});
it("does not prune below quota", async () => {
  db.query.mockImplementation(async (sql: string) => ({
    rows: sql.startsWith("SELECT revision")
      ? [{ revision: 0, snapshot: project }]
      : sql.startsWith("SELECT count")
        ? [{ count: 63 }]
        : sql.startsWith("INSERT INTO generation_runs")
          ? [row]
          : [],
  }));
  await startGenerationRun("owner", { runId: id, project, prompt: "Build" });
  expect(db.query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(
    false,
  );
});

it("returns the durable finished snapshot separately from the raw checkpoint", async () => {
  row.recovery_checkpoint = structuredClone(project);
  const run = await readGenerationRun("owner", id);
  expect(run.recoveryCheckpoint).toEqual(project);
});

it("retains the latest finished geometry during interrupted replacements and honors deletion", async () => {
  const starting = { ...project, entities: [fixtureEntities()[0]] };
  row.checkpoint = starting;
  row.starting_snapshot = starting;
  row.recovery_checkpoint = starting;
  const entityId = starting.entities[0].id;
  const appendGeometry = (
    sequence: number,
    kind: "tree" | "mushroom",
    detail: "coarse" | "refined",
  ) =>
    appendGenerationRun("owner", {
      runId: id,
      envelope: {
        ...op(sequence),
        command: {
          type: "set_geometry",
          id: entityId,
          geometry: { kind, detail },
        },
      },
    });
  const coarse = await appendGeometry(1, "mushroom", "coarse");
  expect(coarse.checkpoint.entities[0].stage).toBe("coarse");
  expect(coarse.recoveryCheckpoint?.entities[0]).toEqual(starting.entities[0]);
  const ready = await appendGeometry(2, "mushroom", "refined");
  const again = await appendGeometry(3, "tree", "coarse");
  expect(again.recoveryCheckpoint?.entities[0]).toEqual(
    ready.checkpoint.entities[0],
  );
  // Simulate an old run that has durable operations but no recovery column value.
  row.recovery_checkpoint = null;
  const reconstructed = await readGenerationRun("owner", id);
  expect(reconstructed.recoveryCheckpoint).toEqual(again.recoveryCheckpoint);
  expect(db.query).toHaveBeenCalledWith(
    "UPDATE generation_runs SET recovery_checkpoint=$2 WHERE id=$1",
    [id, JSON.stringify(again.recoveryCheckpoint)],
  );
  row.recovery_checkpoint = reconstructed.recoveryCheckpoint;
  const removed = await appendGenerationRun("owner", {
    runId: id,
    envelope: { ...op(4), command: { type: "remove_entity", id: entityId } },
  });
  expect(removed.recoveryCheckpoint?.entities).toEqual([]);
});

it("replays a reparented hierarchy recovery atomically", async () => {
  const journalOp = (sequence: number, command: any) => ({
    ...op(sequence),
    operationId: `hierarchy-operation-${sequence}`,
    command,
  });
  const group = (id: string, position: [number, number, number]) => ({
    id,
    label: id,
    position,
    scale: [1, 1, 1] as [number, number, number],
  });
  const child = {
    id: "child",
    label: "Child",
    position: [2, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    color: "#6ead60",
    stage: "seed" as const,
  };
  const unrelated = {
    id: "unrelated",
    label: "Unrelated",
    position: [4, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    color: "#6ead60",
    stage: "seed" as const,
  };
  const append = (sequence: number, command: any) =>
    appendGenerationRun("owner", {
      runId: id,
      envelope: journalOp(sequence, command),
    });

  await append(1, {
    type: "create_group",
    group: group("old-parent", [1, 0, 3]),
  });
  await append(2, {
    type: "create_group",
    group: group("current-parent", [10, 0, 0]),
  });
  await append(3, { type: "reserve_entity", entity: child });
  await append(4, {
    type: "set_parent",
    id: "child",
    parentId: "old-parent",
    keepWorldTransform: false,
  });
  const ready = await append(5, {
    type: "set_geometry",
    id: "child",
    geometry: { kind: "tree", detail: "refined" },
  });
  expect(ready.checkpoint.entities[0]).toMatchObject({
    id: "child",
    parentId: "old-parent",
    stage: "ready",
    geometry: { kind: "tree", detail: "refined" },
  });

  await append(6, { type: "reserve_entity", entity: unrelated });
  await append(7, {
    type: "set_geometry",
    id: "unrelated",
    geometry: { kind: "tree", detail: "refined" },
  });
  const committedTransform = await append(8, {
    type: "set_transform",
    id: "unrelated",
    position: [8, 0, 0],
    rotation: [0, 0.25, 0],
    scale: [1.5, 1, 0.75],
  });
  expect(committedTransform.recoveryCheckpoint?.entities[1]).toMatchObject({
    id: "unrelated",
    position: [8, 0, 0],
    rotation: [0, 0.25, 0],
    scale: [1.5, 1, 0.75],
    stage: "ready",
  });

  const coarse = await append(9, {
    type: "set_geometry",
    id: "child",
    geometry: { kind: "tree", detail: "coarse" },
  });
  expect(coarse.checkpoint.entities[0]).toMatchObject({
    parentId: "old-parent",
    stage: "coarse",
  });
  expect(coarse.recoveryCheckpoint?.entities[0]).toMatchObject({
    parentId: "old-parent",
    stage: "ready",
    geometry: { kind: "tree", detail: "refined" },
  });

  const reparented = await append(10, {
    type: "set_parent",
    id: "child",
    parentId: "current-parent",
    keepWorldTransform: false,
  });
  expect(reparented.checkpoint.entities[0]).toMatchObject({
    parentId: "current-parent",
    stage: "coarse",
  });
  expect(reparented.recoveryCheckpoint?.entities[0]).toMatchObject({
    parentId: "current-parent",
    stage: "ready",
    geometry: { kind: "tree", detail: "refined" },
  });

  const removedOldParent = await append(11, {
    type: "remove_group",
    id: "old-parent",
  });
  expect(removedOldParent.checkpoint.groups?.map((entry) => entry.id)).toEqual([
    "current-parent",
  ]);
  expect(
    removedOldParent.recoveryCheckpoint?.groups?.map((entry) => entry.id),
  ).toEqual(["current-parent"]);
  expect(removedOldParent.recoveryCheckpoint?.entities[0]).toMatchObject({
    id: "child",
    parentId: "current-parent",
    stage: "ready",
    geometry: { kind: "tree", detail: "refined" },
  });
  expect(removedOldParent.recoveryCheckpoint?.entities[1]).toMatchObject({
    id: "unrelated",
    position: [8, 0, 0],
    rotation: [0, 0.25, 0],
    scale: [1.5, 1, 0.75],
    stage: "ready",
  });
  expect(operations.map((envelope) => envelope.command.type)).toEqual([
    "create_group",
    "create_group",
    "reserve_entity",
    "set_parent",
    "set_geometry",
    "reserve_entity",
    "set_geometry",
    "set_transform",
    "set_geometry",
    "set_parent",
    "remove_group",
  ]);

  const checkpointBeforeCycle = structuredClone(row.checkpoint);
  const sequenceBeforeCycle = row.sequence;
  await expect(
    append(12, {
      type: "set_parent",
      id: "current-parent",
      parentId: "current-parent",
      keepWorldTransform: false,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(operations).toHaveLength(11);
  expect(row.sequence).toBe(sequenceBeforeCycle);
  expect(row.checkpoint).toEqual(checkpointBeforeCycle);
  expect(db.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");

  row.expired = true;
  row.recovery_checkpoint = null;
  const interrupted = await readGenerationRun("owner", id);
  expect(interrupted.state).toBe("interrupted");
  expect(
    interrupted.recoveryCheckpoint?.groups?.map((entry) => entry.id),
  ).toEqual(["current-parent"]);
  expect(interrupted.recoveryCheckpoint?.entities[0]).toMatchObject({
    parentId: "current-parent",
    stage: "ready",
    geometry: { kind: "tree", detail: "refined" },
  });

  row.recovery_checkpoint = null;
  const replay = await replayGenerationRun("owner", id, 0);
  expect(replay.operations.map((envelope) => envelope.command.type)).toEqual(
    operations.map((envelope) => envelope.command.type),
  );
  expect(replay.nextSequence).toBe(11);
  expect(replay.run.recoveryCheckpoint?.entities[0]).toMatchObject({
    parentId: "current-parent",
    stage: "ready",
    geometry: { kind: "tree", detail: "refined" },
  });
  expect(replay.run.recoveryCheckpoint?.entities[1]).toMatchObject({
    id: "unrelated",
    position: [8, 0, 0],
    rotation: [0, 0.25, 0],
    scale: [1.5, 1, 0.75],
  });
  await expect(
    appendGenerationRun("other", {
      runId: id,
      envelope: journalOp(12, {
        type: "set_environment",
        sky: "#ffffff",
      }),
    }),
  ).rejects.toMatchObject({ status: 404 });
  expect(operations).toHaveLength(11);
  await expect(readGenerationRun("other", id)).rejects.toMatchObject({
    status: 404,
  });
});

it("refuses legacy reconstruction with missing operations", async () => {
  row.recovery_checkpoint = null;
  row.sequence = 1;
  await expect(readGenerationRun("owner", id)).rejects.toMatchObject({
    status: 409,
  });
});

it("refuses an out-of-sequence legacy journal even when its length matches", async () => {
  row.recovery_checkpoint = null;
  row.sequence = 1;
  operations = [op(2)];
  await expect(readGenerationRun("owner", id)).rejects.toMatchObject({
    status: 409,
  });
});
