import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  bakeSoftwareTextureColors,
  playableEntities,
  projectSoftwareTerrainChunk,
  requiredGeometryReady,
  softwareEntityPassesVisibility,
  softwarePickCenterIsVisible,
  type SoftwareGeometryEntry,
} from "../src/components/software-world";
import { entitySchema, type Project } from "../src/lib/protocol";
import type { WorldNavigationEntityBounds } from "../src/lib/world-navigation-bounds";
import { selectVisibleWorldEntityIds } from "../src/lib/world-visibility";

const project = (entities: Project["entities"]) => ({ entities }) as Project;

describe("software renderer geometry readiness", () => {
  it("bakes atlas colors into a clone without mutating source geometry or pixels", () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    source.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(
        [0.5, 1, 0.25, 0.5, 1, 0.25, 0.5, 1, 0.25],
        3,
      ),
    );
    source.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 2),
    );
    const pixels = new Uint8Array([128, 64, 32, 255]);
    const texture = new THREE.DataTexture(pixels, 1, 1, THREE.RGBAFormat);
    texture.colorSpace = "srgb-linear";
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    const originalColors = Array.from(source.getAttribute("color").array);
    const originalPixels = Array.from(pixels);
    const baked = bakeSoftwareTextureColors(source.clone(), texture);
    expect(Array.from(source.getAttribute("color").array)).toEqual(
      originalColors,
    );
    expect(Array.from(pixels)).toEqual(originalPixels);
    expect(baked.getAttribute("color").getX(0)).toBeCloseTo(0.5 * (128 / 255));
    expect(baked.getAttribute("color").getY(0)).toBeCloseTo(64 / 255);
    expect(baked.getAttribute("color").getZ(0)).toBeCloseTo(0.25 * (32 / 255));
    baked.dispose();
    texture.dispose();
    source.dispose();
  });

  it("keeps the last-good recipe paired with its collision stage while loading a replacement", () => {
    const oldEntity = entitySchema.parse({
      id: "model",
      label: "Old model",
      position: [0, 0, 0],
      stage: "ready",
      geometry: {
        kind: "asset",
        assetId: "kenney.nature.tree-default",
        detail: "refined",
      },
    });
    const replacement = entitySchema.parse({
      ...oldEntity,
      geometry: {
        kind: "asset",
        assetId: "kenney.nature.mushroom-red",
        detail: "refined",
      },
      stage: "coarse",
    });
    const entry: SoftwareGeometryEntry = {
      geometry: new THREE.BoxGeometry(),
      ready: true,
      sourceRecipe: oldEntity.geometry,
      sourceStage: oldEntity.stage,
    };
    const geometries = new Map([[oldEntity.id, entry]]);

    const playable = playableEntities(project([replacement]), geometries);
    expect(playable[0].geometry).toBe(oldEntity.geometry);
    expect(playable[0].stage).toBe("ready");
    expect(requiredGeometryReady(project([replacement]), geometries)).toBe(
      false,
    );
    entry.geometry.dispose();
  });

  it("announces readiness for procedural primitives without an external asset lease", () => {
    const primitive = entitySchema.parse({
      id: "platform",
      label: "Platform",
      position: [0, 0, 0],
      stage: "ready",
      geometry: { kind: "platform", detail: "refined" },
    });
    expect(requiredGeometryReady(project([primitive]), new Map())).toBe(true);
    expect(playableEntities(project([primitive]), new Map())).toEqual([
      primitive,
    ]);
  });
});

describe("software ground chunk projection", () => {
  const cameraFor = (
    position: [number, number, number],
    target: [number, number, number],
  ) => {
    const camera = new THREE.PerspectiveCamera(43, 390 / 844, 0.1, 250);
    camera.position.set(...position);
    camera.lookAt(...target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return camera;
  };

  it("clips a chunk crossing the near plane to finite viewport coordinates", () => {
    const camera = cameraFor([0, 0.01, 0], [0, 0.01, -1]);
    const polygon = projectSoftwareTerrainChunk(
      { lod: 0, x: -1, z: -1 },
      camera,
      390,
      844,
    );

    expect(polygon).toBeDefined();
    expect(polygon!.length).toBeGreaterThanOrEqual(3);
    expect(
      polygon!.every(
        ({ x, y }) =>
          Number.isFinite(x) &&
          Number.isFinite(y) &&
          x >= 0 &&
          x <= 390 &&
          y >= 0 &&
          y <= 844,
      ),
    ).toBe(true);
  });

  it("rejects chunks behind or far outside the camera frustum", () => {
    const camera = cameraFor([0, 2, 5], [0, 0, 0]);
    expect(
      projectSoftwareTerrainChunk({ lod: 0, x: 0, z: 1 }, camera, 390, 844),
    ).toBeUndefined();
    expect(
      projectSoftwareTerrainChunk({ lod: 0, x: 100, z: -1 }, camera, 390, 844),
    ).toBeUndefined();
    expect(
      projectSoftwareTerrainChunk({ lod: 0, x: 0, z: -1 }, camera, 0, 844),
    ).toBeUndefined();
  });
});

describe("software visibility and picking", () => {
  it("gates settled draw work by the shared frustum while leaving gameplay uncullled", () => {
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 250);
    camera.position.set(0, 12, 24);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const entities = [
      { id: "visible" },
      { id: "offscreen" },
      { id: "unknown" },
    ];
    const boundsByEntity: WorldNavigationEntityBounds = new Map([
      ["visible", { min: [-1, -1, -1], max: [1, 1, 1] }],
      ["offscreen", { min: [99, -1, -31], max: [101, 1, -29] }],
      ["unknown", undefined],
    ]);
    const visible = selectVisibleWorldEntityIds(
      entities,
      boundsByEntity,
      camera,
    );

    expect(visible.has("visible")).toBe(true);
    expect(visible.has("offscreen")).toBe(false);
    expect(visible.has("unknown")).toBe(true);
    expect(softwareEntityPassesVisibility("offscreen", visible)).toBe(false);
    expect(softwareEntityPassesVisibility("offscreen")).toBe(true);
  });

  it("rejects offscreen, behind-camera, and nonfinite software pick centers", () => {
    const center = { x: 120, y: 240, z: 0 };
    expect(softwarePickCenterIsVisible(center, 390, 844)).toBe(true);
    expect(softwarePickCenterIsVisible({ x: -1, y: 240, z: 0 }, 390, 844)).toBe(
      false,
    );
    expect(
      softwarePickCenterIsVisible({ x: 120, y: 240, z: 1.1 }, 390, 844),
    ).toBe(false);
    expect(
      softwarePickCenterIsVisible({ x: Number.NaN, y: 240, z: 0 }, 390, 844),
    ).toBe(false);
  });
});
