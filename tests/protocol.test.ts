import { describe, it, expect } from "vitest";
import {
  blankProject,
  applyOperation,
  assetGeometrySchema,
  generatedGeometrySchema,
  commandSchema,
  committed,
  projectSchema,
  type Command,
  type Cursor,
} from "../src/lib/protocol";
import { fixtureCommands } from "../src/lib/fixtures";
import { encodeWorld, decodeWorld } from "../src/lib/export";
const seed: Command = {
  type: "reserve_entity",
  entity: {
    id: "tree",
    label: "Tree",
    position: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#00aa00",
    stage: "seed",
  },
};
function setup() {
  const project = blankProject();
  const cursor: Cursor = { runId: "run", sequence: 0, seen: new Set() };
  const op = {
    version: 1,
    projectId: project.id,
    runId: "run",
    operationId: "op",
    sequence: 1,
    baseRevision: 0,
    command: seed,
  };
  return { project, cursor, op };
}
describe("scene protocol", () => {
  it("accepts known catalog geometry and rejects unknown IDs or URLs", () => {
    expect(
      assetGeometrySchema.safeParse({
        kind: "asset",
        assetId: "kenney.nature.tree-default",
        detail: "refined",
      }).success,
    ).toBe(true);
    for (const assetId of ["unknown.asset", "https://evil.example/model.glb"])
      expect(
        assetGeometrySchema.safeParse({
          kind: "asset",
          assetId,
          detail: "refined",
        }).success,
      ).toBe(false);
  });

  it("preserves asset palette until set_material explicitly adds a tint", () => {
    const { project, cursor, op } = setup();
    const reserved = applyOperation(
      project,
      {
        ...op,
        command: {
          ...seed,
          entity: {
            ...seed.entity,
            geometry: {
              kind: "asset",
              assetId: "kenney.nature.tree-default",
              detail: "refined",
            },
          },
        },
      },
      cursor,
    );
    const recolored = applyOperation(
      reserved.project,
      {
        ...op,
        operationId: "recolor",
        sequence: 2,
        baseRevision: 1,
        command: { type: "set_material", id: "tree", color: "#ed99b5" },
      },
      reserved.cursor,
    );
    expect(recolored.project.entities[0].geometry).toMatchObject({
      kind: "asset",
      assetId: "kenney.nature.tree-default",
      tint: "#ed99b5",
    });
  });

  it("persists procedural material tints without changing multipart recipes", () => {
    const { project, cursor, op } = setup();
    const parts = [
      {
        shape: "box" as const,
        position: [-1, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        color: "#123456",
      },
      {
        shape: "sphere" as const,
        position: [1, 0, 0] as [number, number, number],
        scale: [0.5, 0.5, 0.5] as [number, number, number],
        color: "#abcdef",
      },
    ];
    const reserved = applyOperation(project, op, cursor);
    const built = applyOperation(
      reserved.project,
      {
        ...op,
        operationId: "procedural-geometry",
        sequence: 2,
        baseRevision: 1,
        command: {
          type: "set_geometry",
          id: "tree",
          geometry: { kind: "custom", detail: "refined", parts },
        },
      },
      reserved.cursor,
    );
    const recolored = applyOperation(
      built.project,
      {
        ...op,
        operationId: "procedural-recolor",
        sequence: 3,
        baseRevision: 2,
        command: { type: "set_material", id: "tree", color: "#ed99b5" },
      },
      built.cursor,
    );
    expect(recolored.project.entities[0].geometry).toEqual({
      kind: "custom",
      detail: "refined",
      parts,
      tint: "#ed99b5",
    });
    expect(
      projectSchema.parse(JSON.parse(JSON.stringify(recolored.project)))
        .entities[0].geometry,
    ).toEqual(recolored.project.entities[0].geometry);
  });

  it("does not permit new-only entities to downgrade", () => {
    const { project, cursor, op } = setup();
    const reserved = applyOperation(
      project,
      {
        ...op,
        command: {
          ...seed,
          entity: { ...seed.entity, assetPolicy: "new-only" },
        },
      },
      cursor,
    );
    expect(() =>
      applyOperation(
        reserved.project,
        {
          ...op,
          operationId: "downgrade",
          sequence: 2,
          baseRevision: 1,
          command: {
            type: "set_geometry",
            id: "tree",
            geometry: { kind: "asset", assetId: "kenney.nature.tree-default" },
            assetPolicy: "catalog-allowed",
          },
        },
        reserved.cursor,
      ),
    ).toThrow();
  });

  it("accepts an ordered reservation and ignores exact retries", () => {
    const { project, cursor, op } = setup();
    const a = applyOperation(project, op, cursor);
    expect(a.project.entities).toHaveLength(1);
    expect(applyOperation(a.project, op, a.cursor).project).toBe(a.project);
  });
  it("rejects stale revisions, stale runs, and out-of-order records", () => {
    const { project, cursor, op } = setup();
    for (const patch of [
      { baseRevision: 4 },
      { sequence: 3 },
      { runId: "old" },
      { projectId: "other" },
    ])
      expect(() =>
        applyOperation(project, { ...op, ...patch }, cursor),
      ).toThrow();
  });
  it("rejects invalid geometry and references", () => {
    expect(
      commandSchema.safeParse({
        type: "set_transform",
        id: "x",
        position: [Infinity, 0, 0],
      }).success,
    ).toBe(false);
    const { project, cursor, op } = setup();
    expect(() =>
      applyOperation(
        project,
        {
          ...op,
          command: { type: "set_material", id: "missing", color: "#ffffff" },
        },
        cursor,
      ),
    ).toThrow();
  });
  it("removes pending reservations from checkpoints", () => {
    const { project, cursor, op } = setup();
    expect(
      committed(applyOperation(project, op, cursor).project).entities,
    ).toHaveLength(0);
  });
  it("builds both fixtures through the same bounded protocol", () => {
    for (const garden of [false, true]) {
      let { project, cursor } = setup();
      for (const command of fixtureCommands(garden)) {
        const out = applyOperation(
          project,
          {
            version: 1,
            projectId: project.id,
            runId: "run",
            operationId: crypto.randomUUID(),
            sequence: cursor.sequence + 1,
            baseRevision: project.revision,
            command,
          },
          cursor,
        );
        project = out.project;
        cursor = out.cursor;
      }
      expect(project.entities.length).toBeGreaterThan(10);
      expect(project.entities.every((e) => e.stage === "ready")).toBe(true);
      const shared = decodeWorld(encodeWorld(project));
      expect(shared.entities).toEqual(project.entities);
      expect(shared.messages).toEqual([]);
    }
  });
});
it("preserves unrelated object identities during a scoped update", () => {
  const { project, cursor, op } = setup();
  const first = applyOperation(project, op, cursor);
  const entity = first.project.entities[0];
  const second = applyOperation(
    first.project,
    {
      ...op,
      operationId: "op2",
      sequence: 2,
      baseRevision: 1,
      command: { type: "commit_revision", message: "Hello" },
    },
    first.cursor,
  );
  expect(second.project.entities[0]).toBe(entity);
});
it("restores an existing ready object if a refinement stops midway", () => {
  const { project, cursor, op } = setup();
  const first = applyOperation(project, op, cursor);
  const ready = {
    ...first.project,
    entities: first.project.entities.map((e) => ({
      ...e,
      stage: "ready" as const,
    })),
  };
  const pending = {
    ...ready,
    entities: ready.entities.map((e) => ({ ...e, stage: "coarse" as const })),
  };
  expect(committed(pending, ready).entities[0].stage).toBe("ready");
});
const generatedJob = {
  version: 1,
  parts: [{ id: "body", shape: "box", color: "#123456" }],
};
const generatedMetadata = {
  version: 1,
  sha256: "a".repeat(64),
  bytes: 2048,
  source: "local-blender",
  blenderVersion: "4.0.2",
  bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
  createdAt: "2026-09-08T00:00:00Z",
};
it("accepts unresolved generated jobs for validation projection and resolved metadata for persistence", () => {
  const unresolved = generatedGeometrySchema.parse({
    kind: "generated",
    job: generatedJob,
  });
  expect(unresolved.detail).toBe("refined");
  expect(unresolved.model).toBeUndefined();
  expect(unresolved.job.parts[0].scale).toEqual([1, 1, 1]);
  const resolved = generatedGeometrySchema.parse({
    ...unresolved,
    model: generatedMetadata,
    tint: "#ff44aa",
  });
  expect(resolved.model?.sha256).toBe(generatedMetadata.sha256);
  expect(
    commandSchema.parse({
      type: "set_geometry",
      id: "tree",
      geometry: resolved,
    }),
  ).toMatchObject({ geometry: { kind: "generated", tint: "#ff44aa" } });
});
it("rejects invalid generated modeling jobs, metadata, and unknown recipe fields", () => {
  for (const patch of [
    { job: { ...generatedJob, python: "run code" } },
    {
      job: {
        version: 1,
        parts: [
          {
            ...generatedJob.parts[0],
            shape: "mesh",
            vertices: [
              [0, 0, 0],
              [1, 0, 0],
              [0, 1, 0],
            ],
            faces: [[0, 1, 99]],
          },
        ],
      },
    },
    { model: { ...generatedMetadata, sha256: "../../file" } },
    {
      model: {
        ...generatedMetadata,
        bounds: { min: [2, 0, 0], max: [1, 1, 1] },
      },
    },
    { model: { ...generatedMetadata, source: "remote" } },
    { url: "https://example.test/evil.glb" },
    { tint: "red" },
  ])
    expect(
      generatedGeometrySchema.safeParse({
        kind: "generated",
        job: generatedJob,
        ...patch,
      }).success,
    ).toBe(false);
});
it("allows new-only generated geometry and recolors it without replacing its job or metadata", () => {
  const { project, cursor, op } = setup();
  const first = applyOperation(project, op, cursor);
  const geometry = generatedGeometrySchema.parse({
    kind: "generated",
    job: generatedJob,
    model: generatedMetadata,
  });
  const generated = applyOperation(
    first.project,
    {
      ...op,
      operationId: "generated",
      sequence: 2,
      baseRevision: 1,
      command: {
        type: "set_geometry",
        id: "tree",
        assetPolicy: "new-only",
        geometry,
      },
    },
    first.cursor,
  );
  expect(generated.project.entities[0]).toMatchObject({
    stage: "ready",
    assetPolicy: "new-only",
    geometry: { kind: "generated" },
  });
  const tinted = applyOperation(
    generated.project,
    {
      ...op,
      operationId: "tint",
      sequence: 3,
      baseRevision: 2,
      command: { type: "set_material", id: "tree", color: "#ff44aa" },
    },
    generated.cursor,
  );
  expect(tinted.project.entities[0]).toMatchObject({
    color: "#ff44aa",
    assetPolicy: "new-only",
    geometry: { ...geometry, tint: "#ff44aa" },
  });
  expect(() =>
    applyOperation(
      tinted.project,
      {
        ...op,
        operationId: "catalog",
        sequence: 4,
        baseRevision: 3,
        command: {
          type: "set_geometry",
          id: "tree",
          geometry: {
            kind: "asset",
            assetId: "kenney.nature.tree-default",
            detail: "refined",
          },
        },
      },
      tinted.cursor,
    ),
  ).toThrow("new-only");
});
it("allows unresolved generated geometry in the server reducer projection", () => {
  const { project, cursor, op } = setup();
  const reserved = applyOperation(project, op, cursor);
  const geometry = generatedGeometrySchema.parse({
    kind: "generated",
    job: generatedJob,
    detail: "coarse",
  });
  const applied = applyOperation(
    reserved.project,
    {
      ...op,
      operationId: "projected",
      sequence: 2,
      baseRevision: 1,
      command: {
        type: "set_geometry",
        id: "tree",
        assetPolicy: "new-only",
        geometry,
      },
    },
    reserved.cursor,
  );
  expect(applied.project.entities[0]).toMatchObject({
    stage: "coarse",
    assetPolicy: "new-only",
    geometry: { kind: "generated" },
  });
  expect(applied.project.entities[0].geometry).not.toHaveProperty("model");
});
