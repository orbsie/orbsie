import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  playableEntities,
  requiredGeometryReady,
  type SoftwareGeometryEntry,
} from "../src/components/software-world";
import { entitySchema, type Project } from "../src/lib/protocol";

const project = (entities: Project["entities"]) =>
  ({ entities } as Project);

describe("software renderer geometry readiness", () => {
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
