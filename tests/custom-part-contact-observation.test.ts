import { describe, expect, it } from "vitest";
import {
  blankProject,
  type Entity,
  type ProceduralGeometryRecipe,
} from "../src/lib/protocol";
import { observeCustomPartContact } from "../src/lib/server/custom-part-contact-observation";

function mushroomParts(): NonNullable<ProceduralGeometryRecipe["parts"]> {
  return [
    {
      shape: "cylinder",
      position: [0, 0.38, 0],
      scale: [0.24, 0.4, 0.24],
      color: "#fff0df",
    },
    {
      shape: "lathe",
      position: [0, 0.94, 0],
      scale: [0.85, 0.48, 0.85],
      color: "#f274b8",
      profile: [
        [0, 0],
        [0.55, 0],
        [0.95, 0.1],
        [1, 0.22],
        [0.88, 0.34],
        [0.55, 0.47],
        [0, 0.48],
      ],
    },
    {
      shape: "sphere",
      position: [-0.34, 1.13, 0.47],
      scale: [0.12, 0.06, 0.12],
      color: "#fff4e8",
    },
    {
      shape: "sphere",
      position: [0.31, 1.16, 0.5],
      scale: [0.09, 0.05, 0.09],
      color: "#fff4e8",
    },
  ];
}

function customEntity(id: string, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    label: `private label ${id}`,
    position: [0, 0.2, 0],
    scale: [2, 2, 2],
    color: "#34765c",
    geometry: {
      kind: "custom",
      detail: "refined",
      parts: mushroomParts(),
    },
    stage: "ready",
    ...overrides,
  };
}

describe("observeCustomPartContact", () => {
  it("reports the rounded 0.72 m cap-to-stem vertical gap", () => {
    const project = blankProject();
    project.entities = [customEntity("mushroom")];

    expect(observeCustomPartContact(project, "mushroom").observations).toEqual([
      {
        entityId: "mushroom",
        status: "observed",
        parts: [
          { index: 1, shape: "lathe" },
          { index: 0, shape: "cylinder" },
        ],
        gapMeters: 0.72,
      },
    ]);
  });

  it("reports zero for bounds that meet at their Y edges", () => {
    const project = blankProject();
    project.entities = [
      customEntity("touching", {
        position: [0, 0, 0],
        scale: [1, 1, 1],
        geometry: {
          kind: "custom",
          detail: "refined",
          parts: [
            {
              shape: "cylinder",
              position: [0, 0.25, 0],
              scale: [0.5, 0.5, 0.5],
              color: "#fff0df",
            },
            {
              shape: "lathe",
              position: [0, 0.5, 0],
              scale: [1, 1, 1],
              color: "#f274b8",
              profile: [
                [0, 0],
                [1, 0],
                [1, 0.5],
                [0, 0.5],
              ],
            },
          ],
        },
      }),
    ];

    expect(observeCustomPartContact(project).observations[0]).toMatchObject({
      status: "observed",
      gapMeters: 0,
    });
  });

  it("does not claim a gap measurement when a part is rotated", () => {
    const project = blankProject();
    project.entities = [
      customEntity("rotated-part", {
        geometry: {
          kind: "custom",
          detail: "refined",
          parts: [
            {
              shape: "cylinder",
              position: [0, 0.38, 0],
              scale: [0.24, 0.4, 0.24],
              rotation: [0, 0.1, 0],
              color: "#fff0df",
            },
            {
              shape: "lathe",
              position: [0, 0.94, 0],
              scale: [0.85, 0.48, 0.85],
              color: "#f274b8",
              profile: [
                [0, 0],
                [1, 0],
                [1, 0.48],
                [0, 0.48],
              ],
            },
          ],
        },
      }),
    ];

    expect(observeCustomPartContact(project).observations[0]).toMatchObject({
      status: "inconclusive",
      reason: "part-rotation",
    });
  });

  it("prioritizes the selected entity, caps observations, and omits labels", () => {
    const project = blankProject();
    project.entities = [
      customEntity("a"),
      customEntity("b"),
      customEntity("c"),
      customEntity("selected"),
    ];

    const observation = observeCustomPartContact(project, "selected");
    expect(observation.observations.map((entry) => entry.entityId)).toEqual([
      "selected",
      "a",
      "b",
    ]);
    expect(observation.observations).toHaveLength(3);
    expect(JSON.stringify(observation)).not.toContain("private label");
  });

  const unsupportedTransforms: [string, Partial<Entity>][] = [
    ["parent", { parentId: "group-1" }],
    ["rotation", { rotation: [0, 0.1, 0] }],
  ];
  it.each(unsupportedTransforms)(
    "marks unsupported %s transforms inconclusive",
    (name, transform) => {
      const project = blankProject();
      project.entities = [customEntity("mushroom", transform)];

      expect(observeCustomPartContact(project).observations[0]).toMatchObject({
        status: "inconclusive",
        reason: name === "parent" ? "parent-transform" : "entity-rotation",
      });
      expect(
        observeCustomPartContact(project).observations[0],
      ).not.toHaveProperty("gapMeters");
    },
  );
});
