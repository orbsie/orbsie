import {
  WORLD_NAVIGATION_CAMERA_ELEVATION_RADIANS,
  WORLD_NAVIGATION_LIMITS,
} from "./world-navigation";

export type WorldTerrainChunkKey = Readonly<{
  lod: number;
  x: number;
  z: number;
}>;

export type WorldTerrainFocus = readonly [x: number, y: number, z: number];

export type WorldTerrainView = Readonly<{
  /** World-space camera/player focus; terrain selection uses X/Z and height. */
  focus: WorldTerrainFocus;
  /** Camera distance along the shared 30-degree camera pose. */
  distance: number;
  /** Viewport width divided by height. */
  aspect: number;
}>;

export type WorldTerrainSample = Readonly<{
  position: readonly [x: number, y: 0, z: number];
  /** Smooth, deterministic normalized appearance variation in [0, 1]. */
  appearance: number;
}>;

export const WORLD_TERRAIN_BASE_CHUNK_SIZE = 64;
export const WORLD_TERRAIN_NEIGHBORHOOD_RADIUS = 3;
export const WORLD_TERRAIN_MAX_ACTIVE_CHUNKS =
  (WORLD_TERRAIN_NEIGHBORHOOD_RADIUS * 2 + 1) ** 2;
export const WORLD_TERRAIN_COLLISION_HEIGHT = 0;
export const WORLD_TERRAIN_VERTICAL_FOV_RADIANS = (43 * Math.PI) / 180;

const MAX_TERRAIN_LOD = 40;
const MIN_SUPPORTED_ASPECT = 0.05;
const MAX_SUPPORTED_ASPECT = 20;
const VERTICAL_TANGENT = Math.tan(WORLD_TERRAIN_VERTICAL_FOV_RADIANS / 2);

function finiteWorldCoordinate(value: number) {
  return (
    Number.isFinite(value) &&
    Math.abs(value) <= WORLD_NAVIGATION_LIMITS.maxTargetCoordinate
  );
}

function assertView(distance: number, aspect: number) {
  if (
    !Number.isFinite(distance) ||
    distance < WORLD_NAVIGATION_LIMITS.minDistance ||
    distance > WORLD_NAVIGATION_LIMITS.maxDistance
  )
    throw new RangeError(
      "Terrain camera distance is outside supported limits.",
    );
  if (
    !Number.isFinite(aspect) ||
    aspect < MIN_SUPPORTED_ASPECT ||
    aspect > MAX_SUPPORTED_ASPECT
  )
    throw new RangeError(
      "Terrain viewport aspect is outside supported limits.",
    );
}

function assertFocus(
  focus: WorldTerrainFocus,
): asserts focus is WorldTerrainFocus {
  if (
    !Array.isArray(focus) ||
    focus.length !== 3 ||
    !finiteWorldCoordinate(focus[0]) ||
    !finiteWorldCoordinate(focus[1]) ||
    !finiteWorldCoordinate(focus[2])
  )
    throw new RangeError(
      "Terrain focus must be finite and within world limits.",
    );
}

/** Return the exact power-of-two chunk edge length for a non-negative LOD. */
export function worldTerrainChunkSize(lod: number): number {
  if (!Number.isSafeInteger(lod) || lod < 0 || lod > MAX_TERRAIN_LOD)
    throw new RangeError("Terrain LOD is outside supported limits.");
  return WORLD_TERRAIN_BASE_CHUNK_SIZE * Math.pow(2, lod);
}

/** Map world X/Z to a signed chunk key using floor semantics at negative edges. */
export function worldTerrainChunkKeyAt(
  x: number,
  z: number,
  lod = 0,
): WorldTerrainChunkKey {
  const size = worldTerrainChunkSize(lod);
  if (!finiteWorldCoordinate(x) || !finiteWorldCoordinate(z))
    throw new RangeError("Terrain coordinates must be finite and in range.");
  const chunkX = Math.floor(x / size);
  const chunkZ = Math.floor(z / size);
  return {
    lod,
    x: Object.is(chunkX, -0) ? 0 : chunkX,
    z: Object.is(chunkZ, -0) ? 0 : chunkZ,
  };
}

/**
 * Maximum distance from the focus to a point where a viewport corner ray
 * intersects the flat ground. This uses the shared 43-degree FOV and camera
 * elevation; the symmetric footprint is heading-independent.
 */
export function worldTerrainGroundViewRadius(
  distance: number,
  aspect: number,
  focusHeight = 0,
): number {
  assertView(distance, aspect);
  if (!finiteWorldCoordinate(focusHeight))
    throw new RangeError("Terrain focus height must be finite and in range.");
  const elevation = WORLD_NAVIGATION_CAMERA_ELEVATION_RADIANS;
  const sinElevation = Math.sin(elevation);
  const cosElevation = Math.cos(elevation);
  const cameraHeight = focusHeight + distance * sinElevation;
  if (!(cameraHeight > 0))
    throw new RangeError("Terrain camera must be above the ground plane.");
  const cameraForward = distance * cosElevation;
  const horizontalTangent = VERTICAL_TANGENT * aspect;
  let maxRadius = 0;

  for (const vertical of [-VERTICAL_TANGENT, VERTICAL_TANGENT]) {
    const rayY = -sinElevation + vertical * cosElevation;
    if (!(rayY < 0))
      throw new RangeError("The shared terrain camera must face the ground.");
    const scale = -cameraHeight / rayY;
    const rayZ = -cosElevation - vertical * sinElevation;
    for (const horizontal of [-horizontalTangent, horizontalTangent]) {
      const x = scale * horizontal;
      const z = cameraForward + scale * rayZ;
      const radius = Math.hypot(x, z);
      if (!Number.isFinite(radius))
        throw new RangeError("Terrain view footprint is not finite.");
      maxRadius = Math.max(maxRadius, radius);
    }
  }
  return maxRadius;
}

/**
 * Select a fixed 7x7 world-aligned neighborhood around an explicit focus.
 * LOD is the smallest power-of-two tile size whose neighborhood contains the
 * complete ground-plane viewport footprint.
 */
export function selectWorldTerrainChunks(
  view: WorldTerrainView,
): readonly WorldTerrainChunkKey[] {
  if (!view || typeof view !== "object")
    throw new RangeError("Terrain view is required.");
  assertFocus(view.focus);
  const radius = worldTerrainGroundViewRadius(
    view.distance,
    view.aspect,
    view.focus[1],
  );
  let lod = 0;
  let size = worldTerrainChunkSize(lod);
  while (
    WORLD_TERRAIN_NEIGHBORHOOD_RADIUS * size < radius &&
    lod < MAX_TERRAIN_LOD
  ) {
    lod += 1;
    size = worldTerrainChunkSize(lod);
  }
  if (WORLD_TERRAIN_NEIGHBORHOOD_RADIUS * size < radius)
    throw new RangeError("Terrain footprint exceeds supported chunk LOD.");

  const center = worldTerrainChunkKeyAt(view.focus[0], view.focus[2], lod);
  const chunks: WorldTerrainChunkKey[] = [];
  for (
    let z = center.z - WORLD_TERRAIN_NEIGHBORHOOD_RADIUS;
    z <= center.z + WORLD_TERRAIN_NEIGHBORHOOD_RADIUS;
    z += 1
  ) {
    for (
      let x = center.x - WORLD_TERRAIN_NEIGHBORHOOD_RADIUS;
      x <= center.x + WORLD_TERRAIN_NEIGHBORHOOD_RADIUS;
      x += 1
    )
      chunks.push({ lod, x, z });
  }
  return chunks;
}

/** Sample a seamless world-space appearance value; LOD and chunk keys are irrelevant. */
export function sampleWorldTerrainAppearance(x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z))
    throw new RangeError("Terrain sample coordinates must be finite.");
  const broad = Math.sin(x * 0.0017 + z * 0.0011);
  const medium = Math.sin(x * 0.017 - z * 0.013) * Math.cos(z * 0.019);
  const fine = Math.sin(z * 0.071 + x * 0.043);
  return 0.5 + 0.2 * broad + 0.15 * medium + 0.1 * fine;
}

/**
 * Sample a chunk-local normalized point. Adjacent keys produce the same
 * world coordinate on their shared edge, including after LOD changes.
 */
export function sampleWorldTerrainChunk(
  key: WorldTerrainChunkKey,
  u: number,
  v: number,
): WorldTerrainSample {
  if (!key || !Number.isSafeInteger(key.x) || !Number.isSafeInteger(key.z))
    throw new RangeError("Terrain chunk coordinates must be safe integers.");
  const size = worldTerrainChunkSize(key.lod);
  if (!Number.isFinite(u) || u < 0 || u > 1)
    throw new RangeError("Terrain chunk U coordinate must be in [0, 1].");
  if (!Number.isFinite(v) || v < 0 || v > 1)
    throw new RangeError("Terrain chunk V coordinate must be in [0, 1].");
  const x = key.x * size + u * size;
  const z = key.z * size + v * size;
  if (!Number.isFinite(x) || !Number.isFinite(z))
    throw new RangeError("Terrain sample position is not finite.");
  return {
    position: [x, WORLD_TERRAIN_COLLISION_HEIGHT, z],
    appearance: sampleWorldTerrainAppearance(x, z),
  };
}
