import { describe, expect, it } from "vitest";
import {
  applyOperation,
  blankProject,
  commandSchema,
  committed,
  modelCommandSchemaForCapabilities,
  projectSchema,
  type Command,
  type Cursor,
  type Entity,
  type Group,
  type Project,
} from "../src/lib/protocol";
import { encodeWorld, decodeWorld } from "../src/lib/export";
import { resolveSceneTransforms } from "../src/lib/scene-transform";

function entity(id: string, overrides: Record<string, unknown> = {}): Entity {
  return {
    id,
    label: id,
    position: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#6ead60",
    stage: "ready",
    geometry: { kind: "tree", detail: "refined" },
    ...overrides,
  } as Entity;
}

function group(id: string, overrides: Record<string, unknown> = {}): Group {
  return {
    id,
    label: id,
    position: [0, 0, 0],
    scale: [1, 1, 1],
    ...overrides,
  } as Group;
}

function operation(
  project: Project,
  cursor: Cursor,
  command: Command,
  operationId = `op-${cursor.sequence + 1}`,
) {
  return applyOperation(
    project,
    {
      version: 1,
      projectId: project.id,
      runId: cursor.runId,
      operationId,
      sequence: cursor.sequence + 1,
      baseRevision: project.revision,
      command,
    },
    cursor,
  );
}

function start() {
  return {
    project: blankProject(),
    cursor: { runId: "hierarchy", sequence: 0, seen: new Set<string>() },
  } satisfies { project: Project; cursor: Cursor };
}

describe("scene hierarchy protocol", () => {
  it("keeps new fields omitted when decoding a flat project", () => {
    const parsed = projectSchema.parse({
      ...blankProject(),
      entities: [entity("leaf")],
    });
    expect(parsed).not.toHaveProperty("groups");
    expect(parsed.entities[0]).not.toHaveProperty("rotation");
    expect(parsed.entities[0]).not.toHaveProperty("parentId");
  });

  it("validates the shared graph at the project boundary", () => {
    const invalidProjects = [
      {
        groups: [group("a"), group("a")],
        entities: [],
      },
      {
        groups: [group("a", { parentId: "missing" })],
        entities: [],
      },
      {
        groups: [group("a", { parentId: "b" }), group("b", { parentId: "a" })],
        entities: [],
      },
      {
        groups: [group("a", { scale: [1, 0, 1] })],
        entities: [],
      },
      {
        groups: [group("a")],
        entities: [entity("a")],
      },
      {
        groups: [],
        entities: [entity("leaf", { parentId: "missing" })],
      },
    ];
    for (const scene of invalidProjects)
      expect(
        projectSchema.safeParse({ ...blankProject(), ...scene }).success,
      ).toBe(false);

    const tooDeep = Array.from({ length: 33 }, (_, index) =>
      group(`g${index}`, index ? { parentId: `g${index - 1}` } : {}),
    );
    expect(
      projectSchema.safeParse({
        ...blankProject(),
        groups: tooDeep,
        entities: [],
      }).success,
    ).toBe(false);
  });

  it("creates, transforms, reparents, and removes groups atomically", () => {
    let { project, cursor } = start();
    ({ project, cursor } = operation(project, cursor, {
      type: "create_group",
      group: group("parent", { position: [1, 0, 3] }),
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "create_group",
      group: group("other", { position: [10, 0, 0] }),
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "reserve_entity",
      entity: entity("leaf", {
        stage: "seed",
        geometry: undefined,
        position: [2, 0, 0],
      }),
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "set_parent",
      id: "leaf",
      parentId: "parent",
      keepWorldTransform: false,
    }));
    expect(
      resolveSceneTransforms(project).entities.get("leaf")?.worldPosition,
    ).toEqual([3, 0, 3]);

    ({ project, cursor } = operation(project, cursor, {
      type: "set_group_transform",
      id: "parent",
      position: [5, 0, 3],
      rotation: [0, Math.PI / 2, 0],
      scale: [2, 2, 2],
    }));
    expect(project.groups?.find((g) => g.id === "parent")).toMatchObject({
      position: [5, 0, 3],
      rotation: [0, Math.PI / 2, 0],
      scale: [2, 2, 2],
    });
    expect(() =>
      operation(project, cursor, { type: "remove_group", id: "parent" }),
    ).toThrow(/children/i);
    expect(project.revision).toBe(5);

    ({ project, cursor } = operation(project, cursor, {
      type: "set_parent",
      id: "leaf",
      parentId: null,
      keepWorldTransform: false,
    }));
    ({ project } = operation(project, cursor, {
      type: "remove_group",
      id: "parent",
    }));
    expect(project.groups?.map((g) => g.id)).toEqual(["other"]);
  });

  it("preserves local and world reparenting modes", () => {
    let { project, cursor } = start();
    ({ project, cursor } = operation(project, cursor, {
      type: "create_group",
      group: group("a", { position: [10, 0, 0] }),
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "create_group",
      group: group("b", { position: [20, 0, 0] }),
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "reserve_entity",
      entity: entity("leaf", {
        stage: "seed",
        geometry: undefined,
        position: [1, 0, 0],
      }),
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "set_parent",
      id: "leaf",
      parentId: "a",
      keepWorldTransform: false,
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "set_parent",
      id: "leaf",
      parentId: "b",
      keepWorldTransform: false,
    }));
    let scene = resolveSceneTransforms(project);
    expect(project.entities[0].position).toEqual([1, 0, 0]);
    expect(scene.entities.get("leaf")?.worldPosition).toEqual([21, 0, 0]);

    ({ project, cursor } = operation(project, cursor, {
      type: "set_parent",
      id: "leaf",
      parentId: "a",
      keepWorldTransform: true,
    }));
    scene = resolveSceneTransforms(project);
    expect(scene.entities.get("leaf")?.worldPosition).toEqual([21, 0, 0]);
    expect(project.entities[0].position).toEqual([11, 0, 0]);
  });

  it("rejects missing parents, cycles, and shear without changing state", () => {
    let { project, cursor } = start();
    ({ project, cursor } = operation(project, cursor, {
      type: "create_group",
      group: group("a"),
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "create_group",
      group: group("b", { rotation: [0, Math.PI / 4, 0], scale: [2, 1, 3] }),
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "reserve_entity",
      entity: entity("leaf", { stage: "seed", geometry: undefined }),
    }));
    const beforeMissing = structuredClone(project);
    const cursorBeforeMissing = {
      ...cursor,
      seen: new Set(cursor.seen),
    };
    expect(() =>
      operation(project, cursor, {
        type: "set_parent",
        id: "leaf",
        parentId: "missing",
        keepWorldTransform: false,
      }),
    ).toThrow(/missing|group/i);
    expect(project).toEqual(beforeMissing);
    expect(cursor).toEqual(cursorBeforeMissing);

    ({ project, cursor } = operation(project, cursor, {
      type: "set_parent",
      id: "a",
      parentId: "b",
      keepWorldTransform: false,
    }));
    const beforeCycle = structuredClone(project);
    const cursorBeforeCycle = { ...cursor, seen: new Set(cursor.seen) };
    expect(() =>
      operation(project, cursor, {
        type: "set_parent",
        id: "b",
        parentId: "a",
        keepWorldTransform: false,
      }),
    ).toThrow(/cycle/i);
    expect(project).toEqual(beforeCycle);
    expect(cursor).toEqual(cursorBeforeCycle);

    // The parent has a rotated nonuniform scale. Keeping the root entity's
    // world matrix would require a sheared local transform.
    const beforeShear = structuredClone(project);
    const cursorBeforeShear = { ...cursor, seen: new Set(cursor.seen) };
    expect(() =>
      operation(project, cursor, {
        type: "set_parent",
        id: "leaf",
        parentId: "b",
        keepWorldTransform: true,
      }),
    ).toThrow(/shear|represent/i);
    expect(project).toEqual(beforeShear);
    expect(cursor).toEqual(cursorBeforeShear);
  });

  it("advertises integrated hierarchy through the model schema", () => {
    expect(
      commandSchema.safeParse({
        type: "set_transform",
        id: "leaf",
        rotation: [0, 0.5, 0],
      }).success,
    ).toBe(true);
    const advertised = modelCommandSchemaForCapabilities(false, false);
    const reservation = entity("leaf", { rotation: [0, 0.5, 0] });
    delete reservation.geometry;
    expect(
      advertised.safeParse({
        type: "set_transform",
        id: "leaf",
        rotation: [0, 0.5, 0],
      }).success,
    ).toBe(true);
    expect(
      advertised.safeParse({
        type: "reserve_entity",
        entity: reservation,
      }).success,
    ).toBe(true);
    expect(
      advertised.safeParse({
        type: "create_group",
        group: group("g"),
      }).success,
    ).toBe(true);
  });

  it("recovers ready geometry while retaining the current valid hierarchy", () => {
    let { project, cursor } = start();
    ({ project, cursor } = operation(project, cursor, {
      type: "create_group",
      group: group("a"),
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "create_group",
      group: group("b", { position: [10, 0, 0] }),
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "reserve_entity",
      entity: entity("child", {
        stage: "seed",
        geometry: undefined,
        position: [1, 0, 0],
        assetPolicy: "new-only",
      }),
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "set_parent",
      id: "child",
      parentId: "a",
      keepWorldTransform: false,
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "set_geometry",
      id: "child",
      geometry: { kind: "tree", detail: "refined" },
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "reserve_entity",
      entity: entity("unrelated", {
        stage: "seed",
        geometry: undefined,
        position: [7, 0, 0],
      }),
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "set_geometry",
      id: "unrelated",
      geometry: { kind: "tree", detail: "refined" },
    }));
    const baseline = structuredClone(project);

    ({ project, cursor } = operation(project, cursor, {
      type: "set_geometry",
      id: "child",
      geometry: { kind: "tree", detail: "coarse" },
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "set_parent",
      id: "child",
      parentId: "b",
      keepWorldTransform: false,
    }));
    ({ project, cursor } = operation(project, cursor, {
      type: "remove_group",
      id: "a",
    }));
    ({ project } = operation(project, cursor, {
      type: "set_transform",
      id: "unrelated",
      position: [8, 0, 0],
    }));
    const checkpoint = committed(project, baseline);
    expect(checkpoint.groups?.map((g) => g.id)).toEqual(["b"]);
    expect(checkpoint.entities[0]).toMatchObject({
      parentId: "b",
      position: [1, 0, 0],
      stage: "ready",
      geometry: baseline.entities[0].geometry,
      color: baseline.entities[0].color,
      assetPolicy: "new-only",
    });
    expect(checkpoint.entities[1].position).toEqual([8, 0, 0]);
    expect(() => projectSchema.parse(checkpoint)).not.toThrow();
  });

  it("round-trips hierarchy through world encoding", () => {
    const project = projectSchema.parse({
      ...blankProject(),
      groups: [
        group("outer", { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3] }),
        group("inner", { parentId: "outer", scale: [2, 2, 2] }),
      ],
      entities: [
        entity("leaf", {
          parentId: "inner",
          position: [4, 0, 0],
          rotation: [0, 0.5, 0],
        }),
      ],
    });
    const decoded = decodeWorld(encodeWorld(project));
    expect(decoded.groups).toEqual(project.groups);
    expect(decoded.entities).toEqual(project.entities);
  });
});
