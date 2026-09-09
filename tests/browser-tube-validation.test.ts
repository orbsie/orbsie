import { describe, expect, it } from "vitest";
import Module from "manifold-3d";
import {
  browserModelRecipeSchema,
  parseBrowserModelRecipe,
  replaceBrowserModelRecipeNode,
} from "../src/lib/browser-modeling";
import {
  browserTubeMeshCounts,
  validateBrowserTube,
} from "../src/lib/browser-tube-validation";
import { evaluateBrowserModelRecipe } from "../src/lib/browser-modeling-kernel";

const straightPath = [
  [0, 0, 0],
  [0, 3, 0],
] as [number, number, number][];
const bentPath = [
  [0, 0, 0],
  [0, 2, 0],
  [2, 2, 0],
  [2, 3, 1],
] as [number, number, number][];
const nonplanarPath = [
  [0, 0, 0],
  [1, 1, 0],
  [1, 2, 1],
  [2, 3, 1],
] as [number, number, number][];

function tubeRecipe(path = straightPath, segments = 16) {
  return parseBrowserModelRecipe({
    version: 1,
    revision: 0,
    output: "tube",
    nodes: [
      {
        id: "tube",
        kind: "tube",
        path,
        radius: 0.25,
        segments,
      },
    ],
  });
}

function manifoldKernel(wasm: Awaited<ReturnType<typeof Module>>) {
  return {
    cube: (size: readonly [number, number, number], center: boolean) =>
      wasm.Manifold.cube(size, center),
    sphere: (radius: number, segments: number) =>
      wasm.Manifold.sphere(radius, segments),
    cylinder: (
      depth: number,
      radiusLow: number,
      radiusHigh: number,
      segments: number,
      center: boolean,
    ) => wasm.Manifold.cylinder(depth, radiusLow, radiusHigh, segments, center),
    extrude: (profile: [number, number][], depth: number) =>
      wasm.Manifold.extrude(profile, depth),
    revolve: (profile: [number, number][], segments: number, degrees: number) =>
      wasm.Manifold.revolve(profile, segments, degrees),
    mesh: (vertices: Float32Array, triangles: Uint32Array) =>
      wasm.Manifold.ofMesh(
        new wasm.Mesh({
          numProp: 3,
          vertProperties: vertices,
          triVerts: triangles,
        }),
      ),
  };
}

describe("browser tube validation", () => {
  it("builds bounded straight, bent, and nonplanar tubes", async () => {
    const wasm = await Module();
    wasm.setup();
    for (const path of [straightPath, bentPath, nonplanarPath]) {
      const result = evaluateBrowserModelRecipe(
        tubeRecipe(path),
        manifoldKernel(wasm),
      );
      const counts = browserTubeMeshCounts(path.length, 16);
      expect(result.statistics.vertices).toBe(counts.vertices);
      expect(result.statistics.triangles).toBe(counts.triangles);
      expect(result.bounds.min.every((value) => value >= -100)).toBe(true);
      expect(result.bounds.max.every((value) => value <= 100)).toBe(true);
      if (path === straightPath) {
        expect(result.bounds.min).toEqual([-0.25, 0, -0.25]);
        expect(result.bounds.max).toEqual([0.25, 3, 0.25]);
      }
    }
  });

  it("keeps frame construction deterministic and accepts the default segment count", () => {
    const recipe = parseBrowserModelRecipe({
      version: 1,
      revision: 0,
      output: "tube",
      nodes: [{ id: "tube", kind: "tube", path: straightPath, radius: 0.25 }],
    });
    expect(recipe.nodes[0]).toMatchObject({ segments: 16 });
    const first = validateBrowserTube(straightPath, 0.25, 16);
    const second = validateBrowserTube(straightPath, 0.25, 16);
    expect(first.vertices).toEqual(second.vertices);
    expect(first.triangles).toEqual(second.triangles);
  });

  it("rejects duplicate, degenerate, reversing, out-of-bounds, and self-overlapping paths", () => {
    const invalidPaths = [
      [straightPath[0], straightPath[0]],
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 0, 0],
      ],
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 0, 0.00001],
      ],
      [
        [-2, 0, 0],
        [2, 0, 2],
        [-2, 0, 2],
        [2, 0, 0],
      ],
      [
        [0, 0, 0],
        [101, 0, 0],
      ],
    ] as [number, number, number][][];
    for (const path of invalidPaths)
      expect(() => validateBrowserTube(path, 0.25, 16)).toThrow(
        "Browser mesh is invalid",
      );
    expect(() => validateBrowserTube(straightPath, 1e-4, 16)).toThrow();
    expect(() => validateBrowserTube(straightPath, 0.25, 2)).toThrow();
    expect(() => validateBrowserTube(straightPath, 0.25, 65)).toThrow();
  });

  it("rejects derived tube budgets and unsupported extra fields", () => {
    const longPath = Array.from(
      { length: 63 },
      (_, index) => [index - 31, 0, 0] as [number, number, number],
    );
    const nodes = ["a", "b", "c"].map((id) => ({
      id,
      kind: "tube" as const,
      path: longPath,
      radius: 0.25,
      segments: 64,
    }));
    expect(
      browserModelRecipeSchema.safeParse({
        version: 1,
        revision: 0,
        output: "join",
        nodes: [
          ...nodes,
          {
            id: "join",
            kind: "boolean",
            operation: "union",
            operands: ["a", "b", "c"],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      browserModelRecipeSchema.safeParse({
        version: 1,
        revision: 0,
        output: "tube",
        nodes: [
          {
            id: "tube",
            kind: "tube",
            path: straightPath,
            radius: 0.25,
            segments: 16,
            closed: false,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("preserves the stable node ID while revising a tube path", () => {
    const recipe = tubeRecipe();
    const revised = replaceBrowserModelRecipeNode(
      recipe,
      "tube",
      { ...recipe.nodes[0], path: bentPath, radius: 0.4 },
      recipe.revision,
    );
    expect(revised.revision).toBe(1);
    expect(revised.nodes[0]).toMatchObject({ id: "tube", radius: 0.4 });
  });
});
