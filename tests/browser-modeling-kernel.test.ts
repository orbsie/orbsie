import { describe, expect, it } from "vitest";
import {
  browserModelKernelLimits,
  evaluateBrowserModelRecipe,
  type BrowserModelKernel,
  type BrowserModelKernelBounds,
  type BrowserModelKernelManifold,
} from "../src/lib/browser-modeling-kernel";
import { parseBrowserModelRecipe } from "../src/lib/browser-modeling";

const triangleMesh = {
  numProp: 3,
  vertProperties: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
  triVerts: new Uint32Array([0, 1, 2]),
};

function absoluteMeshVolume(vertices: Float32Array, indices: Uint32Array) {
  let volume = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index] * 3;
    const b = indices[index + 1] * 3;
    const c = indices[index + 2] * 3;
    volume +=
      (vertices[a] *
        (vertices[b + 1] * vertices[c + 2] -
          vertices[b + 2] * vertices[c + 1]) +
        vertices[a + 1] *
          (vertices[b + 2] * vertices[c] - vertices[b] * vertices[c + 2]) +
        vertices[a + 2] *
          (vertices[b] * vertices[c + 1] - vertices[b + 1] * vertices[c])) /
      6;
  }
  return Math.abs(volume);
}

class FakeManifold implements BrowserModelKernelManifold {
  static nextId = 0;
  readonly id = FakeManifold.nextId++;

  constructor(
    readonly label: string,
    private readonly log: string[],
    private readonly mesh = triangleMesh,
    private readonly statusValue = "NoError",
  ) {
    log.push(`create:${label}`);
  }

  private next(operation: string, other?: FakeManifold) {
    this.log.push(
      `${operation}:${this.label}${other ? `:${other.label}` : ""}`,
    );
    return new FakeManifold(
      `${this.label}.${operation}`,
      this.log,
      this.mesh,
      this.statusValue,
    );
  }

  add(other: BrowserModelKernelManifold) {
    return this.next("add", other as FakeManifold);
  }
  subtract(other: BrowserModelKernelManifold) {
    return this.next("subtract", other as FakeManifold);
  }
  intersect(other: BrowserModelKernelManifold) {
    return this.next("intersect", other as FakeManifold);
  }
  scale(value: readonly [number, number, number]) {
    this.log.push(`scale:${this.label}:${value.join(",")}`);
    return new FakeManifold(
      `${this.label}.scale`,
      this.log,
      this.mesh,
      this.statusValue,
    );
  }
  rotate(value: readonly [number, number, number]) {
    this.log.push(`rotate:${this.label}:${value.join(",")}`);
    return new FakeManifold(
      `${this.label}.rotate`,
      this.log,
      this.mesh,
      this.statusValue,
    );
  }
  translate(value: readonly [number, number, number]) {
    this.log.push(`translate:${this.label}:${value.join(",")}`);
    return new FakeManifold(
      `${this.label}.translate`,
      this.log,
      this.mesh,
      this.statusValue,
    );
  }
  numTri() {
    return this.mesh.triVerts.length / 3;
  }
  status() {
    return this.statusValue;
  }
  boundingBox(): BrowserModelKernelBounds {
    return { min: [-1, -1, 0], max: [1, 1, 0] };
  }
  getMesh() {
    return this.mesh;
  }
  delete() {
    this.log.push(`delete:${this.label}`);
  }
}

function fakeKernel(
  log: string[],
  mesh = triangleMesh,
  status = "NoError",
): BrowserModelKernel {
  return {
    cube: (size, center) => {
      log.push(`cube:${size.join(",")}:${center}`);
      return new FakeManifold("cube", log, mesh, status);
    },
    sphere: (radius, segments) => {
      log.push(`sphere:${radius}:${segments}`);
      return new FakeManifold("sphere", log, mesh, status);
    },
    cylinder: (depth, radiusLow, radiusHigh, segments, center) => {
      log.push(
        `cylinder:${depth}:${radiusLow}:${radiusHigh}:${segments}:${center}`,
      );
      return new FakeManifold("cylinder", log, mesh, status);
    },
    extrude: (profile, depth) => {
      log.push(
        `extrude:${profile.map((point) => point.join(",")).join(";")}:${depth}`,
      );
      return new FakeManifold("extrude", log, mesh, status);
    },
    revolve: (profile, segments, degrees) => {
      log.push(
        `revolve:${profile.map((point) => point.join(",")).join(";")}:${segments}:${degrees}`,
      );
      return new FakeManifold("revolve", log, mesh, status);
    },
    mesh: (vertices, triangles) => {
      log.push(`mesh:${vertices.length}:${triangles.length}`);
      return new FakeManifold("mesh", log, mesh, status);
    },
  };
}

const archRecipe = parseBrowserModelRecipe({
  version: 1,
  revision: 0,
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
      rotation: [0, Math.PI / 2, 0],
      scale: [1, 1, 1],
    },
    {
      id: "arch",
      kind: "boolean",
      operation: "subtract",
      operands: ["outer", "opening-placement"],
    },
  ],
});

describe("browser modeling kernel adapter", () => {
  it("evaluates the arch DAG with axis and transform order, then copies bounded mesh data", () => {
    const log: string[] = [];
    const result = evaluateBrowserModelRecipe(archRecipe, fakeKernel(log));

    expect(log).toContain("cube:6,4,2:true");
    expect(log).toContain("cylinder:2:1.25:1.25:48:true");
    expect(log).toContain("scale:cylinder:1,1,1");
    expect(log).toContain("rotate:cylinder.scale:0,90,0");
    expect(log).toContain("translate:cylinder.scale.rotate:0,-0.6,0");
    expect(log.some((entry) => entry.startsWith("subtract:"))).toBe(true);
    expect(log.indexOf("scale:cylinder:1,1,1")).toBeLessThan(
      log.indexOf("rotate:cylinder.scale:0,90,0"),
    );
    expect(log.indexOf("rotate:cylinder.scale:0,90,0")).toBeLessThan(
      log.indexOf("translate:cylinder.scale.rotate:0,-0.6,0"),
    );
    expect(result.vertices).toBeInstanceOf(Float32Array);
    expect(result.indices).toBeInstanceOf(Uint32Array);
    expect(result.statistics).toEqual({
      triangles: 1,
      vertices: 3,
      bytes: result.vertices.byteLength + result.indices.byteLength,
    });
    const deletes = log.filter((entry) => entry.startsWith("delete:"));
    expect(new Set(deletes).size).toBe(deletes.length);
    expect(deletes.length).toBe(
      log.filter((entry) => entry.startsWith("create:")).length,
    );
  });

  it("memoizes shared operands and applies multi-operand booleans left to right", () => {
    const log: string[] = [];
    // The recipe validator rejects duplicate operands; use a transform alias
    // to exercise shared memoization without changing the recipe contract.
    const sharedRecipe = parseBrowserModelRecipe({
      version: 1,
      revision: 0,
      output: "result",
      nodes: [
        { id: "shared", kind: "sphere", radius: 1, segments: 12 },
        { id: "other", kind: "box", size: [1, 1, 1] },
        { id: "third", kind: "box", size: [2, 2, 2] },
        {
          id: "alias",
          kind: "transform",
          input: "shared",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        {
          id: "result",
          kind: "boolean",
          operation: "union",
          operands: ["shared", "other", "alias", "third"],
        },
      ],
    });
    const result = evaluateBrowserModelRecipe(sharedRecipe, fakeKernel(log));
    expect(result.statistics.triangles).toBe(1);
    expect(log.filter((entry) => entry === "sphere:1:12")).toHaveLength(1);
    expect(log.filter((entry) => entry.startsWith("add:")).length).toBe(3);
    expect(log.filter((entry) => entry.startsWith("delete:")).length).toBe(
      log.filter((entry) => entry.startsWith("create:")).length,
    );
  });

  it("normalizes extrusion winding and centers the Z extent", () => {
    const log: string[] = [];
    const recipe = parseBrowserModelRecipe({
      version: 1,
      revision: 0,
      output: "profile",
      nodes: [
        {
          id: "profile",
          kind: "extrude",
          profile: [
            [-1, -1],
            [-1, 1],
            [1, 1],
            [1, -1],
          ],
          depth: 2,
        },
      ],
    });
    evaluateBrowserModelRecipe(recipe, fakeKernel(log));
    expect(log).toContain("extrude:1,-1;1,1;-1,1;-1,-1:2");
    expect(log).toContain("translate:extrude:0,0,-1");
  });

  it("normalizes revolve winding, rotates Z-up output to Y-up, and cleans both outputs", () => {
    const log: string[] = [];
    const recipe = parseBrowserModelRecipe({
      version: 1,
      revision: 0,
      output: "profile",
      nodes: [
        {
          id: "profile",
          kind: "revolve",
          profile: [
            [0, -1],
            [1, -1],
            [1, 1],
            [0, 1],
          ],
          segments: 24,
        },
      ],
    });
    evaluateBrowserModelRecipe(recipe, fakeKernel(log));
    expect(log).toContain("revolve:0,-1;1,-1;1,1;0,1:24:360");
    expect(log).toContain("rotate:revolve:-90,0,0");
    const creates = log.filter((entry) => entry.startsWith("create:"));
    const deletes = log.filter((entry) => entry.startsWith("delete:"));
    expect(deletes).toEqual(
      creates
        .slice()
        .reverse()
        .map((entry) => entry.replace("create:", "delete:")),
    );
  });

  it("deletes every owned backend object when the backend reports an error", () => {
    const log: string[] = [];
    const recipe = parseBrowserModelRecipe({
      version: 1,
      revision: 0,
      output: "box",
      nodes: [{ id: "box", kind: "box", size: [1, 1, 1] }],
    });
    expect(() =>
      evaluateBrowserModelRecipe(
        recipe,
        fakeKernel(log, triangleMesh, "NotManifold"),
      ),
    ).toThrow(/NotManifold/);
    const creates = log.filter((entry) => entry.startsWith("create:"));
    const deletes = log.filter((entry) => entry.startsWith("delete:"));
    expect(deletes).toEqual(
      creates
        .slice()
        .reverse()
        .map((entry) => entry.replace("create:", "delete:")),
    );
  });

  it("rejects non-finite or out-of-range mesh data while still cleaning ownership", () => {
    const log: string[] = [];
    const invalidMesh = {
      numProp: 3,
      vertProperties: new Float32Array([0, 0, Number.NaN, 1, 0, 0, 0, 1, 0]),
      triVerts: new Uint32Array([0, 1, 9]),
    };
    const recipe = parseBrowserModelRecipe({
      version: 1,
      revision: 0,
      output: "box",
      nodes: [{ id: "box", kind: "box", size: [1, 1, 1] }],
    });
    expect(() =>
      evaluateBrowserModelRecipe(recipe, fakeKernel(log, invalidMesh)),
    ).toThrow(/non-finite|out of range/);
    expect(log.filter((entry) => entry.startsWith("delete:")).length).toBe(
      log.filter((entry) => entry.startsWith("create:")).length,
    );
  });

  it("redacts mesh backend failures and deletes the returned object", () => {
    const log: string[] = [];
    const recipe = parseBrowserModelRecipe({
      version: 1,
      revision: 0,
      output: "mesh",
      nodes: [
        {
          id: "mesh",
          kind: "mesh",
          vertices: [
            [-1, 0, -1],
            [1, 0, -1],
            [0, 0, 1],
            [0, 1, 0],
          ],
          triangles: [
            [0, 1, 2],
            [0, 3, 1],
            [1, 3, 2],
            [2, 3, 0],
          ],
        },
      ],
    });
    expect(() =>
      evaluateBrowserModelRecipe(
        recipe,
        fakeKernel(log, triangleMesh, "NotManifold"),
      ),
    ).toThrow("Browser mesh is invalid.");
    expect(log.filter((entry) => entry.startsWith("delete:")).length).toBe(
      log.filter((entry) => entry.startsWith("create:")).length,
    );
  });

  it("enforces the declared output budgets", () => {
    expect(browserModelKernelLimits.maxTriangles).toBe(100_000);
    expect(browserModelKernelLimits.maxMeshBytes).toBe(8 * 1024 * 1024);

    const oversizedIndices = new Uint32Array(
      (browserModelKernelLimits.maxTriangles + 1) * 3,
    );
    for (let index = 0; index < oversizedIndices.length; index += 3)
      oversizedIndices.set([0, 1, 2], index);
    const log: string[] = [];
    const recipe = parseBrowserModelRecipe({
      version: 1,
      revision: 0,
      output: "box",
      nodes: [{ id: "box", kind: "box", size: [1, 1, 1] }],
    });
    expect(() =>
      evaluateBrowserModelRecipe(
        recipe,
        fakeKernel(log, {
          numProp: 3,
          vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          triVerts: oversizedIndices,
        }),
      ),
    ).toThrow(/triangle budget/);
    expect(log.filter((entry) => entry.startsWith("delete:"))).toHaveLength(1);
  });

  it("matches Three.js Euler XYZ bounds with the installed Manifold backend", async () => {
    const [{ default: Module }, THREE] = await Promise.all([
      import("manifold-3d"),
      import("three"),
    ]);
    const wasm = await Module();
    wasm.setup();
    const recipe = parseBrowserModelRecipe({
      version: 1,
      revision: 0,
      output: "rotated",
      nodes: [
        { id: "box", kind: "box", size: [2, 4, 6] },
        {
          id: "rotated",
          kind: "transform",
          input: "box",
          position: [0, 0, 0],
          rotation: [0.3, 0.7, 0.2],
          scale: [1, 1, 1],
        },
      ],
    });
    const expectedMin = [Infinity, Infinity, Infinity];
    const expectedMax = [-Infinity, -Infinity, -Infinity];
    const euler = new THREE.Euler(0.3, 0.7, 0.2, "XYZ");
    for (const x of [-1, 1]) {
      for (const y of [-2, 2]) {
        for (const z of [-3, 3]) {
          const corner = new THREE.Vector3(x, y, z).applyEuler(euler);
          for (let axis = 0; axis < 3; axis += 1) {
            expectedMin[axis] = Math.min(
              expectedMin[axis],
              corner.getComponent(axis),
            );
            expectedMax[axis] = Math.max(
              expectedMax[axis],
              corner.getComponent(axis),
            );
          }
        }
      }
    }
    const result = evaluateBrowserModelRecipe(recipe, {
      cube: (size, center) => wasm.Manifold.cube(size, center),
      sphere: (radius, segments) => wasm.Manifold.sphere(radius, segments),
      cylinder: (depth, radiusLow, radiusHigh, segments, center) =>
        wasm.Manifold.cylinder(depth, radiusLow, radiusHigh, segments, center),
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
    });
    for (let axis = 0; axis < 3; axis += 1) {
      expect(result.bounds.min[axis]).toBeCloseTo(expectedMin[axis], 6);
      expect(result.bounds.max[axis]).toBeCloseTo(expectedMax[axis], 6);
    }
  });

  it("evaluates a concave extrusion as a centered solid for both windings", async () => {
    const [{ default: Module }] = await Promise.all([import("manifold-3d")]);
    const wasm = await Module();
    wasm.setup();
    const counterClockwise = [
      [-1, -1],
      [1, -1],
      [1, 0],
      [0, 0],
      [0, 1],
      [-1, 1],
    ] as [number, number][];
    const clockwise = counterClockwise.slice().reverse();

    for (const profile of [counterClockwise, clockwise]) {
      const recipe = parseBrowserModelRecipe({
        version: 1,
        revision: 0,
        output: "profile",
        nodes: [{ id: "profile", kind: "extrude", profile, depth: 1 }],
      });
      const result = evaluateBrowserModelRecipe(recipe, {
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
      });
      expect(result.statistics.triangles).toBeGreaterThan(0);
      expect(result.bounds.min).toEqual([-1, -1, -0.5]);
      expect(result.bounds.max).toEqual([1, 1, 0.5]);
      expect(result.indices.length % 3).toBe(0);
      expect(absoluteMeshVolume(result.vertices, result.indices)).toBeCloseTo(
        3,
        5,
      );
    }
  });

  it("revolves the vase profile around Y with equivalent winding and bounded width", async () => {
    const [{ default: Module }] = await Promise.all([import("manifold-3d")]);
    const wasm = await Module();
    wasm.setup();
    const counterClockwise = [
      [0, -1],
      [0.5, -1],
      [1.25, -0.4],
      [1.25, 0.3],
      [0.6, 1],
      [0, 1],
    ] as [number, number][];
    const evaluations = [];
    for (const profile of [
      counterClockwise,
      counterClockwise.slice().reverse(),
    ]) {
      const recipe = parseBrowserModelRecipe({
        version: 1,
        revision: 7,
        output: "vase",
        nodes: [{ id: "vase", kind: "revolve", profile }],
      });
      evaluations.push(
        evaluateBrowserModelRecipe(recipe, {
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
          extrude: (extrudeProfile, depth) =>
            wasm.Manifold.extrude(extrudeProfile, depth),
          revolve: (revolveProfile, segments, degrees) =>
            wasm.Manifold.revolve(revolveProfile, segments, degrees),
          mesh: (vertices, triangles) =>
            wasm.Manifold.ofMesh(
              new wasm.Mesh({
                numProp: 3,
                vertProperties: vertices,
                triVerts: triangles,
              }),
            ),
        }),
      );
    }
    for (const result of evaluations) {
      expect(result.bounds.min).toEqual([-1.25, -1, -1.25]);
      expect(result.bounds.max).toEqual([1.25, 1, 1.25]);
      expect(result.statistics.triangles).toBeGreaterThan(0);
    }
    expect(evaluations[0].statistics).toEqual(evaluations[1].statistics);
    expect(
      absoluteMeshVolume(evaluations[0].vertices, evaluations[0].indices),
    ).toBeCloseTo(
      absoluteMeshVolume(evaluations[1].vertices, evaluations[1].indices),
      5,
    );
  });
});
