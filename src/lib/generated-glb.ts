import { z } from "zod";
import { Matrix4, Quaternion, Vector3 } from "three";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_VERTICES = 100000;
const MAX_TRIANGLES = 100000;
const integer = z.number().int().nonnegative().max(MAX_BYTES);
const vector = (length: number) =>
  z.array(z.number().finite().min(-1e6).max(1e6)).length(length);
const accessorSchema = z.object({
  bufferView: integer,
  byteOffset: integer.default(0),
  componentType: z.union([
    z.literal(5120),
    z.literal(5121),
    z.literal(5122),
    z.literal(5123),
    z.literal(5125),
    z.literal(5126),
  ]),
  type: z.enum(["SCALAR", "VEC2", "VEC3", "VEC4"]),
  count: z.number().int().min(1).max(300000),
  normalized: z.boolean().default(false),
  min: z.array(z.number().finite().min(-1e6).max(1e6)).min(1).max(4).optional(),
  max: z.array(z.number().finite().min(-1e6).max(1e6)).min(1).max(4).optional(),
});
const primitiveSchema = z.object({
  attributes: z.record(z.string(), integer),
  indices: integer.optional(),
  material: integer.optional(),
  mode: z.literal(4).default(4),
});
const documentSchema = z.object({
  asset: z.object({ version: z.literal("2.0") }),
  buffers: z.array(z.object({ byteLength: integer })).length(1),
  bufferViews: z
    .array(
      z.object({
        buffer: z.literal(0),
        byteOffset: integer.default(0),
        byteLength: integer,
        byteStride: z.number().int().min(4).max(252).optional(),
      }),
    )
    .min(1)
    .max(512),
  accessors: z.array(accessorSchema).min(1).max(512),
  meshes: z
    .array(z.object({ primitives: z.array(primitiveSchema).min(1).max(128) }))
    .min(1)
    .max(128),
  materials: z.array(z.record(z.string(), z.unknown())).max(128).default([]),
  nodes: z
    .array(
      z.object({
        mesh: integer.optional(),
        children: z.array(integer).max(256).default([]),
        translation: vector(3).optional(),
        rotation: vector(4).optional(),
        scale: vector(3).optional(),
        matrix: vector(16).optional(),
      }),
    )
    .min(1)
    .max(256),
  scenes: z
    .array(z.object({ nodes: z.array(integer).min(1).max(256) }))
    .min(1)
    .max(8),
  scene: integer.default(0),
});

function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw Error(`Invalid generated GLB: ${message}`);
}

/** Validate a deliberately bounded static, untextured triangle subset before GLTFLoader allocates geometry. */
export function validateGeneratedGLB(bytes: Uint8Array) {
  requireValid(
    bytes.byteLength >= 28 && bytes.byteLength <= MAX_BYTES,
    "size budget",
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireValid(
    view.getUint32(0, true) === 0x46546c67 &&
      view.getUint32(4, true) === 2 &&
      view.getUint32(8, true) === bytes.byteLength,
    "header",
  );
  let offset = 12;
  const chunks: { type: number; start: number; length: number }[] = [];
  while (offset < bytes.byteLength) {
    requireValid(offset + 8 <= bytes.byteLength, "truncated chunk");
    const length = view.getUint32(offset, true);
    requireValid(
      length % 4 === 0 && offset + 8 + length <= bytes.byteLength,
      "chunk range/alignment",
    );
    chunks.push({
      type: view.getUint32(offset + 4, true),
      start: offset + 8,
      length,
    });
    offset += 8 + length;
  }
  requireValid(
    chunks.length === 2 &&
      chunks[0].type === 0x4e4f534a &&
      chunks[1].type === 0x004e4942,
    "JSON and BIN chunks required",
  );
  const raw: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(chunks[0].start, chunks[0].start + chunks[0].length),
    ),
  );
  // Inspect raw JSON before schema parsing strips unknown properties. Optional
  // resource/geometry extensions are also rejected, rather than silently used.
  let visited = 0;
  function inspect(value: unknown, depth = 0) {
    requireValid(depth < 40 && ++visited < 100000, "JSON complexity");
    if (typeof value === "number")
      requireValid(Number.isFinite(value), "nonfinite JSON number");
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      requireValid(
        !["uri", "sparse", "targets", "weights", "skin"].includes(key),
        "external or dynamic data",
      );
      if (
        [
          "images",
          "textures",
          "skins",
          "animations",
          "extensionsRequired",
        ].includes(key)
      )
        requireValid(
          Array.isArray(child) && child.length === 0,
          "external or dynamic resources",
        );
      if (key === "extensions") {
        requireValid(
          child && typeof child === "object" && !Array.isArray(child),
          "extension object",
        );
        requireValid(
          Object.keys(child).every((name) =>
            [
              "KHR_materials_unlit",
              "KHR_materials_ior",
              "KHR_materials_specular",
            ].includes(name),
          ),
          "unsupported extension",
        );
      }
      inspect(child, depth + 1);
    }
  }
  inspect(raw);
  const doc = documentSchema.parse(raw);
  const bin = chunks[1];
  const bufferLength = doc.buffers[0].byteLength;
  requireValid(
    bufferLength > 0 &&
      bufferLength <= bin.length &&
      bin.length - bufferLength <= 3,
    "BIN length",
  );
  for (const buffer of doc.bufferViews) {
    requireValid(
      buffer.byteLength > 0 &&
        buffer.byteOffset + buffer.byteLength <= bufferLength,
      "buffer view range",
    );
    requireValid(
      buffer.byteStride === undefined || buffer.byteStride % 4 === 0,
      "stride alignment",
    );
  }
  const sizes: Record<number, number> = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
  };
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  let decodedBytes = 0;
  const readers = doc.accessors.map((accessor) => {
    const buffer = doc.bufferViews[accessor.bufferView];
    requireValid(buffer, "accessor buffer view");
    const size = sizes[accessor.componentType],
      width = widths[accessor.type];
    requireValid(
      (!accessor.min || accessor.min.length === width) &&
        (!accessor.max || accessor.max.length === width),
      "accessor bounds shape",
    );
    if (accessor.min && accessor.max)
      requireValid(
        accessor.min.every((v, i) => v <= accessor.max![i]),
        "accessor bounds order",
      );
    const elementBytes = size * width,
      stride = buffer.byteStride ?? elementBytes;
    requireValid(
      stride >= elementBytes &&
        accessor.byteOffset % size === 0 &&
        (buffer.byteOffset + accessor.byteOffset) % size === 0,
      "accessor alignment",
    );
    requireValid(
      accessor.byteOffset + (accessor.count - 1) * stride + elementBytes <=
        buffer.byteLength,
      "accessor range",
    );
    requireValid(
      !accessor.normalized ||
        [5120, 5121, 5122, 5123].includes(accessor.componentType),
      "normalized component type",
    );
    decodedBytes += accessor.count * elementBytes;
    requireValid(decodedBytes <= 8 * 1024 * 1024, "decoded accessor budget");
    const read = (index: number, component = 0) => {
      const start =
        bin.start +
        buffer.byteOffset +
        accessor.byteOffset +
        index * stride +
        component * size;
      switch (accessor.componentType) {
        case 5120:
          return view.getInt8(start);
        case 5121:
          return view.getUint8(start);
        case 5122:
          return view.getInt16(start, true);
        case 5123:
          return view.getUint16(start, true);
        case 5125:
          return view.getUint32(start, true);
        case 5126:
          return view.getFloat32(start, true);
      }
    };
    if (accessor.componentType === 5126)
      for (let i = 0; i < accessor.count; i++)
        for (let c = 0; c < width; c++)
          requireValid(
            Number.isFinite(read(i, c)) && Math.abs(read(i, c)) <= 1e6,
            "nonfinite or excessive attribute",
          );
    return { read, stride };
  });
  const meshCosts = doc.meshes.map((mesh) => {
    let vertices = 0,
      triangles = 0;
    for (const primitive of mesh.primitives) {
      const positionId = primitive.attributes.POSITION;
      const position = doc.accessors[positionId];
      requireValid(
        position &&
          position.type === "VEC3" &&
          position.componentType === 5126 &&
          !position.normalized,
        "POSITION accessor",
      );
      for (const [semantic, id] of Object.entries(primitive.attributes)) {
        const accessor = doc.accessors[id];
        requireValid(
          accessor && accessor.count === position.count,
          "attribute count/reference",
        );
        requireValid(
          [
            "POSITION",
            "NORMAL",
            "TANGENT",
            "COLOR_0",
            "TEXCOORD_0",
            "TEXCOORD_1",
          ].includes(semantic),
          "unsupported vertex attribute",
        );
        requireValid(
          semantic === "COLOR_0"
            ? ["VEC3", "VEC4"].includes(accessor.type)
            : accessor.type ===
                (semantic.startsWith("TEXCOORD")
                  ? "VEC2"
                  : semantic === "TANGENT"
                    ? "VEC4"
                    : "VEC3"),
          "attribute shape",
        );
        if (["NORMAL", "TANGENT"].includes(semantic))
          requireValid(
            accessor.componentType === 5126 && !accessor.normalized,
            "float attribute required",
          );
      }
      requireValid(
        primitive.material === undefined ||
          primitive.material < doc.materials.length,
        "material reference",
      );
      let count = position.count;
      if (primitive.indices !== undefined) {
        const index = doc.accessors[primitive.indices];
        requireValid(
          index &&
            index.type === "SCALAR" &&
            [5121, 5123, 5125].includes(index.componentType) &&
            !index.normalized,
          "index accessor",
        );
        requireValid(
          doc.bufferViews[index.bufferView].byteStride === undefined,
          "interleaved indices",
        );
        count = index.count;
        for (let i = 0; i < count; i++)
          requireValid(
            readers[primitive.indices].read(i) < position.count,
            "index out of range",
          );
      }
      requireValid(count % 3 === 0, "triangle index count");
      vertices += Math.max(count, position.count);
      triangles += count / 3;
      requireValid(
        vertices <= MAX_VERTICES && triangles <= MAX_TRIANGLES,
        "mesh workload",
      );
    }
    return { vertices, triangles };
  });
  requireValid(
    meshCosts.reduce((sum, cost) => sum + cost.vertices, 0) <= MAX_VERTICES,
    "aggregate mesh workload",
  );
  const parents = new Map<number, number>();
  for (const [id, node] of doc.nodes.entries()) {
    requireValid(
      node.mesh === undefined || node.mesh < doc.meshes.length,
      "node mesh reference",
    );
    requireValid(
      !node.matrix || (!node.translation && !node.rotation && !node.scale),
      "matrix and TRS conflict",
    );
    if (node.rotation)
      requireValid(
        Math.abs(node.rotation.reduce((sum, v) => sum + v * v, 0) - 1) < 0.01,
        "rotation quaternion",
      );
    for (const child of node.children) {
      requireValid(
        child < doc.nodes.length && child !== id && !parents.has(child),
        "node hierarchy",
      );
      parents.set(child, id);
    }
  }
  const visitedNodes = new Set<number>(),
    active = new Set<number>();
  function cycle(id: number) {
    requireValid(!active.has(id), "node cycle");
    if (visitedNodes.has(id)) return;
    active.add(id);
    for (const child of doc.nodes[id].children) cycle(child);
    active.delete(id);
    visitedNodes.add(id);
  }
  doc.nodes.forEach((_, id) => cycle(id));
  requireValid(doc.scene < doc.scenes.length, "default scene");
  for (const scene of doc.scenes) {
    let vertices = 0,
      triangles = 0;
    const seen = new Set<number>();
    function walk(id: number, parent = new Matrix4()) {
      requireValid(
        id < doc.nodes.length && !seen.has(id),
        "scene node reference/overlap",
      );
      seen.add(id);
      const node = doc.nodes[id];
      const local = node.matrix
        ? new Matrix4().fromArray(node.matrix)
        : new Matrix4().compose(
            new Vector3(...(node.translation ?? [0, 0, 0])),
            new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
            new Vector3(...(node.scale ?? [1, 1, 1])),
          );
      requireValid(
        local.elements[3] === 0 &&
          local.elements[7] === 0 &&
          local.elements[11] === 0 &&
          local.elements[15] === 1,
        "non-affine node matrix",
      );
      const world = parent.clone().multiply(local);
      requireValid(
        world.elements.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e6),
        "world transform budget",
      );
      if (node.mesh !== undefined)
        for (const primitive of doc.meshes[node.mesh].primitives) {
          const id = primitive.attributes.POSITION;
          const accessor = doc.accessors[id],
            reader = readers[id];
          for (let i = 0; i < accessor.count; i++) {
            const point = new Vector3(
              reader.read(i, 0),
              reader.read(i, 1),
              reader.read(i, 2),
            ).applyMatrix4(world);
            requireValid(
              [point.x, point.y, point.z].every(
                (v) => Number.isFinite(v) && Math.abs(v) <= 1e6,
              ),
              "world position budget",
            );
          }
        }
      if (node.mesh !== undefined) {
        vertices += meshCosts[node.mesh].vertices;
        triangles += meshCosts[node.mesh].triangles;
      }
      requireValid(
        vertices <= MAX_VERTICES && triangles <= MAX_TRIANGLES,
        "instanced scene workload",
      );
      node.children.forEach((child) => walk(child, world));
    }
    scene.nodes.forEach((id) => walk(id));
    requireValid(vertices > 0, "scene has no geometry");
  }
  return raw as unknown as { meshes: unknown[] };
}
