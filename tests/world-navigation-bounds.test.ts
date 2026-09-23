import { describe, expect, it } from "vitest";
import { entitySchema, groupSchema, type Project } from "../src/lib/protocol";
import {
  committedWorldNavigationBounds,
  worldNavigationBoundsByEntity,
} from "../src/lib/world-navigation-bounds";

function project(
  entities: Project["entities"],
  groups: NonNullable<Project["groups"]> = [],
): Project {
  return {
    version: 1,
    id: "bounds-fixture",
    title: "Bounds fixture",
    seed: 1,
    revision: 1,
    entities,
    groups,
    environment: { sky: "#ffffff", ground: "#ffffff", water: "#ffffff" },
    messages: [],
  };
}

function entity(
  id: string,
  stage: "seed" | "coarse" | "ready",
  position: [number, number, number],
  parentId?: string,
  behavior?: { type: "move"; axis?: "x" | "y" | "z"; amplitude?: number },
) {
  return entitySchema.parse({
    id,
    label: id,
    position,
    parentId,
    stage,
    behavior,
    geometry: {
      kind: "custom",
      detail: "refined",
      parts: [
        {
          shape: "box",
          position: [0, 0, 0],
          scale: [1, 1, 1],
          rotation: [0, 0, 0],
          color: "#ffffff",
        },
      ],
    },
  });
}

describe("world navigation bounds by entity", () => {
  it("resolves ready, coarse, and seed bounds through nested far groups", () => {
    const scene = project(
      [
        entity("ready-leaf", "ready", [8, 0, 0], "inner"),
        entity("coarse-leaf", "coarse", [0, 0, 0], "outer"),
        entity("seed-root", "seed", [1_000_000, 0, -1_000_000]),
      ],
      [
        groupSchema.parse({
          id: "outer",
          label: "Outer",
          position: [900_000, 5, -800_000],
          scale: [2, 1, 1],
        }),
        groupSchema.parse({
          id: "inner",
          label: "Inner",
          parentId: "outer",
          position: [50_000, 0, -20_000],
          scale: [1, 1, 1],
        }),
      ],
    );

    const all = worldNavigationBoundsByEntity(scene);
    expect([...all.keys()]).toEqual(["ready-leaf", "coarse-leaf", "seed-root"]);
    expect(all.get("ready-leaf")?.min[0]).toBeCloseTo(1_000_015);
    expect(all.get("ready-leaf")?.max[2]).toBeCloseTo(-819_999.5);
    expect(all.get("coarse-leaf")?.min[0]).toBeCloseTo(899_999);
    expect(all.get("seed-root")?.max[0]).toBeCloseTo(1_000_000.5);

    const committed = committedWorldNavigationBounds(scene);
    expect(committed).toHaveLength(1);
    expect(committed[0]).toEqual(all.get("ready-leaf"));
  });

  it("keeps moving-entity visibility bounds conservative without changing frame bounds", () => {
    const moving = entity("mover", "ready", [123_000, 4, -98_000], undefined, {
      type: "move",
      axis: "x",
      amplitude: 3,
    });
    const scene = project([moving]);
    const visibilityBounds = worldNavigationBoundsByEntity(scene).get("mover")!;
    const frameBounds = committedWorldNavigationBounds(scene)[0];

    expect(visibilityBounds.min[0]).toBeCloseTo(frameBounds.min[0] - 3);
    expect(visibilityBounds.max[0]).toBeCloseTo(frameBounds.max[0] + 3);
    expect(visibilityBounds.min[1]).toBe(frameBounds.min[1]);
    expect(frameBounds.min[0]).toBeCloseTo(122_999.5);
    expect(frameBounds.max[0]).toBeCloseTo(123_000.5);
  });

  it("retains an unknown entry for every entity when its scene graph is invalid", () => {
    const invalid = project([
      entity("kept-a", "seed", [0, 0, 0]),
      entity("kept-b", "ready", [10, 0, 0], "missing-parent"),
    ]);

    const all = worldNavigationBoundsByEntity(invalid);
    expect([...all.entries()]).toEqual([
      ["kept-a", undefined],
      ["kept-b", undefined],
    ]);
    expect(committedWorldNavigationBounds(invalid)).toEqual([]);
  });
});
