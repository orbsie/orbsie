import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BlenderModelingAbortError,
  runBlenderModelingJob,
  type ModelingProgress,
} from "../scripts/blender-modeling";

const tetrahedron = {
  id: "mesh",
  shape: "mesh" as const,
  color: "#ff8844",
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  faces: [
    [0, 2, 1],
    [0, 1, 3],
    [1, 2, 3],
    [2, 0, 3],
  ],
};

const allShapes = {
  version: 1 as const,
  parts: [
    {
      id: "box",
      shape: "box" as const,
      position: [1, 2, 3] as [number, number, number],
      scale: [1, 2, 1] as [number, number, number],
      color: "#ff3344",
      bevel: 0.05,
    },
    {
      id: "sphere",
      shape: "sphere" as const,
      position: [-2, 1, 0] as [number, number, number],
      color: "#33cc66",
      subdivision: 1,
    },
    {
      id: "cylinder",
      shape: "cylinder" as const,
      position: [0, 0, -2] as [number, number, number],
      color: "#3366ff",
      segments: 12,
    },
    {
      id: "cone",
      shape: "cone" as const,
      position: [2, 0, -2] as [number, number, number],
      color: "#ffcc33",
      segments: 12,
    },
    {
      id: "torus",
      shape: "torus" as const,
      position: [-2, 0, -2] as [number, number, number],
      color: "#aa66ff",
      segments: 12,
    },
    {
      ...tetrahedron,
      position: [0, 1, 2] as [number, number, number],
    },
    {
      id: "extrude",
      shape: "extrude" as const,
      color: "#22bbbb",
      profile: [
        [-1, -1],
        [1, -1],
        [0, 1],
      ],
      depth: 1.5,
      position: [3, 0, 2] as [number, number, number],
    },
    {
      id: "lathe",
      shape: "lathe" as const,
      color: "#ee66aa",
      profile: [
        [0, -1],
        [0.6, -0.4],
        [0.45, 0.4],
        [0, 1],
      ],
      segments: 12,
      position: [-3, 0, 2] as [number, number, number],
    },
  ],
};

type GlbAccessor = {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
};
type GlbBufferView = {
  byteOffset?: number;
  byteStride?: number;
};
type GlbPrimitive = {
  attributes: Record<string, number>;
  indices?: number;
};
type GlbDocument = {
  accessors: GlbAccessor[];
  bufferViews: GlbBufferView[];
  meshes: { primitives: GlbPrimitive[] }[];
  nodes: {
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  scene?: number;
  scenes: { nodes: number[] }[];
};
type Vec3 = [number, number, number];
type Matrix4 = number[];
type Triangle = [Vec3, Vec3, Vec3];

function multiplyMatrix(a: Matrix4, b: Matrix4): Matrix4 {
  const result = Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++)
      for (let index = 0; index < 4; index++)
        result[column * 4 + row] += a[index * 4 + row] * b[column * 4 + index];
  return result;
}

function nodeMatrix(node: GlbDocument["nodes"][number]): Matrix4 {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function transformPoint(matrix: Matrix4, point: Vec3): Vec3 {
  return [
    matrix[0] * point[0] +
      matrix[4] * point[1] +
      matrix[8] * point[2] +
      matrix[12],
    matrix[1] * point[0] +
      matrix[5] * point[1] +
      matrix[9] * point[2] +
      matrix[13],
    matrix[2] * point[0] +
      matrix[6] * point[1] +
      matrix[10] * point[2] +
      matrix[14],
  ];
}

function glbTriangles(bytes: Uint8Array): Triangle[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const document = JSON.parse(
    new TextDecoder()
      .decode(bytes.subarray(20, 20 + jsonLength))
      .replace(/\u0000+$/g, "")
      .trim(),
  ) as GlbDocument;
  const binHeader = 20 + jsonLength;
  const binStart = binHeader + 8;
  const readVertex = (accessorId: number, index: number): Vec3 => {
    const accessor = document.accessors[accessorId];
    const bufferView = document.bufferViews[accessor.bufferView];
    const stride = bufferView.byteStride ?? 12;
    const offset =
      binStart +
      (bufferView.byteOffset ?? 0) +
      (accessor.byteOffset ?? 0) +
      index * stride;
    return [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ];
  };
  const readIndex = (accessorId: number, index: number): number => {
    const accessor = document.accessors[accessorId];
    const bufferView = document.bufferViews[accessor.bufferView];
    const size =
      accessor.componentType === 5121
        ? 1
        : accessor.componentType === 5123
          ? 2
          : 4;
    const offset =
      binStart +
      (bufferView.byteOffset ?? 0) +
      (accessor.byteOffset ?? 0) +
      index * size;
    if (size === 1) return view.getUint8(offset);
    if (size === 2) return view.getUint16(offset, true);
    return view.getUint32(offset, true);
  };
  const triangles: Triangle[] = [];
  const identity: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const visit = (nodeId: number, parent: Matrix4) => {
    const node = document.nodes[nodeId];
    const world = multiplyMatrix(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of document.meshes[node.mesh].primitives) {
        const positionAccessor = primitive.attributes.POSITION;
        const position = document.accessors[positionAccessor];
        const indices = primitive.indices;
        const count =
          indices === undefined
            ? position.count
            : document.accessors[indices].count;
        const read = (index: number) =>
          transformPoint(
            world,
            readVertex(
              positionAccessor,
              indices === undefined ? index : readIndex(indices, index),
            ),
          );
        for (let index = 0; index < count; index += 3)
          triangles.push([read(index), read(index + 1), read(index + 2)]);
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const nodeId of document.scenes[document.scene ?? 0].nodes)
    visit(nodeId, identity);
  return triangles;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

describe("local Blender modeling runner", () => {
  it("rejects invalid typed jobs before starting Blender", async () => {
    await expect(
      runBlenderModelingJob({
        version: 1,
        parts: [
          {
            id: "not-a-shape",
            shape: "python" as never,
            color: "#ffffff",
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("honors an already-cancelled signal without starting a job", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runBlenderModelingJob(allShapes, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(BlenderModelingAbortError);
  });

  it("builds every supported shape in an isolated Blender job", async () => {
    const progress: ModelingProgress[] = [];
    const result = await runBlenderModelingJob(allShapes, {
      onProgress: (event) => progress.push(event),
    });
    const digest = createHash("sha256").update(result.glb).digest("hex");
    const stages = new Set(progress.map((event) => event.stage));

    expect(result.glb.byteLength).toBeGreaterThan(20);
    expect(String.fromCharCode(...result.glb.slice(0, 4))).toBe("glTF");
    expect(result.sha256).toBe(digest);
    expect(result.blenderVersion).toMatch(/^4\./);
    expect(result.objects.map((object) => object.shape)).toEqual(
      allShapes.parts.map((part) => part.shape),
    );
    expect(result.materialStats).toHaveLength(allShapes.parts.length);
    expect(result.bounds.min.every(Number.isFinite)).toBe(true);
    expect(result.bounds.max.every(Number.isFinite)).toBe(true);
    expect(result.bounds.size.every((value) => value > 0)).toBe(true);
    expect(stages).toEqual(
      new Set(["validation", "modeling", "exporting", "complete"]),
    );
  }, 30_000);

  it("preserves asymmetric Y-up mesh coordinates in the exported GLB", async () => {
    const result = await runBlenderModelingJob({
      version: 1,
      parts: [
        {
          id: "asymmetric",
          shape: "mesh",
          color: "#ffffff",
          position: [10, 20, 30],
          vertices: [
            [1, 2, 3],
            [2, 2, 3],
            [1, 4, 3],
          ],
          faces: [[0, 1, 2]],
        },
      ],
    });
    expect(result.bounds.min.map((value) => Number(value.toFixed(5)))).toEqual([
      11, 22, 33,
    ]);
    expect(result.bounds.max.map((value) => Number(value.toFixed(5)))).toEqual([
      12, 24, 33,
    ]);
    const triangle = glbTriangles(result.glb)[0];
    expect(triangle).toBeDefined();
    if (!triangle) return;
    for (const [actual, expected] of triangle[0].map(
      (value, index) => [value, [11, 22, 33][index]] as const,
    ))
      expect(actual).toBeCloseTo(expected, 4);
    for (const [actual, expected] of triangle[1].map(
      (value, index) => [value, [12, 22, 33][index]] as const,
    ))
      expect(actual).toBeCloseTo(expected, 4);
    for (const [actual, expected] of triangle[2].map(
      (value, index) => [value, [11, 24, 33][index]] as const,
    ))
      expect(actual).toBeCloseTo(expected, 4);
  }, 30_000);

  it("exports lathe cylinder triangles with outward winding", async () => {
    const result = await runBlenderModelingJob({
      version: 1,
      parts: [
        {
          id: "cylinder-profile",
          shape: "lathe",
          color: "#ffffff",
          segments: 8,
          profile: [
            [1, -1],
            [1, 0],
            [1, 1],
          ],
        },
      ],
    });
    const triangles = glbTriangles(result.glb);
    expect(triangles.length).toBeGreaterThan(8);
    for (const [first, second, third] of triangles) {
      const normal = cross(subtract(second, first), subtract(third, first));
      const center: Vec3 = [
        (first[0] + second[0] + third[0]) / 3,
        (first[1] + second[1] + third[1]) / 3,
        (first[2] + second[2] + third[2]) / 3,
      ];
      const expected: Vec3 =
        Math.abs(Math.abs(center[1]) - 1) < 1e-4
          ? [0, Math.sign(center[1]), 0]
          : [center[0], 0, center[2]];
      expect(dot(normal, expected)).toBeGreaterThan(0.001);
    }
  }, 30_000);

  it("kills the isolated job when cancellation arrives during startup", async () => {
    const controller = new AbortController();
    const promise = runBlenderModelingJob(allShapes, {
      signal: controller.signal,
      onProgress: (event) => {
        if (event.stage === "modeling" && event.progress === 0)
          controller.abort();
      },
    });
    await expect(promise).rejects.toBeInstanceOf(BlenderModelingAbortError);
  }, 30_000);

  it("rejects a throwing progress callback after terminating Blender", async () => {
    await expect(
      runBlenderModelingJob(
        {
          version: 1,
          parts: [{ id: "box", shape: "box", color: "#ffffff" }],
        },
        {
          onProgress: (event) => {
            if (event.stage === "modeling" && event.progress > 0)
              throw new Error("progress callback failed");
          },
        },
      ),
    ).rejects.toThrow("progress callback failed");
  }, 30_000);
});
