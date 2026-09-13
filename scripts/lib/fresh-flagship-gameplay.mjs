const CAMERA_ANGLE = 0.5;

export const FRESH_GAMEPLAY_LIMITS = Object.freeze({
  movementMinDistance: 0.12,
  targetDistance: 0.44,
  centeringDistance: 0.22,
  maxSteeringStepsPerTarget: 240,
  steeringStepMs: 70,
  jumpFeedbackStepMs: 50,
  jumpFeedbackSteps: 6,
  settleMs: 180,
  maxJumpAttempts: 3,
  maxObservationWaitMs: 1000,
});

const GAMEPLAY_SURFACE_FRACTIONS = Object.freeze([
  [0.08, 0.08],
  [0.5, 0.08],
  [0.92, 0.08],
  [0.08, 0.5],
  [0.5, 0.5],
  [0.92, 0.5],
  [0.08, 0.92],
  [0.5, 0.92],
  [0.92, 0.92],
  [0.2, 0.2],
  [0.8, 0.2],
  [0.2, 0.8],
  [0.8, 0.8],
]);

/** Return bounded, inset viewport candidates for a rendered gameplay surface. */
export function gameplaySurfaceCandidatePoints({ x, y, width, height }) {
  const inset = 8;
  const usableWidth = Math.max(1, width - inset * 2);
  const usableHeight = Math.max(1, height - inset * 2);
  return GAMEPLAY_SURFACE_FRACTIONS.map(([fractionX, fractionY]) => ({
    x: x + inset + usableWidth * fractionX,
    y: y + inset + usableHeight * fractionY,
  }));
}

export function generationStreamIsOpen({ stopControlVisible }) {
  return stopControlVisible === true;
}

/** Sample a strictly newer observation without reusing a stale frame. */
export async function waitForFreshGameplayObservation(
  read,
  wait,
  {
    lastAtMs = -Infinity,
    maxWaitMs = Number(FRESH_GAMEPLAY_LIMITS.maxObservationWaitMs),
  } = {},
) {
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(0, maxWaitMs);
  let observation = await read();
  const isFresh = (value) =>
    Boolean(value && Number.isFinite(value.atMs) && value.atMs > lastAtMs);
  if (isFresh(observation))
    return { observation, waitedMs: 0, polls: 0 };
  const intervalMs = 50;
  const maxPolls = Math.max(1, Math.ceil(maxWaitMs / intervalMs));
  for (let poll = 1; poll <= maxPolls; poll++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await wait(Math.min(intervalMs, remainingMs));
    observation = await read();
    if (isFresh(observation) && Date.now() <= deadline)
      return {
        observation,
        waitedMs: Date.now() - startedAt,
        polls: poll,
      };
  }
  return {
    observation: null,
    waitedMs: Date.now() - startedAt,
    polls: maxPolls,
    lastObservedAtMs: observation?.atMs ?? null,
  };
}

/**
 * @param {unknown} before
 * @param {unknown} after
 * @param {{
 *   projectId: string,
 *   streamOpenBefore: boolean,
 *   streamOpenAfter: boolean,
 *   movementMinDistance?: number,
 * }} options
 */
/** Validate every predicate needed to claim movement during an open stream. */
export function validateGenerationMovementObservation(
  before,
  after,
  {
    projectId,
    streamOpenBefore,
    streamOpenAfter,
    movementMinDistance = FRESH_GAMEPLAY_LIMITS.movementMinDistance,
  },
) {
  const failures = [];
  if (!before) failures.push("missing-before-observation");
  if (!after) failures.push("missing-after-observation");
  if (!streamOpenBefore) failures.push("stream-closed-before-input");
  if (!streamOpenAfter) failures.push("stream-closed-after-movement");
  if (before && before.playing !== true)
    failures.push("before-sample-not-playing");
  if (after && after.playing !== true)
    failures.push("after-sample-not-playing");
  if (before && before.projectId !== projectId)
    failures.push("before-project-mismatch");
  if (after && after.projectId !== projectId)
    failures.push("after-project-mismatch");
  if (before && after) {
    if (after.revision < before.revision)
      failures.push("revision-decreased");
    if (after.renderer !== before.renderer)
      failures.push("renderer-changed");
    if (!(Number.isFinite(after.atMs) && after.atMs > before.atMs))
      failures.push("after-observation-not-newer");
  }
  const movementDistance =
    before?.player?.position && after?.player?.position
      ? Math.hypot(
          after.player.position[0] - before.player.position[0],
          after.player.position[2] - before.player.position[2],
        )
      : Number.NaN;
  if (before && after && !Number.isFinite(movementDistance))
    failures.push("movement-distance-nonfinite");
  else if (before && after && movementDistance < movementMinDistance)
    failures.push("movement-below-minimum");
  return {
    valid: failures.length === 0,
    failures,
    movementDistance,
  };
}

/**
 * A portal can win during the approach to it. Treat that as terminal only
 * after the runtime reports the portal contact and the complete score set.
 * Position or proximity alone never completes the objective.
 */
export function portalCompletionIsAuthoritative(
  observation,
  { portalId, expectedCollectibleIds },
) {
  if (
    !observation ||
    observation.status !== "won" ||
    observation.won !== true ||
    !observation.contacts?.includes(portalId)
  )
    return false;
  return expectedCollectibleIds.every((id) =>
    observation.scoreIds?.includes(id),
  );
}

/**
 * @param {unknown} observation
 * @param {{
 *   projectId: string,
 *   revision: number,
 *   renderer?: string,
 *   lastAtMs?: number,
 *   reset?: number,
 *   sessionGeneration?: number,
 *   allowLifecycleChange?: boolean,
 * }} options
 */
export function validateFreshGameplayObservation(
  observation,
  {
    projectId,
    revision,
    renderer,
    lastAtMs = -Infinity,
    reset = undefined,
    sessionGeneration = undefined,
    allowLifecycleChange = false,
  },
) {
  if (!observation)
    throw new Error("Fresh gameplay renderer exposed no observation.");
  if (observation.projectId !== projectId || observation.revision !== revision)
    throw new Error(
      "Fresh gameplay observation changed project identity or revision.",
    );
  if (renderer && observation.renderer !== renderer)
    throw new Error("Fresh gameplay renderer changed during one run.");
  if (
    !allowLifecycleChange &&
    reset !== undefined &&
    observation.reset !== reset
  )
    throw new Error("Fresh gameplay reset changed during traversal.");
  if (
    !allowLifecycleChange &&
    sessionGeneration !== undefined &&
    observation.sessionGeneration !== sessionGeneration
  )
    throw new Error("Fresh gameplay session changed during traversal.");
  if (!(Number.isFinite(observation.atMs) && observation.atMs > lastAtMs))
    throw new Error(
      `Fresh gameplay returned a stale renderer observation (atMs=${observation.atMs}, lastAtMs=${lastAtMs}).`,
    );
  if (!(
    observation.renderer === "webgl" || observation.renderer === "software"
  ))
    throw new Error("Fresh gameplay did not identify its renderer.");
  return observation;
}

const DIRECTIONS = Object.freeze([
  { x: 1, z: 0, keys: ["d"] },
  { x: -1, z: 0, keys: ["a"] },
  { x: 0, z: 1, keys: ["s"] },
  { x: 0, z: -1, keys: ["w"] },
  { x: Math.SQRT1_2, z: Math.SQRT1_2, keys: ["d", "s"] },
  { x: Math.SQRT1_2, z: -Math.SQRT1_2, keys: ["d", "w"] },
  { x: -Math.SQRT1_2, z: Math.SQRT1_2, keys: ["a", "s"] },
  { x: -Math.SQRT1_2, z: -Math.SQRT1_2, keys: ["a", "w"] },
]);

function finitePosition(value, label) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((component) => Number.isFinite(component))
  )
    throw new Error(`${label} must contain a finite 3D position.`);
  return [...value];
}

/** Resolve fresh story entities by their observed semantic IDs and layout. */
export function buildFreshGameplayTargets(project, story) {
  if (!project || typeof project.id !== "string")
    throw new Error("Fresh gameplay requires a committed project identity.");
  const entities = new Map(
    (project.entities ?? []).map((entity) => [entity.id, entity]),
  );
  const requireEntity = (entity, label) => {
    if (!entity || typeof entity.id !== "string")
      throw new Error(`Fresh gameplay is missing its ${label} entity.`);
    const current = entities.get(entity.id);
    if (!current)
      throw new Error(
        `Fresh gameplay ${label} ${entity.id} is not in the project.`,
      );
    return {
      id: current.id,
      behavior: current.behavior?.type ?? null,
      position: finitePosition(current.position, `${label} ${current.id}`),
      scale: finitePosition(current.scale, `${label} ${current.id} scale`),
    };
  };
  const platforms = (story.platforms ?? []).map((entity) =>
    requireEntity(entity, "platform"),
  );
  const collectibles = (story.collectibles ?? []).map((entity) =>
    requireEntity(entity, "collectible"),
  );
  const portal = requireEntity(story.portal, "portal");
  const ids = [...platforms, ...collectibles, portal].map(
    (entity) => entity.id,
  );
  if (new Set(ids).size !== ids.length)
    throw new Error("Fresh gameplay target IDs must be unique.");
  if (collectibles.length !== 5)
    throw new Error(
      `Fresh gameplay expected five collectibles, got ${collectibles.length}.`,
    );
  if (platforms.length !== 3)
    throw new Error(
      `Fresh gameplay expected three platforms, got ${platforms.length}.`,
    );
  return { platforms, collectibles, portal };
}

/** Choose camera-relative real inputs for the currently observed target. */
export function chooseGameplayKeys(playerPosition, targetPosition) {
  const player = finitePosition(playerPosition, "player");
  const target = finitePosition(targetPosition, "target");
  const dx = target[0] - player[0];
  const dz = target[2] - player[2];
  const inputX = Math.cos(CAMERA_ANGLE) * dx - Math.sin(CAMERA_ANGLE) * dz;
  const inputZ = Math.sin(CAMERA_ANGLE) * dx + Math.cos(CAMERA_ANGLE) * dz;
  return DIRECTIONS.reduce((best, candidate) =>
    candidate.x * inputX + candidate.z * inputZ >
    best.x * inputX + best.z * inputZ
      ? candidate
      : best,
  ).keys;
}

/** Keep the jump edge while releasing horizontal steering at platform center. */
export function chooseGameplayJumpKeys(
  playerPosition,
  targetPosition,
  centerDistance = FRESH_GAMEPLAY_LIMITS.centeringDistance,
) {
  const player = finitePosition(playerPosition, "player");
  const target = finitePosition(targetPosition, "target");
  if (
    Math.hypot(player[0] - target[0], player[2] - target[2]) <= centerDistance
  )
    return [" "];
  return [" ", ...chooseGameplayKeys(player, target)];
}

/**
 * Derive platform evidence from successive copied frames. A groundedOn ID is
 * direct physics evidence for a moving platform. A bounce is identified by
 * the runtime's top-surface bounce event; proximity or upward motion alone is
 * never reported as contact.
 */
export function observePlatformContact(previous, current, target) {
  if (!current?.player || !target) return { grounded: false, bounced: false };
  const previousPlatformCount =
    previous?.platformContactCounts?.[target.id] ?? 0;
  const grounded =
    current.player.groundedOn === target.id ||
    (current.platformContactCounts?.[target.id] ?? 0) > previousPlatformCount;
  const previousBounceCount = previous?.bounceContactCounts?.[target.id] ?? 0;
  const bounced =
    (current.bounceContactCounts?.[target.id] ?? 0) > previousBounceCount;
  return { grounded, bounced };
}

export function summarizeFreshGameplayRun({
  project,
  observations,
  targets,
  resetObservation,
}) {
  const expectedIds = targets.collectibles.map((target) => target.id);
  const final = observations.at(-1);
  if (!final)
    throw new Error("Fresh gameplay produced no renderer observation.");
  if (final.projectId !== project.id || final.revision !== project.revision)
    throw new Error(
      "Fresh gameplay observation changed project identity or revision.",
    );
  const collected = [...new Set(final.scoreIds)].filter((id) =>
    expectedIds.includes(id),
  );
  return {
    projectId: final.projectId,
    revision: final.revision,
    renderer: final.renderer,
    collectedIds: collected,
    expectedCollectibleIds: expectedIds,
    score: final.gameScore,
    won: final.won,
    reset: resetObservation?.reset ?? null,
    elapsedMs: observations.at(-1).atMs - observations[0].atMs,
  };
}
