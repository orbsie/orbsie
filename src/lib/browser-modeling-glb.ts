import { BufferAttribute, BufferGeometry, Color } from "three";
import { z } from "zod";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { BrowserModelEvaluation } from "./browser-modeling-kernel";
import { validateGeneratedGLB } from "./generated-glb";

const materialSchema = z
  .object({
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    roughness: z.number().finite().min(0).max(1).default(0.8),
  })
  .strict();

/** Bake derived mesh data; recipes remain in the editable project, not this asset. */
export function bakeBrowserModelGLB(
  mesh: BrowserModelEvaluation,
  appearance: z.input<typeof materialSchema>,
): Uint8Array {
  const material = materialSchema.parse(appearance);
  if (
    !(mesh.vertices instanceof Float32Array) ||
    !(mesh.indices instanceof Uint32Array) ||
    !mesh.vertices.length ||
    mesh.vertices.length % 3 ||
    !mesh.indices.length ||
    mesh.indices.length % 3 ||
    mesh.vertices.length > 300000 ||
    mesh.indices.length > 300000 ||
    !mesh.vertices.every(Number.isFinite) ||
    mesh.indices.some((index) => index >= mesh.vertices.length / 3)
  )
    throw Error("Invalid browser mesh for GLB export.");
  const geometry = new BufferGeometry();
  let shaded: BufferGeometry | undefined;
  try {
    geometry.setAttribute("position", new BufferAttribute(mesh.vertices, 3));
    geometry.setIndex(new BufferAttribute(mesh.indices, 1));
    // Split hard edges while preserving smooth curved surfaces.
    shaded = toCreasedNormals(geometry, Math.PI / 3);
    const vertices = shaded.getAttribute("position").array as Float32Array;
    const normals = shaded.getAttribute("normal").array as Float32Array;
    const indices = Uint32Array.from(
      { length: vertices.length / 3 },
      (_, i) => i,
    );
    const arrays = [vertices, normals, indices];
    const binaryLength = arrays.reduce(
      (sum, array) => sum + array.byteLength,
      0,
    );
    if (binaryLength > 2 * 1024 * 1024)
      throw Error("Browser model exceeds the generated asset size budget.");
    let offset = 0;
    const views = arrays.map((array) => {
      const view = {
        buffer: 0,
        byteOffset: offset,
        byteLength: array.byteLength,
      };
      offset += array.byteLength;
      return view;
    });
    const color = new Color(material.color);
    const document = {
      asset: { version: "2.0", generator: "Orbsie browser modeling" },
      buffers: [{ byteLength: binaryLength }],
      bufferViews: views,
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: vertices.length / 3,
          type: "VEC3",
          min: mesh.bounds.min,
          max: mesh.bounds.max,
        },
        {
          bufferView: 1,
          componentType: 5126,
          count: normals.length / 3,
          type: "VEC3",
        },
        {
          bufferView: 2,
          componentType: 5125,
          count: indices.length,
          type: "SCALAR",
        },
      ],
      materials: [
        {
          pbrMetallicRoughness: {
            baseColorFactor: [color.r, color.g, color.b, 1],
            metallicFactor: 0,
            roughnessFactor: material.roughness,
          },
        },
      ],
      meshes: [
        {
          primitives: [
            {
              attributes: { POSITION: 0, NORMAL: 1 },
              indices: 2,
              material: 0,
              mode: 4,
            },
          ],
        },
      ],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    };
    const json = new TextEncoder().encode(JSON.stringify(document));
    const jsonLength = Math.ceil(json.length / 4) * 4;
    const bytes = new Uint8Array(12 + 8 + jsonLength + 8 + binaryLength);
    const header = new DataView(bytes.buffer);
    header.setUint32(0, 0x46546c67, true);
    header.setUint32(4, 2, true);
    header.setUint32(8, bytes.length, true);
    header.setUint32(12, jsonLength, true);
    header.setUint32(16, 0x4e4f534a, true);
    bytes.fill(0x20, 20, 20 + jsonLength);
    bytes.set(json, 20);
    const binaryStart = 20 + jsonLength;
    header.setUint32(binaryStart, binaryLength, true);
    header.setUint32(binaryStart + 4, 0x004e4942, true);
    offset = binaryStart + 8;
    for (const array of arrays) {
      bytes.set(
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
        offset,
      );
      offset += array.byteLength;
    }
    validateGeneratedGLB(bytes, mesh.bounds);
    return bytes;
  } finally {
    shaded?.dispose();
    geometry.dispose();
  }
}
