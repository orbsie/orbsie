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
import { entityGeometry } from "@/lib/geometry";
import { useAssetGeometry } from "@/lib/use-asset-geometry";
import { useGeneratedGeometry } from "@/lib/use-generated-geometry";
import { isAssetId } from "@/lib/asset-catalog";
import {
  isTextEntryTarget,
  movingEntityPosition,
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
import {
  sampleTexture,
  type FormationTextureSample,
} from "@/lib/formation-particles";
import type { Entity, Project } from "@/lib/protocol";
import {
  worldNavigationBoundsByEntity,
  type WorldNavigationEntityBounds,
} from "@/lib/world-navigation-bounds";
import { selectVisibleWorldEntityIds } from "@/lib/world-visibility";
import { parcelTransitionController } from "@/lib/parcel-transition";
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
  "WebGL2 could not initialize, so Orbsie is using its software canvas renderer.";
const playerStart: PlayerState = { position: [0, 0.5, 5], velocityY: 0 };
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
        }
      : makeEntityGeometry(entity);
    const accepted = onChange(entity.id, entry);
    return () => {
      // Removal is owned by the component-unmount effect below. On a recipe
      // change this entry must remain available until the replacement effect
      // commits; otherwise a pending replacement would blank the last-good
      // mesh and collision shape.
      if (!entry.ready && accepted)
        onChange(entity.id, undefined, entry.geometry);
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
      onChange(entity.id, undefined);
    };
  }, [entity.id, onChange]);
  return null;
}

type ProjectedPoint = { x: number; y: number; z: number };
type PickedEntity = { id: string; x: number; y: number; radius: number };
type SoftwareMarker = { entity: Entity; point: ProjectedPoint };
type SoftwareFace = {
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
    if (
      (entity.geometry?.kind === "asset" ||
        entity.geometry?.kind === "generated") &&
      !entry?.ready
    )
      return { ...entity, stage: "seed" as const };
    if (
      (entity.geometry?.kind === "asset" ||
        entity.geometry?.kind === "generated") &&
      entry?.ready
    )
      return {
        ...entity,
        geometry: entry.sourceRecipe ?? entity.geometry,
        stage: entry.sourceStage,
      };
    return entity;
  });
}

export function requiredGeometryReady(
  project: Project,
  geometries: Map<string, SoftwareGeometryEntry>,
): boolean {
  return project.entities.every((entity) => {
    if (
      entity.geometry?.kind !== "asset" &&
      entity.geometry?.kind !== "generated"
    )
      return true;
    const entry = geometries.get(entity.id);
    return entry?.ready === true && entry.sourceRecipe === entity.geometry;
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

function drawScene(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  project: Project,
  geometries: Map<string, SoftwareGeometryEntry>,
  session: GameSession,
  player: PlayerState,
  selected: string | undefined,
  score: readonly string[],
  time: number,
  camera: THREE.PerspectiveCamera,
  picks: PickedEntity[],
  settledWorkspace: boolean,
  navigation: WorldNavigationState,
  terrainCache: TerrainChunkSelectionCache,
  visibilityCache: SoftwareVisibilityCache,
) {
  const width = canvas.clientWidth || 1;
  const height = canvas.clientHeight || 1;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
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
  const gameplayFrustum =
    playing && settledWorkspace ? softwareCameraFrustum(camera) : undefined;
  const transformedGameplayBounds = new THREE.Box3();
  for (const entity of project.entities) {
    if (!softwareEntityPassesVisibility(entity.id, visibleEntityIds)) continue;
    const effective = playing ? session.effectiveEntity(entity) : entity;
    if (!effective) continue;
    const entry = geometries.get(entity.id);
    if (!entry) continue;
    const matrix = softwareEntityMatrix(
      project,
      entity,
      time,
      session,
      playing,
    );
    if (
      playing &&
      gameplayFrustum &&
      !softwareGeometryVisibleInFrustum(
        entry,
        matrix,
        gameplayFrustum,
        transformedGameplayBounds,
      )
    )
      continue;
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
      playing ? session.state?.entityOverrides[entity.id]?.color : undefined,
    );
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
  }
  for (const marker of markers) {
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
  }
  if (playing) drawPlayer(ctx, player, camera, width, height);
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
  const [, setGeometryVersion] = useState(0);
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
        if (disposed && current?.geometry === disposed) {
          geometriesRef.current.delete(id);
          geometryGenerationRef.current += 1;
          disposeOnce(disposed);
        } else if (disposed && current?.geometry !== disposed) {
          // A stale cleanup may arrive after a replacement has committed.
          disposeOnce(disposed);
        }
        if (entry && (!current || current.geometry !== entry.geometry)) {
          if (current && current.geometry !== entry.geometry)
            disposeOnce(current.geometry);
          geometriesRef.current.set(id, entry);
          geometryGenerationRef.current += 1;
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
  const project = useOrb((state) => state.project);
  const phase = useOrb((state) => state.phase);
  const playing = useOrb((state) => state.playing);
  const selected = useOrb((state) => state.selected);
  const score = useOrb((state) => state.score);
  const reset = useOrb((state) => state.reset);
  const session = useMemo(() => new GameSession(), []);
  const playerRef = useRef<PlayerState>(copyPlayerState(playerStart));
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
        const pendingAssetIds = expected
          .filter((entity) => {
            const entry = geometriesRef.current.get(entity.id);
            return (
              !entry ||
              !entry.ready ||
              entry.sourceRecipe !== entity.geometry ||
              entry.sourceStage !== entity.stage
            );
          })
          .map((entity) => entity.id);
        const failedAssetIds = expected
          .filter((entity) => assetErrorsRef.current.has(entity.id))
          .map((entity) => entity.id);
        const readyAssetIds = expected
          .filter((entity) => {
            const entry = geometriesRef.current.get(entity.id);
            return (
              !!entry &&
              entry.ready &&
              entry.sourceRecipe === entity.geometry &&
              entry.sourceStage === entity.stage &&
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
        return captureSceneCanvas(canvas);
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
    const reportRuntimeError = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      onErrorRef.current?.(softwareRendererError);
    };
    const animate = (now: number) => {
      if (stopped) return;
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
          playerRef.current = copyPlayerState(playerStart);
          inputRef.current.clear();
          previousReset.current = current.reset;
          previousProjectId.current = projectNow.id;
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
          playerRef.current = copyPlayerState(playerStart);
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
          }
        } else inputRef.current.clear();
        const savedNavigation = navigationRef.current;
        const activeNavigation = current.playing
          ? worldNavigationFollowState(
              savedNavigation,
              playerRef.current.position,
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
        drawScene(
          context,
          canvas,
          projectNow,
          geometriesRef.current,
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
          activeNavigation,
          terrainCacheRef.current,
          visibilityCacheRef.current,
        );
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
          requiredGeometryReady(projectNow, geometriesRef.current)
        ) {
          announcedReady.current = true;
          onReadyRef.current?.();
        }
        frame = requestAnimationFrame(animate);
      } catch {
        reportRuntimeError();
      }
    };
    try {
      frame = requestAnimationFrame(animate);
    } catch {
      reportRuntimeError();
    }
    return () => {
      stopped = true;
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
      {project.entities.map((entity) => (
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
