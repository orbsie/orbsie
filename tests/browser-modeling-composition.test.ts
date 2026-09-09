import { describe, expect, it } from "vitest";
import Module from "manifold-3d";
import {
  browserModelRecipeSchema,
  parseBrowserModelRecipe,
  replaceBrowserModelRecipeNode,
} from "../src/lib/browser-modeling";
import {
  evaluateBrowserModelRecipe,
  type BrowserModelKernel,
  type BrowserModelKernelBounds,
  type BrowserModelKernelManifold,
} from "../src/lib/browser-modeling-kernel";

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
    compose: (manifolds: ReturnType<typeof wasm.Manifold.cube>[]) =>
      wasm.Manifold.compose(manifolds),
    mesh: (vertices: Float32Array, triangles: Uint32Array) =>
      wasm.Manifold.ofMesh(
        new wasm.Mesh({
          numProp: 3,
          vertProperties: vertices,
          triVerts: triangles,
        }),
      ),
  } satisfies BrowserModelKernel;
}

function boxRecipe(output: string, nodes: Record<string, unknown>[]) {
  return parseBrowserModelRecipe({
    version: 1,
    revision: 0,
    output,
    nodes,
  });
}

describe("browser modeling composition nodes", () => {
  it("composes separated solids and preserves disconnected output geometry", async () => {
    const wasm = await Module();
    wasm.setup();
    const recipe = boxRecipe("group", [
      { id: "a", kind: "box", size: [1, 1, 1] },
      { id: "b", kind: "box", size: [1, 1, 1] },
      {
        id: "placed",
        kind: "transform",
        input: "b",
        position: [2, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      {
        id: "group",
        kind: "compose",
        inputs: ["a", "placed"],
      },
    ]);
    const result = evaluateBrowserModelRecipe(recipe, manifoldKernel(wasm));
    expect(result.statistics.triangles).toBe(24);
    expect(result.bounds.min).toEqual([-0.5, -0.5, -0.5]);
    expect(result.bounds.max).toEqual([2.5, 0.5, 0.5]);
  });

  it("rejects touching, overlapping, and nested solids despite native compose NoError", async () => {
    const wasm = await Module();
    wasm.setup();
    const nativeLarge = wasm.Manifold.cube([4, 4, 4], true);
    const nativeSmall = wasm.Manifold.cube([1, 1, 1], true);
    const nativeComposed = wasm.Manifold.compose([nativeLarge, nativeSmall]);
    expect(nativeComposed.status()).toBe("NoError");
    expect(nativeLarge.minGap(nativeSmall, 20)).toBe(0);
    nativeComposed.delete();
    nativeLarge.delete();
    nativeSmall.delete();

    for (const [size, position] of [
      [
        [1, 1, 1],
        [1, 0, 0],
      ],
      [
        [1, 1, 1],
        [0.25, 0, 0],
      ],
      [
        [1, 1, 1],
        [0, 0, 0],
      ],
    ] as const) {
      const recipe = boxRecipe("group", [
        { id: "a", kind: "box", size: [4, 4, 4] },
        { id: "b", kind: "box", size },
        {
          id: "placed",
          kind: "transform",
          input: "b",
          position,
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        { id: "group", kind: "compose", inputs: ["a", "placed"] },
      ]);
      expect(() =>
        evaluateBrowserModelRecipe(recipe, manifoldKernel(wasm)),
      ).toThrow(/touching or overlapping|separation/i);
    }
  });

  it("mirrors through the origin plane with positive volume", async () => {
    const wasm = await Module();
    wasm.setup();
    const recipe = boxRecipe("reflected", [
      { id: "box", kind: "box", size: [1, 1, 1] },
      {
        id: "reflected",
        kind: "mirror",
        input: "box",
        normal: [1, 0, 0],
      },
    ]);
    const result = evaluateBrowserModelRecipe(recipe, manifoldKernel(wasm));
    expect(result.bounds.min).toEqual([-0.5, -0.5, -0.5]);
    expect(result.bounds.max).toEqual([0.5, 0.5, 0.5]);
    expect(result.statistics.triangles).toBeGreaterThan(0);
  });

  it("evaluates the exact two-row mirrored-column fixture", async () => {
    const wasm = await Module();
    wasm.setup();
    const recipe = boxRecipe("rows", [
      { id: "column", kind: "box", size: [0.5, 1, 0.5] },
      {
        id: "array",
        kind: "linear-array",
        input: "column",
        count: 3,
        offset: [1.25, 0, 0],
      },
      {
        id: "left",
        kind: "transform",
        input: "array",
        position: [-4, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      { id: "right", kind: "mirror", input: "left", normal: [1, 0, 0] },
      { id: "pair", kind: "compose", inputs: ["left", "right"] },
      {
        id: "rows",
        kind: "instances",
        input: "pair",
        transforms: [
          { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          { position: [0, 0, 2], rotation: [0, 0, 0], scale: [1, 1, 1] },
        ],
      },
    ]);
    const result = evaluateBrowserModelRecipe(recipe, manifoldKernel(wasm));
    expect(result.statistics.triangles).toBe(144);
    expect(result.bounds.min).toEqual([-4.25, -0.5, -0.25]);
    expect(result.bounds.max).toEqual([4.25, 0.5, 2.25]);
  });

  it("builds separated linear arrays and explicit baked instances", async () => {
    const wasm = await Module();
    wasm.setup();
    const array = evaluateBrowserModelRecipe(
      boxRecipe("array", [
        { id: "box", kind: "box", size: [1, 1, 1] },
        {
          id: "array",
          kind: "linear-array",
          input: "box",
          count: 3,
          offset: [2, 0, 0],
        },
      ]),
      manifoldKernel(wasm),
    );
    expect(array.statistics.triangles).toBe(36);
    expect(array.bounds.min).toEqual([-0.5, -0.5, -0.5]);
    expect(array.bounds.max).toEqual([4.5, 0.5, 0.5]);

    const instances = evaluateBrowserModelRecipe(
      boxRecipe("instances", [
        { id: "box", kind: "box", size: [1, 1, 1] },
        {
          id: "instances",
          kind: "instances",
          input: "box",
          transforms: [
            {
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
            {
              position: [0, 0, 2],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
          ],
        },
      ]),
      manifoldKernel(wasm),
    );
    expect(instances.statistics.triangles).toBe(24);
    expect(instances.bounds.min).toEqual([-0.5, -0.5, -0.5]);
    expect(instances.bounds.max).toEqual([0.5, 0.5, 2.5]);

  });

  it("rejects invalid normals, offsets, scales, overlaps, and expansion leaves", () => {
    const invalid = [
      {
        version: 1,
        revision: 0,
        output: "mirror",
        nodes: [
          { id: "box", kind: "box", size: [1, 1, 1] },
          {
            id: "mirror",
            kind: "mirror",
            input: "box",
            normal: [0, 0, 0],
          },
        ],
      },
      {
        version: 1,
        revision: 0,
        output: "array",
        nodes: [
          { id: "box", kind: "box", size: [1, 1, 1] },
          {
            id: "array",
            kind: "linear-array",
            input: "box",
            count: 2,
            offset: [0, 0, 0],
          },
        ],
      },
      {
        version: 1,
        revision: 0,
        output: "instances",
        nodes: [
          { id: "box", kind: "box", size: [1, 1, 1] },
          {
            id: "instances",
            kind: "instances",
            input: "box",
            transforms: [
              { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 1, 1] },
            ],
          },
        ],
      },
    ];
    for (const value of invalid)
      expect(browserModelRecipeSchema.safeParse(value).success).toBe(false);

    const tooManyLeaves = {
      version: 1,
      revision: 0,
      output: "outer",
      nodes: [
        { id: "box", kind: "box", size: [1, 1, 1] },
        {
          id: "inner",
          kind: "linear-array",
          input: "box",
          count: 32,
          offset: [2, 0, 0],
        },
        {
          id: "outer",
          kind: "linear-array",
          input: "inner",
          count: 3,
          offset: [0, 2, 0],
        },
      ],
    };
    expect(browserModelRecipeSchema.safeParse(tooManyLeaves).success).toBe(
      false,
    );
  });

  it("preserves composition node IDs and revisions", () => {
    const recipe = boxRecipe("array", [
      { id: "box", kind: "box", size: [1, 1, 1] },
      {
        id: "array",
        kind: "linear-array",
        input: "box",
        count: 2,
        offset: [2, 0, 0],
      },
    ]);
    const revised = replaceBrowserModelRecipeNode(
      recipe,
      "array",
      { ...recipe.nodes[1], count: 3 },
      recipe.revision,
    );
    expect(revised.revision).toBe(1);
    expect(revised.nodes[1]).toMatchObject({ id: "array", count: 3 });
  });

  class TrackingManifold implements BrowserModelKernelManifold {
    constructor(
      private readonly log: string[],
      private readonly vertices = 8,
      private readonly triangles = 12,
      private readonly gap = 1,
    ) {}
    add() {
      return new TrackingManifold(this.log);
    }
    subtract() {
      return new TrackingManifold(this.log);
    }
    intersect() {
      return new TrackingManifold(this.log);
    }
    scale() {
      this.log.push("scale");
      return new TrackingManifold(
        this.log,
        this.vertices,
        this.triangles,
        this.gap,
      );
    }
    rotate() {
      this.log.push("rotate");
      return new TrackingManifold(
        this.log,
        this.vertices,
        this.triangles,
        this.gap,
      );
    }
    translate() {
      this.log.push("translate");
      return new TrackingManifold(
        this.log,
        this.vertices,
        this.triangles,
        this.gap,
      );
    }
    mirror() {
      this.log.push("mirror");
      return new TrackingManifold(
        this.log,
        this.vertices,
        this.triangles,
        this.gap,
      );
    }
    minGap() {
      return this.gap;
    }
    numVert() {
      return this.vertices;
    }
    numTri() {
      return this.triangles;
    }
    volume() {
      return 1;
    }
    status() {
      return "NoError";
    }
    boundingBox(): BrowserModelKernelBounds {
      return { min: [-1, -1, -1], max: [1, 1, 1] };
    }
    getMesh() {
      return {
        numProp: 3,
        vertProperties: new Float32Array(this.vertices * 3),
        triVerts: new Uint32Array(this.triangles * 3),
      };
    }
    delete() {
      this.log.push("delete");
    }
  }

  function trackingKernel(
    log: string[],
    vertices = 8,
    triangles = 12,
    gap = 1,
  ): BrowserModelKernel {
    const make = () => new TrackingManifold(log, vertices, triangles, gap);
    return {
      cube: make,
      sphere: make,
      cylinder: make,
      extrude: make,
      revolve: make,
      compose: () => make(),
      mesh: make,
    } as BrowserModelKernel;
  }

  it("checks copy budgets before allocation and cleans owned copies on rejection", () => {
    const overBudgetLog: string[] = [];
    const overBudget = boxRecipe("array", [
      { id: "box", kind: "box", size: [1, 1, 1] },
      {
        id: "array",
        kind: "linear-array",
        input: "box",
        count: 2,
        offset: [2, 0, 0],
      },
    ]);
    expect(() =>
      evaluateBrowserModelRecipe(
        overBudget,
        trackingKernel(overBudgetLog, 100_001, 12),
      ),
    ).toThrow(/expanded geometry budget/);
    expect(overBudgetLog).not.toContain("translate");
    expect(overBudgetLog).toContain("delete");

    const overlapLog: string[] = [];
    const overlap = boxRecipe("array", [
      { id: "box", kind: "box", size: [1, 1, 1] },
      {
        id: "array",
        kind: "linear-array",
        input: "box",
        count: 2,
        offset: [2, 0, 0],
      },
    ]);
    expect(() =>
      evaluateBrowserModelRecipe(overlap, trackingKernel(overlapLog, 8, 12, 0)),
    ).toThrow(/touching or overlapping/);
    expect(overlapLog).toContain("translate");
    expect(
      overlapLog.filter((entry) => entry === "delete").length,
    ).toBeGreaterThanOrEqual(2);
  });
});
