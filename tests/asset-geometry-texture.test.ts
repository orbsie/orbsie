import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  decodeAssetGeometry,
  transferableAssetGeometryBuffers,
  type AssetGeometryTransfer,
} from "../src/lib/asset-geometry-core";
import { reconstructAssetGeometry } from "../src/lib/asset-geometry-queue";
import { AssetGeometryLoader } from "../src/lib/asset-geometry";
import {
  assetFilePathFor,
  requireCatalogAsset,
} from "../src/lib/asset-catalog";

const root = path.resolve(__dirname, "..");
const texturedPath = path.join(
  root,
  "docs/evidence/mushroom-basic-textured-filter-corrected/prototype.glb",
);

type JsonRecord = Record<string, unknown>;
interface TestImage extends JsonRecord {
  bufferView?: number;
}
interface TestBufferView extends JsonRecord {
  byteOffset: number;
  byteLength: number;
}
interface TestPbr extends JsonRecord {
  baseColorTexture: JsonRecord;
}
interface TestMaterial extends JsonRecord {
  pbrMetallicRoughness: TestPbr;
}
interface TestPrimitive extends JsonRecord {
  material?: number;
}
interface TestMesh extends JsonRecord {
  primitives: TestPrimitive[];
}
interface TestJson extends JsonRecord {
  images: TestImage[];
  textures: JsonRecord[];
  bufferViews: TestBufferView[];
  materials: TestMaterial[];
  meshes: TestMesh[];
}

function readGlb(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let jsonBytes: Uint8Array | undefined;
  let binary = new Uint8Array(0);
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) jsonBytes = chunk;
    if (type === 0x004e4942) binary = new Uint8Array(chunk);
    offset += 8 + length;
  }
  if (!jsonBytes) throw new Error("fixture JSON chunk missing");
  return {
    json: JSON.parse(new TextDecoder().decode(jsonBytes).trim()) as TestJson,
    binary,
  };
}

function writeGlb(json: TestJson, binary: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadding = (4 - (jsonBytes.byteLength % 4)) % 4;
  const binaryPadding = (4 - (binary.byteLength % 4)) % 4;
  const total =
    12 +
    8 +
    jsonBytes.byteLength +
    jsonPadding +
    8 +
    binary.byteLength +
    binaryPadding;
  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  let offset = 12;
  view.setUint32(offset, jsonBytes.byteLength + jsonPadding, true);
  view.setUint32(offset + 4, 0x4e4f534a, true);
  output.set(jsonBytes, offset + 8);
  output.fill(
    0x20,
    offset + 8 + jsonBytes.byteLength,
    offset + 8 + jsonBytes.byteLength + jsonPadding,
  );
  offset += 8 + jsonBytes.byteLength + jsonPadding;
  view.setUint32(offset, binary.byteLength + binaryPadding, true);
  view.setUint32(offset + 4, 0x004e4942, true);
  output.set(binary, offset + 8);
  return output;
}

async function malformedGlb(
  mutate: (json: TestJson, binary: Uint8Array) => void,
): Promise<Uint8Array> {
  const source = new Uint8Array(await fs.readFile(texturedPath));
  const { json, binary } = readGlb(source);
  mutate(json, binary);
  return writeGlb(json, binary);
}

async function decodeMalformed(
  bytes: Uint8Array,
  maxGeometryBytes = 24 * 1024 * 1024,
) {
  return decodeAssetGeometry(
    bytes,
    "kenney.nature.tree-default",
    250_000,
    maxGeometryBytes,
    { verifyManifest: false, maxAssetBytes: 2 * 1024 * 1024 },
  );
}

describe("embedded catalog texture decoder contract", () => {
  it("rejects external images before GLTFLoader can request them", async () => {
    const bytes = await malformedGlb((json) => {
      json.images[0].uri = "data:image/png;base64,AAAA";
      delete json.images[0].bufferView;
    });
    await expect(decodeMalformed(bytes)).rejects.toMatchObject({
      code: "unsafe-url",
    });
  });

  it("rejects malformed and oversized embedded PNG ranges before decode", async () => {
    const badPng = await malformedGlb((json, binary) => {
      const bufferViewIndex = json.images[0].bufferView;
      if (bufferViewIndex === undefined)
        throw new Error("fixture bufferView missing");
      const imageView = json.bufferViews[bufferViewIndex];
      binary[imageView.byteOffset] = 0;
    });
    await expect(decodeMalformed(badPng)).rejects.toMatchObject({
      code: "parse-failed",
    });

    const badRange = await malformedGlb((json) => {
      json.images[0].bufferView = 999;
    });
    await expect(decodeMalformed(badRange)).rejects.toMatchObject({
      code: "parse-failed",
    });

    const oversized = await malformedGlb((json, binary) => {
      const bufferViewIndex = json.images[0].bufferView;
      if (bufferViewIndex === undefined)
        throw new Error("fixture bufferView missing");
      const imageView = json.bufferViews[bufferViewIndex];
      new DataView(
        binary.buffer,
        binary.byteOffset + imageView.byteOffset,
      ).setUint32(16, 2048, false);
    });
    await expect(decodeMalformed(oversized)).rejects.toMatchObject({
      code: "too-large",
    });

    const pixelBudget = await malformedGlb(() => {});
    await expect(
      decodeMalformed(pixelBudget, 512 * 512 * 4 - 1),
    ).rejects.toMatchObject({ code: "too-large" });
  });

  it("rejects multiple images, unsupported maps, and nested extensions explicitly", async () => {
    const multipleImages = await malformedGlb((json) => {
      json.images.push({ ...json.images[0] });
    });
    await expect(decodeMalformed(multipleImages)).rejects.toMatchObject({
      code: "parse-failed",
    });

    const unsupportedMap = await malformedGlb((json) => {
      json.materials[0].normalTexture = { index: 0 };
    });
    await expect(decodeMalformed(unsupportedMap)).rejects.toMatchObject({
      code: "parse-failed",
    });

    const nestedExtension = await malformedGlb((json) => {
      json.materials[0].pbrMetallicRoughness.baseColorTexture.extensions = {
        KHR_texture_transform: {},
      };
    });
    await expect(decodeMalformed(nestedExtension)).rejects.toMatchObject({
      code: "parse-failed",
    });

    const transparentMaterial = await malformedGlb((json) => {
      json.materials[0].alphaMode = "BLEND";
    });
    await expect(decodeMalformed(transparentMaterial)).rejects.toMatchObject({
      code: "parse-failed",
    });

    const doubleSidedMaterial = await malformedGlb((json) => {
      json.materials[0].doubleSided = true;
    });
    await expect(decodeMalformed(doubleSidedMaterial)).rejects.toMatchObject({
      code: "parse-failed",
    });
  });

  it("rejects omitted and malformed textured primitive material indices", async () => {
    const malformedMutations: Array<(json: TestJson) => void> = [
      (json) => {
        delete json.meshes[0].primitives[0].material;
      },
      (json) => {
        json.meshes[0].primitives[0].material = -1;
      },
      (json) => {
        json.meshes[0].primitives[0].material = 0.5;
      },
      (json) => {
        json.meshes[0].primitives[0].material = 999;
      },
    ];
    for (const mutate of malformedMutations) {
      const bytes = await malformedGlb(mutate);
      await expect(decodeMalformed(bytes)).rejects.toMatchObject({
        code: "parse-failed",
      });
    }
  });

  it("reconstructs and transfers typed RGBA pixels with geometry", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const pixels = new Uint8Array(2 * 2 * 4).fill(7);
    const decoded: AssetGeometryTransfer = {
      attributes: {
        position: { array: positions, itemSize: 3, normalized: false },
      },
      box: { min: [0, 0, 0], max: [1, 1, 0] },
      sphere: { center: [0.5, 0.5, 0], radius: 1 },
      byteLength: positions.byteLength + pixels.byteLength,
      baseColorTexture: {
        pixels,
        width: 2,
        height: 2,
        colorSpace: "srgb",
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        magFilter: THREE.LinearFilter,
        minFilter: THREE.LinearMipmapLinearFilter,
        generateMipmaps: true,
        channel: 0,
      },
      userData: { sourceTransformsPreserved: true },
    };
    const prepared = reconstructAssetGeometry(decoded);
    expect(prepared.baseColorTexture?.pixels).toBe(pixels);
    expect(prepared.baseColorTexture?.width).toBe(2);
    expect(prepared.geometry.getAttribute("position").array).toBe(positions);
    expect(prepared.geometry.userData).not.toHaveProperty("baseColorTexture");
    expect(transferableAssetGeometryBuffers(decoded)).toEqual(
      expect.arrayContaining([positions.buffer, pixels.buffer]),
    );
    prepared.geometry.dispose();
  });

  it("rejects malformed transferred texture descriptors without dropping them", () => {
    const base: AssetGeometryTransfer = {
      attributes: {},
      box: { min: [0, 0, 0], max: [0, 0, 0] },
      sphere: { center: [0, 0, 0], radius: 0 },
      byteLength: 0,
      userData: {},
    };
    const validTexture = {
      pixels: new Uint8Array(16),
      width: 2,
      height: 2,
      colorSpace: "srgb",
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearMipmapLinearFilter,
      generateMipmaps: true,
      channel: 0,
    };
    for (const texture of [
      null,
      { ...validTexture, wrapT: 999 },
      { ...validTexture, magFilter: THREE.LinearMipmapLinearFilter },
      { ...validTexture, channel: 1 },
    ]) {
      expect(() =>
        reconstructAssetGeometry({
          ...base,
          baseColorTexture:
            texture as unknown as AssetGeometryTransfer["baseColorTexture"],
        }),
      ).toThrow(/base-color texture/);
    }
  });

  it("counts decoded texture pixels in loader cache admission and eviction", async () => {
    const previousBitmap = Object.getOwnPropertyDescriptor(
      globalThis,
      "createImageBitmap",
    );
    const previousCanvas = Object.getOwnPropertyDescriptor(
      globalThis,
      "OffscreenCanvas",
    );
    class FakeCanvasContext {
      clearRect() {}
      drawImage() {}
      getImageData(_x: number, _y: number, width: number, height: number) {
        return { data: new Uint8ClampedArray(width * height * 4) } as ImageData;
      }
    }
    class FakeOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        return new FakeCanvasContext();
      }
    }
    Object.defineProperty(globalThis, "createImageBitmap", {
      configurable: true,
      value: async () => ({ width: 512, height: 512, close() {} }),
    });
    Object.defineProperty(globalThis, "OffscreenCanvas", {
      configurable: true,
      value: FakeOffscreenCanvas,
    });
    try {
      const texturedBytes = await fs.readFile(texturedPath);
      const bridgePath = path.join(
        root,
        assetFilePathFor("kenney.nature.bridge-wood"),
      );
      const bridgeBytes = await fs.readFile(bridgePath);
      const loader = new AssetGeometryLoader({
        verifyManifest: false,
        maxCacheEntries: 1,
        fetchBytes: async (url) =>
          url.includes("tree_default") ? texturedBytes : bridgeBytes,
      });
      const textured = await loader.load("kenney.nature.tree-default");
      const geometryBytes = Object.values(textured.geometry.attributes).reduce(
        (total, attribute) => total + attribute.array.byteLength,
        0,
      );
      expect(textured.baseColorTexture?.pixels.byteLength).toBe(512 * 512 * 4);
      expect(textured.geometry.userData).not.toHaveProperty("baseColorTexture");
      expect(textured.byteLength).toBe(geometryBytes + 512 * 512 * 4);
      expect(loader.stats.bytes).toBe(textured.byteLength);
      let disposed = 0;
      textured.geometry.addEventListener("dispose", () => disposed++);
      textured.release();
      const bridge = await loader.load("kenney.nature.bridge-wood");
      expect(disposed).toBe(1);
      expect(loader.stats).toMatchObject({
        entries: 1,
        bytes: bridge.byteLength,
      });
      expect(bridge.baseColorTexture).toBeUndefined();
      bridge.release();
      loader.dispose();
    } finally {
      if (previousBitmap)
        Object.defineProperty(globalThis, "createImageBitmap", previousBitmap);
      else Reflect.deleteProperty(globalThis, "createImageBitmap");
      if (previousCanvas)
        Object.defineProperty(globalThis, "OffscreenCanvas", previousCanvas);
      else Reflect.deleteProperty(globalThis, "OffscreenCanvas");
    }
  });
});
