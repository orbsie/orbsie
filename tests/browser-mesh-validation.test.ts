import { describe, expect, it } from "vitest";
import {
  parseBrowserModelRecipe,
  browserModelRecipeSchema,
} from "../src/lib/browser-modeling";
import {
  BrowserMeshValidationBudgetError,
  validateBrowserMesh,
} from "../src/lib/browser-mesh-validation";
import { evaluateBrowserModelRecipe } from "../src/lib/browser-modeling-kernel";

const tetraVertices = [
  [-1, 0, -1],
  [1, 0, -1],
  [0, 0, 1],
  [0, 1.25, 0],
] as [number, number, number][];
const tetraTriangles = [
  [0, 1, 2],
  [0, 3, 1],
  [1, 3, 2],
  [2, 3, 0],
] as [number, number, number][];

const cubeVertices = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
] as [number, number, number][];
const cubeTriangles = [
  [0, 3, 2],
  [0, 2, 1],
  [4, 5, 6],
  [4, 6, 7],
  [0, 4, 7],
  [0, 7, 3],
  [1, 2, 6],
  [1, 6, 5],
  [0, 1, 5],
  [0, 5, 4],
  [3, 7, 6],
  [3, 6, 2],
] as [number, number, number][];

function meshRecipe(vertices = tetraVertices, triangles = tetraTriangles) {
  return parseBrowserModelRecipe({
    version: 1,
    revision: 0,
    output: "mesh",
    nodes: [{ id: "mesh", kind: "mesh", vertices, triangles }],
  });
}

function subdividedBox(subdivisions: number) {
  const vertices: [number, number, number][] = [];
  const indices = new Map<string, number>();
  const vertex = (i: number, j: number, k: number) => {
    const key = `${i},${j},${k}`;
    const existing = indices.get(key);
    if (existing !== undefined) return existing;
    const created = vertices.length;
    vertices.push([
      -100 + (200 * i) / subdivisions,
      -0.05 + (0.1 * j) / subdivisions,
      -0.05 + (0.1 * k) / subdivisions,
    ]);
    indices.set(key, created);
    return created;
  };
  const triangles: [number, number, number][] = [];
  const addFace = (
    corner: (i: number, j: number) => number,
    forward: boolean,
  ) => {
    for (let i = 0; i < subdivisions; i += 1)
      for (let j = 0; j < subdivisions; j += 1) {
        const a = corner(i, j);
        const b = corner(i + 1, j);
        const c = corner(i + 1, j + 1);
        const d = corner(i, j + 1);
        const faces: [number, number, number][] = forward
          ? [
              [a, b, c],
              [a, c, d],
            ]
          : [
              [a, d, c],
              [a, c, b],
            ];
        triangles.push(...faces);
      }
  };
  addFace((j, k) => vertex(0, j, k), false);
  addFace((j, k) => vertex(subdivisions, j, k), true);
  addFace((i, k) => vertex(i, 0, k), true);
  addFace((i, k) => vertex(i, subdivisions, k), false);
  addFace((i, j) => vertex(i, j, 0), false);
  addFace((i, j) => vertex(i, j, subdivisions), true);
  return { vertices, triangles };
}

describe("browser mesh recipe validation", () => {
  it("accepts an outward tetrahedron and normalizes to bounded typed arrays", () => {
    const result = validateBrowserMesh(tetraVertices, tetraTriangles);
    expect(result.vertices).toBeInstanceOf(Float32Array);
    expect(result.triangles).toBeInstanceOf(Uint32Array);
    expect(result.vertices.length).toBe(12);
    expect(result.triangles.length).toBe(12);
  });

  it("rejects global inversion, open/nonmanifold topology, and malformed triangles", () => {
    expect(() =>
      validateBrowserMesh(
        tetraVertices,
        tetraTriangles.map(([a, b, c]) => [a, c, b]),
      ),
    ).toThrow("Browser mesh is invalid");
    expect(() =>
      validateBrowserMesh(tetraVertices, tetraTriangles.slice(0, -1)),
    ).toThrow("Browser mesh is invalid");
    expect(() =>
      validateBrowserMesh(tetraVertices, [...tetraTriangles, [0, 1, 3]]),
    ).toThrow("Browser mesh is invalid");
    expect(() =>
      validateBrowserMesh(tetraVertices, [
        [0, 1, 2],
        [0, 2, 1],
        [0, 3, 1],
        [1, 3, 2],
      ]),
    ).toThrow("Browser mesh is invalid");
    expect(() =>
      validateBrowserMesh([...tetraVertices, tetraVertices[0]], tetraTriangles),
    ).toThrow("Browser mesh is invalid");
    expect(() =>
      validateBrowserMesh(tetraVertices, [
        ...tetraTriangles.slice(0, -1),
        [2, 3, 2],
      ]),
    ).toThrow("Browser mesh is invalid");
  });

  it("rejects unused vertices, coplanar overlap, and malformed schema indices", () => {
    expect(() =>
      validateBrowserMesh([...tetraVertices, [5, 5, 5]], tetraTriangles),
    ).toThrow("Browser mesh is invalid");

    const overlappingTop = cubeVertices.map(
      (point) => [...point] as [number, number, number],
    );
    overlappingTop[2] = [0.2, 1, 0.5];
    expect(() => validateBrowserMesh(overlappingTop, cubeTriangles)).toThrow(
      "Browser mesh is invalid",
    );

    expect(
      browserModelRecipeSchema.safeParse({
        version: 1,
        revision: 0,
        output: "mesh",
        nodes: [
          {
            id: "mesh",
            kind: "mesh",
            vertices: tetraVertices,
            triangles: [[0, 1, 9], ...tetraTriangles.slice(1)],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts a valid cube and enforces per-node and aggregate limits", () => {
    expect(() =>
      validateBrowserMesh(cubeVertices, cubeTriangles),
    ).not.toThrow();
    for (const scale of [0.001, 50]) {
      const scaled = cubeVertices.map(
        ([x, y, z]) =>
          [x * scale, y * scale, z * scale] as [number, number, number],
      );
      expect(() => validateBrowserMesh(scaled, cubeTriangles)).not.toThrow();
    }
    expect(() =>
      browserModelRecipeSchema.parse({
        version: 1,
        revision: 0,
        output: "mesh",
        nodes: [
          {
            id: "mesh",
            kind: "mesh",
            vertices: cubeVertices,
            triangles: cubeTriangles,
          },
        ],
      }),
    ).not.toThrow();

    const largeVertices = Array.from({ length: 4096 }, (_, index) => [
      index % 64,
      Math.floor(index / 64),
      0,
    ]);
    const largeTriangles = [
      [0, 1, 65],
      [0, 65, 64],
      [1, 2, 66],
      [1, 66, 65],
    ];
    const oversizedRecipe = {
      version: 1,
      revision: 0,
      output: "join",
      nodes: [
        {
          id: "left",
          kind: "mesh" as const,
          vertices: largeVertices,
          triangles: largeTriangles,
        },
        {
          id: "right",
          kind: "mesh" as const,
          vertices: largeVertices,
          triangles: largeTriangles,
        },
        {
          id: "join",
          kind: "boolean" as const,
          operation: "union" as const,
          operands: ["left", "right"],
        },
      ],
    };
    expect(browserModelRecipeSchema.safeParse(oversizedRecipe).success).toBe(
      false,
    );
  });

  it("rejects scaled coplanar overlap at both small and large valid-shell sizes", () => {
    for (const scale of [0.001, 50]) {
      const overlapping = cubeVertices.map(
        ([x, y, z]) =>
          [x * scale, y * scale, z * scale] as [number, number, number],
      );
      overlapping[2] = [0.2 * scale, scale, 0.5 * scale];
      expect(() => validateBrowserMesh(overlapping, cubeTriangles)).toThrow(
        "Browser mesh is invalid",
      );
    }
  });

  it("fails closed when broadphase pair work exceeds its bounded budget", () => {
    const simple = subdividedBox(1);
    expect(() =>
      validateBrowserMesh(simple.vertices, simple.triangles),
    ).not.toThrow();
    const box = subdividedBox(25);
    expect(box.vertices.length).toBeLessThanOrEqual(4096);
    expect(box.triangles.length).toBeLessThanOrEqual(8192);
    try {
      validateBrowserMesh(box.vertices, box.triangles);
      throw new Error("expected mesh validation budget failure");
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserMeshValidationBudgetError);
      expect(error).toMatchObject({ code: "BROWSER_MESH_VALIDATION_BUDGET" });
    }
  });

  it("rejects a connected non-coplanar self-intersection that raw Manifold accepts", async () => {
    const crossed = cubeVertices.map(
      (point) => [...point] as [number, number, number],
    );
    crossed[2] = [0, 2.5, 0];
    const [{ default: Module }] = await Promise.all([import("manifold-3d")]);
    const wasm = await Module();
    wasm.setup();
    const raw = wasm.Manifold.ofMesh(
      new wasm.Mesh({
        numProp: 3,
        vertProperties: new Float32Array(crossed.flat()),
        triVerts: new Uint32Array(cubeTriangles.flat()),
      }),
    );
    expect(raw.status()).toBe("NoError");
    expect(raw.volume()).toBeGreaterThan(0);
    raw.delete();
    expect(() => validateBrowserMesh(crossed, cubeTriangles)).toThrow(
      "Browser mesh is invalid",
    );
  });

  it("rejects disconnected closed shells even when each shell is individually valid", () => {
    const secondVertices = cubeVertices.map(
      ([x, y, z]) => [x + 5, y, z] as [number, number, number],
    );
    const secondTriangles = cubeTriangles.map(
      ([a, b, c]) =>
        [
          a + cubeVertices.length,
          b + cubeVertices.length,
          c + cubeVertices.length,
        ] as [number, number, number],
    );
    expect(() =>
      validateBrowserMesh(
        [...cubeVertices, ...secondVertices],
        [...cubeTriangles, ...secondTriangles],
      ),
    ).toThrow("Browser mesh is invalid");
  });

  it("evaluates a validated mesh through the real Manifold adapter", async () => {
    const [{ default: Module }] = await Promise.all([import("manifold-3d")]);
    const wasm = await Module();
    wasm.setup();
    const result = evaluateBrowserModelRecipe(
      meshRecipe(cubeVertices, cubeTriangles),
      {
        cube: (size, center) => wasm.Manifold.cube(size, center),
        sphere: (radius, segments) => wasm.Manifold.sphere(radius, segments),
        cylinder: (depth, radiusLow, radiusHigh, segments, center) =>
          wasm.Manifold.cylinder(
            depth,
            radiusLow,
            radiusHigh,
            segments,
            center,
          ),
        extrude: (profile, depth) => wasm.Manifold.extrude(profile, depth),
        revolve: (profile, segments, degrees) =>
          wasm.Manifold.revolve(profile, segments, degrees),
        mesh: (vertices, triangles) =>
          wasm.Manifold.ofMesh(
            new wasm.Mesh({
              numProp: 3,
              vertProperties: vertices,
              triVerts: triangles,
            }),
          ),
      },
    );
    expect(result.bounds.min).toEqual([-1, -1, -1]);
    expect(result.bounds.max).toEqual([1, 1, 1]);
    expect(result.statistics.triangles).toBe(12);
  });
});
