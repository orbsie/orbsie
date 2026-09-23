import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  bakeSoftwareTextureColors,
  playableEntities,
  projectSoftwareResidencyProxy,
  projectSoftwareTerrainChunk,
  projectSoftwareTriangle,
  requiredGeometryReady,
  softwareProxyBoundsByEntity,
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
import { entitySchema, groupSchema, type Project } from "../src/lib/protocol";
import type { WorldNavigationEntityBounds } from "../src/lib/world-navigation-bounds";
import { selectVisibleWorldEntityIds } from "../src/lib/world-visibility";
import { GameSession } from "../src/lib/game-session";
import { stepGameplay } from "../src/lib/gameplay";
import { formationRecipeIdentity } from "../src/lib/formation-completion";
import {
  releaseOwnedSoftwareGeometry,
  softwareActiveProxyIds,
  selectSoftwareFormationResidency,
  softwareEntityVisualReviewReady,
  softwareProxyDrawnForRevision,
  type SoftwareFormationCompletionRecord,
} from "../src/lib/software-formation-residency";

const project = (entities: Project["entities"]) => ({ entities }) as Project;

function completeProject(
  entities: Project["entities"],
  groups: Project["groups"] = [],
): Project {
  return {
    version: 1,
    id: "software-residency-fixture",
    title: "Software residency fixture",
    seed: 1,
    revision: 1,
    entities,
    groups,
    environment: { sky: "#ffffff", ground: "#ffffff", water: "#ffffff" },
    messages: [],
  };
}

function readyAsset(
  id: string,
  position: [number, number, number] = [0, 0, 0],
) {
  return entitySchema.parse({
    id,
    label: id,
    position,
    stage: "ready",
    geometry: {
      kind: "asset",
      assetId: "kenney.nature.tree-default",
      detail: "refined",
    },
  });
}

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

  it("keeps only 48 completed external recipes resident and follows travel", () => {
    const entities = Array.from({ length: 160 }, (_, index) =>
      readyAsset(`entity-${String(index).padStart(3, "0")}`, [index, 0, 0]),
    );
    const completed = new Map(
      entities.map((entity) => [entity.id, formationRecipeIdentity(entity)]),
    );
    const bounds = new Map(
      entities.map((entity, index) => [
        entity.id,
        { center: [index, 0, 0] as const, size: [1, 2, 1] as const },
      ]),
    );
    const presentation = selectSoftwareFormationResidency({
      entities,
      completedRecipeByEntity: completed,
      proxyBoundsByEntity: bounds,
      focus: [0, 0, 0],
      enabled: true,
    });

    expect(presentation.residentIds.size).toBe(48);
    expect(presentation.fullFormationIds.size).toBe(48);
    expect(presentation.proxyIds.size).toBe(112);

    const travelEntities = [
      readyAsset("west", [-1000, 0, 0]),
      readyAsset("east", [1000, 0, 0]),
    ];
    const travelCompleted = new Map(
      travelEntities.map((entity) => [
        entity.id,
        formationRecipeIdentity(entity),
      ]),
    );
    const travelBounds = new Map(
      travelEntities.map((entity) => [
        entity.id,
        {
          center: entity.position as readonly [number, number, number],
          size: [2, 2, 2] as const,
        },
      ]),
    );
    const west = selectSoftwareFormationResidency({
      entities: travelEntities,
      completedRecipeByEntity: travelCompleted,
      proxyBoundsByEntity: travelBounds,
      focus: [-1000, 0, 0],
      enabled: true,
    });
    const east = selectSoftwareFormationResidency({
      entities: travelEntities,
      completedRecipeByEntity: travelCompleted,
      proxyBoundsByEntity: travelBounds,
      focus: [1000, 0, 0],
      enabled: true,
      previousResidentIds: west.residentIds,
    });
    const revisit = selectSoftwareFormationResidency({
      entities: travelEntities,
      completedRecipeByEntity: travelCompleted,
      proxyBoundsByEntity: travelBounds,
      focus: [-1000, 0, 0],
      enabled: true,
      previousResidentIds: east.residentIds,
    });
    expect([...west.residentIds]).toEqual(["west"]);
    expect([...east.residentIds]).toEqual(["east"]);
    expect([...revisit.residentIds]).toEqual(["west"]);
  });

  it("prioritizes visible and selected entities while retaining unknown bounds", () => {
    const entities = Array.from({ length: 50 }, (_, index) =>
      readyAsset(`entity-${String(index).padStart(2, "0")}`),
    );
    const completed = new Map(
      entities.map((entity) => [entity.id, formationRecipeIdentity(entity)]),
    );
    const bounds = new Map<
      string,
      | {
          center: readonly [number, number, number];
          size: readonly [number, number, number];
        }
      | undefined
    >(
      entities.map((entity) => [
        entity.id,
        { center: [0, 0, 0] as const, size: [1, 1, 1] as const },
      ]),
    );
    bounds.set("entity-49", undefined);
    const presentation = selectSoftwareFormationResidency({
      entities,
      completedRecipeByEntity: completed,
      proxyBoundsByEntity: bounds,
      focus: [0, 0, 0],
      enabled: true,
      visibleIds: new Set(["entity-48"]),
      selectedId: "entity-47",
    });

    expect(presentation.residentIds.has("entity-47")).toBe(true);
    expect(presentation.residentIds.has("entity-48")).toBe(true);
    expect(presentation.fullFormationIds.has("entity-49")).toBe(true);
    expect(presentation.proxyIds.has("entity-49")).toBe(false);
  });

  it("keeps a completed proxy visible while a resident lease is rehydrating", () => {
    const entity = readyAsset("reentry");
    const identity = formationRecipeIdentity(entity);
    const bounds = new Map([
      [entity.id, { center: [0, 0, 0] as const, size: [1, 1, 1] as const }],
    ]);
    const completed = new Map([[entity.id, identity]]);
    const presentation = selectSoftwareFormationResidency({
      entities: [entity],
      completedRecipeByEntity: completed,
      proxyBoundsByEntity: bounds,
      focus: [0, 0, 0],
      selectedId: entity.id,
      enabled: true,
    });
    const noDisplayedLease = softwareActiveProxyIds({
      entities: [entity],
      presentation,
      completedRecipeByEntity: completed,
      displayedByEntity: new Map(),
    });
    const loadedLease = softwareActiveProxyIds({
      entities: [entity],
      presentation,
      completedRecipeByEntity: completed,
      displayedByEntity: new Map([
        [
          entity.id,
          {
            ready: true,
            sourceRecipe: entity.geometry,
            sourceStage: entity.stage,
            sourceColor: entity.color,
          },
        ],
      ]),
    });

    expect(presentation.residentIds.has(entity.id)).toBe(true);
    expect(noDisplayedLease.has(entity.id)).toBe(true);
    expect(loadedLease.has(entity.id)).toBe(false);
  });

  it("gates current visible draws and permits completed offscreen proxy review", () => {
    const entity = readyAsset("tree");
    const recipeIdentity = formationRecipeIdentity(entity);
    const completion: SoftwareFormationCompletionRecord = {
      recipeIdentity,
      loadedRevision: 2,
    };
    const projectNow = { ...project([entity]), id: "review", revision: 3 };
    const offscreenProxyReady = requiredGeometryReady(
      projectNow,
      new Map(),
      new Map([[entity.id, completion]]),
      new Set(),
      new Set([entity.id]),
      new Set(),
    );
    expect(offscreenProxyReady).toBe(true);
    expect(
      softwareEntityVisualReviewReady(
        entity,
        undefined,
        completion,
        3,
        true,
        true,
        true,
        false,
      ),
    ).toBe(false);
    const proxyDraw = {
      projectId: projectNow.id,
      revision: projectNow.revision,
      recipeIdentity,
    };
    expect(
      softwareProxyDrawnForRevision(
        entity,
        projectNow.id,
        projectNow.revision,
        proxyDraw,
      ),
    ).toBe(true);
    expect(
      requiredGeometryReady(
        projectNow,
        new Map(),
        new Map([[entity.id, completion]]),
        new Set([entity.id]),
        new Set([entity.id]),
        new Set([entity.id]),
        new Set(),
        new Map([[entity.id, proxyDraw]]),
      ),
    ).toBe(true);

    const changedRecipe = entitySchema.parse({
      ...entity,
      color: "#ff0000",
    });
    expect(
      softwareEntityVisualReviewReady(
        changedRecipe,
        undefined,
        completion,
        3,
        false,
        true,
      ),
    ).toBe(false);
    const fullEntry: SoftwareGeometryEntry = {
      geometry: new THREE.BoxGeometry(),
      ready: true,
      sourceRecipe: entity.geometry,
      sourceStage: entity.stage,
      sourceColor: entity.color,
    };
    expect(
      softwareEntityVisualReviewReady(entity, fullEntry, completion, 3, true),
    ).toBe(false);
    completion.fullDrawnRevision = 3;
    expect(
      softwareEntityVisualReviewReady(entity, fullEntry, completion, 3, true),
    ).toBe(true);
    fullEntry.geometry.dispose();
  });

  it("does not let stale lease cleanup remove a newer clone", () => {
    const stale = new THREE.BoxGeometry();
    const current = new THREE.SphereGeometry();
    const entries = new Map<string, { geometry: THREE.BufferGeometry }>([
      ["tree", { geometry: current }],
    ]);
    const disposed = new WeakSet<THREE.BufferGeometry>();
    const disposedEvents = new Map<THREE.BufferGeometry, number>();
    const disposeOnce = (geometry: THREE.BufferGeometry) => {
      if (disposed.has(geometry)) return;
      disposed.add(geometry);
      disposedEvents.set(geometry, (disposedEvents.get(geometry) ?? 0) + 1);
      geometry.dispose();
    };

    expect(
      releaseOwnedSoftwareGeometry<
        THREE.BufferGeometry,
        { geometry: THREE.BufferGeometry }
      >(entries, "tree", stale, disposeOnce),
    ).toBe(false);
    expect(entries.get("tree")?.geometry).toBe(current);
    expect(
      releaseOwnedSoftwareGeometry<
        THREE.BufferGeometry,
        { geometry: THREE.BufferGeometry }
      >(entries, "tree", current, disposeOnce),
    ).toBe(true);
    expect(entries.has("tree")).toBe(false);
    expect(disposedEvents.get(stale)).toBe(1);
    expect(disposedEvents.get(current)).toBe(1);
    disposeOnce(stale);
    expect(disposedEvents.get(stale)).toBe(1);
  });

  it("derives proxy centers from grouped and rotated world bounds", () => {
    const entity = entitySchema.parse({
      ...readyAsset("grouped-leaf", [2, 0, 0]),
      parentId: "far-group",
    });
    const group = groupSchema.parse({
      id: "far-group",
      label: "Far group",
      position: [25_000, 0, 0],
      rotation: [0, Math.PI / 2, 0],
    });
    const bounds = softwareProxyBoundsByEntity(
      completeProject([entity], [group]),
    ).get(entity.id);

    expect(bounds).toBeDefined();
    expect(bounds!.center[0]).toBeGreaterThan(24_900);
    expect(Math.abs(bounds!.center[2])).toBeLessThan(20);
    expect(bounds!.center[0]).not.toBe(entity.position[0]);
  });

  it("keeps edge-straddling proxy geometry visible when its center is outside", () => {
    const camera = new THREE.PerspectiveCamera(43, 390 / 844, 0.1, 250);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const bounds = {
      center: [1.3, 0, 0] as const,
      size: [2, 2, 1] as const,
    };
    const node = { worldPosition: bounds.center };
    const runtime = new THREE.Matrix4().makeTranslation(...bounds.center);
    const projection = projectSoftwareResidencyProxy(
      bounds,
      node,
      runtime,
      camera,
      390,
      844,
    );

    expect(projection).toBeDefined();
    expect(projection!.point.x).toBeGreaterThanOrEqual(0);
    expect(projection!.point.x).toBeLessThanOrEqual(390);
    expect(projection!.radius).toBeGreaterThan(0);

    const outside = projectSoftwareResidencyProxy(
      { center: [20, 0, 0], size: [1, 1, 1] },
      { worldPosition: [20, 0, 0] },
      new THREE.Matrix4().makeTranslation(20, 0, 0),
      camera,
      390,
      844,
    );
    expect(outside).toBeUndefined();

    const farCamera = new THREE.PerspectiveCamera(43, 390 / 844, 0.1, 20_000);
    farCamera.position.set(0, 0, 5);
    farCamera.lookAt(0, 0, 0);
    farCamera.updateProjectionMatrix();
    farCamera.updateMatrixWorld();
    const tinyFarProxy = projectSoftwareResidencyProxy(
      { center: [0, 0, -10_000], size: [0.12, 0.12, 0.12] },
      { worldPosition: [0, 0, -10_000] },
      new THREE.Matrix4().makeTranslation(0, 0, -10_000),
      farCamera,
      390,
      844,
    );
    expect(tinyFarProxy).toBeDefined();
    expect(tinyFarProxy!.radius).toBe(6);
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
