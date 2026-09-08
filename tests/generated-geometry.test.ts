import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  runBlenderModelingJob,
  type BlenderModelingResult,
} from "../scripts/blender-modeling";

const records = vi.hoisted(() => new Map<string, unknown>());
vi.mock("idb-keyval", () => ({
  get: async (key: string) => structuredClone(records.get(key)),
  update: async (key: string, updater: (value: unknown) => unknown) => {
    records.set(
      key,
      structuredClone(updater(structuredClone(records.get(key)))),
    );
  },
}));

import {
  GeneratedGeometryError,
  GeneratedGeometryLoader,
} from "../src/lib/generated-geometry";
import {
  readGeneratedModel,
  saveGeneratedModel,
} from "../src/lib/generated-models";

let actual: BlenderModelingResult;

beforeAll(async () => {
  actual = await runBlenderModelingJob({
    version: 1,
    parts: [
      {
        id: "box",
        shape: "box",
        position: [3, 4, 5],
        scale: [2, 1, 0.5],
        color: "#cc8844",
      },
      {
        id: "lathe",
        shape: "lathe",
        position: [-2, 1, -1],
        color: "#4488cc",
        profile: [
          [0, -1],
          [0.5, -0.5],
          [0.35, 0.5],
          [0, 1],
        ],
        segments: 12,
      },
    ],
  });
});

beforeEach(() => records.clear());

function resolverFor(bytes: Uint8Array, calls: string[] = []) {
  return async (hash: string, _signal: AbortSignal) => {
    calls.push(hash);
    return new Uint8Array(bytes);
  };
}

it("loads an actual Blender GLB with world transforms and material colors", async () => {
  const calls: string[] = [];
  const loader = new GeneratedGeometryLoader({
    resolveBytes: resolverFor(actual.glb, calls),
  });
  const loaded = await loader.load(actual.sha256);
  const position = loaded.geometry.getAttribute("position");
  const normal = loaded.geometry.getAttribute("normal");
  const color = loaded.geometry.getAttribute("color");
  expect(calls).toEqual([actual.sha256]);
  expect(position.count).toBeGreaterThan(0);
  expect(normal.count).toBe(position.count);
  expect(color.count).toBe(position.count);
  expect(loaded.geometry.userData.orbsieGeneratedHash).toBe(actual.sha256);
  expect(loaded.geometry.userData.sourceTransformsPreserved).toBe(true);
  expect(loaded.geometry.userData.sourceMaterialColorsPreserved).toBe(true);
  expect(loaded.geometry.boundingBox?.min.x).toBeCloseTo(
    actual.bounds.min[0],
    4,
  );
  expect(loaded.geometry.boundingBox?.min.y).toBeCloseTo(
    actual.bounds.min[1],
    4,
  );
  expect(loaded.geometry.boundingBox?.min.z).toBeCloseTo(
    actual.bounds.min[2],
    4,
  );
  expect(loaded.geometry.boundingBox?.max.x).toBeCloseTo(
    actual.bounds.max[0],
    4,
  );
  expect(loaded.geometry.boundingBox?.max.y).toBeCloseTo(
    actual.bounds.max[1],
    4,
  );
  expect(loaded.geometry.boundingBox?.max.z).toBeCloseTo(
    actual.bounds.max[2],
    4,
  );
  const colors = color.array as Float32Array;
  const distinct = new Set<string>();
  for (let index = 0; index < colors.length; index += 3)
    distinct.add(
      [colors[index], colors[index + 1], colors[index + 2]]
        .map((value) => value.toFixed(4))
        .join(","),
    );
  expect(distinct.size).toBeGreaterThanOrEqual(2);
  const sourceBuffer = new ArrayBuffer(actual.glb.byteLength);
  new Uint8Array(sourceBuffer).set(actual.glb);
  const source = await new GLTFLoader().parseAsync(sourceBuffer, "");
  const sourceColors: THREE.Color[] = [];
  source.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials)
      if ("color" in material && material.color instanceof THREE.Color)
        sourceColors.push(material.color);
  });
  for (const wanted of sourceColors) {
    expect(
      Array.from({ length: colors.length / 3 }, (_, index) => index).some(
        (index) =>
          Math.abs(colors[index * 3] - wanted.r) < 1e-4 &&
          Math.abs(colors[index * 3 + 1] - wanted.g) < 1e-4 &&
          Math.abs(colors[index * 3 + 2] - wanted.b) < 1e-4,
      ),
    ).toBe(true);
  }
  for (const hex of ["#cc8844", "#4488cc"]) {
    const wanted = new THREE.Color(hex);
    expect(
      Array.from({ length: colors.length / 3 }, (_, index) => index).some(
        (index) =>
          Math.abs(colors[index * 3] - wanted.r) < 1e-4 &&
          Math.abs(colors[index * 3 + 1] - wanted.g) < 1e-4 &&
          Math.abs(colors[index * 3 + 2] - wanted.b) < 1e-4,
      ),
    ).toBe(true);
  }
  source.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  loaded.release();
  loader.dispose();
});

it("reads the default IndexedDB model path and rejects content corruption", async () => {
  const metadata = await saveGeneratedModel(actual.glb, {
    blenderVersion: actual.blenderVersion,
    bounds: { min: actual.bounds.min, max: actual.bounds.max },
  });
  const restored = await readGeneratedModel(metadata.sha256);
  expect(restored.glb).toEqual(actual.glb);
  const loader = new GeneratedGeometryLoader();
  const loaded = await loader.load(metadata.sha256);
  expect(loaded.hash).toBe(metadata.sha256);
  loaded.release();
  loader.dispose();

  const corrupted = new Uint8Array(actual.glb);
  corrupted[corrupted.length - 1] ^= 1;
  const invalid = new GeneratedGeometryLoader({
    resolveBytes: resolverFor(corrupted),
  });
  await expect(invalid.load(actual.sha256)).rejects.toMatchObject({
    code: "integrity-failed",
  });
  invalid.dispose();
});

it("shares bounded leases and disposes an uncached geometry after final release", async () => {
  const loader = new GeneratedGeometryLoader({
    maxCacheBytes: 1,
    resolveBytes: resolverFor(actual.glb),
  });
  const firstPromise = loader.load(actual.sha256);
  const secondPromise = loader.load(actual.sha256);
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  expect(second.geometry).toBe(first.geometry);
  expect(loader.stats).toMatchObject({
    entries: 0,
    activeLeases: 2,
  });
  let disposed = 0;
  first.geometry.addEventListener("dispose", () => disposed++);
  first.release();
  expect(disposed).toBe(0);
  second.release();
  expect(disposed).toBe(1);
  expect(loader.stats.activeLeases).toBe(0);
  loader.dispose();
});

it("cancels a pending trusted resolver and leaves no cache entry", async () => {
  const controller = new AbortController();
  let sawAbort = false;
  const loader = new GeneratedGeometryLoader({
    resolveBytes: async (_hash, signal) =>
      new Promise<Uint8Array>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            sawAbort = true;
            reject(new Error("aborted"));
          },
          { once: true },
        );
      }),
  });
  const pending = loader.load(actual.sha256, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toBeInstanceOf(GeneratedGeometryError);
  await expect(pending).rejects.toMatchObject({ code: "aborted" });
  expect(sawAbort).toBe(true);
  expect(loader.stats).toMatchObject({ entries: 0, pending: 0 });
  loader.dispose();
});

it("rejects non-hash identities before invoking the resolver", async () => {
  const resolver = vi.fn(resolverFor(actual.glb));
  const loader = new GeneratedGeometryLoader({ resolveBytes: resolver });
  await expect(
    loader.load("https://example.com/model.glb"),
  ).rejects.toMatchObject({
    code: "invalid-hash",
  });
  expect(resolver).not.toHaveBeenCalled();
  loader.dispose();
});
