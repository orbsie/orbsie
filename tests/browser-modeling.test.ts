import { describe, expect, it } from "vitest";
import {
  browserModelRecipeLimits,
  browserModelRecipeSchema,
  parseBrowserModelRecipe,
  replaceBrowserModelRecipeNode,
} from "../src/lib/browser-modeling";

const archRecipe = {
  version: 1,
  revision: 3,
  output: "arch",
  nodes: [
    { id: "outer", kind: "box", size: [6, 4, 2] },
    {
      id: "opening",
      kind: "cylinder",
      radius: 1.25,
      depth: 2,
      axis: "z",
      segments: 48,
    },
    {
      id: "opening-placement",
      kind: "transform",
      input: "opening",
      position: [0, -0.6, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    {
      id: "arch",
      kind: "boolean",
      operation: "subtract",
      operands: ["outer", "opening-placement"],
    },
  ],
} as const;

describe("browser modeling recipe contract", () => {
  it("accepts a centered arch subtraction with canonical units", () => {
    const recipe = parseBrowserModelRecipe(archRecipe);
    expect(recipe.output).toBe("arch");
    expect(recipe.nodes[1]).toMatchObject({
      kind: "cylinder",
      axis: "z",
      segments: 48,
    });
    expect(recipe.nodes[2]).toMatchObject({
      kind: "transform",
      position: [0, -0.6, 0],
      rotation: [0, 0, 0],
    });
  });

  it("accepts a simple concave extrusion profile in either winding", () => {
    const counterClockwise = [
      [-1, -1],
      [1, -1],
      [1, 0],
      [0, 0],
      [0, 1],
      [-1, 1],
    ];
    const clockwise = counterClockwise.slice().reverse();
    for (const profile of [counterClockwise, clockwise]) {
      expect(
        browserModelRecipeSchema.safeParse({
          version: 1,
          revision: 0,
          output: "profile",
          nodes: [{ id: "profile", kind: "extrude", profile, depth: 1.25 }],
        }).success,
      ).toBe(true);
    }
  });

  it("accepts a full revolve profile with a default segment count", () => {
    const recipe = parseBrowserModelRecipe({
      version: 1,
      revision: 0,
      output: "vase",
      nodes: [
        {
          id: "vase",
          kind: "revolve",
          profile: [
            [0, -1],
            [0.5, -1],
            [1.25, -0.4],
            [1.25, 0.3],
            [0.6, 1],
            [0, 1],
          ],
        },
      ],
    });
    expect(recipe.nodes[0]).toMatchObject({
      kind: "revolve",
      segments: 32,
    });
  });

  it("revises a revolve profile while preserving its stable node ID", () => {
    const recipe = parseBrowserModelRecipe({
      version: 1,
      revision: 4,
      output: "vase",
      nodes: [
        {
          id: "vase",
          kind: "revolve",
          profile: [
            [0, -1],
            [0.5, -1],
            [1, 0],
            [0, 1],
          ],
        },
      ],
    });
    const revised = replaceBrowserModelRecipeNode(
      recipe,
      "vase",
      {
        ...recipe.nodes[0],
        profile: [
          [0, -1],
          [0.75, -1],
          [1.5, 0],
          [0, 1],
        ],
      },
      recipe.revision,
    );
    expect(revised.revision).toBe(5);
    expect(revised.nodes[0]).toMatchObject({
      id: "vase",
      kind: "revolve",
      profile: [
        [0, -1],
        [0.75, -1],
        [1.5, 0],
        [0, 1],
      ],
    });
  });

  it("rejects negative radii and invalid revolve polygons with precise issues", () => {
    expect(() =>
      parseBrowserModelRecipe({
        version: 1,
        revision: 0,
        output: "profile",
        nodes: [
          {
            id: "profile",
            kind: "revolve",
            profile: [
              [-0.1, -1],
              [1, -1],
              [1, 1],
              [0, 1],
            ],
          },
        ],
      }),
    ).toThrow("Revolve profile radius must be nonnegative");

    const invalidProfiles = [
      {
        profile: [
          [0, -1],
          [1, -1],
          [1, -1],
          [0, 1],
        ],
        message: "Revolve profile vertices must be distinct",
      },
      {
        profile: [
          [0, 0],
          [4, 3],
          [0, 4],
          [4, 0],
        ],
        message: "Revolve profile must enclose a nonzero area",
      },
      {
        profile: [
          [0, 0],
          [2, 0],
          [1, 0],
          [1, 1],
        ],
        message: "Revolve profile must not backtrack",
      },
      {
        profile: [
          [0, -1],
          [4, 3],
          [0, 4],
          [3, 0],
        ],
        message: "Revolve profile edges must not intersect",
      },
    ];
    for (const { profile, message } of invalidProfiles)
      expect(() =>
        parseBrowserModelRecipe({
          version: 1,
          revision: 0,
          output: "profile",
          nodes: [{ id: "profile", kind: "revolve", profile }],
        }),
      ).toThrow(message);
  });

  it("rejects duplicate, degenerate, self-intersecting, and oversized profiles", () => {
    const invalidProfiles = [
      [
        [-1, -1],
        [1, -1],
        [1, -1],
        [-1, 1],
      ],
      [
        [-1, 0],
        [0, 0],
        [1, 0],
      ],
      [
        [-2, -1],
        [2, 2],
        [-2, 2],
        [2, -1],
        [0, 1],
      ],
      Array.from({ length: 65 }, (_, index) => [index, 0]),
      [
        [-browserModelRecipeLimits.maxCoordinateMeters - 1, 0],
        [0, 1],
        [1, 0],
      ],
    ];
    for (const profile of invalidProfiles)
      expect(
        browserModelRecipeSchema.safeParse({
          version: 1,
          revision: 0,
          output: "profile",
          nodes: [{ id: "profile", kind: "extrude", profile, depth: 1 }],
        }).success,
      ).toBe(false);
  });

  it("replaces one cutter dimension and then its transform immutably", () => {
    const original = parseBrowserModelRecipe(archRecipe);
    const resized = replaceBrowserModelRecipeNode(
      original,
      "opening",
      { ...original.nodes[1], radius: 1.5 },
      original.revision,
    );
    const moved = replaceBrowserModelRecipeNode(
      resized,
      "opening-placement",
      { ...resized.nodes[2], position: [0.4, -0.6, 0], scale: [1, 0.9, 1] },
      resized.revision,
    );

    expect(original.revision).toBe(3);
    expect(original.nodes[1]).toMatchObject({ radius: 1.25 });
    expect(original.nodes[2]).toMatchObject({ position: [0, -0.6, 0] });
    expect(moved.revision).toBe(5);
    expect(moved.nodes[0]).toEqual(original.nodes[0]);
    expect(moved.nodes[3]).toEqual(original.nodes[3]);
    expect(moved.nodes[1]).toMatchObject({ id: "opening", radius: 1.5 });
    expect(moved.nodes[2]).toMatchObject({
      id: "opening-placement",
      input: "opening",
      position: [0.4, -0.6, 0],
      scale: [1, 0.9, 1],
    });
  });

  it("rejects duplicate, missing, cyclic, unreachable, and unknown graph data", () => {
    const cases = [
      {
        ...archRecipe,
        nodes: [...archRecipe.nodes, { ...archRecipe.nodes[0], id: "outer" }],
      },
      {
        ...archRecipe,
        nodes: archRecipe.nodes.map((node) =>
          node.id === "opening-placement"
            ? { ...node, input: "missing" }
            : node,
        ),
      },
      {
        ...archRecipe,
        nodes: [
          {
            id: "a",
            kind: "transform",
            input: "b",
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          {
            id: "b",
            kind: "transform",
            input: "a",
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
        ],
        output: "a",
      },
      {
        ...archRecipe,
        nodes: [
          ...archRecipe.nodes,
          { id: "unused", kind: "sphere", radius: 1 },
        ],
      },
      {
        ...archRecipe,
        nodes: archRecipe.nodes.map((node) =>
          node.id === "outer" ? { ...node, python: "nope" } : node,
        ),
      },
    ];
    for (const value of cases)
      expect(browserModelRecipeSchema.safeParse(value).success).toBe(false);
  });

  it("enforces maximum depth through shared subgraphs", () => {
    const value = {
      version: 1,
      revision: 0,
      output: "result",
      nodes: [
        { id: "shared-base", kind: "box", size: [1, 1, 1] },
        {
          id: "shared-subtree",
          kind: "transform",
          input: "shared-base",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        {
          id: "short",
          kind: "transform",
          input: "shared-subtree",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        ...Array.from({ length: 14 }, (_, index) => ({
          id: `long-${index}`,
          kind: "transform" as const,
          input: index === 13 ? "shared-subtree" : `long-${index + 1}`,
          position: [0, 0, 0] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
        })),
        {
          id: "result",
          kind: "boolean",
          operation: "union",
          operands: ["short", "long-0"],
        },
      ],
    };
    expect(browserModelRecipeSchema.safeParse(value).success).toBe(false);
  });

  it("rejects bounded dimension, coordinate, scale, segment, count, and depth violations", () => {
    const boundedFailures = [
      {
        ...archRecipe,
        nodes: archRecipe.nodes.map((node) =>
          node.id === "outer" ? { ...node, size: [0, 1, 1] } : node,
        ),
      },
      {
        ...archRecipe,
        nodes: archRecipe.nodes.map((node) =>
          node.id === "opening"
            ? { ...node, segments: browserModelRecipeLimits.maxSegments + 1 }
            : node,
        ),
      },
      {
        ...archRecipe,
        nodes: archRecipe.nodes.map((node) =>
          node.id === "opening-placement"
            ? { ...node, scale: [1, 0, 1] }
            : node,
        ),
      },
      {
        ...archRecipe,
        nodes: archRecipe.nodes.map((node) =>
          node.id === "opening-placement"
            ? {
                ...node,
                position: [
                  browserModelRecipeLimits.maxCoordinateMeters + 1,
                  0,
                  0,
                ],
              }
            : node,
        ),
      },
      {
        ...archRecipe,
        nodes: archRecipe.nodes.map((node) =>
          node.id === "opening-placement"
            ? {
                ...node,
                rotation: [
                  browserModelRecipeLimits.maxRotationRadians + 1,
                  0,
                  0,
                ],
              }
            : node,
        ),
      },
      {
        ...archRecipe,
        nodes: Array.from({ length: 65 }, (_, index) => ({
          id: `box-${index}`,
          kind: "box",
          size: [1, 1, 1],
        })),
        output: "box-0",
      },
    ];
    for (const value of boundedFailures)
      expect(browserModelRecipeSchema.safeParse(value).success).toBe(false);

    const deepNodes = [
      { id: "box", kind: "box", size: [1, 1, 1] },
      ...Array.from(
        { length: browserModelRecipeLimits.maxDepth },
        (_, index) => ({
          id: `transform-${index}`,
          kind: "transform" as const,
          input: index === 0 ? "box" : `transform-${index - 1}`,
          position: [0, 0, 0] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
        }),
      ),
    ];
    expect(
      browserModelRecipeSchema.safeParse({
        version: 1,
        revision: 0,
        output: `transform-${browserModelRecipeLimits.maxDepth - 1}`,
        nodes: deepNodes,
      }).success,
    ).toBe(false);
  });

  it("accepts bounded twist and taper deformations and rejects out-of-range values", () => {
    const deformationRecipe = {
      version: 1,
      revision: 0,
      output: "tapered",
      nodes: [
        { id: "column", kind: "box", size: [1, 3, 2] },
        { id: "twisted", kind: "twist", input: "column", angle: 0.35 },
        {
          id: "tapered",
          kind: "taper",
          input: "twisted",
          bottomScale: 1,
          topScale: 1.25,
        },
      ],
    };
    const parsed = parseBrowserModelRecipe(deformationRecipe);
    expect(parsed.nodes[1]).toMatchObject({ kind: "twist", angle: 0.35 });
    expect(parsed.nodes[2]).toMatchObject({
      kind: "taper",
      bottomScale: 1,
      topScale: 1.25,
    });
    expect(
      browserModelRecipeSchema.safeParse({
        ...deformationRecipe,
        nodes: deformationRecipe.nodes.map((node) =>
          node.id === "twisted"
            ? { ...node, angle: browserModelRecipeLimits.maxTwistAngle }
            : node.id === "tapered"
              ? {
                  ...node,
                  bottomScale: browserModelRecipeLimits.minDeformationScale,
                  topScale: browserModelRecipeLimits.maxDeformationScale,
                }
              : node,
        ),
      }).success,
    ).toBe(true);

    const invalidRecipes = [
      {
        ...deformationRecipe,
        nodes: deformationRecipe.nodes.map((node) =>
          node.id === "twisted" ? { ...node, angle: 1.6 } : node,
        ),
      },
      {
        ...deformationRecipe,
        nodes: deformationRecipe.nodes.map((node) =>
          node.id === "twisted" ? { ...node, angle: -1.6 } : node,
        ),
      },
      {
        ...deformationRecipe,
        nodes: deformationRecipe.nodes.map((node) =>
          node.id === "tapered" ? { ...node, topScale: 0 } : node,
        ),
      },
      {
        ...deformationRecipe,
        nodes: deformationRecipe.nodes.map((node) =>
          node.id === "tapered" ? { ...node, bottomScale: 4.1 } : node,
        ),
      },
      {
        ...deformationRecipe,
        nodes: deformationRecipe.nodes.map((node) =>
          node.id === "tapered" ? { ...node, input: "missing" } : node,
        ),
      },
    ];
    for (const recipe of invalidRecipes)
      expect(browserModelRecipeSchema.safeParse(recipe).success).toBe(false);
  });

  it("rejects stale revisions and replacements that change the stable ID", () => {
    const recipe = parseBrowserModelRecipe(archRecipe);
    expect(() =>
      replaceBrowserModelRecipeNode(
        recipe,
        "opening",
        { ...recipe.nodes[1], radius: 1.5 },
        recipe.revision - 1,
      ),
    ).toThrow(/stale/);
    expect(() =>
      replaceBrowserModelRecipeNode(
        recipe,
        "opening",
        { ...recipe.nodes[1], id: "different" },
        recipe.revision,
      ),
    ).toThrow(/preserve node ID/);
  });
});
