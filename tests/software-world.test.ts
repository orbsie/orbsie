import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  bakeSoftwareTextureColors,
  playableEntities,
  requiredGeometryReady,
  type SoftwareGeometryEntry,
} from "../src/components/software-world";
import { entitySchema, type Project } from "../src/lib/protocol";

const project = (entities: Project["entities"]) =>
  ({ entities } as Project);

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
