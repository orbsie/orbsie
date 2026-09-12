// Read-only source-contact calculations for the flagship platform verifier.
// These mirror src/lib/gameplay.ts platformTop/isInsidePlatform for catalog
// assets without importing renderer, store, or gameplay state.

export const PLAYER_HALF_HEIGHT = 0.42;
export const LANDING_CROSSING_TOLERANCE = 0.08;

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

/**
 * Reconstruct the source collision proxy from catalog bounds and the entity
 * transform. The observed platform center supplies only the moving X/Z
 * position; source Y remains the entity transform plus the catalog max-Y.
 * This intentionally does not use the visible mesh top for contact height.
 */
export function sourcePlatformContact(entity, renderedPlatform, asset) {
  if (!entity?.position || !entity?.scale || !renderedPlatform?.center)
    return null;
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
  };
}

/**
 * Match the gameplay landing gate: descending, crossing the source contact
 * height, and the player center inside the source X/Z footprint.
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
  const source = sourcePlatformContact(entity, renderedPlatform, asset);
  if (!player || !previousPlayer || !source)
    return {
      accepted: false,
      descending: false,
      sourceOverlap: false,
      crossedContactHeight: false,
      source: null,
    };
  const currentY = player.center[1];
  const previousY = previousPlayer.center[1];
  const descending = currentY < previousY - 0.005;
  const crossedContactHeight =
    previousY >= source.contactY - LANDING_CROSSING_TOLERANCE &&
    currentY <= source.contactY;
  const sourceOverlap =
    Math.abs(player.center[0] - source.center[0]) <= source.halfX &&
    Math.abs(player.center[2] - source.center[2]) <= source.halfZ;
  return {
    accepted: descending && crossedContactHeight && sourceOverlap,
    descending,
    sourceOverlap,
    crossedContactHeight,
    currentY,
    previousY,
    source,
  };
}
