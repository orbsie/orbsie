import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { assertInputGameProject } from "../scripts/provider-browser-e2e.mjs";
import {
  blankProject,
  generatedGeometrySchema,
  projectSchema,
  type GeometryRecipe,
  type Project,
} from "../src/lib/protocol";

const browserGeometry = generatedGeometrySchema.parse({
  kind: "generated",
  detail: "refined",
  job: {
    backend: "browser-manifold",
    recipe: {
      version: 1,
      revision: 0,
      output: "body",
      nodes: [{ id: "body", kind: "box", size: [1, 1, 1] }],
    },
  },
  model: {
    version: 1,
    sha256: "a".repeat(64),
    bytes: 1024,
    source: "browser-manifold",
    kernelVersion: "3.3.2",
    bounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
    createdAt: "2026-09-10T00:00:00.000Z",
  },
});
const browserProceduralSource = {
  version: 1 as const,
  language: "quickjs" as const,
  code: `({version:1,revision:0,output:"body",nodes:[{id:"body",kind:"box",size:[1,1,1]}]})`,
  seed: 7,
};
const browserProceduralGeometry = generatedGeometrySchema.parse({
  ...browserGeometry,
  job: {
    ...browserGeometry.job,
    authoring: {
      source: browserProceduralSource,
      sourceHash: createHash("sha256")
        .update(JSON.stringify(browserProceduralSource), "utf8")
        .digest("hex"),
    },
  },
});
const browserProceduralJob = browserProceduralGeometry.job as Extract<
  typeof browserProceduralGeometry.job,
  { backend: "browser-manifold" }
>;

const game = {
  variables: [],
  rules: [
    {
      id: "right-score",
      trigger: { type: "input" as const, action: "right" as const },
      conditions: [],
      actions: [{ type: "add_score" as const, amount: 7 }],
    },
    {
      id: "up-win",
      trigger: { type: "input" as const, action: "up" as const },
      conditions: [],
      actions: [{ type: "win" as const }],
    },
    {
      id: "left-lose",
      trigger: { type: "input" as const, action: "left" as const },
      conditions: [],
      actions: [{ type: "lose" as const }],
    },
  ],
};

function projectWith(
  geometries: [GeometryRecipe, GeometryRecipe],
  stage: "seed" | "coarse" | "ready" = "ready",
): Project {
  const project = blankProject();
  project.entities = [
    {
      id: "tree",
      label: "Original tree",
      position: [-1, 0, 0],
      scale: [1, 1, 1],
      color: "#6ead60",
      stage,
      geometry: geometries[0],
    },
    {
      id: "mushroom",
      label: "Original mushroom",
      position: [1, 0, 0],
      scale: [1, 1, 1],
      color: "#d18e5a",
      stage,
      geometry: geometries[1],
    },
  ];
  project.game = game;
  return project;
}

function assertInputGame(project: Project) {
  return assertInputGameProject(
    project,
    "Input game project",
    (value: unknown) => projectSchema.safeParse(value).success,
  );
}

describe("input-game provider acceptance", () => {
  it("accepts the existing procedural tree and mushroom geometry", () => {
    const project = projectWith([
      { kind: "tree", detail: "refined" },
      { kind: "mushroom", detail: "refined" },
    ]);

    expect(() => assertInputGame(project)).not.toThrow();
  });

  it("accepts trusted baked browser-manifold geometry", () => {
    const project = projectWith([browserGeometry, browserProceduralGeometry]);

    expect(() => assertInputGame(project)).not.toThrow();
  });

  it.each([
    {
      name: "a catalog asset",
      geometries: [
        {
          kind: "asset",
          assetId: "kenney.nature.tree-default",
          detail: "refined",
        },
        { kind: "mushroom", detail: "refined" },
      ],
    },
    {
      name: "an unbaked browser model",
      geometries: [
        {
          kind: "generated",
          detail: "refined",
          job: browserGeometry.job,
        },
        { kind: "mushroom", detail: "refined" },
      ],
    },
    {
      name: "a native companion model",
      geometries: [
        {
          kind: "generated",
          detail: "refined",
          job: {
            version: 1,
            parts: [{ id: "body", shape: "box", color: "#ffffff" }],
          },
          model: {
            ...browserGeometry.model,
            source: "local-blender",
            blenderVersion: "4.0.2",
            kernelVersion: undefined,
          },
        },
        { kind: "mushroom", detail: "refined" },
      ],
    },
    {
      name: "an arbitrary remote model URL",
      geometries: [
        {
          ...browserGeometry,
          url: "https://example.test/tree.glb",
        },
        { kind: "mushroom", detail: "refined" },
      ],
    },
    {
      name: "mismatched procedural source provenance",
      geometries: [
        {
          ...browserProceduralGeometry,
          job: {
            ...browserProceduralGeometry.job,
            authoring: {
              ...browserProceduralJob.authoring,
              sourceHash: "b".repeat(64),
            },
          },
        },
        { kind: "mushroom", detail: "refined" },
      ],
    },
  ])("rejects $name", ({ geometries }) => {
    expect(() => assertInputGame(projectWith(geometries as never))).toThrow();
  });

  it("rejects unfinished geometry while retaining the game contract", () => {
    expect(() =>
      assertInputGame(
        projectWith(
          [
            { kind: "tree", detail: "refined" },
            { kind: "mushroom", detail: "refined" },
          ],
          "coarse",
        ),
      ),
    ).toThrow(/unfinished geometry/);

    const invalidGame = structuredClone(
      projectWith([
        { kind: "tree", detail: "refined" },
        { kind: "mushroom", detail: "refined" },
      ]),
    );
    invalidGame.game!.rules[0].actions[0] = { type: "add_score", amount: 8 };
    expect(() => assertInputGame(invalidGame)).toThrow(/7|deep-equal/);
  });
});
