import {
  browserModelRecipeSchema,
  type BrowserModelRecipe,
} from "./browser-modeling";
import {
  BROWSER_MESH_INVALID_ERROR,
  BrowserMeshValidationBudgetError,
  validateBrowserMesh,
} from "./browser-mesh-validation";

export type BrowserModelVec3 = readonly [number, number, number];

export interface BrowserModelKernelMesh {
  readonly numProp: number;
  readonly vertProperties: Float32Array;
  readonly triVerts: Uint32Array;
}

export interface BrowserModelKernelBounds {
  readonly min: BrowserModelVec3;
  readonly max: BrowserModelVec3;
}

/** The small structural surface required from a Manifold-compatible backend. */
export interface BrowserModelKernelManifold {
  add(other: BrowserModelKernelManifold): BrowserModelKernelManifold;
  subtract(other: BrowserModelKernelManifold): BrowserModelKernelManifold;
  intersect(other: BrowserModelKernelManifold): BrowserModelKernelManifold;
  scale(value: BrowserModelVec3): BrowserModelKernelManifold;
  rotate(degrees: BrowserModelVec3): BrowserModelKernelManifold;
  translate(value: BrowserModelVec3): BrowserModelKernelManifold;
  numTri(): number;
  status(): string;
  boundingBox(): BrowserModelKernelBounds;
  getMesh(): BrowserModelKernelMesh;
  delete(): void;
}

/** Static constructors matching Manifold's cube, sphere, and cylinder API. */
export interface BrowserModelKernel {
  cube(size: BrowserModelVec3, center: boolean): BrowserModelKernelManifold;
  sphere(radius: number, segments: number): BrowserModelKernelManifold;
  cylinder(
    depth: number,
    radiusLow: number,
    radiusHigh: number,
    segments: number,
    center: boolean,
  ): BrowserModelKernelManifold;
  /** Construct an uncentered Z extrusion; the evaluator centers it explicitly. */
  extrude(
    profile: [number, number][],
    depth: number,
  ): BrowserModelKernelManifold;
  /** Construct a full Z-axis revolve from a radius/height profile. */
  revolve(
    profile: [number, number][],
    segments: number,
    degrees: number,
  ): BrowserModelKernelManifold;
  /** Construct a fixed-property triangle mesh after browser-side validation. */
  mesh(
    vertices: Float32Array,
    triangles: Uint32Array,
  ): BrowserModelKernelManifold;
}

export interface BrowserModelMeshBounds {
  readonly min: [number, number, number];
  readonly max: [number, number, number];
}

export interface BrowserModelEvaluationStatistics {
  readonly triangles: number;
  readonly vertices: number;
  readonly bytes: number;
}

export interface BrowserModelEvaluation {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly bounds: BrowserModelMeshBounds;
  readonly statistics: BrowserModelEvaluationStatistics;
}

export const browserModelKernelLimits = Object.freeze({
  maxTriangles: 100_000,
  maxVertices: 100_000,
  maxMeshBytes: 8 * 1024 * 1024,
});

function fail(message: string): never {
  throw new Error(`[browser-modeling-kernel] ${message}`);
}

function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function degrees(value: BrowserModelVec3): [number, number, number] {
  const factor = 180 / Math.PI;
  return [value[0] * factor, value[1] * factor, value[2] * factor];
}

function axisDegrees(axis: "x" | "y" | "z"): [number, number, number] {
  if (axis === "x") return [0, 90, 0];
  if (axis === "y") return [-90, 0, 0];
  return [0, 0, 0];
}

function signedProfileArea(profile: readonly [number, number][]): number {
  let twiceArea = 0;
  for (let index = 0; index < profile.length; index += 1) {
    const next = profile[(index + 1) % profile.length];
    twiceArea += profile[index][0] * next[1] - next[0] * profile[index][1];
  }
  return twiceArea / 2;
}

function normalizedProfile(
  profile: readonly [number, number][],
): [number, number][] {
  const points = profile.map(([x, y]) => [x, y] as [number, number]);
  return signedProfileArea(points) < 0 ? points.reverse() : points;
}

function assertStatus(object: BrowserModelKernelManifold, nodeId: string) {
  const status = object.status();
  requireValid(
    status === "NoError",
    `backend rejected node ${nodeId} with status ${status}.`,
  );
  const triangles = object.numTri();
  requireValid(
    Number.isInteger(triangles) &&
      triangles >= 0 &&
      triangles <= browserModelKernelLimits.maxTriangles,
    `backend node ${nodeId} exceeds the triangle budget.`,
  );
}

function rotateThreeEuler(
  object: BrowserModelKernelManifold,
  radians: BrowserModelVec3,
  nodeId: string,
  own: (
    value: BrowserModelKernelManifold,
    nodeId: string,
  ) => BrowserModelKernelManifold,
): BrowserModelKernelManifold {
  const [x, y, z] = degrees(radians);
  // Manifold's combined rotate([x, y, z]) applies its axes in the opposite
  // matrix order to Three.js Euler XYZ. Axis calls in reverse order produce
  // Three's Rx * Ry * Rz matrix while retaining the recipe's XYZ convention.
  let rotated = object;
  if (z !== 0) rotated = own(rotated.rotate([0, 0, z]), nodeId);
  if (y !== 0) rotated = own(rotated.rotate([0, y, 0]), nodeId);
  if (x !== 0) rotated = own(rotated.rotate([x, 0, 0]), nodeId);
  return rotated;
}

function assertBounds(
  bounds: BrowserModelKernelBounds,
): BrowserModelMeshBounds {
  const min = [...bounds.min] as [number, number, number];
  const max = [...bounds.max] as [number, number, number];
  requireValid(
    min.length === 3 && max.length === 3,
    "backend bounds must have three coordinates.",
  );
  for (let index = 0; index < 3; index += 1) {
    requireValid(
      Number.isFinite(min[index]) && Number.isFinite(max[index]),
      "backend bounds must be finite.",
    );
    requireValid(min[index] <= max[index], "backend bounds must be ordered.");
  }
  return { min, max };
}

function readMesh(
  object: BrowserModelKernelManifold,
  nodeId: string,
): BrowserModelEvaluation {
  const mesh = object.getMesh();
  requireValid(
    Number.isInteger(mesh.numProp) && mesh.numProp >= 3,
    "backend mesh properties are invalid.",
  );
  requireValid(
    mesh.vertProperties.byteLength + mesh.triVerts.byteLength <=
      browserModelKernelLimits.maxMeshBytes,
    "backend mesh exceeds the byte budget.",
  );
  requireValid(
    mesh.vertProperties.length % mesh.numProp === 0,
    "backend vertex properties have an invalid stride.",
  );
  requireValid(
    mesh.triVerts.length % 3 === 0,
    "backend triangle indices are incomplete.",
  );

  const vertices = mesh.vertProperties.length / mesh.numProp;
  const triangles = mesh.triVerts.length / 3;
  requireValid(
    vertices <= browserModelKernelLimits.maxVertices,
    "backend mesh exceeds the vertex budget.",
  );
  requireValid(
    triangles <= browserModelKernelLimits.maxTriangles,
    "backend mesh exceeds the triangle budget.",
  );
  requireValid(
    object.numTri() === triangles,
    `backend triangle count changed while reading node ${nodeId}.`,
  );

  const positions = new Float32Array(vertices * 3);
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    for (let coordinate = 0; coordinate < 3; coordinate += 1) {
      const value = mesh.vertProperties[vertex * mesh.numProp + coordinate];
      requireValid(
        Number.isFinite(value),
        `backend mesh has a non-finite position at vertex ${vertex}.`,
      );
      positions[vertex * 3 + coordinate] = value;
    }
  }
  for (const index of mesh.triVerts)
    requireValid(
      index < vertices,
      `backend mesh index ${index} is out of range.`,
    );

  const bytes = positions.byteLength + mesh.triVerts.byteLength;
  requireValid(
    bytes <= browserModelKernelLimits.maxMeshBytes,
    "output mesh exceeds the byte budget.",
  );
  return {
    vertices: positions,
    indices: new Uint32Array(mesh.triVerts),
    bounds: assertBounds(object.boundingBox()),
    statistics: { triangles, vertices, bytes },
  };
}

/** Evaluate the validated recipe through only the injected kernel surface. */
export function evaluateBrowserModelRecipe(
  input: BrowserModelRecipe,
  kernel: BrowserModelKernel,
): BrowserModelEvaluation {
  const recipe = browserModelRecipeSchema.parse(input);
  const byId = new Map(recipe.nodes.map((node) => [node.id, node]));
  const memo = new Map<string, BrowserModelKernelManifold>();
  const owned: BrowserModelKernelManifold[] = [];

  const own = (object: BrowserModelKernelManifold, nodeId: string) => {
    if (!owned.includes(object)) owned.push(object);
    assertStatus(object, nodeId);
    return object;
  };

  const evaluateNode = (nodeId: string): BrowserModelKernelManifold => {
    const cached = memo.get(nodeId);
    if (cached) return cached;
    const node = byId.get(nodeId);
    requireValid(node, `recipe node does not exist: ${nodeId}.`);

    let object: BrowserModelKernelManifold;
    switch (node.kind) {
      case "box":
        object = own(kernel.cube(node.size, true), node.id);
        break;
      case "sphere":
        object = own(kernel.sphere(node.radius, node.segments), node.id);
        break;
      case "cylinder": {
        const cylinder = own(
          kernel.cylinder(
            node.depth,
            node.radius,
            node.radius,
            node.segments,
            true,
          ),
          node.id,
        );
        const rotation = axisDegrees(node.axis);
        object = rotation.every((value) => value === 0)
          ? cylinder
          : own(cylinder.rotate(rotation), node.id);
        break;
      }
      case "extrude": {
        const extruded = own(
          kernel.extrude(normalizedProfile(node.profile), node.depth),
          node.id,
        );
        object = own(extruded.translate([0, 0, -node.depth / 2]), node.id);
        break;
      }
      case "revolve": {
        const revolved = own(
          kernel.revolve(normalizedProfile(node.profile), node.segments, 360),
          node.id,
        );
        object = own(revolved.rotate([-90, 0, 0]), node.id);
        break;
      }
      case "mesh": {
        let validated;
        try {
          validated = validateBrowserMesh(node.vertices, node.triangles);
        } catch (error) {
          if (error instanceof BrowserMeshValidationBudgetError)
            throw new Error(BROWSER_MESH_INVALID_ERROR);
          throw error;
        }
        try {
          object = own(
            kernel.mesh(validated.vertices, validated.triangles),
            node.id,
          );
        } catch {
          throw new Error(BROWSER_MESH_INVALID_ERROR);
        }
        break;
      }
      case "transform": {
        const inputObject = evaluateNode(node.input);
        const scaled = own(inputObject.scale(node.scale), node.id);
        const rotated = rotateThreeEuler(scaled, node.rotation, node.id, own);
        object = own(rotated.translate(node.position), node.id);
        break;
      }
      case "boolean": {
        let result = evaluateNode(node.operands[0]);
        for (const operandId of node.operands.slice(1)) {
          const operand = evaluateNode(operandId);
          result = own(
            node.operation === "union"
              ? result.add(operand)
              : node.operation === "subtract"
                ? result.subtract(operand)
                : result.intersect(operand),
            node.id,
          );
        }
        object = result;
        break;
      }
    }
    memo.set(nodeId, object);
    return object;
  };

  let result: BrowserModelEvaluation | undefined;
  let operationFailed = false;
  let operationError: unknown;
  let cleanupError: unknown;
  try {
    const output = evaluateNode(recipe.output);
    result = readMesh(output, recipe.output);
  } catch (error) {
    operationFailed = true;
    operationError = error;
  } finally {
    for (const object of [...owned].reverse()) {
      try {
        object.delete();
      } catch (error) {
        cleanupError ??= error;
      }
    }
  }
  if (operationFailed) throw operationError;
  if (cleanupError !== undefined)
    throw new Error("backend object cleanup failed after evaluation.");
  requireValid(result, "backend evaluation produced no result.");
  return result;
}
