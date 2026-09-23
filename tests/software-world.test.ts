import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  bakeSoftwareTextureColors,
  playableEntities,
  projectSoftwareTerrainChunk,
  projectSoftwareTriangle,
  requiredGeometryReady,
  softwareCameraFrustum,
  softwareEntityPassesVisibility,
  softwareEntityMatrix,
  softwareGeometryVisibleInFrustum,
  softwarePickCenterIsVisible,
  terrainChunksForView,
  type TerrainChunkSelectionCache,
  type SoftwareGeometryEntry,
} from "../src/components/software-world";
import {
  createWorldNavigationState,
  worldNavigationFollowState,
  type WorldNavigationState,
} from "../src/lib/world-navigation";
import { worldTerrainChunkKeyAt } from "../src/lib/world-terrain";
import { entitySchema, type Project } from "../src/lib/protocol";
import type { WorldNavigationEntityBounds } from "../src/lib/world-navigation-bounds";
import { selectVisibleWorldEntityIds } from "../src/lib/world-visibility";
import { GameSession } from "../src/lib/game-session";
import { stepGameplay } from "../src/lib/gameplay";

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

describe("software gameplay terrain follow", () => {
  const cache = (): TerrainChunkSelectionCache => ({
    selectionKey: undefined,
    chunks: [],
  });

  it("recenters terrain for far player travel, caches within a cell, and restores the editor view", () => {
    const editorNavigation = createWorldNavigationState({
      target: [160, 2, -230],
      heading: 1.1,
      distance: 24,
    });
    const editorSnapshot = JSON.stringify(editorNavigation);
    const terrainCache = cache();
    const editorChunks = terrainChunksForView(
      terrainCache,
      editorNavigation,
      390 / 844,
    );
    const distantPosition = [65_430, 0.5, -72_190] as const;
    const follow = worldNavigationFollowState(
      editorNavigation,
      distantPosition,
    );
    const followedChunks = terrainChunksForView(
      terrainCache,
      follow,
      390 / 844,
    );

    expect(follow.target).toEqual(distantPosition);
    expect(followedChunks).not.toBe(editorChunks);
    expect(followedChunks).toHaveLength(49);
    const center = followedChunks[24];
    expect(center).toEqual(
      worldTerrainChunkKeyAt(
        distantPosition[0],
        distantPosition[2],
        center.lod,
      ),
    );

    const sameCellPosition = [65_431, 3.5, -72_191] as const;
    const withinCell = worldNavigationFollowState(
      editorNavigation,
      sameCellPosition,
    );
    expect(terrainChunksForView(terrainCache, withinCell, 390 / 844)).toBe(
      followedChunks,
    );

    const nextCellPosition = [65_500, 3.5, -72_250] as const;
    const nextCell = worldNavigationFollowState(
      editorNavigation,
      nextCellPosition,
    );
    const movedChunks = terrainChunksForView(terrainCache, nextCell, 390 / 844);
    expect(movedChunks).not.toBe(followedChunks);
    expect(movedChunks[24]).toEqual(
      worldTerrainChunkKeyAt(
        nextCellPosition[0],
        nextCellPosition[2],
        movedChunks[24].lod,
      ),
    );

    const restoredChunks = terrainChunksForView(
      terrainCache,
      editorNavigation,
      390 / 844,
    );
    expect(restoredChunks[24]).toEqual(
      worldTerrainChunkKeyAt(
        editorNavigation.target[0],
        editorNavigation.target[2],
        restoredChunks[24].lod,
      ),
    );
    expect(JSON.stringify(editorNavigation)).toBe(editorSnapshot);
  });

  it("uses conservative height buckets and safely caches invalid follow input", () => {
    const editorNavigation = createWorldNavigationState({
      target: [0, 0, 0],
      distance: 24,
    });
    const terrainCache = cache();
    const atSpawnHeight = worldNavigationFollowState(
      editorNavigation,
      [0, 0.5, 5],
    );
    const first = terrainChunksForView(terrainCache, atSpawnHeight, 1);
    const belowBucketEdge = worldNavigationFollowState(
      editorNavigation,
      [0, 3.9, 5],
    );
    expect(terrainChunksForView(terrainCache, belowBucketEdge, 1)).toBe(first);

    const aboveBucketEdge = worldNavigationFollowState(
      editorNavigation,
      [0, 4.1, 5],
    );
    expect(terrainChunksForView(terrainCache, aboveBucketEdge, 1)).not.toBe(
      first,
    );

    const invalidFollow = worldNavigationFollowState(editorNavigation, [
      Number.NaN,
      0,
      0,
    ]);
    expect(invalidFollow.target).toEqual(editorNavigation.target);
    const invalidCamera = {
      ...editorNavigation,
      target: [Number.NaN, 0, 0] as WorldNavigationState["target"],
    };
    const invalidChunks = terrainChunksForView(terrainCache, invalidCamera, 1);
    expect(invalidChunks).toEqual([]);
    expect(terrainChunksForView(terrainCache, invalidCamera, 1)).toBe(
      invalidChunks,
    );
  });
});

describe("software entity triangle clipping", () => {
  const camera = () => {
    const value = new THREE.PerspectiveCamera(90, 1, 1, 10);
    value.lookAt(0, 0, -1);
    value.updateProjectionMatrix();
    value.updateMatrixWorld();
    return value;
  };

  it("clips a triangle crossing the near plane into a bounded screen polygon", () => {
    const face = projectSoftwareTriangle(
      [
        new THREE.Vector3(-0.5, -0.5, -2),
        new THREE.Vector3(0.5, -0.5, -0.5),
        new THREE.Vector3(0, 0.6, -2),
      ],
      camera(),
      400,
      400,
    );

    expect(face).toBeDefined();
    expect(face!.points.length).toBeGreaterThanOrEqual(3);
    expect(
      Number.isFinite(face!.depth) &&
        face!.depth >= -10 &&
        face!.depth <= -1 &&
        face!.points.every(
          ({ x, y, z }) =>
            Number.isFinite(x) &&
            Number.isFinite(y) &&
            Number.isFinite(z) &&
            x >= 0 &&
            x <= 400 &&
            y >= 0 &&
            y <= 400,
        ),
    ).toBe(true);
  });

  it("rejects triangles entirely before the near plane, behind the camera, or degenerate", () => {
    const view = camera();
    expect(
      projectSoftwareTriangle(
        [
          new THREE.Vector3(-0.5, -0.5, -0.5),
          new THREE.Vector3(0.5, -0.5, -0.5),
          new THREE.Vector3(0, 0.5, -0.5),
        ],
        view,
        400,
        400,
      ),
    ).toBeUndefined();
    expect(
      projectSoftwareTriangle(
        [
          new THREE.Vector3(-0.5, -0.5, 1),
          new THREE.Vector3(0.5, -0.5, 1),
          new THREE.Vector3(0, 0.5, 1),
        ],
        view,
        400,
        400,
      ),
    ).toBeUndefined();
    expect(
      projectSoftwareTriangle(
        [
          new THREE.Vector3(-0.5, 0, -2),
          new THREE.Vector3(0, 0, -2),
          new THREE.Vector3(0.5, 0, -2),
        ],
        view,
        400,
        400,
      ),
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

  it("culls distant gameplay geometry but keeps missing or invalid bounds visible", () => {
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 250);
    camera.position.set(0, 4, 12);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const frustum = softwareCameraFrustum(camera)!;
    const matrix = new THREE.Matrix4().makeTranslation(10_000, 0, 0);
    const entry = (geometry: THREE.BufferGeometry): SoftwareGeometryEntry => ({
      geometry,
      ready: true,
      sourceRecipe: undefined,
      sourceStage: "ready",
    });
    const distant = entry(new THREE.BoxGeometry(2, 2, 2));
    const missing = entry(new THREE.BufferGeometry());
    const invalidGeometry = new THREE.BufferGeometry();
    invalidGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([Number.NaN, 0, 0], 3),
    );

    expect(softwareGeometryVisibleInFrustum(distant, matrix, frustum)).toBe(
      false,
    );
    expect(softwareGeometryVisibleInFrustum(missing, matrix, frustum)).toBe(
      true,
    );
    expect(
      softwareGeometryVisibleInFrustum(entry(invalidGeometry), matrix, frustum),
    ).toBe(true);

    distant.geometry.dispose();
    missing.geometry.dispose();
    invalidGeometry.dispose();
  });

  it("uses a teleported current pose to restore drawing without a project revision", () => {
    const entity = entitySchema.parse({
      id: "teleported",
      label: "Teleported object",
      position: [10_000, 0, 0],
      stage: "ready",
    });
    const snapshot = project([entity]);
    snapshot.revision = 4;
    const session = new GameSession();
    session.sync("test-world", {
      variables: [],
      rules: [
        {
          id: "teleport-on-start",
          trigger: { type: "start" },
          conditions: [],
          actions: [
            {
              type: "set_position",
              entityId: entity.id,
              position: [0, 0, 0],
            },
          ],
        },
      ],
    });
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 250);
    camera.position.set(0, 4, 12);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const frustum = softwareCameraFrustum(camera)!;
    const entry: SoftwareGeometryEntry = {
      geometry: new THREE.BoxGeometry(0.5, 0.5, 0.5),
      ready: true,
      sourceRecipe: undefined,
      sourceStage: "ready",
    };
    const beforeTeleport = softwareEntityMatrix(
      snapshot,
      entity,
      0,
      session,
      true,
    );

    expect(
      softwareGeometryVisibleInFrustum(entry, beforeTeleport, frustum),
    ).toBe(false);
    session.advance(0);
    const afterTeleport = softwareEntityMatrix(
      snapshot,
      entity,
      0,
      session,
      true,
    );
    expect(
      softwareGeometryVisibleInFrustum(entry, afterTeleport, frustum),
    ).toBe(true);
    expect(snapshot.revision).toBe(4);
    expect(snapshot.entities[0].position).toEqual([10_000, 0, 0]);
    entry.geometry.dispose();
  });

  it("leaves distant gameplay collection authority intact when its mesh is culled", () => {
    const collectible = entitySchema.parse({
      id: "far-collectible",
      label: "Far collectible",
      position: [10_000, 0.42, 0],
      stage: "ready",
      geometry: { kind: "crystal", detail: "coarse" },
      behavior: { type: "collect" },
    });
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 250);
    camera.position.set(0, 4, 12);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const entry: SoftwareGeometryEntry = {
      geometry: new THREE.BoxGeometry(),
      ready: true,
      sourceRecipe: undefined,
      sourceStage: "ready",
    };

    expect(
      softwareGeometryVisibleInFrustum(
        entry,
        softwareEntityMatrix(
          project([collectible]),
          collectible,
          0,
          new GameSession(),
          true,
        ),
        softwareCameraFrustum(camera)!,
      ),
    ).toBe(false);
    const result = stepGameplay(
      { position: [10_000, 0.42, 0], velocityY: 0 },
      { x: 0, z: 0, jump: false },
      [collectible],
      [],
      0,
      0.016,
    );
    expect(result.collected).toContain(collectible.id);
    entry.geometry.dispose();
  });
});
