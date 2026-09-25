"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { useOrb } from "@/lib/store";
import { entityGeometry, terrainValue } from "@/lib/geometry";
import { useAssetGeometry } from "@/lib/use-asset-geometry";
import { useGeneratedGeometry } from "@/lib/use-generated-geometry";
import { isAssetId } from "@/lib/asset-catalog";
import {
  gameplayEntityForVisualState,
  isTextEntryTarget,
  movingEntityPosition,
  playerSpawnForProject,
  stepGameplay,
  type PlayerState,
} from "@/lib/gameplay";
import {
  gameplayObservationRequested,
  publishGameplayObservation,
} from "@/lib/gameplay-observation";
import {
  PlayerInputTracker,
  actionForPlayerKey,
  type PlayerInputDetail,
} from "@/lib/player-input";
import { GameSession, GAME_RULES_RESTART_NOTICE } from "@/lib/game-session";
import {
  resolveRuntimeScene,
  runtimeEntityMatrix,
  usesSceneHierarchy,
} from "@/lib/scene-runtime";
import type { ResolvedScene } from "@/lib/scene-transform";
import {
  sampleTexture,
  type FormationTextureSample,
} from "@/lib/formation-particles";
import type { Entity, Project } from "@/lib/protocol";
import {
  worldNavigationBoundsByEntity,
  type WorldNavigationEntityBounds,
} from "@/lib/world-navigation-bounds";
import {
  formationProxyVisualBounds,
  playbackFormationResidencyFocusCell,
  type FormationProxyVisualBounds,
} from "@/lib/formation-residency-presentation";
import { formationRecipeIdentity } from "@/lib/formation-completion";
import {
  releaseOwnedSoftwareGeometry,
  softwareActiveProxyIds,
  selectSoftwareFormationResidency,
  softwareProxyDrawnForRevision,
  softwareEntityVisualReviewReady,
  softwareGeometryMatchesEntity,
  type SoftwareFormationCompletionRecord,
  type SoftwareProxyDrawRecord,
} from "@/lib/software-formation-residency";
import { selectVisibleWorldEntityIds } from "@/lib/world-visibility";
import {
  globeScale,
  parcelTransitionController,
  smoothTransition,
} from "@/lib/parcel-transition";
import {
  worldNavigationCameraPose,
  worldNavigationFarPlane,
  worldNavigationFollowState,
  worldNavigationLandingLookTarget,
  type WorldNavigationState,
} from "@/lib/world-navigation";
import type { WorldNavigationCommand } from "@/lib/world-navigation";
import { WorldNavigationGestureController } from "@/lib/world-navigation-gestures";
import {
  selectWorldTerrainChunks,
  worldTerrainChunkKeyAt,
  worldTerrainChunkSize,
  worldTerrainGroundViewRadius,
  type WorldTerrainChunkKey,
} from "@/lib/world-terrain";
import {
  notifySceneReviewCaptureChanged,
  captureSceneReview,
  captureSceneCanvas,
  sceneReviewCameraViewFromMatrixWorld,
  registerSceneReviewCaptureSource,
  type SceneReviewSourceState,
} from "@/lib/scene-review-capture";

export type SoftwareGeometryEntry = {
  geometry: THREE.BufferGeometry;
  tint?: string;
  ready: boolean;
  /** The recipe/stage that produced this geometry. Keep these paired while a
   * replacement asset is still loading so collision uses the displayed mesh. */
  sourceRecipe: Entity["geometry"];
  sourceStage: Entity["stage"];
  sourceColor?: string;
};

type SoftwareWorldFixtureDiagnostics = typeof globalThis & {
  __ORBSIE_SOFTWARE_WORLD_DIAGNOSTICS_REQUESTED__?: boolean;
  __ORBSIE_SOFTWARE_WORLD_DIAGNOSTICS_READ__?: () => {
    renderer: "software";
    mounted: boolean;
    canvasConnected: boolean;
    playing: boolean;
    phase: string;
    documentVisibility: DocumentVisibilityState;
    documentHasFocus: boolean;
    loopStopped: boolean;
    frameScheduled: boolean;
    frameCount: number;
    lastFrameAtMs: number | null;
    lastFrameAgeMs: number | null;
    lastFrameGapMs: number | null;
    maxFrameGapMs: number;
    lastFrameDurationMs: number | null;
    maxFrameDurationMs: number;
    heartbeatCount: number;
    lastHeartbeatAtMs: number | null;
    lastHeartbeatAgeMs: number | null;
    maxHeartbeatGapMs: number;
    observationCount: number;
    lastObservationAtMs: number | null;
    runtimeError: {
      name: string;
      message: string;
      stack: string | null;
    } | null;
  };
};

const localSoftwareBounds = new WeakMap<
  THREE.BufferGeometry,
  THREE.Box3 | null
>();

type SoftwareWorldProps = {
  navigation: WorldNavigationState;
  getNavigation: () => WorldNavigationState;
  navigationGestureController: WorldNavigationGestureController;
  navigationEnabled: boolean;
  onNavigationCommand: (command: WorldNavigationCommand) => void;
  onNavigationClickSuppression: (pointerId: number) => void;
  clearNavigationGestures: () => void;
  clearNavigationClickFallback: () => void;
  consumeNavigationClick: (pointerId?: number) => boolean;
  onReady?: () => void;
  onNavigationReady?: () => void;
  onRendererReady?: (renderer?: "software") => void;
  onError?: (message: string) => void;
};

const softwareRendererError =
  "This browser could not start its 2D graphics fallback. Your world needs a browser with canvas support.";
const softwareFallbackWarning =
  "WebGL2 is not usable on this device, so Orbsie is using compatibility graphics.";
function playerStartForProject(project: Project): PlayerState {
  return { position: playerSpawnForProject(project), velocityY: 0 };
}
let motionPreference: MediaQueryList | undefined;
const reduced = () => {
  if (typeof window === "undefined") return false;
  motionPreference ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return motionPreference.matches;
};

function copyPlayerState(value: PlayerState): PlayerState {
  return {
    ...value,
    position: [...value.position] as [number, number, number],
    supportPosition: value.supportPosition
      ? ([...value.supportPosition] as [number, number, number])
      : undefined,
    supportMatrix: value.supportMatrix ? [...value.supportMatrix] : undefined,
  };
}

function toSrgb(value: number): number {
  const linear = Math.max(0, Math.min(1, value));
  return Math.round(
    (linear <= 0.0031308
      ? linear * 12.92
      : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055) * 255,
  );
}

function cssColor(rgb: readonly [number, number, number], alpha = 1): string {
  return `rgb(${toSrgb(rgb[0])} ${toSrgb(rgb[1])} ${toSrgb(rgb[2])} / ${alpha})`;
}

function readColor(
  attribute:
    THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  index: number,
): [number, number, number] {
  if (!attribute || index >= attribute.count) return [1, 1, 1];
  return [attribute.getX(index), attribute.getY(index), attribute.getZ(index)];
}

function textureSample(
  texture: THREE.DataTexture,
): FormationTextureSample | undefined {
  const image = texture.image;
  const pixels = image?.data;
  if (
    !(pixels instanceof Uint8Array) ||
    !Number.isSafeInteger(image?.width) ||
    !Number.isSafeInteger(image?.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    pixels.byteLength !== image.width * image.height * 4 ||
    !["", "srgb", "srgb-linear"].includes(texture.colorSpace)
  )
    return undefined;
  return {
    pixels,
    width: image.width,
    height: image.height,
    colorSpace: texture.colorSpace as FormationTextureSample["colorSpace"],
    wrapS: texture.wrapS,
    wrapT: texture.wrapT,
    magFilter: texture.magFilter,
    minFilter: texture.minFilter,
  };
}

/** Bake a bounded atlas approximation into committed software vertex colors. */
export function bakeSoftwareTextureColors(
  geometry: THREE.BufferGeometry,
  texture: THREE.DataTexture | undefined,
): THREE.BufferGeometry {
  if (!texture) return geometry;
  const sample = textureSample(texture);
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  if (!sample || !position || !uv || uv.itemSize < 2) return geometry;
  const sourceColors = geometry.getAttribute("color");
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index++) {
    const source = readColor(sourceColors, index);
    const sampled =
      index < uv.count &&
      Number.isFinite(uv.getX(index)) &&
      Number.isFinite(uv.getY(index))
        ? sampleTexture(sample, [uv.getX(index), uv.getY(index)])
        : ([1, 1, 1] as const);
    colors[index * 3] = source[0] * sampled[0];
    colors[index * 3 + 1] = source[1] * sampled[1];
    colors[index * 3 + 2] = source[2] * sampled[2];
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function makeEntityGeometry(entity: Entity): SoftwareGeometryEntry {
  const geometry = entityGeometry(
    entity.geometry?.kind === "asset" || entity.geometry?.kind === "generated"
      ? { ...entity, geometry: undefined }
      : entity,
  );
  return {
    geometry,
    ready:
      entity.geometry?.kind !== "asset" &&
      entity.geometry?.kind !== "generated",
    sourceRecipe: entity.geometry,
    sourceStage: entity.stage,
    sourceColor: entity.color,
  };
}

function SoftwareEntity({
  entity,
  onChange,
  onAssetError,
}: {
  entity: Entity;
  onChange: (
    id: string,
    entry: SoftwareGeometryEntry | undefined,
    disposed?: THREE.BufferGeometry,
  ) => boolean;
  onAssetError: (id: string, error: string | undefined) => void;
}) {
  const ownedGeometry = useRef<THREE.BufferGeometry | undefined>(undefined);
  const recipe =
    entity.geometry?.kind === "asset" || entity.geometry?.kind === "generated"
      ? entity.geometry
      : undefined;
  const catalog = useAssetGeometry(
    recipe?.kind === "asset" && isAssetId(recipe.assetId)
      ? recipe.assetId
      : undefined,
  );
  const generated = useGeneratedGeometry(
    recipe?.kind === "generated" ? recipe.model?.sha256 : undefined,
  );
  const loaded = recipe?.kind === "generated" ? generated : catalog;
  const loadedTexture = recipe?.kind === "asset" ? catalog?.texture : undefined;
  useEffect(() => {
    onAssetError(entity.id, loaded?.error);
    if (loaded?.error)
      useOrb.getState().set({ error: `${entity.label}: ${loaded.error}` });
    return () => onAssetError(entity.id, undefined);
  }, [entity.id, entity.label, loaded?.error, onAssetError]);
  useEffect(() => {
    // Clone/build only after React commits this entity. That keeps discarded
    // concurrent renders from allocating geometries that have no owner.
    const geometry = loaded?.geometry?.clone();
    const entry = geometry
      ? {
          geometry: bakeSoftwareTextureColors(geometry, loadedTexture),
          tint: recipe?.tint,
          ready: true,
          sourceRecipe: entity.geometry,
          sourceStage: entity.stage,
          sourceColor: entity.color,
        }
      : makeEntityGeometry(entity);
    const accepted = onChange(entity.id, entry);
    if (accepted) ownedGeometry.current = entry.geometry;
    return () => {
      // Removal is owned by the component-unmount effect below. On a recipe
      // change this entry must remain available until the replacement effect
      // commits; otherwise a pending replacement would blank the last-good
      // mesh and collision shape.
      if (!entry.ready && accepted) {
        onChange(entity.id, undefined, entry.geometry);
        if (ownedGeometry.current === entry.geometry)
          ownedGeometry.current = undefined;
      }
    };
  }, [
    entity.id,
    entity.geometry,
    entity.color,
    entity.stage,
    loaded?.geometry,
    loadedTexture,
    onChange,
    recipe?.tint,
  ]);
  useEffect(() => {
    return () => {
      const geometry = ownedGeometry.current;
      if (geometry) onChange(entity.id, undefined, geometry);
      ownedGeometry.current = undefined;
    };
  }, [entity.id, onChange]);
  return null;
}

type ProjectedPoint = { x: number; y: number; z: number };
type PickedEntity = { id: string; x: number; y: number; radius: number };
type SoftwareMarker = {
  entity: Entity;
  point: ProjectedPoint;
  proxyRadius?: number;
};
type SoftwareFace = {
  entityId: string;
  points: readonly ProjectedPoint[];
  color: string;
  depth: number;
};

type SoftwareVisibilityCache = {
  project?: Project;
  revision?: number;
  boundsByEntity: WorldNavigationEntityBounds;
  visibleEntityIds?: ReadonlySet<string>;
  target: [number, number, number];
  heading: number;
  distance: number;
  width: number;
  height: number;
  cameraWorld: number[];
  projection: number[];
};

function sameEntityIdSet(
  left: ReadonlySet<string> | undefined,
  right: ReadonlySet<string> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

/** Committed world AABBs become stable proxy placement bounds. */
export function softwareProxyBoundsByEntity(
  project: Project,
): ReadonlyMap<string, FormationProxyVisualBounds | undefined> {
  const worldBounds = worldNavigationBoundsByEntity(project);
  let scene: ResolvedScene | undefined;
  try {
    scene = resolveRuntimeScene(project);
  } catch {
    scene = undefined;
  }
  return new Map(
    project.entities.map((entity) => {
      const node = scene?.entities.get(entity.id);
      const resolvedNode = node
        ? {
            worldMatrix: node.worldMatrix,
            worldPosition: node.worldPosition,
          }
        : undefined;
      return [
        entity.id,
        formationProxyVisualBounds(worldBounds.get(entity.id), resolvedNode),
      ];
    }),
  );
}

/** Whether a projected object center can be reached by a canvas pick. */
export function softwarePickCenterIsVisible(
  center: Readonly<{ x: number; y: number; z: number }>,
  width: number,
  height: number,
): boolean {
  return (
    Number.isFinite(width) &&
    width > 0 &&
    Number.isFinite(height) &&
    height > 0 &&
    Number.isFinite(center.x) &&
    Number.isFinite(center.y) &&
    Number.isFinite(center.z) &&
    center.x >= 0 &&
    center.x <= width &&
    center.y >= 0 &&
    center.y <= height &&
    center.z >= -1 &&
    center.z <= 1
  );
}

/** Keep the gameplay and transition draw paths uncullled. */
export function softwareEntityPassesVisibility(
  entityId: string,
  visibleEntityIds?: ReadonlySet<string>,
): boolean {
  return visibleEntityIds === undefined || visibleEntityIds.has(entityId);
}

function sameMatrixSnapshot(
  snapshot: number[],
  matrix: THREE.Matrix4,
): boolean {
  const values = matrix.elements;
  if (snapshot.length !== values.length) return false;
  for (let index = 0; index < values.length; index++)
    if (snapshot[index] !== values[index]) return false;
  return true;
}

function visibleEntitiesForSettledWorkspace(
  cache: SoftwareVisibilityCache,
  project: Project,
  navigation: WorldNavigationState,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): ReadonlySet<string> {
  const projectChanged =
    cache.project !== project || cache.revision !== project.revision;
  if (projectChanged) {
    cache.project = project;
    cache.revision = project.revision;
    try {
      cache.boundsByEntity = worldNavigationBoundsByEntity(project);
    } catch {
      cache.boundsByEntity = new Map(
        project.entities.map((entity) => [entity.id, undefined]),
      );
    }
    cache.visibleEntityIds = undefined;
  }
  const [targetX, targetY, targetZ] = navigation.target;
  const cameraChanged =
    cache.visibleEntityIds === undefined ||
    cache.target[0] !== targetX ||
    cache.target[1] !== targetY ||
    cache.target[2] !== targetZ ||
    cache.heading !== navigation.heading ||
    cache.distance !== navigation.distance ||
    cache.width !== width ||
    cache.height !== height ||
    !sameMatrixSnapshot(cache.cameraWorld, camera.matrixWorld) ||
    !sameMatrixSnapshot(cache.projection, camera.projectionMatrix);
  if (cameraChanged) {
    cache.visibleEntityIds = selectVisibleWorldEntityIds(
      project.entities,
      cache.boundsByEntity,
      camera,
    );
    cache.target = [targetX, targetY, targetZ];
    cache.heading = navigation.heading;
    cache.distance = navigation.distance;
    cache.width = width;
    cache.height = height;
    cache.cameraWorld = [...camera.matrixWorld.elements];
    cache.projection = [...camera.projectionMatrix.elements];
  }
  return (
    cache.visibleEntityIds ?? new Set(project.entities.map(({ id }) => id))
  );
}

export type SoftwareTerrainScreenPoint = Readonly<{ x: number; y: number }>;
export type SoftwareProjectedFace = Readonly<{
  /** Frustum clipping can turn one source triangle into a convex polygon. */
  points: readonly Readonly<{ x: number; y: number; z: number }>[];
  depth: number;
}>;

function terrainPlaneDistance(
  point: THREE.Vector3,
  plane: number,
  tangentVertical: number,
  tangentHorizontal: number,
  near: number,
  far: number,
): number {
  const depth = -point.z;
  switch (plane) {
    case 0:
      return depth - near;
    case 1:
      return far - depth;
    case 2:
      return point.x + depth * tangentHorizontal;
    case 3:
      return depth * tangentHorizontal - point.x;
    case 4:
      return point.y + depth * tangentVertical;
    default:
      return depth * tangentVertical - point.y;
  }
}

function clipCameraPolygonToFrustum(
  worldPoints: readonly THREE.Vector3[],
  camera: THREE.PerspectiveCamera,
): THREE.Vector3[] | undefined {
  if (
    worldPoints.length < 3 ||
    !Number.isFinite(camera.fov) ||
    camera.fov <= 0 ||
    camera.fov >= 180 ||
    !Number.isFinite(camera.aspect) ||
    camera.aspect <= 0 ||
    !Number.isFinite(camera.near) ||
    camera.near <= 0 ||
    !Number.isFinite(camera.far) ||
    camera.far <= camera.near
  )
    return undefined;

  const tangentVertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tangentHorizontal = tangentVertical * camera.aspect;
  if (!Number.isFinite(tangentVertical) || !Number.isFinite(tangentHorizontal))
    return undefined;
  let polygon = worldPoints.map((point) =>
    point.clone().applyMatrix4(camera.matrixWorldInverse),
  );
  if (
    polygon.some(
      (point) =>
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isFinite(point.z),
    )
  )
    return undefined;

  for (let plane = 0; plane < 6 && polygon.length > 0; plane++) {
    const clipped: THREE.Vector3[] = [];
    let previous = polygon[polygon.length - 1];
    let previousDistance = terrainPlaneDistance(
      previous,
      plane,
      tangentVertical,
      tangentHorizontal,
      camera.near,
      camera.far,
    );
    if (!Number.isFinite(previousDistance)) return undefined;
    for (const current of polygon) {
      const currentDistance = terrainPlaneDistance(
        current,
        plane,
        tangentVertical,
        tangentHorizontal,
        camera.near,
        camera.far,
      );
      if (!Number.isFinite(currentDistance)) return undefined;
      const previousInside = previousDistance >= 0;
      const currentInside = currentDistance >= 0;
      if (previousInside !== currentInside) {
        const denominator = previousDistance - currentDistance;
        if (!Number.isFinite(denominator) || denominator === 0)
          return undefined;
        const amount = THREE.MathUtils.clamp(
          previousDistance / denominator,
          0,
          1,
        );
        const intersection = previous.clone().lerp(current, amount);
        if (
          !Number.isFinite(intersection.x) ||
          !Number.isFinite(intersection.y) ||
          !Number.isFinite(intersection.z)
        )
          return undefined;
        clipped.push(intersection);
      }
      if (currentInside) clipped.push(current);
      previous = current;
      previousDistance = currentDistance;
    }
    polygon = clipped;
  }
  return polygon.length >= 3 ? polygon : undefined;
}

function projectCameraPolygonToScreen(
  cameraPoints: readonly THREE.Vector3[],
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): ProjectedPoint[] | undefined {
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  )
    return undefined;
  const screen: ProjectedPoint[] = [];
  for (const point of cameraPoints) {
    const projected = point.clone().applyMatrix4(camera.projectionMatrix);
    if (
      !Number.isFinite(projected.x) ||
      !Number.isFinite(projected.y) ||
      !Number.isFinite(projected.z)
    )
      return undefined;
    screen.push({
      x: THREE.MathUtils.clamp((projected.x * 0.5 + 0.5) * width, 0, width),
      y: THREE.MathUtils.clamp((-projected.y * 0.5 + 0.5) * height, 0, height),
      z: projected.z,
    });
  }
  let doubledArea = 0;
  for (let index = 0; index < screen.length; index++) {
    const current = screen[index];
    const next = screen[(index + 1) % screen.length];
    doubledArea += current.x * next.y - next.x * current.y;
  }
  if (!Number.isFinite(doubledArea) || Math.abs(doubledArea) < 0.01)
    return undefined;
  return screen;
}

/** Clip one world-space triangle into its visible screen-space polygon. */
export function projectSoftwareTriangle(
  worldPoints: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): SoftwareProjectedFace | undefined {
  const clipped = clipCameraPolygonToFrustum(worldPoints, camera);
  if (!clipped) return undefined;
  const screen = projectCameraPolygonToScreen(clipped, camera, width, height);
  if (!screen) return undefined;
  const depth =
    clipped.reduce((sum, point) => sum + point.z, 0) / clipped.length;
  if (!Number.isFinite(depth)) return undefined;
  return { points: screen, depth };
}

/**
 * Project a world-aligned ground chunk after clipping it against the camera
 * frustum. This keeps tiles crossing the near plane or viewport edges finite
 * and prevents perspective division from creating enormous inverted paths.
 */
export function projectSoftwareTerrainChunk(
  key: WorldTerrainChunkKey,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): readonly SoftwareTerrainScreenPoint[] | undefined {
  if (!Number.isFinite(width) || width <= 0) return undefined;
  if (!Number.isFinite(height) || height <= 0) return undefined;

  let size: number;
  try {
    size = worldTerrainChunkSize(key.lod);
  } catch {
    return undefined;
  }
  if (!Number.isSafeInteger(key.x) || !Number.isSafeInteger(key.z))
    return undefined;
  const originX = key.x * size;
  const originZ = key.z * size;
  if (!Number.isFinite(originX) || !Number.isFinite(originZ)) return undefined;

  const corners = [
    new THREE.Vector3(originX, 0, originZ),
    new THREE.Vector3(originX + size, 0, originZ),
    new THREE.Vector3(originX + size, 0, originZ + size),
    new THREE.Vector3(originX, 0, originZ + size),
  ];
  camera.updateMatrixWorld();
  const clipped = clipCameraPolygonToFrustum(corners, camera);
  return clipped
    ? projectCameraPolygonToScreen(clipped, camera, width, height)
    : undefined;
}

function projectPoint(
  point: THREE.Vector3,
  matrix: THREE.Matrix4,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): ProjectedPoint {
  const projected = point.clone().applyMatrix4(matrix).project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * width,
    y: (-projected.y * 0.5 + 0.5) * height,
    z: projected.z,
  };
}

export type SoftwareProxyProjection = Readonly<{
  point: ProjectedPoint;
  radius: number;
}>;

/** Project a lightweight proxy from committed bounds and the current runtime transform. */
export function projectSoftwareResidencyProxy(
  bounds: FormationProxyVisualBounds,
  resolvedNode: Readonly<{
    worldPosition: readonly [number, number, number];
  }>,
  runtimeMatrix: THREE.Matrix4,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): SoftwareProxyProjection | undefined {
  if (
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !runtimeMatrix.elements.every(Number.isFinite) ||
    ![...resolvedNode.worldPosition, ...bounds.center, ...bounds.size].every(
      Number.isFinite,
    ) ||
    bounds.size.some((component) => component <= 0)
  )
    return undefined;
  const center = new THREE.Vector3(...bounds.center);
  center.x += runtimeMatrix.elements[12] - resolvedNode.worldPosition[0];
  center.y += runtimeMatrix.elements[13] - resolvedNode.worldPosition[1];
  center.z += runtimeMatrix.elements[14] - resolvedNode.worldPosition[2];
  if (![center.x, center.y, center.z].every(Number.isFinite)) return undefined;
  camera.updateMatrixWorld();
  const half = bounds.size.map((component) => component / 2);
  const corners = Array.from(
    { length: 8 },
    (_, index) =>
      new THREE.Vector3(
        center.x + (index & 1 ? half[0] : -half[0]),
        center.y + (index & 2 ? half[1] : -half[1]),
        center.z + (index & 4 ? half[2] : -half[2]),
      ),
  );
  const faces = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ] as const;
  const projected: ProjectedPoint[] = [];
  for (const face of faces) {
    const clipped = clipCameraPolygonToFrustum(
      face.map((corner) => corners[corner]),
      camera,
    );
    if (!clipped) continue;
    for (const cameraPoint of clipped) {
      const point = cameraPoint.clone().applyMatrix4(camera.projectionMatrix);
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isFinite(point.z)
      )
        continue;
      projected.push({
        x: THREE.MathUtils.clamp((point.x * 0.5 + 0.5) * width, 0, width),
        y: THREE.MathUtils.clamp((-point.y * 0.5 + 0.5) * height, 0, height),
        z: point.z,
      });
    }
  }
  if (!projected.length) return undefined;
  const minX = Math.min(...projected.map(({ x }) => x));
  const maxX = Math.max(...projected.map(({ x }) => x));
  const minY = Math.min(...projected.map(({ y }) => y));
  const maxY = Math.max(...projected.map(({ y }) => y));
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return undefined;
  const point: ProjectedPoint = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: Math.min(...projected.map(({ z }) => z)),
  };
  const radius = Math.max(
    6,
    Math.min(22, Math.hypot(maxX - minX, maxY - minY) / 2),
  );
  return Number.isFinite(radius) ? { point, radius } : undefined;
}

export function softwareEntityMatrix(
  project: Project,
  entity: Entity,
  time: number,
  session: GameSession,
  playing: boolean,
): THREE.Matrix4 {
  const override = playing
    ? session.state?.entityOverrides[entity.id]
    : undefined;
  if (usesSceneHierarchy(project))
    return runtimeEntityMatrix(
      resolveRuntimeScene(project),
      entity,
      time,
      override?.position,
    );
  const effective = playing
    ? (session.effectiveEntity(entity) ?? entity)
    : entity;
  const position = movingEntityPosition(effective, time);
  if (override?.position) position.splice(0, 3, ...override.position);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...(entity.rotation ?? [0, 0, 0])),
    ),
    new THREE.Vector3(...entity.scale),
  );
}

function finiteBounds(bounds: THREE.Box3): boolean {
  return (
    Number.isFinite(bounds.min.x) &&
    Number.isFinite(bounds.min.y) &&
    Number.isFinite(bounds.min.z) &&
    Number.isFinite(bounds.max.x) &&
    Number.isFinite(bounds.max.y) &&
    Number.isFinite(bounds.max.z) &&
    bounds.min.x <= bounds.max.x &&
    bounds.min.y <= bounds.max.y &&
    bounds.min.z <= bounds.max.z
  );
}

function softwareGeometryBounds(
  geometry: THREE.BufferGeometry,
): THREE.Box3 | undefined {
  if (localSoftwareBounds.has(geometry))
    return localSoftwareBounds.get(geometry) ?? undefined;
  let bounds: THREE.Box3 | null = null;
  try {
    const position = geometry.getAttribute("position");
    if (position && position.count > 0) {
      geometry.computeBoundingBox();
      if (geometry.boundingBox && finiteBounds(geometry.boundingBox))
        bounds = geometry.boundingBox.clone();
    }
  } catch {
    // An unavailable or malformed bound is treated conservatively at draw time.
  }
  localSoftwareBounds.set(geometry, bounds);
  return bounds ?? undefined;
}

/** Build one world frustum from the software camera's current projection. */
export function softwareCameraFrustum(
  camera: THREE.PerspectiveCamera,
): THREE.Frustum | undefined {
  try {
    const viewProjection = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    if (!viewProjection.elements.every(Number.isFinite)) return undefined;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(viewProjection);
    if (
      !frustum.planes.every(
        (plane) =>
          Number.isFinite(plane.constant) &&
          Number.isFinite(plane.normal.x) &&
          Number.isFinite(plane.normal.y) &&
          Number.isFinite(plane.normal.z),
      )
    )
      return undefined;
    return frustum;
  } catch {
    return undefined;
  }
}

/** Only a finite current world bound can prove that gameplay geometry is out of view. */
export function softwareGeometryVisibleInFrustum(
  entry: SoftwareGeometryEntry,
  matrix: THREE.Matrix4,
  frustum: THREE.Frustum,
  transformedBounds = new THREE.Box3(),
): boolean {
  const localBounds = softwareGeometryBounds(entry.geometry);
  if (
    !localBounds ||
    !matrix.elements.every(Number.isFinite) ||
    !frustum.planes.every(
      (plane) =>
        Number.isFinite(plane.constant) &&
        Number.isFinite(plane.normal.x) &&
        Number.isFinite(plane.normal.y) &&
        Number.isFinite(plane.normal.z),
    )
  )
    return true;
  try {
    transformedBounds.copy(localBounds).applyMatrix4(matrix);
    if (!finiteBounds(transformedBounds)) return true;
    return frustum.intersectsBox(transformedBounds);
  } catch {
    return true;
  }
}

function drawEntity(
  entry: SoftwareGeometryEntry,
  entity: Entity,
  matrix: THREE.Matrix4,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  selected: boolean,
  collected: boolean,
  pick: PickedEntity[],
  faces: SoftwareFace[],
  markers: SoftwareMarker[],
  colorOverride?: string,
) {
  if (collected && entity.behavior?.type === "collect") return;
  const geometry = entry.geometry;
  const position = geometry.getAttribute("position");
  if (!position) return;
  const colors = geometry.getAttribute("color");
  const index = geometry.index;
  const triangles = Math.floor((index?.count ?? position.count) / 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let triangle = 0; triangle < triangles; triangle++) {
    const ia = index?.getX(triangle * 3) ?? triangle * 3;
    const ib = index?.getX(triangle * 3 + 1) ?? triangle * 3 + 1;
    const ic = index?.getX(triangle * 3 + 2) ?? triangle * 3 + 2;
    a.set(position.getX(ia), position.getY(ia), position.getZ(ia));
    b.set(position.getX(ib), position.getY(ib), position.getZ(ib));
    c.set(position.getX(ic), position.getY(ic), position.getZ(ic));
    const ca = readColor(colors, ia);
    const cb = readColor(colors, ib);
    const cc = readColor(colors, ic);
    let rgb: [number, number, number] = [
      (ca[0] + cb[0] + cc[0]) / 3,
      (ca[1] + cb[1] + cc[1]) / 3,
      (ca[2] + cb[2] + cc[2]) / 3,
    ];
    if (colorOverride) {
      const color = new THREE.Color(colorOverride);
      rgb = [color.r, color.g, color.b];
    } else if (entry.tint) {
      const tint = new THREE.Color(entry.tint);
      rgb = [tint.r, tint.g, tint.b];
    }
    const clipped = projectSoftwareTriangle(
      [
        a.clone().applyMatrix4(matrix),
        b.clone().applyMatrix4(matrix),
        c.clone().applyMatrix4(matrix),
      ],
      camera,
      width,
      height,
    );
    if (clipped)
      faces.push({
        entityId: entity.id,
        points: clipped.points,
        color: cssColor(rgb),
        depth: clipped.depth,
      });
  }
  const center = projectPoint(
    new THREE.Vector3(0, 0.65, 0),
    matrix,
    camera,
    width,
    height,
  );
  const visibleCenter = softwarePickCenterIsVisible(center, width, height);
  if (visibleCenter)
    pick.push({ id: entity.id, x: center.x, y: center.y, radius: 32 });
  if (visibleCenter && (selected || entity.behavior?.type === "portal"))
    markers.push({ entity, point: center });
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  state: PlayerState,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
) {
  const matrix = new THREE.Matrix4().makeTranslation(...state.position);
  const point = projectPoint(
    new THREE.Vector3(0, 0.4, 0),
    matrix,
    camera,
    width,
    height,
  );
  ctx.beginPath();
  ctx.arc(point.x, point.y, 10, 0, Math.PI * 2);
  ctx.fillStyle = "#fff8db";
  ctx.fill();
  ctx.strokeStyle = "#3a665c";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(point.x + 3, point.y - 2, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#3a665c";
  ctx.fill();
}

export function playableEntities(
  project: Project,
  geometries: Map<string, SoftwareGeometryEntry>,
): Entity[] {
  return project.entities.map((entity) => {
    const entry = geometries.get(entity.id);
    const displayed = entry?.ready
      ? {
          geometry: entry.sourceRecipe ?? entity.geometry,
          stage: entry.sourceStage,
        }
      : undefined;
    const visualReady = softwareGeometryMatchesEntity(entity, entry);
    return gameplayEntityForVisualState(entity, visualReady, displayed);
  });
}

export function requiredGeometryReady(
  project: Project,
  geometries: Map<string, SoftwareGeometryEntry>,
  completionRecords: ReadonlyMap<
    string,
    SoftwareFormationCompletionRecord
  > = new Map(),
  visibleProxyIds?: ReadonlySet<string>,
  proxyIds: ReadonlySet<string> = new Set(),
  visibleEntityIds?: ReadonlySet<string>,
  nonDrawableIds: ReadonlySet<string> = new Set(),
  drawnProxyByEntity: ReadonlyMap<string, SoftwareProxyDrawRecord> = new Map(),
): boolean {
  return project.entities.every((entity) => {
    if (
      entity.geometry?.kind !== "asset" &&
      entity.geometry?.kind !== "generated"
    )
      return true;
    const visibleInViewport =
      !nonDrawableIds.has(entity.id) &&
      (visibleEntityIds === undefined || visibleEntityIds.has(entity.id));
    const visibleProxy =
      proxyIds.has(entity.id) &&
      visibleInViewport &&
      (visibleProxyIds?.has(entity.id) === true ||
        visibleEntityIds?.has(entity.id) === true);
    return softwareEntityVisualReviewReady(
      entity,
      geometries.get(entity.id),
      completionRecords.get(entity.id),
      project.revision,
      visibleInViewport,
      proxyIds.has(entity.id),
      visibleProxy,
      softwareProxyDrawnForRevision(
        entity,
        project.id,
        project.revision,
        drawnProxyByEntity.get(entity.id),
      ),
    );
  });
}

export type TerrainChunkSelectionCache = {
  selectionKey: string | undefined;
  chunks: readonly WorldTerrainChunkKey[];
};

export function terrainChunksForView(
  cache: TerrainChunkSelectionCache,
  navigation: WorldNavigationState,
  aspect: number,
): readonly WorldTerrainChunkKey[] {
  const [focusX, focusY, focusZ] = navigation.target;
  let selectionKey: string;
  let terrainFocus: WorldNavigationState["target"];
  try {
    const baseCell = worldTerrainChunkKeyAt(focusX, focusZ, 0);
    const heightBucket = Math.ceil(focusY / 4);
    terrainFocus = [focusX, heightBucket * 4, focusZ];
    selectionKey = [
      baseCell.x,
      baseCell.z,
      heightBucket,
      navigation.distance,
      aspect,
    ].join(":");
  } catch {
    selectionKey = `invalid:${[focusX, focusY, focusZ, navigation.distance, aspect].join(":")}`;
    terrainFocus = [Number.NaN, Number.NaN, Number.NaN];
  }
  if (cache.selectionKey === selectionKey) return cache.chunks;
  cache.selectionKey = selectionKey;
  try {
    cache.chunks = selectWorldTerrainChunks({
      focus: terrainFocus,
      distance: navigation.distance,
      aspect,
    });
  } catch {
    // Keep the renderer alive for a malformed camera intent. The gradient
    // remains behind the scene until the next valid navigation update.
    cache.chunks = [];
  }
  return cache.chunks;
}

function drawWorkspaceGround(
  ctx: CanvasRenderingContext2D,
  project: Project,
  navigation: WorldNavigationState,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  cache: TerrainChunkSelectionCache,
) {
  const chunks = terrainChunksForView(cache, navigation, width / height);
  if (!chunks.length) return;
  ctx.fillStyle = project.environment.ground;
  for (const chunk of chunks) {
    const polygon = projectSoftwareTerrainChunk(chunk, camera, width, height);
    if (!polygon) continue;
    ctx.beginPath();
    ctx.moveTo(polygon[0].x, polygon[0].y);
    for (let index = 1; index < polygon.length; index++)
      ctx.lineTo(polygon[index].x, polygon[index].y);
    ctx.closePath();
    // Match the continuous base fill exactly so clipped tile edges cannot
    // introduce visible seams.
    ctx.fill();
  }
}

type SoftwareSceneDrawResult = Readonly<{
  completedFullDraw: boolean;
  visibleEntityIds?: ReadonlySet<string>;
  reviewVisibleEntityIds: ReadonlySet<string>;
  visibleProxyIds: ReadonlySet<string>;
}>;

let landingPlanetTexture: HTMLCanvasElement | undefined;

function landingPlanetSurface() {
  if (landingPlanetTexture) return landingPlanetTexture;

  const size = 256;
  const texture = document.createElement("canvas");
  texture.width = size;
  texture.height = size;
  const surface = texture.getContext("2d", { alpha: true });
  if (!surface) return undefined;

  const image = surface.createImageData(size, size);
  const palette: readonly (readonly [
    number,
    readonly [number, number, number],
  ])[] = [
    [-0.45, [17, 82, 112]],
    [-0.05, [36, 139, 157]],
    [0.16, [75, 192, 185]],
    [0.27, [219, 210, 158]],
    [0.72, [148, 188, 120]],
    [1.2, [85, 139, 92]],
  ] as const;
  const light = [-0.44, 0.48, 0.76] as const;

  for (let py = 0; py < size; py++) {
    const y = ((py + 0.5) / size) * 2 - 1;
    for (let px = 0; px < size; px++) {
      const x = ((px + 0.5) / size) * 2 - 1;
      const radiusSquared = x * x + y * y;
      if (radiusSquared > 1) continue;

      const z = Math.sqrt(1 - radiusSquared);
      const terrain = terrainValue(x, y, z);
      let lower = palette[0];
      let upper = palette[1];
      for (let index = 1; index < palette.length; index++) {
        if (terrain <= palette[index][0]) {
          lower = palette[index - 1];
          upper = palette[index];
          break;
        }
        lower = palette[index - 1];
        upper = palette[index];
      }
      const blend = Math.max(
        0,
        Math.min(1, (terrain - lower[0]) / (upper[0] - lower[0])),
      );
      const illumination = Math.max(
        0.36,
        Math.min(
          1.15,
          0.55 + (x * light[0] + y * light[1] + z * light[2]) * 0.68,
        ),
      );
      const offset = (py * size + px) * 4;
      for (let channel = 0; channel < 3; channel++)
        image.data[offset + channel] = Math.round(
          (lower[1][channel] +
            (upper[1][channel] - lower[1][channel]) * blend) *
            illumination,
        );
      image.data[offset + 3] = 255;
    }
  }

  surface.putImageData(image, 0, 0);
  landingPlanetTexture = texture;
  return texture;
}

function drawLandingSpace(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  progress: number,
  ground: string,
) {
  const groundBlend = smoothTransition(progress, 0.73, 0.99);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#071322");
  sky.addColorStop(0.52, "#0b2436");
  sky.addColorStop(1, "#102d3b");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  if (groundBlend > 0) {
    ctx.globalAlpha = groundBlend;
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  const nebula = ctx.createRadialGradient(
    width * 0.2,
    height * 0.31,
    0,
    width * 0.2,
    height * 0.31,
    Math.max(width, height) * 0.62,
  );
  nebula.addColorStop(0, "rgba(58, 139, 157, .17)");
  nebula.addColorStop(0.52, "rgba(39, 81, 120, .07)");
  nebula.addColorStop(1, "rgba(14, 32, 58, 0)");
  ctx.fillStyle = nebula;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 1 - groundBlend;
  for (let index = 0; index < 58; index++) {
    const x = ((index * 0.61803398875 + 0.13) % 1) * width;
    const y = ((index * 0.75487766625 + 0.31) % 1) * height;
    const twinkle = 0.52 + Math.sin(time * 0.6 + index * 2.1) * 0.2;
    const radius = index % 9 === 0 ? 1.45 : index % 3 === 0 ? 0.95 : 0.6;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(220, 244, 241, ${twinkle})`;
    ctx.fill();
    if (index % 9 === 0) {
      ctx.strokeStyle = `rgba(183, 233, 231, ${twinkle * 0.35})`;
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y + 4);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawLandingPlanet(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  progress: number,
  reducedMotion: boolean,
) {
  const radius = Math.min(width * 0.59, height * 0.43);
  const zoom = globeScale(progress);
  const centerX = width * 0.5;
  const centerY = height * 0.51 - height * 0.3 * progress;
  const planetRadius = radius * zoom;
  const opacity = 1 - smoothTransition(progress, 0.86, 0.99);
  if (opacity <= 0.001) return;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.shadowColor = "rgba(74, 222, 219, .48)";
  ctx.shadowBlur = Math.max(18, radius * 0.14);
  ctx.beginPath();
  ctx.arc(centerX, centerY, planetRadius * 1.018, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(68, 203, 207, .12)";
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, planetRadius, 0, Math.PI * 2);
  ctx.clip();
  const ocean = ctx.createRadialGradient(
    centerX - planetRadius * 0.39,
    centerY - planetRadius * 0.46,
    planetRadius * 0.04,
    centerX,
    centerY,
    planetRadius * 1.15,
  );
  ocean.addColorStop(0, "#71e6d9");
  ocean.addColorStop(0.43, "#37bfc2");
  ocean.addColorStop(0.8, "#19758f");
  ocean.addColorStop(1, "#0b304c");
  ctx.fillStyle = ocean;
  ctx.fillRect(
    centerX - planetRadius,
    centerY - planetRadius,
    planetRadius * 2,
    planetRadius * 2,
  );

  const texture = landingPlanetSurface();
  if (texture) {
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(reducedMotion ? -0.035 : Math.sin(time * 0.12) * 0.055);
    ctx.filter = "blur(0.75px)";
    ctx.drawImage(
      texture,
      -planetRadius,
      -planetRadius,
      planetRadius * 2,
      planetRadius * 2,
    );
    ctx.filter = "none";
    ctx.restore();
  }

  const cloudOpacity = reducedMotion ? 0.14 : 0.18;
  const drift = reducedMotion
    ? 0
    : Math.sin(time * 0.17) * planetRadius * 0.025;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = `rgba(236, 255, 245, ${cloudOpacity})`;
  ctx.lineWidth = Math.max(3, planetRadius * 0.028);
  ctx.beginPath();
  ctx.moveTo(
    centerX - planetRadius * 0.78 + drift,
    centerY - planetRadius * 0.22,
  );
  ctx.bezierCurveTo(
    centerX - planetRadius * 0.42,
    centerY - planetRadius * 0.42,
    centerX + planetRadius * 0.1,
    centerY - planetRadius * 0.08,
    centerX + planetRadius * 0.76 + drift,
    centerY - planetRadius * 0.31,
  );
  ctx.stroke();
  ctx.lineWidth = Math.max(2, planetRadius * 0.017);
  ctx.beginPath();
  ctx.moveTo(
    centerX - planetRadius * 0.7 - drift,
    centerY + planetRadius * 0.25,
  );
  ctx.bezierCurveTo(
    centerX - planetRadius * 0.18,
    centerY + planetRadius * 0.04,
    centerX + planetRadius * 0.34,
    centerY + planetRadius * 0.48,
    centerX + planetRadius * 0.81 - drift,
    centerY + planetRadius * 0.17,
  );
  ctx.stroke();

  const atmosphere = ctx.createRadialGradient(
    centerX - planetRadius * 0.23,
    centerY - planetRadius * 0.34,
    planetRadius * 0.3,
    centerX,
    centerY,
    planetRadius * 1.06,
  );
  atmosphere.addColorStop(0, "rgba(4, 27, 47, 0)");
  atmosphere.addColorStop(0.77, "rgba(5, 37, 57, .08)");
  atmosphere.addColorStop(1, "rgba(3, 26, 47, .64)");
  ctx.fillStyle = atmosphere;
  ctx.fillRect(
    centerX - planetRadius,
    centerY - planetRadius,
    planetRadius * 2,
    planetRadius * 2,
  );

  const highlight = ctx.createRadialGradient(
    centerX - planetRadius * 0.42,
    centerY - planetRadius * 0.48,
    0,
    centerX - planetRadius * 0.24,
    centerY - planetRadius * 0.25,
    planetRadius * 0.88,
  );
  highlight.addColorStop(0, "rgba(236, 255, 231, .18)");
  highlight.addColorStop(0.65, "rgba(204, 252, 236, .025)");
  highlight.addColorStop(1, "rgba(204, 252, 236, 0)");
  ctx.fillStyle = highlight;
  ctx.fillRect(
    centerX - planetRadius,
    centerY - planetRadius,
    planetRadius * 2,
    planetRadius * 2,
  );
  ctx.restore();

  ctx.beginPath();
  ctx.arc(centerX, centerY, planetRadius * 1.002, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(164, 245, 230, .72)";
  ctx.lineWidth = Math.max(1, radius * 0.009);
  ctx.stroke();
  ctx.restore();
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  project: Project,
  geometries: Map<string, SoftwareGeometryEntry>,
  proxyIds: ReadonlySet<string>,
  proxyBoundsByEntity: ReadonlyMap<
    string,
    FormationProxyVisualBounds | undefined
  >,
  completionRecords: Map<string, SoftwareFormationCompletionRecord>,
  drawnProxyByEntity: Map<string, SoftwareProxyDrawRecord>,
  recipeIdentityByEntity: ReadonlyMap<string, string>,
  session: GameSession,
  player: PlayerState,
  selected: string | undefined,
  score: readonly string[],
  time: number,
  camera: THREE.PerspectiveCamera,
  picks: PickedEntity[],
  settledWorkspace: boolean,
  landingProgress: number | undefined,
  reducedMotion: boolean,
  navigation: WorldNavigationState,
  terrainCache: TerrainChunkSelectionCache,
  visibilityCache: SoftwareVisibilityCache,
): SoftwareSceneDrawResult {
  const width = canvas.clientWidth || 1;
  const height = canvas.clientHeight || 1;
  const isPhoneSizedCanvas =
    Math.min(width, height) <= 540 && Math.max(width, height) < 1100;
  const dpr = Math.min(
    isPhoneSizedCanvas ? 1 : 2,
    window.devicePixelRatio || 1,
  );
  if (
    canvas.width !== Math.round(width * dpr) ||
    canvas.height !== Math.round(height * dpr)
  ) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const groundVisible = settledWorkspace && camera.position.y > 0;
  if (landingProgress !== undefined) {
    drawLandingSpace(
      ctx,
      width,
      height,
      time,
      landingProgress,
      project.environment.ground,
    );
    drawLandingPlanet(ctx, width, height, time, landingProgress, reducedMotion);
  } else {
    if (groundVisible) ctx.fillStyle = project.environment.ground;
    else {
      const gradient = ctx.createRadialGradient(
        width * 0.48,
        height * 0.34,
        10,
        width * 0.48,
        height * 0.5,
        Math.max(width, height),
      );
      gradient.addColorStop(0, "#faf8e8");
      gradient.addColorStop(0.55, "#e7efe3");
      gradient.addColorStop(1, "#d8eae6");
      ctx.fillStyle = gradient;
    }
    ctx.fillRect(0, 0, width, height);
    if (!settledWorkspace) {
      ctx.fillStyle = "rgba(93, 146, 122, .1)";
      ctx.beginPath();
      ctx.ellipse(
        width / 2,
        height * 0.72,
        width * 0.4,
        height * 0.12,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  if (groundVisible)
    drawWorkspaceGround(
      ctx,
      project,
      navigation,
      camera,
      width,
      height,
      terrainCache,
    );
  picks.length = 0;
  const faces: SoftwareFace[] = [];
  const markers: SoftwareMarker[] = [];
  const playing = useOrb.getState().playing;
  const visibleEntityIds =
    settledWorkspace && !playing
      ? visibleEntitiesForSettledWorkspace(
          visibilityCache,
          project,
          navigation,
          camera,
          width,
          height,
        )
      : undefined;
  const reviewVisibleEntityIds = new Set(visibleEntityIds ?? []);
  const visibleProxyIds = new Set<string>();
  const gameplayFrustum =
    playing && settledWorkspace ? softwareCameraFrustum(camera) : undefined;
  const transformedGameplayBounds = new THREE.Box3();
  const resolvedScene = (() => {
    try {
      return resolveRuntimeScene(project);
    } catch {
      return undefined;
    }
  })();
  let completedFullDraw = false;
  let proxyDrawChanged = false;
  const fullReadyEntityIds = new Set<string>();
  for (const entity of project.entities) {
    const visibleByBounds = softwareEntityPassesVisibility(
      entity.id,
      visibleEntityIds,
    );
    const effective = playing ? session.effectiveEntity(entity) : entity;
    if (!effective) continue;
    if (
      playing &&
      score.includes(entity.id) &&
      entity.behavior?.type === "collect"
    )
      continue;
    const entry = geometries.get(entity.id);
    const bounds = proxyIds.has(entity.id)
      ? proxyBoundsByEntity.get(entity.id)
      : undefined;
    const canDrawFull = softwareGeometryMatchesEntity(entity, entry);
    if (canDrawFull) fullReadyEntityIds.add(entity.id);
    const proxyOnly = proxyIds.has(entity.id) && (!entry || !canDrawFull);
    if (!entry && !bounds) continue;
    const matrix = softwareEntityMatrix(
      project,
      entity,
      time,
      session,
      playing,
    );
    const completion = completionRecords.get(entity.id);
    const passesGameplayFrustum =
      proxyOnly ||
      !(
        playing &&
        gameplayFrustum &&
        entry &&
        !softwareGeometryVisibleInFrustum(
          entry,
          matrix,
          gameplayFrustum,
          transformedGameplayBounds,
        )
      );
    if (!visibleByBounds) continue;
    if (!passesGameplayFrustum) continue;

    if (proxyOnly && bounds) {
      if (score.includes(entity.id) && entity.behavior?.type === "collect")
        continue;
      const resolvedNode = resolvedScene?.entities.get(entity.id);
      if (!resolvedNode) continue;
      const projected = projectSoftwareResidencyProxy(
        bounds,
        resolvedNode,
        matrix,
        camera,
        width,
        height,
      );
      if (!projected) continue;
      reviewVisibleEntityIds.add(entity.id);
      picks.push({
        id: entity.id,
        x: projected.point.x,
        y: projected.point.y,
        radius: Math.max(24, projected.radius + 8),
      });
      markers.push({
        entity: effective,
        point: projected.point,
        proxyRadius: projected.radius,
      });
      continue;
    }
    if (entry) {
      if (playing) reviewVisibleEntityIds.add(entity.id);
      const collectColor = playing
        ? session.state?.entityOverrides[entity.id]?.color
        : undefined;
      drawEntity(
        entry,
        effective,
        matrix,
        camera,
        width,
        height,
        selected === entity.id,
        playing && score.includes(entity.id),
        picks,
        faces,
        markers,
        collectColor,
      );
    }
  }
  faces.sort((left, right) => left.depth - right.depth);
  for (const face of faces) {
    ctx.beginPath();
    ctx.moveTo(face.points[0].x, face.points[0].y);
    for (let index = 1; index < face.points.length; index++)
      ctx.lineTo(face.points[index].x, face.points[index].y);
    ctx.closePath();
    ctx.fillStyle = face.color;
    ctx.fill();
    const completion = completionRecords.get(face.entityId);
    if (
      fullReadyEntityIds.has(face.entityId) &&
      completion &&
      completion.recipeIdentity === recipeIdentityByEntity.get(face.entityId) &&
      completion.fullDrawnRevision !== project.revision
    ) {
      completion.fullDrawnRevision = project.revision;
      completedFullDraw = true;
    }
  }
  for (const marker of markers) {
    if (marker.proxyRadius !== undefined) {
      ctx.beginPath();
      ctx.arc(
        marker.point.x,
        marker.point.y,
        marker.proxyRadius,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle =
        marker.entity.geometry?.kind === "asset" ||
        marker.entity.geometry?.kind === "generated"
          ? (marker.entity.geometry.tint ?? marker.entity.color)
          : marker.entity.color;
      ctx.fill();
      visibleProxyIds.add(marker.entity.id);
      ctx.strokeStyle = "rgba(255, 255, 245, .9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const previous = drawnProxyByEntity.get(marker.entity.id);
      if (
        !previous ||
        previous.projectId !== project.id ||
        previous.revision !== project.revision ||
        previous.recipeIdentity !== recipeIdentityByEntity.get(marker.entity.id)
      ) {
        drawnProxyByEntity.set(marker.entity.id, {
          projectId: project.id,
          revision: project.revision,
          recipeIdentity: recipeIdentityByEntity.get(marker.entity.id) ?? "",
        });
        proxyDrawChanged = true;
      }
    }
    if (marker.entity.id === selected) {
      ctx.beginPath();
      ctx.arc(marker.point.x, marker.point.y, 27, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 248, 204, .95)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (marker.entity.behavior?.type === "portal") {
      ctx.beginPath();
      ctx.arc(marker.point.x, marker.point.y - 20, 19, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(189, 237, 207, .85)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (
      marker.proxyRadius === undefined &&
      (marker.entity.id === selected ||
        marker.entity.behavior?.type === "portal")
    ) {
      const completion = completionRecords.get(marker.entity.id);
      if (
        fullReadyEntityIds.has(marker.entity.id) &&
        completion &&
        completion.recipeIdentity ===
          recipeIdentityByEntity.get(marker.entity.id) &&
        completion.fullDrawnRevision !== project.revision
      ) {
        completion.fullDrawnRevision = project.revision;
        completedFullDraw = true;
      }
    }
  }
  if (playing) drawPlayer(ctx, player, camera, width, height);
  if (completedFullDraw || proxyDrawChanged) notifySceneReviewCaptureChanged();
  return {
    completedFullDraw,
    visibleEntityIds,
    reviewVisibleEntityIds,
    visibleProxyIds,
  };
}

export default function SoftwareWorld({
  navigation,
  getNavigation,
  navigationGestureController,
  navigationEnabled,
  onNavigationCommand,
  onNavigationClickSuppression,
  clearNavigationGestures,
  clearNavigationClickFallback,
  consumeNavigationClick,
  onReady,
  onNavigationReady,
  onRendererReady,
  onError,
}: SoftwareWorldProps) {
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigationCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const geometriesRef = useRef(new Map<string, SoftwareGeometryEntry>());
  const geometryGenerationRef = useRef(0);
  const disposedGeometriesRef = useRef(new WeakSet<THREE.BufferGeometry>());
  const assetErrorsRef = useRef(new Map<string, string>());
  const drawnProxyByEntityRef = useRef(
    new Map<string, SoftwareProxyDrawRecord>(),
  );
  const project = useOrb((state) => state.project);
  const recipeIdentityByEntity = useMemo(
    () =>
      new Map(
        project.entities.map((entity) => [
          entity.id,
          formationRecipeIdentity(entity),
        ]),
      ),
    [project],
  );
  const recipeIdentityByEntityRef = useRef({
    project,
    identities: recipeIdentityByEntity,
  });
  recipeIdentityByEntityRef.current = {
    project,
    identities: recipeIdentityByEntity,
  };
  const projectRef = useRef(project);
  projectRef.current = project;
  const completionRecordsRef = useRef(
    new Map<string, SoftwareFormationCompletionRecord>(),
  );
  const completionProjectIdRef = useRef(project.id);
  if (completionProjectIdRef.current !== project.id) {
    completionProjectIdRef.current = project.id;
    completionRecordsRef.current.clear();
    drawnProxyByEntityRef.current.clear();
    for (const entity of project.entities) {
      const entry = geometriesRef.current.get(entity.id);
      if (
        entity.stage === "ready" &&
        softwareGeometryMatchesEntity(entity, entry) &&
        !assetErrorsRef.current.has(entity.id)
      )
        completionRecordsRef.current.set(entity.id, {
          recipeIdentity: formationRecipeIdentity(entity),
          loadedRevision: project.revision,
        });
    }
  }
  useLayoutEffect(() => {
    const identities = new Map(
      project.entities.map((entity) => [
        entity.id,
        formationRecipeIdentity(entity),
      ]),
    );
    for (const [id, completion] of completionRecordsRef.current)
      if (identities.get(id) !== completion.recipeIdentity)
        completionRecordsRef.current.delete(id);
    for (const [id, record] of drawnProxyByEntityRef.current)
      if (
        record.projectId !== project.id ||
        record.revision !== project.revision ||
        identities.get(id) !== record.recipeIdentity
      )
        drawnProxyByEntityRef.current.delete(id);
  }, [project]);
  const [geometryVersion, setGeometryVersion] = useState(0);
  const completedRecipeByEntity = useMemo(
    () =>
      new Map(
        [...completionRecordsRef.current].map(([id, record]) => [
          id,
          record.recipeIdentity,
        ]),
      ),
    [geometryVersion, project],
  );
  const completedRecipeByEntityRef = useRef({
    project,
    recipes: completedRecipeByEntity,
  });
  completedRecipeByEntityRef.current = {
    project,
    recipes: completedRecipeByEntity,
  };
  const geometryChange = useMemo(
    () =>
      (
        id: string,
        entry: SoftwareGeometryEntry | undefined,
        disposed?: THREE.BufferGeometry,
      ): boolean => {
        const disposeOnce = (geometry: THREE.BufferGeometry) => {
          if (disposedGeometriesRef.current.has(geometry)) return;
          disposedGeometriesRef.current.add(geometry);
          geometry.dispose();
        };
        const current = geometriesRef.current.get(id);
        if (entry && !entry.ready && current?.ready) {
          // Keep the committed last-good shape during an asynchronous asset
          // replacement. The pending clone has no owner once it is rejected.
          disposeOnce(entry.geometry);
          notifySceneReviewCaptureChanged();
          return false;
        }
        if (disposed) {
          const removed = releaseOwnedSoftwareGeometry(
            geometriesRef.current,
            id,
            disposed,
            disposeOnce,
          );
          if (removed) {
            geometryGenerationRef.current += 1;
            const completion = completionRecordsRef.current.get(id);
            if (completion) delete completion.fullDrawnRevision;
          }
        }
        if (entry && (!current || current.geometry !== entry.geometry)) {
          if (current && current.geometry !== entry.geometry)
            disposeOnce(current.geometry);
          const completion = completionRecordsRef.current.get(id);
          if (completion) delete completion.fullDrawnRevision;
          geometriesRef.current.set(id, entry);
          geometryGenerationRef.current += 1;
          const currentProject = projectRef.current;
          const currentEntity = currentProject.entities.find(
            (entity) => entity.id === id,
          );
          if (
            currentEntity?.stage === "ready" &&
            entry.sourceStage === "ready" &&
            softwareGeometryMatchesEntity(currentEntity, entry) &&
            !assetErrorsRef.current.has(id)
          ) {
            const identity = formationRecipeIdentity(currentEntity);
            const completion = completionRecordsRef.current.get(id);
            if (completion?.recipeIdentity !== identity)
              completionRecordsRef.current.set(id, {
                recipeIdentity: identity,
                loadedRevision: currentProject.revision,
              });
          }
          setGeometryVersion((version) => version + 1);
          notifySceneReviewCaptureChanged();
          return true;
        }
        if (!entry && !disposed && current) {
          geometriesRef.current.delete(id);
          geometryGenerationRef.current += 1;
          disposeOnce(current.geometry);
          setGeometryVersion((version) => version + 1);
          notifySceneReviewCaptureChanged();
          return true;
        }
        setGeometryVersion((version) => version + 1);
        return false;
      },
    [],
  );
  const phase = useOrb((state) => state.phase);
  const playing = useOrb((state) => state.playing);
  const selected = useOrb((state) => state.selected);
  const score = useOrb((state) => state.score);
  const reset = useOrb((state) => state.reset);
  const session = useMemo(() => new GameSession(), []);
  const hasEnteredPlay = useRef(playing);
  const [initialPlayerState] = useState(() => playerStartForProject(project));
  const playerRef = useRef<PlayerState>(copyPlayerState(initialPlayerState));
  const initialPlaybackFocus = playbackFormationResidencyFocusCell(
    playerRef.current.position,
  );
  const playbackResidencyCellRef = useRef(initialPlaybackFocus.key);
  const [, setPlaybackResidencyCell] = useState(initialPlaybackFocus.key);
  const [residencyVisibleIds, setResidencyVisibleIds] = useState<
    ReadonlySet<string> | undefined
  >(undefined);
  const residencyVisibleIdsRef = useRef(residencyVisibleIds);
  residencyVisibleIdsRef.current = residencyVisibleIds;
  const [residencyWorkspaceSettled, setResidencyWorkspaceSettled] =
    useState(false);
  const residencyWorkspaceSettledRef = useRef(false);
  const previousResidentIdsRef = useRef<ReadonlySet<string>>(new Set());
  const residencyProjectIdRef = useRef(project.id);
  useLayoutEffect(() => {
    if (residencyProjectIdRef.current !== project.id || phase !== "editing") {
      residencyWorkspaceSettledRef.current = false;
      setResidencyWorkspaceSettled(false);
      setResidencyVisibleIds(undefined);
      previousResidentIdsRef.current = new Set();
    }
    residencyProjectIdRef.current = project.id;
  }, [phase, project.id]);
  const currentPlaybackFocus = playbackFormationResidencyFocusCell(
    playerRef.current.position,
  );
  const proxyBoundsByEntity = useMemo(
    () => softwareProxyBoundsByEntity(project),
    [project],
  );
  const proxyBoundsByEntityRef = useRef({
    project,
    bounds: proxyBoundsByEntity,
  });
  proxyBoundsByEntityRef.current = { project, bounds: proxyBoundsByEntity };
  const residencyPresentation = useMemo(
    () =>
      selectSoftwareFormationResidency({
        entities: project.entities,
        completedRecipeByEntity,
        proxyBoundsByEntity,
        focus: playing ? currentPlaybackFocus.focus : navigation.target,
        visibleIds: playing ? undefined : residencyVisibleIds,
        selectedId: selected,
        previousResidentIds: previousResidentIdsRef.current,
        enabled: residencyWorkspaceSettled && phase === "editing",
      }),
    [
      currentPlaybackFocus.key,
      geometryVersion,
      completedRecipeByEntity,
      navigation.target,
      phase,
      playing,
      project,
      proxyBoundsByEntity,
      residencyVisibleIds,
      residencyWorkspaceSettled,
      selected,
    ],
  );
  useLayoutEffect(() => {
    previousResidentIdsRef.current = residencyPresentation.residentIds;
  }, [residencyPresentation]);
  const residencyPresentationRef = useRef({
    project,
    value: residencyPresentation,
  });
  residencyPresentationRef.current = { project, value: residencyPresentation };
  const reviewVisibleEntityIdsRef = useRef<ReadonlySet<string> | undefined>(
    undefined,
  );
  const reviewVisibleProxyIdsRef = useRef<ReadonlySet<string>>(new Set());
  const inputRef = useRef(new PlayerInputTracker());
  const announcedReady = useRef(false);
  const rendererReady = useRef(false);
  const picksRef = useRef<PickedEntity[]>([]);
  const terrainCacheRef = useRef<TerrainChunkSelectionCache>({
    selectionKey: undefined,
    chunks: [],
  });
  const visibilityCacheRef = useRef<SoftwareVisibilityCache>({
    boundsByEntity: new Map(),
    target: [Number.NaN, Number.NaN, Number.NaN],
    heading: Number.NaN,
    distance: Number.NaN,
    width: Number.NaN,
    height: Number.NaN,
    cameraWorld: [],
    projection: [],
  });
  const generationRef = useRef(-1);
  const previousReset = useRef(reset);
  const previousProjectId = useRef(project.id);
  const transitionInitialized = useRef(false);
  const initializedScene = useRef(false);
  const previousTransitionProjectId = useRef(project.id);
  const previousPhase = useRef(phase);
  const navigationEnabledRef = useRef(navigationEnabled);
  navigationEnabledRef.current =
    navigationEnabled && phase === "editing" && !playing;
  const previousViewportMobile = useRef<boolean | undefined>(undefined);
  const cameraStart = useMemo(() => new THREE.Vector3(), []);
  const cameraEnd = useMemo(() => new THREE.Vector3(), []);
  const landingPose = useMemo(
    () => worldNavigationCameraPose(navigation),
    [navigation],
  );
  const onReadyRef = useRef(onReady);
  const onNavigationReadyRef = useRef(onNavigationReady);
  const onRendererReadyRef = useRef(onRendererReady);
  const onErrorRef = useRef(onError);
  const reviewProjectRef = useRef(project);
  const reviewPhaseRef = useRef(phase);
  const navigationReadyNotified = useRef(false);
  const drawnRevisionRef = useRef<
    { projectId: string; revision: number } | undefined
  >(undefined);
  const drawnGeometryGenerationRef = useRef(-1);
  useLayoutEffect(() => {
    reviewProjectRef.current = project;
    reviewPhaseRef.current = phase;
    notifySceneReviewCaptureChanged();
  }, [phase, project]);
  const reviewMounted = useRef(false);
  const onAssetError = useCallback((id: string, error: string | undefined) => {
    if (error) assetErrorsRef.current.set(id, error);
    else assetErrorsRef.current.delete(id);
    notifySceneReviewCaptureChanged();
  }, []);
  onReadyRef.current = onReady;
  onNavigationReadyRef.current = onNavigationReady;
  onRendererReadyRef.current = onRendererReady;
  onErrorRef.current = onError;

  useEffect(() => {
    reviewMounted.current = true;
    const source = {
      renderer: "software",
      getState: (): SceneReviewSourceState => {
        const currentProject = reviewProjectRef.current;
        const currentRevision = currentProject.revision;
        const expected = currentProject.entities;
        const currentState = useOrb.getState();
        const presentation =
          residencyPresentationRef.current.project === currentProject
            ? residencyPresentationRef.current.value
            : undefined;
        const completedRecipes =
          completedRecipeByEntityRef.current.project === currentProject
            ? completedRecipeByEntityRef.current.recipes
            : new Map<string, string>();
        const proxyIds = softwareActiveProxyIds({
          entities: expected,
          presentation: presentation ?? {
            proxyIds: new Set(),
            residentIds: new Set(),
          },
          completedRecipeByEntity: completedRecipes,
          displayedByEntity: geometriesRef.current,
        });
        const visibleEntities = reviewVisibleEntityIdsRef.current;
        const visibleProxies = reviewVisibleProxyIdsRef.current;
        const nonDrawableIds = new Set(
          currentProject.entities
            .filter(
              (entity) =>
                currentState.playing &&
                (!session.effectiveEntity(entity) ||
                  (currentState.score.includes(entity.id) &&
                    entity.behavior?.type === "collect")),
            )
            .map((entity) => entity.id),
        );
        const visuallyReady = (entity: Entity) => {
          const drawable = !nonDrawableIds.has(entity.id);
          const visibleInViewport =
            drawable &&
            (visibleEntities === undefined || visibleEntities.has(entity.id));
          return softwareEntityVisualReviewReady(
            entity,
            geometriesRef.current.get(entity.id),
            completionRecordsRef.current.get(entity.id),
            currentRevision,
            visibleInViewport,
            proxyIds.has(entity.id),
            proxyIds.has(entity.id) &&
              visibleInViewport &&
              (visibleProxies.has(entity.id) ||
                visibleEntities?.has(entity.id) === true),
            softwareProxyDrawnForRevision(
              entity,
              currentProject.id,
              currentRevision,
              drawnProxyByEntityRef.current.get(entity.id),
            ),
          );
        };
        const pendingAssetIds = expected
          .filter(
            (entity) =>
              (entity.geometry?.kind === "asset" ||
                entity.geometry?.kind === "generated") &&
              (assetErrorsRef.current.has(entity.id) || !visuallyReady(entity)),
          )
          .map((entity) => entity.id);
        const failedAssetIds = expected
          .filter((entity) => assetErrorsRef.current.has(entity.id))
          .map((entity) => entity.id);
        const readyAssetIds = expected
          .filter((entity) => {
            return (
              (entity.geometry?.kind === "asset" ||
                entity.geometry?.kind === "generated") &&
              visuallyReady(entity) &&
              !assetErrorsRef.current.has(entity.id)
            );
          })
          .map((entity) => entity.id);
        const framePainted =
          drawnRevisionRef.current?.projectId === currentProject.id &&
          drawnRevisionRef.current.revision === currentRevision &&
          drawnGeometryGenerationRef.current === geometryGenerationRef.current;
        return {
          renderer: "software",
          projectId: currentProject.id,
          revision: currentRevision,
          renderedRevision:
            framePainted && pendingAssetIds.length === 0 ? currentRevision : -1,
          transitionSettled:
            reviewPhaseRef.current === "editing" &&
            parcelTransitionController.snapshot.settled,
          mounted: reviewMounted.current && rendererReady.current,
          readyAssetIds,
          pendingAssetIds,
          failedAssetIds,
          errors: expected
            .map((entity) => assetErrorsRef.current.get(entity.id))
            .filter((error): error is string => !!error),
        };
      },
      capture: () => {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Software canvas is not ready.");
        const camera = navigationCameraRef.current;
        if (!camera) return captureSceneCanvas(canvas);
        return captureSceneCanvas(canvas, {
          boundsByEntity: worldNavigationBoundsByEntity(
            projectRef.current,
          ).values(),
          viewMatrix: camera.matrixWorldInverse.elements,
          projectionMatrix: camera.projectionMatrix.elements,
        });
      },
      getCameraView: () => {
        const camera = navigationCameraRef.current;
        return camera
          ? sceneReviewCameraViewFromMatrixWorld(camera.matrixWorld.elements)
          : undefined;
      },
    } as const;
    const unregister = registerSceneReviewCaptureSource(source);
    const fixtureProbe = (
      globalThis as typeof globalThis & {
        __orbsieSceneReviewFixture?: {
          software?: {
            capture: typeof captureSceneReview;
            read: () => SceneReviewSourceState;
          };
        };
      }
    ).__orbsieSceneReviewFixture;
    const fixtureEntry = {
      capture: captureSceneReview,
      read: source.getState,
    };
    if (fixtureProbe) fixtureProbe.software = fixtureEntry;
    notifySceneReviewCaptureChanged();
    return () => {
      reviewMounted.current = false;
      if (fixtureProbe?.software === fixtureEntry) delete fixtureProbe.software;
      unregister();
      notifySceneReviewCaptureChanged();
    };
  }, []);

  useEffect(
    () => () => {
      for (const entry of geometriesRef.current.values()) {
        if (disposedGeometriesRef.current.has(entry.geometry)) continue;
        disposedGeometriesRef.current.add(entry.geometry);
        entry.geometry.dispose();
      }
      geometriesRef.current.clear();
      assetErrorsRef.current.clear();
      notifySceneReviewCaptureChanged();
    },
    [],
  );

  /* __ORBSIE_SOFTWARE_WORLD_FIXTURE_PROBE__ */

  useLayoutEffect(() => {
    const firstMount = !transitionInitialized.current;
    const projectChanged = previousTransitionProjectId.current !== project.id;
    if (projectChanged || phase === "landing" || phase === "descending")
      navigationReadyNotified.current = false;
    const directWorkspace =
      phase === "editing" &&
      previousPhase.current === "landing" &&
      !projectChanged;
    if (firstMount)
      parcelTransitionController.reset(
        phase === "landing" || phase === "descending" ? 0 : 1,
      );
    else if (phase === "landing")
      projectChanged
        ? parcelTransitionController.reset(0)
        : parcelTransitionController.setTarget(0);
    else if (projectChanged || directWorkspace)
      parcelTransitionController.reset(phase === "descending" ? 0 : 1);
    else parcelTransitionController.setTarget(1);
    transitionInitialized.current = true;
    initializedScene.current = false;
    previousTransitionProjectId.current = project.id;
    previousPhase.current = phase;
  }, [phase, project.id]);

  useEffect(() => parcelTransitionController.attachRenderer(), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let context: CanvasRenderingContext2D | null;
    try {
      context = canvas.getContext("2d", { alpha: true });
    } catch {
      onErrorRef.current?.(softwareRendererError);
      return;
    }
    if (!context) {
      onErrorRef.current?.(softwareRendererError);
      return;
    }
    if (!rendererReady.current) {
      rendererReady.current = true;
      onRendererReadyRef.current?.("software");
      notifySceneReviewCaptureChanged();
    }
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 250);
    navigationCameraRef.current = camera;
    camera.position.set(0, 1.8, 10.2);
    camera.lookAt(0, 0.35, 0);
    camera.updateMatrixWorld();
    let frame = 0;
    let last = performance.now();
    let stopped = false;
    let mounted = true;
    let frameScheduled = false;
    let frameCount = 0;
    let lastFrameAtMs: number | null = null;
    let lastFrameGapMs: number | null = null;
    let maxFrameGapMs = 0;
    let lastFrameDurationMs: number | null = null;
    let maxFrameDurationMs = 0;
    let frameStartedAtMs: number | null = null;
    let heartbeatCount = 0;
    let lastHeartbeatAtMs: number | null = null;
    let maxHeartbeatGapMs = 0;
    let observationCount = 0;
    let lastObservationAtMs: number | null = null;
    let runtimeError: {
      name: string;
      message: string;
      stack: string | null;
    } | null = null;
    const fixtureDiagnostics = globalThis as SoftwareWorldFixtureDiagnostics;
    const collectFixtureDiagnostics =
      fixtureDiagnostics.__ORBSIE_SOFTWARE_WORLD_DIAGNOSTICS_REQUESTED__ ===
      true;
    const heartbeatTimer = collectFixtureDiagnostics
      ? window.setInterval(() => {
          const now = performance.now();
          if (lastHeartbeatAtMs !== null)
            maxHeartbeatGapMs = Math.max(
              maxHeartbeatGapMs,
              now - lastHeartbeatAtMs,
            );
          lastHeartbeatAtMs = now;
          heartbeatCount += 1;
        }, 50)
      : null;
    if (collectFixtureDiagnostics)
      fixtureDiagnostics.__ORBSIE_SOFTWARE_WORLD_DIAGNOSTICS_READ__ = () => {
        const now = performance.now();
        return {
          renderer: "software",
          mounted,
          canvasConnected: canvas.isConnected,
          playing: useOrb.getState().playing,
          phase: useOrb.getState().phase,
          documentVisibility: document.visibilityState,
          documentHasFocus: document.hasFocus(),
          loopStopped: stopped,
          frameScheduled,
          frameCount,
          lastFrameAtMs,
          lastFrameAgeMs:
            lastFrameAtMs === null ? null : Math.max(0, now - lastFrameAtMs),
          lastFrameGapMs,
          maxFrameGapMs,
          lastFrameDurationMs,
          maxFrameDurationMs,
          heartbeatCount,
          lastHeartbeatAtMs,
          lastHeartbeatAgeMs:
            lastHeartbeatAtMs === null
              ? null
              : Math.max(0, now - lastHeartbeatAtMs),
          maxHeartbeatGapMs,
          observationCount,
          lastObservationAtMs,
          runtimeError,
        };
      };
    const reportRuntimeError = (error?: unknown) => {
      if (stopped) return;
      stopped = true;
      if (collectFixtureDiagnostics) {
        if (frameStartedAtMs !== null) {
          lastFrameDurationMs = performance.now() - frameStartedAtMs;
          maxFrameDurationMs = Math.max(
            maxFrameDurationMs,
            lastFrameDurationMs,
          );
        }
        frameScheduled = false;
        runtimeError = {
          name: error instanceof Error ? error.name : "UnknownError",
          message: error instanceof Error ? error.message : String(error),
          stack:
            error instanceof Error
              ? (error.stack?.split("\n").slice(0, 7).join("\n") ?? null)
              : null,
        };
      }
      cancelAnimationFrame(frame);
      onErrorRef.current?.(softwareRendererError);
    };
    const animate = (now: number) => {
      if (stopped) return;
      if (collectFixtureDiagnostics) {
        if (lastFrameAtMs !== null) {
          lastFrameGapMs = now - lastFrameAtMs;
          maxFrameGapMs = Math.max(maxFrameGapMs, lastFrameGapMs);
        }
        frameScheduled = false;
        frameCount += 1;
        lastFrameAtMs = now;
        frameStartedAtMs = performance.now();
      }
      try {
        const delta = Math.min(0.04, Math.max(0, (now - last) / 1000));
        last = now;
        const current = useOrb.getState();
        const projectNow = current.project;
        const currentPhase = current.phase;
        const mobile = (canvas.clientWidth || 1) < 700;
        if (previousViewportMobile.current !== mobile) {
          previousViewportMobile.current = mobile;
          initializedScene.current = false;
        }
        if (
          previousReset.current !== current.reset ||
          previousProjectId.current !== projectNow.id
        ) {
          playerRef.current = playerStartForProject(projectNow);
          if (previousProjectId.current !== projectNow.id)
            hasEnteredPlay.current = false;
          inputRef.current.clear();
          previousReset.current = current.reset;
          previousProjectId.current = projectNow.id;
        }
        if (current.playing && !hasEnteredPlay.current) {
          playerRef.current = playerStartForProject(projectNow);
          inputRef.current.clear();
          hasEnteredPlay.current = true;
        }
        const rulesChanged = session.sync(
          projectNow.id,
          projectNow.game,
          current.reset,
        );
        if (current.playing && rulesChanged)
          current.set({
            notice: GAME_RULES_RESTART_NOTICE,
            ruleRestartCount: current.ruleRestartCount + 1,
          });
        const resetAvatar = () => {
          if (generationRef.current === session.resetGeneration) return false;
          generationRef.current = session.resetGeneration;
          playerRef.current = playerStartForProject(useOrb.getState().project);
          useOrb.getState().set({
            score: [],
            gameScore: 0,
            won: false,
            lost: false,
          });
          return true;
        };
        resetAvatar();
        if (current.playing) {
          const pressed = inputRef.current.consumePressed();
          for (const action of pressed) session.queueInput(action);
          session.advance(delta);
          // Input/start/tick actions can run a reset rule. Reconcile that
          // generation before physics and use the post-reset store score.
          const didAdvanceReset = resetAvatar();
          const afterAdvance = useOrb.getState();
          const rawX =
            (inputRef.current.isHeld("right") ? 1 : 0) -
            (inputRef.current.isHeld("left") ? 1 : 0);
          const rawZ =
            (inputRef.current.isHeld("down") ? 1 : 0) -
            (inputRef.current.isHeld("up") ? 1 : 0);
          const directionVector = new THREE.Vector3(rawX, 0, rawZ);
          if (directionVector.lengthSq())
            directionVector
              .applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5)
              .normalize();
          const direction = {
            x: directionVector.x,
            z: directionVector.z,
            jump: inputRef.current.isHeld("jump") || pressed.includes("jump"),
          };
          const matrices = usesSceneHierarchy(projectNow)
            ? new Map(
                projectNow.entities.map((entity) => [
                  entity.id,
                  runtimeEntityMatrix(
                    resolveRuntimeScene(projectNow),
                    entity,
                    now / 1000,
                    session.state?.entityOverrides[entity.id]?.position,
                  ),
                ]),
              )
            : undefined;
          const playable = playableEntities(projectNow, geometriesRef.current)
            .map((entity) => session.effectiveEntity(entity))
            .filter((entity): entity is Entity => entity !== null);
          const result = stepGameplay(
            playerRef.current,
            direction,
            playable,
            didAdvanceReset ? [] : afterAdvance.score,
            now / 1000,
            session.state && session.state.status !== "playing" ? 0 : delta,
            session.collisionTargets,
            matrices,
          );
          playerRef.current = result;
          const beforeContacts = session.resetGeneration;
          session.emitContacts(result.contacts);
          if (session.resetGeneration === beforeContacts)
            session.emitCollections(result.collected);
          const didReset = resetAvatar();
          const next = useOrb.getState();
          if (
            !didReset &&
            (next.score.length !== result.collected.length ||
              result.collected.some((id, i) => next.score[i] !== id))
          )
            next.set({ score: result.collected });
          if (session.state) {
            const won = session.state.status === "won";
            const lost = session.state.status === "lost";
            if (
              next.gameScore !== session.state.score ||
              next.won !== won ||
              next.lost !== lost
            )
              next.set({ gameScore: session.state.score, won, lost });
          } else if (result.won && !next.won) next.set({ won: true });
          if (gameplayObservationRequested()) {
            const observedEntities = playable.map((entity) => {
              const matrix = matrices?.get(entity.id);
              const position = matrix
                ? ([
                    matrix.elements[12],
                    matrix.elements[13],
                    matrix.elements[14],
                  ] as [number, number, number])
                : movingEntityPosition(entity, now / 1000);
              return {
                id: entity.id,
                behavior: entity.behavior?.type ?? null,
                stage: entity.stage,
                position,
                scale: [...entity.scale] as [number, number, number],
              };
            });
            const latest = useOrb.getState();
            publishGameplayObservation({
              renderer: "software",
              projectId: latest.project.id,
              revision: latest.project.revision,
              simulationDeltaMs: delta * 1000,
              playing: latest.playing,
              player: playerRef.current,
              entities: observedEntities,
              contacts: result.contacts,
              platformContactId: result.platformContactId,
              bounceContactId: result.bounceContactId,
              collected: result.collected,
              scoreIds: latest.score,
              gameScore: latest.gameScore,
              status: session.state?.status ?? null,
              won: latest.won,
              lost: latest.lost,
              reset: latest.reset,
              sessionGeneration: session.resetGeneration,
            });
            if (collectFixtureDiagnostics) {
              observationCount += 1;
              lastObservationAtMs = performance.now();
            }
          }
        } else inputRef.current.clear();
        if (current.playing) {
          const focusCell = playbackFormationResidencyFocusCell(
            playerRef.current.position,
          );
          if (focusCell.key !== playbackResidencyCellRef.current) {
            playbackResidencyCellRef.current = focusCell.key;
            setPlaybackResidencyCell(focusCell.key);
          }
        }
        const savedNavigation = navigationRef.current;
        const activeNavigation = current.playing
          ? worldNavigationFollowState(
              savedNavigation,
              playerRef.current.position,
              {
                width: canvas.clientWidth,
                height: canvas.clientHeight,
              },
            )
          : savedNavigation;
        const target = currentPhase === "landing" ? 0 : 1;
        parcelTransitionController.setTarget(target);
        const transition = parcelTransitionController.step(delta, reduced());
        const progress = transition.progress;
        if (
          currentPhase === "landing" ||
          progress < 1 ||
          !initializedScene.current
        ) {
          cameraStart.set(0, 1.8, mobile ? 14.5 : 10.2);
          cameraEnd.set(...landingPose.position);
          camera.position.copy(cameraStart.lerp(cameraEnd, progress));
          const look = worldNavigationLandingLookTarget(
            progress,
            landingPose.target,
          );
          camera.lookAt(...look);
          initializedScene.current = progress > 0.99;
        }
        if (
          currentPhase === "editing" &&
          transition.settled &&
          transition.progress >= 1 &&
          initializedScene.current
        ) {
          if (!residencyWorkspaceSettledRef.current) {
            residencyWorkspaceSettledRef.current = true;
            setResidencyWorkspaceSettled(true);
          }
          if (!navigationReadyNotified.current) {
            navigationReadyNotified.current = true;
            onNavigationReadyRef.current?.();
          }
          const pose = worldNavigationCameraPose(activeNavigation);
          camera.position.set(...pose.position);
          camera.lookAt(...pose.target);
          let groundFar = 0;
          try {
            const aspect =
              (canvas.clientWidth || 1) / Math.max(1, canvas.clientHeight || 1);
            groundFar =
              activeNavigation.distance +
              worldTerrainGroundViewRadius(
                activeNavigation.distance,
                aspect,
                activeNavigation.target[1],
              );
          } catch {
            // Keep the navigation far plane if the viewport cannot be used by
            // terrain selection; the renderer remains available regardless.
          }
          const far = Math.max(
            worldNavigationFarPlane(activeNavigation),
            groundFar * 1.01,
          );
          if (camera.far !== far) {
            camera.far = far;
            camera.updateProjectionMatrix();
          }
        }
        if (target === 1 && transition.settled) {
          const latest = useOrb.getState();
          if (
            latest.project.id === projectNow.id &&
            latest.phase === "descending"
          )
            latest.set({ phase: "editing" });
        }
        const framePresentation =
          residencyPresentationRef.current.project === projectNow
            ? residencyPresentationRef.current.value
            : undefined;
        const frameProxyIds = softwareActiveProxyIds({
          entities: projectNow.entities,
          presentation: framePresentation ?? {
            proxyIds: new Set(),
            residentIds: new Set(),
          },
          completedRecipeByEntity:
            completedRecipeByEntityRef.current.project === projectNow
              ? completedRecipeByEntityRef.current.recipes
              : new Map(),
          displayedByEntity: geometriesRef.current,
        });
        const drawResult = drawScene(
          context,
          canvas,
          projectNow,
          geometriesRef.current,
          frameProxyIds,
          proxyBoundsByEntityRef.current.project === projectNow
            ? proxyBoundsByEntityRef.current.bounds
            : new Map(),
          completionRecordsRef.current,
          drawnProxyByEntityRef.current,
          recipeIdentityByEntityRef.current.project === projectNow
            ? recipeIdentityByEntityRef.current.identities
            : new Map(),
          session,
          playerRef.current,
          current.selected,
          useOrb.getState().score,
          now / 1000,
          camera,
          picksRef.current,
          currentPhase === "editing" &&
            transition.settled &&
            transition.progress >= 1 &&
            initializedScene.current,
          currentPhase === "landing" || currentPhase === "descending"
            ? progress
            : undefined,
          reduced(),
          activeNavigation,
          terrainCacheRef.current,
          visibilityCacheRef.current,
        );
        reviewVisibleEntityIdsRef.current = drawResult.reviewVisibleEntityIds;
        reviewVisibleProxyIdsRef.current = drawResult.visibleProxyIds;
        if (
          !current.playing &&
          !sameEntityIdSet(
            residencyVisibleIdsRef.current,
            drawResult.visibleEntityIds,
          )
        ) {
          residencyVisibleIdsRef.current = drawResult.visibleEntityIds;
          setResidencyVisibleIds(drawResult.visibleEntityIds);
        }
        const drawnProject = drawnRevisionRef.current;
        if (
          drawnProject?.projectId !== projectNow.id ||
          drawnProject.revision !== projectNow.revision
        ) {
          drawnRevisionRef.current = {
            projectId: projectNow.id,
            revision: projectNow.revision,
          };
          notifySceneReviewCaptureChanged();
        }
        if (
          drawnGeometryGenerationRef.current !== geometryGenerationRef.current
        ) {
          drawnGeometryGenerationRef.current = geometryGenerationRef.current;
          notifySceneReviewCaptureChanged();
        }
        if (
          current.playing &&
          !announcedReady.current &&
          requiredGeometryReady(
            projectNow,
            geometriesRef.current,
            completionRecordsRef.current,
            drawResult.visibleProxyIds,
            frameProxyIds,
            drawResult.reviewVisibleEntityIds,
            new Set(
              projectNow.entities
                .filter(
                  (entity) =>
                    !session.effectiveEntity(entity) ||
                    (useOrb.getState().score.includes(entity.id) &&
                      entity.behavior?.type === "collect"),
                )
                .map((entity) => entity.id),
            ),
            drawnProxyByEntityRef.current,
          )
        ) {
          announcedReady.current = true;
          onReadyRef.current?.();
        }
        frame = requestAnimationFrame(animate);
        if (collectFixtureDiagnostics) {
          lastFrameDurationMs = performance.now() - (frameStartedAtMs ?? now);
          maxFrameDurationMs = Math.max(
            maxFrameDurationMs,
            lastFrameDurationMs,
          );
          frameScheduled = true;
        }
      } catch (error) {
        reportRuntimeError(error);
      }
    };
    try {
      frame = requestAnimationFrame(animate);
      if (collectFixtureDiagnostics) frameScheduled = true;
    } catch (error) {
      reportRuntimeError(error);
    }
    return () => {
      stopped = true;
      if (collectFixtureDiagnostics) {
        mounted = false;
        frameScheduled = false;
        if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      }
      cancelAnimationFrame(frame);
      navigationCameraRef.current = null;
      inputRef.current.clear();
      rendererReady.current = false;
      drawnRevisionRef.current = undefined;
      drawnGeometryGenerationRef.current = -1;
      notifySceneReviewCaptureChanged();
    };
  }, []);

  useEffect(() => {
    const legacyPointerIds = new Map<string, number | string>();
    const key = (event: KeyboardEvent, down: boolean) => {
      const buttonActivation =
        (event.target as Element)?.closest("button") &&
        [" ", "Enter"].includes(event.key);
      if (down && (isTextEntryTarget(event.target) || buttonActivation)) return;
      const action = actionForPlayerKey(event.key);
      if (down && action) event.preventDefault();
      inputRef.current.setKeyboard(event.key, down);
    };
    const down = (event: KeyboardEvent) => key(event, true);
    const up = (event: KeyboardEvent) => key(event, false);
    const blur = () => {
      inputRef.current.clear();
      legacyPointerIds.clear();
    };
    const focus = (event: FocusEvent) => {
      if (isTextEntryTarget(event.target)) blur();
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") blur();
    };
    const pointer = (event: Event) => {
      const detail = (event as CustomEvent<PlayerInputDetail>).detail;
      if (
        typeof detail?.key === "string" &&
        (detail.pointerId === undefined || Number.isInteger(detail.pointerId))
      ) {
        const key = detail.key.toLowerCase();
        const pointerId =
          detail.pointerId ?? legacyPointerIds.get(key) ?? `legacy:${key}`;
        if (detail.pointerId === undefined && detail.down)
          legacyPointerIds.set(key, pointerId);
        inputRef.current.setPointer(
          pointerId,
          detail.key,
          Boolean(detail.down),
        );
        if (detail.pointerId === undefined && !detail.down)
          legacyPointerIds.delete(key);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("pagehide", blur);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("focusin", focus);
    window.addEventListener("orbsie-input", pointer);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pagehide", blur);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("focusin", focus);
      window.removeEventListener("orbsie-input", pointer);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointerStarts = new Map<number, { x: number; y: number }>();
    navigationGestureController.reset();
    if (!navigationEnabledRef.current) clearNavigationGestures();
    const previousTouchAction = canvas.style.touchAction;
    if (navigationEnabledRef.current) canvas.style.touchAction = "none";
    const rotatingPointers = new Set<number>();
    let pendingContextMenuPointer: number | null = null;
    let contextMenuTimeout: ReturnType<typeof setTimeout> | undefined;
    let observedCanvasSize: readonly [number, number] | undefined;

    const clearTransientState = () => {
      rotatingPointers.clear();
      pendingContextMenuPointer = null;
      if (contextMenuTimeout !== undefined) {
        clearTimeout(contextMenuTimeout);
        contextMenuTimeout = undefined;
      }
    };
    const resetGestureState = () => {
      clearTransientState();
      clearNavigationGestures();
    };
    const getViewport = () => {
      const rect = canvas.getBoundingClientRect();
      const camera = navigationCameraRef.current;
      if (!camera) return undefined;
      const currentNavigation = getNavigation();
      return {
        width: rect.width,
        height: rect.height,
        verticalFovRadians: (camera.fov * Math.PI) / 180,
        distance: currentNavigation.distance,
        heading: currentNavigation.heading,
      };
    };
    const hitNavigationObject = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      return [...picksRef.current]
        .reverse()
        .some(
          (candidate) =>
            Math.hypot(candidate.x - x, candidate.y - y) < candidate.radius,
        );
    };
    const pointerDown = (event: PointerEvent) => {
      pointerStarts.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      if (!navigationEnabledRef.current) return;
      clearNavigationClickFallback();
      if (pendingContextMenuPointer !== null) {
        pendingContextMenuPointer = null;
        if (contextMenuTimeout !== undefined) {
          clearTimeout(contextMenuTimeout);
          contextMenuTimeout = undefined;
        }
      }
      const pointerType =
        event.pointerType === "touch"
          ? "touch"
          : event.pointerType === "mouse"
            ? "mouse"
            : undefined;
      if (!pointerType) return;
      const button =
        event.button === 0
          ? "primary"
          : event.button === 2
            ? "secondary"
            : "other";
      navigationGestureController.pointerDown({
        pointerId: event.pointerId,
        pointerType,
        x: event.clientX,
        y: event.clientY,
        button,
        objectHit: hitNavigationObject(event),
      });
    };
    const click = (event: PointerEvent) => {
      const start = pointerStarts.get(event.pointerId);
      pointerStarts.delete(event.pointerId);
      if (consumeNavigationClick(event.pointerId)) return;
      if (
        start &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8
      )
        return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hit = [...picksRef.current]
        .reverse()
        .find(
          (candidate) =>
            Math.hypot(candidate.x - x, candidate.y - y) < candidate.radius,
        );
      if (!hit) return;
      const current = useOrb.getState();
      if (current.playing) session.queueClick(hit.id);
      else current.set({ selected: hit.id });
    };
    const cancel = (event: PointerEvent) =>
      pointerStarts.delete(event.pointerId);
    const move = (event: PointerEvent) => {
      if (!navigationEnabledRef.current) return;
      const viewport = getViewport();
      if (!viewport) return;
      const result = navigationGestureController.pointerMove(
        { pointerId: event.pointerId, x: event.clientX, y: event.clientY },
        viewport,
      );
      if (result.suppressClick) onNavigationClickSuppression(event.pointerId);
      for (const command of result.commands) {
        if (command.type === "rotate_to_heading")
          rotatingPointers.add(event.pointerId);
        onNavigationCommand(command);
      }
      if (result.handled && event.cancelable) event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      const result = navigationGestureController.pointerUp(event.pointerId);
      if (result.suppressClick) onNavigationClickSuppression(event.pointerId);
      if (rotatingPointers.delete(event.pointerId)) {
        pendingContextMenuPointer = event.pointerId;
        if (contextMenuTimeout !== undefined) clearTimeout(contextMenuTimeout);
        contextMenuTimeout = setTimeout(() => {
          pendingContextMenuPointer = null;
          contextMenuTimeout = undefined;
        }, 750);
      }
    };
    const pointerCancel = (event: PointerEvent) => {
      navigationGestureController.pointerCancel(event.pointerId);
      pointerStarts.delete(event.pointerId);
      rotatingPointers.delete(event.pointerId);
      if (pendingContextMenuPointer === event.pointerId) {
        pendingContextMenuPointer = null;
        if (contextMenuTimeout !== undefined) {
          clearTimeout(contextMenuTimeout);
          contextMenuTimeout = undefined;
        }
      }
    };
    const wheel = (event: WheelEvent) => {
      if (!navigationEnabledRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const pixelMultiplier =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? rect.height
            : 1;
      const viewport = getViewport();
      if (!viewport) return;
      const result = navigationGestureController.wheel(
        { deltaY: event.deltaY * pixelMultiplier },
        viewport,
      );
      for (const command of result.commands) onNavigationCommand(command);
      if (result.handled && event.cancelable) event.preventDefault();
    };
    const contextMenu = (event: MouseEvent) => {
      if (rotatingPointers.size > 0 || pendingContextMenuPointer !== null) {
        event.preventDefault();
        pendingContextMenuPointer = null;
        if (contextMenuTimeout !== undefined) {
          clearTimeout(contextMenuTimeout);
          contextMenuTimeout = undefined;
        }
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden) resetGestureState();
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (!entry) return;
            const nextSize: readonly [number, number] = [
              entry.contentRect.width,
              entry.contentRect.height,
            ];
            if (
              observedCanvasSize &&
              (observedCanvasSize[0] !== nextSize[0] ||
                observedCanvasSize[1] !== nextSize[1])
            )
              resetGestureState();
            observedCanvasSize = nextSize;
          });
    resizeObserver?.observe(canvas);

    canvas.addEventListener("pointerdown", pointerDown, true);
    canvas.addEventListener("pointerup", click);
    canvas.addEventListener("pointercancel", cancel);
    window.addEventListener("pointermove", move, {
      capture: true,
      passive: false,
    });
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", pointerCancel, true);
    canvas.addEventListener("wheel", wheel, { capture: true, passive: false });
    canvas.addEventListener("contextmenu", contextMenu, true);
    window.addEventListener("blur", resetGestureState);
    window.addEventListener("resize", resetGestureState);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      canvas.removeEventListener("pointerdown", pointerDown, true);
      canvas.removeEventListener("pointerup", click);
      canvas.removeEventListener("pointercancel", cancel);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", pointerCancel, true);
      canvas.removeEventListener("wheel", wheel, true);
      canvas.removeEventListener("contextmenu", contextMenu, true);
      window.removeEventListener("blur", resetGestureState);
      window.removeEventListener("resize", resetGestureState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      resizeObserver?.disconnect();
      canvas.style.touchAction = previousTouchAction;
      resetGestureState();
    };
  }, [
    clearNavigationClickFallback,
    clearNavigationGestures,
    consumeNavigationClick,
    getNavigation,
    navigationEnabled,
    navigationGestureController,
    onNavigationClickSuppression,
    onNavigationCommand,
    project.id,
    session,
  ]);

  return (
    <div className="software-world" aria-label="Software world renderer">
      <canvas ref={canvasRef} />
      {project.entities
        .filter((entity) =>
          residencyPresentation.fullFormationIds.has(entity.id),
        )
        .map((entity) => (
          <SoftwareEntity
            key={entity.id}
            entity={entity}
            onChange={geometryChange}
            onAssetError={onAssetError}
          />
        ))}
      <p className="software-world-status" aria-live="polite">
        {softwareFallbackWarning}
      </p>
    </div>
  );
}
