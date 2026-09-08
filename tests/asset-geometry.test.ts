import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  AssetGeometryLoader,
  type AssetBytesFetcher,
} from "../src/lib/asset-geometry";
import {
  assetFilePathFor,
  requireCatalogAsset,
  type AssetId,
} from "../src/lib/asset-catalog";

const root = path.resolve(__dirname, "..");

async function checkedInBytes(id: AssetId): Promise<ArrayBuffer> {
  const bytes = await fs.readFile(path.join(root, assetFilePathFor(id)));
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function readerFor(
  calls: string[] = [],
  override?: (url: string, signal: AbortSignal) => Promise<ArrayBuffer>,
): AssetBytesFetcher {
  return async (url, signal) => {
    calls.push(url);
    if (override) return override(url, signal);
    const id = (url.match(/[^/]+\.glb$/)?.[0] ?? "").replace(".glb", "");
    const byFile: Record<string, AssetId> = {
      tree_default: "kenney.nature.tree-default",
      platform_grass: "kenney.nature.platform-grass",
      bridge_wood: "kenney.nature.bridge-wood",
    };
    const assetId = byFile[id];
    if (!assetId) throw new Error(`unknown test path ${url}`);
    return checkedInBytes(assetId);
  };
}

describe("asynchronous catalog geometry loading", () => {
  it("bakes source node transforms and material colors into merged formation geometry", async () => {
    const id = "kenney.nature.tree-default" as const;
    const loader = new AssetGeometryLoader({ fetchBytes: readerFor() });
    const loaded = await loader.load(id);
    const position = loaded.geometry.getAttribute("position");
    const color = loaded.geometry.getAttribute("color");
    expect(position.count).toBeGreaterThan(0);
    expect(color.count).toBe(position.count);
    expect(loaded.geometry.userData.sourceTransformsPreserved).toBe(true);
    expect(loaded.geometry.userData.sourceMaterialColorsPreserved).toBe(true);

    const raw = await checkedInBytes(id);
    const source = await new GLTFLoader().parseAsync(
      raw,
      requireCatalogAsset(id).path,
    );
    source.scene.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3();
    source.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const bounds = new THREE.Box3().setFromObject(mesh);
      sourceBounds.union(bounds);
    });
    const mergedBounds = loaded.geometry.boundingBox!;
    expect(mergedBounds.min.x).toBeCloseTo(sourceBounds.min.x, 5);
    expect(mergedBounds.min.y).toBeCloseTo(sourceBounds.min.y, 5);
    expect(mergedBounds.max.y).toBeCloseTo(sourceBounds.max.y, 5);

    const colors = color.array as Float32Array;
    const expected: THREE.Color[] = [];
    source.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        if ("color" in material && material.color instanceof THREE.Color)
          expected.push(material.color);
      }
    });
    expect(
      expected.some((wanted) => {
        for (let i = 0; i < colors.length; i += 3) {
          if (
            Math.abs(colors[i] - wanted.r) < 1e-5 &&
            Math.abs(colors[i + 1] - wanted.g) < 1e-5 &&
            Math.abs(colors[i + 2] - wanted.b) < 1e-5
          )
            return true;
        }
        return false;
      }),
    ).toBe(true);
    loaded.release();
    loader.dispose();
    source.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  });

  it("shares bounded cache ownership and disposes after eviction or loader teardown", async () => {
    const calls: string[] = [];
    const loader = new AssetGeometryLoader({
      fetchBytes: readerFor(calls),
      maxCacheEntries: 1,
    });
    const first = await loader.load("kenney.nature.tree-default");
    const second = await loader.load("kenney.nature.tree-default");
    expect(second.geometry).toBe(first.geometry);
    expect(loader.stats).toMatchObject({ entries: 1, activeLeases: 2 });
    let disposed = 0;
    first.geometry.addEventListener("dispose", () => disposed++);
    first.release();
    expect(disposed).toBe(0);
    second.release();
    expect(loader.stats.activeLeases).toBe(0);

    const bridge = await loader.load("kenney.nature.bridge-wood");
    expect(disposed).toBe(1);
    bridge.release();
    expect(calls).toHaveLength(2);
    loader.dispose();
    expect(loader.stats).toEqual({
      entries: 0,
      bytes: 0,
      pending: 0,
      activeLeases: 0,
    });
  });

  it("bounds reads, rejects unknown IDs, and propagates cancellation without fallback geometry", async () => {
    const calls: string[] = [];
    const loader = new AssetGeometryLoader({
      maxAssetBytes: 32,
      fetchBytes: readerFor(calls),
    });
    await expect(
      loader.load("kenney.nature.tree-default"),
    ).rejects.toMatchObject({ code: "too-large" });
    await expect(
      loader.load("https://evil.example/model.glb" as AssetId),
    ).rejects.toMatchObject({
      code: "unknown-id",
    });
    expect(loader.stats.entries).toBe(0);
    loader.dispose();

    let sawAbort = false;
    const controller = new AbortController();
    const pendingLoader = new AssetGeometryLoader({
      fetchBytes: async (_url, signal) =>
        new Promise<ArrayBuffer>((_, reject) => {
          signal.addEventListener("abort", () => {
            sawAbort = true;
            reject(new Error("aborted"));
          });
        }),
    });
    const pending = pendingLoader.load("kenney.nature.tree-default", {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: "aborted",
    });
    expect(sawAbort).toBe(true);
    expect(pendingLoader.stats.entries).toBe(0);
    pendingLoader.dispose();
  });
});
