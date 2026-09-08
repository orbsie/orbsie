import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  validateGeneratedGLB,
  generatedGLBBounds,
  inspectGeneratedGLB,
} from "../src/lib/generated-glb";

function triangle() {
  return {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
}
function encode(
  document: object,
  binary = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer),
) {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const binLength = Math.ceil(binary.length / 4) * 4;
  const bytes = new Uint8Array(28 + jsonLength + binLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonLength);
  bytes.set(json, 20);
  view.setUint32(20 + jsonLength, binLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  bytes.set(binary, 28 + jsonLength);
  return bytes;
}
it("accepts a minimal static mesh and real multi-material Kenney GLB", () => {
  expect(validateGeneratedGLB(encode(triangle())).meshes).toHaveLength(1);
  expect(
    validateGeneratedGLB(
      readFileSync("public/models/kenney/nature-kit/tree_default.glb"),
    ).meshes.length,
  ).toBeGreaterThan(0);
});
it("rejects incomplete/misaligned chunk framing and JSON-only fake meshes", () => {
  const valid = encode(triangle());
  for (const offset of [8, 12, 16, valid.length - 40]) {
    const bad = valid.slice();
    new DataView(bad.buffer).setUint32(offset, 0xffffffff, true);
    expect(() => validateGeneratedGLB(bad)).toThrow();
  }
  const bad = valid.slice(0, valid.length - 44);
  new DataView(bad.buffer).setUint32(8, bad.length, true);
  expect(() => validateGeneratedGLB(bad)).toThrow();
  expect(() =>
    validateGeneratedGLB(encode({ asset: { version: "2.0" }, meshes: [{}] })),
  ).toThrow();
});
it.each([
  { buffers: [{ byteLength: 36, uri: "https://example.com/secret.bin" }] },
  { images: [{ uri: "data:image/png;base64,AAAA" }] },
  { skins: [{}] },
  { animations: [{}] },
  { extensionsRequired: ["KHR_mesh_quantization"] },
  {
    extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 0 } } },
  },
  {
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        sparse: { count: 1000000000 },
      },
    ],
  },
  { accessors: [{ componentType: 5126, count: 1000000000, type: "VEC3" }] },
  {
    accessors: [
      { bufferView: 0, componentType: 5126, count: 300000, type: "VEC3" },
    ],
  },
  { bufferViews: [{ buffer: 0, byteOffset: 32, byteLength: 36 }] },
  { bufferViews: [{ buffer: 0, byteLength: 36, byteStride: 8 }] },
  {
    accessors: [
      {
        bufferView: 0,
        byteOffset: 1,
        componentType: 5126,
        count: 2,
        type: "VEC3",
      },
    ],
  },
])(
  "rejects resource or oversized accessor metadata %# before model parsing",
  (patch) => {
    expect(() =>
      validateGeneratedGLB(encode({ ...triangle(), ...patch })),
    ).toThrow();
  },
);
it("rejects nonfinite position data", () => {
  const binary = new Uint8Array(
    new Float32Array([Infinity, 0, 0, 1, 0, 0, 0, 1, 0]).buffer,
  );
  expect(() => validateGeneratedGLB(encode(triangle(), binary))).toThrow(
    "nonfinite",
  );
});
it("checks index component type, range and triangle counts", () => {
  const binary = new Uint8Array(40);
  binary.set(
    new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer),
  );
  binary.set([0, 1, 9], 36);
  const base = triangle();
  const doc = {
    ...base,
    buffers: [{ byteLength: 40 }],
    bufferViews: [
      ...base.bufferViews,
      { buffer: 0, byteOffset: 36, byteLength: 3 },
    ],
    accessors: [
      ...base.accessors,
      { bufferView: 1, componentType: 5121, count: 3, type: "SCALAR" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  };
  expect(() => validateGeneratedGLB(encode(doc, binary))).toThrow(
    "index out of range",
  );
  binary[38] = 2;
  expect(() => validateGeneratedGLB(encode(doc, binary))).not.toThrow();
  doc.accessors[1].count = 2;
  expect(() => validateGeneratedGLB(encode(doc, binary))).toThrow(
    "triangle index count",
  );
});
it.each([
  { nodes: [{ mesh: 0, children: [0] }] },
  { nodes: [{ children: [1] }, { mesh: 0, children: [0] }] },
  { nodes: [{ mesh: 0, children: [1, 1] }, {}] },
  { nodes: [{ mesh: 1 }] },
  { scenes: [{ nodes: [2] }] },
  { scenes: [{ nodes: [0, 0] }] },
  { nodes: [{ mesh: 0, rotation: [0, 0, 0, 0] }] },
])("rejects invalid scene graphs and transforms %#", (patch) => {
  expect(() =>
    validateGeneratedGLB(encode({ ...triangle(), ...patch })),
  ).toThrow();
});
it("bounds repeated mesh instances even when the binary itself is tiny", () => {
  const base = triangle();
  const primitives = Array.from({ length: 128 }, () => ({
    attributes: { POSITION: 0 },
  }));
  // 128 primitives * 256 nodes * 6 expanded vertices > 100000.
  const binary = new Uint8Array(72);
  const doc = {
    ...base,
    buffers: [{ byteLength: 72 }],
    bufferViews: [{ buffer: 0, byteLength: 72 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 6, type: "VEC3" }],
    meshes: [{ primitives }],
    nodes: Array.from({ length: 256 }, () => ({ mesh: 0 })),
    scenes: [{ nodes: Array.from({ length: 256 }, (_, id) => id) }],
  };
  expect(() => validateGeneratedGLB(encode(doc, binary))).toThrow(
    "instanced scene workload",
  );
});
it("rejects invalid accessor bounds and compounded node transforms", () => {
  const base = triangle();
  for (const patch of [
    { min: [0, 0] },
    { min: [1, 0, 0], max: [0, 1, 1] },
    { min: [0, 0, "bad"] },
  ])
    expect(() =>
      validateGeneratedGLB(
        encode({ ...base, accessors: [{ ...base.accessors[0], ...patch }] }),
      ),
    ).toThrow();
  const nodes = [
    { scale: [10000, 10000, 10000], children: [1] },
    { scale: [10000, 10000, 10000], mesh: 0 },
  ];
  expect(() => validateGeneratedGLB(encode({ ...base, nodes }))).toThrow(
    "world transform budget",
  );
  expect(() =>
    validateGeneratedGLB(
      encode({
        ...base,
        nodes: [
          { mesh: 0, matrix: [1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        ],
      }),
    ),
  ).toThrow("non-affine");
});
it("checks canonical default-scene bounds using actual transformed triangle vertices", () => {
  const root = Math.SQRT1_2;
  const doc = {
    ...triangle(),
    nodes: [
      { translation: [10, 20, 30], children: [1] },
      { mesh: 0, rotation: [0, 0, root, root], scale: [2, 3, 1] },
    ],
  };
  const bytes = encode(doc),
    bounds = generatedGLBBounds(bytes);
  expect(bounds.min[0]).toBeCloseTo(7);
  expect(bounds.min[1]).toBeCloseTo(20);
  expect(bounds.min[2]).toBeCloseTo(30);
  expect(bounds.max[0]).toBeCloseTo(10);
  expect(bounds.max[1]).toBeCloseTo(22);
  expect(bounds.max[2]).toBeCloseTo(30);
  expect(() =>
    validateGeneratedGLB(bytes, { min: [7, 20, 30], max: [10, 22, 30] }),
  ).not.toThrow();
  expect(inspectGeneratedGLB(bytes).document.meshes).toHaveLength(1);
  for (const invalid of [
    {
      min: [7, 20, 30] as [number, number, number],
      max: [10, 23, 30] as [number, number, number],
    },
    {
      min: [0, 0, 0] as [number, number, number],
      max: [1e308, 1e308, 1e308] as [number, number, number],
    },
  ])
    expect(() => validateGeneratedGLB(bytes, invalid)).toThrow();
});
it("does not let unused accessor vertices or other scenes enlarge canonical model bounds", () => {
  const base = triangle(),
    binary = new Uint8Array(52);
  binary.set(
    new Uint8Array(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 999, 999, 999]).buffer,
    ),
  );
  binary.set([0, 1, 2], 48);
  const doc = {
    ...base,
    buffers: [{ byteLength: 52 }],
    bufferViews: [
      { buffer: 0, byteLength: 48 },
      { buffer: 0, byteOffset: 48, byteLength: 3 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
      { bufferView: 1, componentType: 5121, count: 3, type: "SCALAR" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }, { mesh: 0, translation: [100, 100, 100] }],
    scenes: [{ nodes: [0] }, { nodes: [1] }],
  };
  expect(generatedGLBBounds(encode(doc, binary))).toEqual({
    min: [0, 0, 0],
    max: [1, 1, 0],
  });
});
