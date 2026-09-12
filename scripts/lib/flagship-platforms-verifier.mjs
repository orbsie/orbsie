// Read-only source-contact calculations for the flagship platform verifier.
// These mirror src/lib/gameplay.ts platformTop/isInsidePlatform for catalog
// assets without importing renderer, store, or gameplay state.
import { Matrix4, Vector3 } from "three";

export const PLAYER_HALF_HEIGHT = 0.42;
export const LANDING_CROSSING_TOLERANCE = 0.08;
// The runtime clamps a successful landing to this source contact height. A
// sampled frame materially below it is a late pass-through, not proof of a
// landing, even when the crossing tolerance was satisfied previously. The
// runtime clamps to this value without an additional gameplay tolerance.
export const LANDING_CONTACT_HEIGHT_TOLERANCE = 1e-5;
// Keep these in sync with src/lib/gameplay.ts. They are used only to decide
// whether a moving-platform handoff is currently feasible for this verifier.
export const PLAYER_MOVE_SPEED = 4;
export const JUMP_SPEED = 6;
export const GRAVITY = 15;
export const CONTACT_HORIZONTAL_TOLERANCE = 0.22;

export const DEFAULT_JUMP_REACH_MARGIN = 0.2;
export const DEFAULT_DIMENSION_RELATIVE_TOLERANCE = 0.08;
export const DEFAULT_DIMENSION_ABSOLUTE_TOLERANCE = 0.015;
const MATRIX_EPSILON = 1e-9;

export function touchControlLabel(key) {
  return { w: "Forward", a: "Left", s: "Back", d: "Right", " ": "Jump" }[key];
}

export function movingTargetMotionBound(entity, flightTime) {
  const behavior = entity?.behavior;
  if (
    behavior?.type !== "move" ||
    !Number.isFinite(flightTime) ||
    flightTime < 0
  )
    return 0;
  const amplitude = Math.abs(behavior.amplitude ?? 0.5);
  const speed = Math.abs(behavior.speed ?? 1);
  // Bound a sinusoid over the flight by both its full excursion and its
  // maximum local speed. This is conservative and avoids assuming a phase.
  return Math.min(amplitude * 2, amplitude * speed * flightTime);
}

export function transformedAssetDimensions(entity, asset) {
  if (!entity?.scale || !asset?.bounds?.min || !asset?.bounds?.max) return null;
  return [0, 1, 2].map(
    (axis) =>
      Math.abs(asset.bounds.max[axis] - asset.bounds.min[axis]) *
      Math.abs(entity.scale[axis]),
  );
}

export function renderedDimensionsMatchSource(
  renderedPlatform,
  entity,
  asset,
  {
    relativeTolerance = DEFAULT_DIMENSION_RELATIVE_TOLERANCE,
    absoluteTolerance = DEFAULT_DIMENSION_ABSOLUTE_TOLERANCE,
  } = {},
) {
  const expected = transformedAssetDimensions(entity, asset);
  const actual = renderedPlatform?.size;
  if (
    !expected ||
    !actual ||
    expected.length !== 3 ||
    actual.length !== 3 ||
    !expected.every(Number.isFinite) ||
    !actual.every(Number.isFinite)
  )
    return false;
  return expected.every(
    (value, axis) =>
      Math.abs(actual[axis] - value) <=
      Math.max(absoluteTolerance, value * relativeTolerance),
  );
}

export function jumpReachModel({
  margin = DEFAULT_JUMP_REACH_MARGIN,
  targetMotionMargin = 0,
} = {}) {
  const flightTime = (2 * JUMP_SPEED) / GRAVITY;
  return {
    moveSpeed: PLAYER_MOVE_SPEED,
    jumpSpeed: JUMP_SPEED,
    gravity: GRAVITY,
    flightTime,
    margin,
    targetMotionMargin,
    // Reserve base margin for driver sampling; target motion is passed as a
    // separate bound and the target footprint/contact tolerance are handled by
    // horizontalGapToPlatform.
    maxTravel: Math.max(
      0,
      PLAYER_MOVE_SPEED * flightTime - margin - targetMotionMargin,
    ),
  };
}

export function horizontalGapToPlatform(
  playerCenter,
  renderedPlatform,
  entity,
  asset,
  { margin = DEFAULT_JUMP_REACH_MARGIN, targetMotionMargin = 0 } = {},
) {
  const source = sourcePlatformContact(
    entity,
    renderedPlatform,
    asset,
    playerCenter,
  );
  if (!source || !playerCenter) return null;
  const reach = jumpReachModel({ margin, targetMotionMargin });
  const expandedHalfX = source.halfX + CONTACT_HORIZONTAL_TOLERANCE;
  const expandedHalfZ = source.halfZ + CONTACT_HORIZONTAL_TOLERANCE;
  const dx = Math.max(
    Math.abs(playerCenter[0] - source.center[0]) - expandedHalfX,
    0,
  );
  const dz = Math.max(
    Math.abs(playerCenter[2] - source.center[2]) - expandedHalfZ,
    0,
  );
  const gap = Math.hypot(dx, dz);
  return {
    gap,
    reachable: gap <= reach.maxTravel,
    maxTravel: reach.maxTravel,
    margin: reach.margin,
    flightTime: reach.flightTime,
    source,
  };
}

function scaledBounds(entity, asset) {
  const low = asset.bounds.min.map((value, axis) =>
    Math.min(
      value * entity.scale[axis],
      asset.bounds.max[axis] * entity.scale[axis],
    ),
  );
  const high = asset.bounds.max.map((value, axis) =>
    Math.max(
      value * entity.scale[axis],
      asset.bounds.min[axis] * entity.scale[axis],
    ),
  );
  return { low, high };
}

function affineMatrix(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 16 ||
    !value.every(Number.isFinite) ||
    value[3] !== 0 ||
    value[7] !== 0 ||
    value[11] !== 0 ||
    value[15] !== 1
  )
    return null;
  const matrix = new Matrix4().fromArray(value);
  return Number.isFinite(matrix.determinant()) && matrix.determinant() !== 0
    ? matrix
    : null;
}

function transformedBounds(matrix, bounds) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const point = new Vector3(x, y, z).applyMatrix4(matrix);
        for (const axis of [0, 1, 2]) {
          min[axis] = Math.min(min[axis], point.getComponent(axis));
          max[axis] = Math.max(max[axis], point.getComponent(axis));
        }
      }
  return { min, max };
}

// Keep the ray/box calculation aligned with src/lib/scene-support.ts. The
// browser exposes the Formation group's local runtime matrix. This is the
// same matrix gameplay passes to platformTop; matrixWorld can additionally
// include the visual island wrapper used during scene presentation.
function supportSurfaceHeight(matrix, bounds, x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined;
  const inverse = matrix.clone().invert();
  const origin = new Vector3(x, 0, z).applyMatrix4(inverse);
  const direction = new Vector3(
    inverse.elements[4],
    inverse.elements[5],
    inverse.elements[6],
  );
  let enter = -Infinity;
  let leave = Infinity;
  for (const axis of [0, 1, 2]) {
    const start = origin.getComponent(axis);
    const delta = direction.getComponent(axis);
    if (delta === 0) {
      if (
        start < bounds.min[axis] - MATRIX_EPSILON ||
        start > bounds.max[axis] + MATRIX_EPSILON
      )
        return undefined;
      continue;
    }
    const a = (bounds.min[axis] - start) / delta;
    const b = (bounds.max[axis] - start) / delta;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave + MATRIX_EPSILON) return undefined;
  }
  return Number.isFinite(leave) ? leave : undefined;
}

/**
 * Reconstruct the source collision proxy from the same source catalog bounds
 * and runtime pose used by gameplay. The Formation group's local runtime
 * matrix is authoritative when present: set_position actions and scene
 * hierarchy transforms can change the effective pose after the authored entity
 * snapshot was captured. The authored transform remains a compatibility
 * fallback for old retained samples that predate runtime matrix telemetry.
 */
export function sourcePlatformContact(
  entity,
  renderedPlatform,
  asset,
  playerCenter,
) {
  if (!entity?.position || !entity?.scale || !renderedPlatform?.center)
    return null;
  const matrixValue = renderedPlatform.runtimeMatrix;
  if (matrixValue !== undefined) {
    const matrix = affineMatrix(matrixValue);
    if (!matrix) return null;
    const bounds = transformedBounds(matrix, asset.bounds);
    const center = bounds.min.map(
      (value, axis) => (value + bounds.max[axis]) / 2,
    );
    const query = playerCenter ?? [center[0], 0, center[2]];
    const surfaceY = supportSurfaceHeight(
      matrix,
      asset.bounds,
      query[0],
      query[2],
    );
    return {
      bounds,
      center,
      contactY:
        surfaceY === undefined ? -Infinity : surfaceY + PLAYER_HALF_HEIGHT,
      halfX: (bounds.max[0] - bounds.min[0]) / 2,
      halfZ: (bounds.max[2] - bounds.min[2]) / 2,
      playerHalfHeight: PLAYER_HALF_HEIGHT,
      catalogBounds: asset.bounds,
      entityPosition: entity.position,
      entityScale: entity.scale,
      runtimeMatrix: matrix.toArray(),
      runtimeSurfaceY: surfaceY,
      contactModel: "runtime-matrix-support-surface",
    };
  }
  const { low, high } = scaledBounds(entity, asset);
  const localCenter = low.map((value, axis) => (value + high[axis]) / 2);
  const origin = [
    renderedPlatform.center[0] - localCenter[0],
    entity.position[1],
    renderedPlatform.center[2] - localCenter[2],
  ];
  const bounds = {
    min: low.map((value, axis) => origin[axis] + value),
    max: high.map((value, axis) => origin[axis] + value),
  };
  return {
    bounds,
    center: bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2),
    contactY: origin[1] + high[1] + PLAYER_HALF_HEIGHT,
    halfX: (high[0] - low[0]) / 2,
    halfZ: (high[2] - low[2]) / 2,
    playerHalfHeight: PLAYER_HALF_HEIGHT,
    catalogBounds: asset.bounds,
    entityPosition: entity.position,
    entityScale: entity.scale,
    contactModel: "authored-entity-transform-fallback",
  };
}

/**
 * Match the gameplay landing gate: descending, crossing the source contact
 * height, and the player center inside the source X/Z footprint. New samples
 * provide runtimeCenter from the Player group's local frame so the query and
 * contact matrix stay in the same coordinates; center is a legacy fallback.
 */
export function sourceLandingEvidence(
  previousSample,
  currentSample,
  entity,
  asset,
) {
  const player = currentSample?.player;
  const previousPlayer = previousSample?.player;
  const renderedPlatform = currentSample?.platforms?.[entity.id];
  const playerCenter = player?.runtimeCenter ?? player?.center;
  const previousPlayerCenter =
    previousPlayer?.runtimeCenter ?? previousPlayer?.center;
  const source = sourcePlatformContact(
    entity,
    renderedPlatform,
    asset,
    playerCenter,
  );
  if (!playerCenter || !previousPlayerCenter || !source)
    return {
      accepted: false,
      descending: false,
      sourceOverlap: false,
      crossedContactHeight: false,
      atContactHeight: false,
      source: null,
    };
  const currentY = playerCenter[1];
  const previousY = previousPlayerCenter[1];
  const descending = currentY < previousY - 0.005;
  const crossedContactHeight =
    previousY >= source.contactY - LANDING_CROSSING_TOLERANCE &&
    currentY <= source.contactY;
  const atContactHeight =
    Math.abs(currentY - source.contactY) <= LANDING_CONTACT_HEIGHT_TOLERANCE;
  const sourceOverlap =
    Math.abs(playerCenter[0] - source.center[0]) <= source.halfX &&
    Math.abs(playerCenter[2] - source.center[2]) <= source.halfZ;
  return {
    accepted:
      descending && crossedContactHeight && atContactHeight && sourceOverlap,
    descending,
    sourceOverlap,
    crossedContactHeight,
    atContactHeight,
    currentY,
    previousY,
    source,
  };
}
