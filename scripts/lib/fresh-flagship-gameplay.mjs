const CAMERA_ANGLE = 0.5;
const JUMP_SAMPLE_FIRST_COUNT = 4;
const JUMP_SAMPLE_RECENT_COUNT = 8;

export const FRESH_GAMEPLAY_LIMITS = Object.freeze({
  movementMinDistance: 0.12,
  targetDistance: 0.44,
  centeringDistance: 0.22,
  maxSteeringStepsPerTarget: 240,
  steeringStepMs: 70,
  jumpFeedbackStepMs: 50,
  jumpFeedbackSteps: 6,
  jumpPressMs: 35,
  settleMs: 180,
  maxJumpAttempts: 3,
  maxObservationWaitMs: 3000,
});

/** Keep the first four and latest eight samples from one platform jump. */
export function retainFreshGameplayJumpSample(samples, sample) {
  const current = Array.isArray(samples) ? samples : [];
  const first = current.slice(0, JUMP_SAMPLE_FIRST_COUNT);
  if (first.length < JUMP_SAMPLE_FIRST_COUNT) return [...first, sample];
  const recent = [...current.slice(JUMP_SAMPLE_FIRST_COUNT), sample].slice(
    -JUMP_SAMPLE_RECENT_COUNT,
  );
  return [...first, ...recent];
}

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

/** Keep workspace layout checks in active gameplay mode without saving edits. */
export async function enterFreshGameplayLayoutMode(page) {
  const play = page.getByRole("button", { name: "Play", exact: true });
  if (await play.isVisible()) {
    await play.click();
    return "started";
  }
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  if (await edit.isVisible()) return "already-playing";
  throw new Error("Fresh gameplay layout requires a Play or Edit control.");
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
  if (isFresh(observation)) return { observation, waitedMs: 0, polls: 0 };
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
    if (after.revision < before.revision) failures.push("revision-decreased");
    if (after.renderer !== before.renderer) failures.push("renderer-changed");
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

/** Resolve current story entities from one saved project revision. */
export function buildFreshGameplayTargets(
  project,
  story,
  { expectedCollectibleCount = 5, expectedRevision = project?.revision } = {},
) {
  if (!project || typeof project.id !== "string")
    throw new Error("Fresh gameplay requires a committed project identity.");
  if (![5, 7].includes(expectedCollectibleCount))
    throw new Error("Fresh gameplay collectible count must be five or seven.");
  if (
    !Number.isSafeInteger(project.revision) ||
    project.revision !== expectedRevision
  )
    throw new Error(
      "Fresh gameplay project revision does not match its target.",
    );
  const entities = new Map(
    (project.entities ?? []).map((entity) => [entity.id, entity]),
  );
  if (entities.size !== (project.entities ?? []).length)
    throw new Error("Fresh gameplay project contains duplicate entity IDs.");
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
      geometry: current.geometry,
    };
  };
  const platforms = (story.platforms ?? []).map((entity) =>
    requireEntity(entity, "platform"),
  );
  const currentCollectibles = (project.entities ?? []).filter(
    (entity) => entity.stage === "ready" && entity.behavior?.type === "collect",
  );
  if (currentCollectibles.length !== expectedCollectibleCount)
    throw new Error(
      `Fresh gameplay expected ${expectedCollectibleCount} collectibles in revision ${project.revision}, got ${currentCollectibles.length}.`,
    );
  const storyCollectibleIds = (story.collectibles ?? []).map(
    (entity) => requireEntity(entity, "collectible").id,
  );
  const currentCollectibleIds = currentCollectibles.map((entity) => entity.id);
  if (
    storyCollectibleIds.length !== expectedCollectibleCount ||
    new Set(storyCollectibleIds).size !== storyCollectibleIds.length ||
    currentCollectibleIds.some((id) => !storyCollectibleIds.includes(id)) ||
    storyCollectibleIds.some((id) => !currentCollectibleIds.includes(id))
  )
    throw new Error(
      "Fresh gameplay collectible IDs do not match the current project revision.",
    );
  const collectibles = currentCollectibles.map((entity) =>
    requireEntity(entity, "collectible"),
  );
  const portal = requireEntity(story.portal, "portal");
  const ids = [...platforms, ...collectibles, portal].map(
    (entity) => entity.id,
  );
  if (new Set(ids).size !== ids.length)
    throw new Error("Fresh gameplay target IDs must be unique.");
  if (platforms.length !== 3)
    throw new Error(
      `Fresh gameplay expected three platforms, got ${platforms.length}.`,
    );
  return { platforms, collectibles, portal };
}

/**
 * Collect pickups at or above the final support plane before descending ones,
 * then minimize 3D travel distance within each group. This preserves elevated
 * pickups while bounce height is available; original order breaks exact ties.
 */
export function orderFreshGameplayCollectiblesFromSupport(
  collectibles,
  supportPosition,
) {
  if (!Array.isArray(collectibles))
    throw new Error("Fresh gameplay collectibles must be an array.");
  const support = finitePosition(supportPosition, "final support");
  return collectibles
    .map((target, index) => {
      const position = finitePosition(
        target?.position,
        `collectible ${target?.id ?? index}`,
      );
      const verticalPriority = position[1] >= support[1] ? 0 : 1;
      const distanceSquared = position.reduce(
        (total, component, axis) => total + (component - support[axis]) ** 2,
        0,
      );
      return { target, index, verticalPriority, distanceSquared };
    })
    .sort(
      (a, b) =>
        a.verticalPriority - b.verticalPriority ||
        a.distanceSquared - b.distanceSquared ||
        a.index - b.index,
    )
    .map(({ target }) => target);
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

/** Avoid adding horizontal drift once the avatar is centered over a target. */
export function chooseGameplaySteeringKeys(
  playerPosition,
  targetPosition,
  centerDistance = FRESH_GAMEPLAY_LIMITS.centeringDistance,
) {
  const player = finitePosition(playerPosition, "player");
  const target = finitePosition(targetPosition, "target");
  return Math.hypot(player[0] - target[0], player[2] - target[2]) <=
    centerDistance
    ? []
    : chooseGameplayKeys(player, target);
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

/** Classify the vertical phase without treating a fixed-delay sample as a landing. */
export function gameplayJumpPhase(observation, groundY = 0.42) {
  const player = observation?.player;
  if (!player || !Array.isArray(player.position)) return "unknown";
  if (typeof player.groundedOn === "string" && player.groundedOn)
    return "supported";
  if (
    Number.isFinite(player.velocityY) &&
    Number.isFinite(player.position[1]) &&
    Math.abs(player.velocityY) <= 0.1 &&
    player.position[1] <= groundY + 0.08
  )
    return "grounded";
  if (player.velocityY > 0.1) return "ascending";
  if (player.velocityY < -0.1) return "descending";
  return "apex";
}

/** Return the current stable support, if one is authoritative in the sample. */
export function gameplaySupportId(observation, groundY = 0.42) {
  const phase = gameplayJumpPhase(observation, groundY);
  if (phase === "supported") return observation.player.groundedOn;
  if (phase === "grounded") return "ground";
  return null;
}

/** Estimate a target platform's top surface using its committed geometry bounds. */
export function gameplayPlatformSurfaceHeight(
  target,
  position = target?.position,
) {
  const base = finitePosition(position, "platform");
  const scaleY = Number(target?.scale?.[1]);
  if (!Number.isFinite(scaleY))
    throw new Error("platform scale must be finite.");
  const bounds = target?.geometry?.model?.bounds;
  const high = bounds
    ? Math.max(bounds.min[1] * scaleY, bounds.max[1] * scaleY)
    : Math.max(-0.025 * scaleY, 0.52 * scaleY);
  return base[1] + high + 0.42;
}

/**
 * Capture a bounded pair bracketing a downward crossing of estimated platform top.
 */
export function detectDescendingPlatformSurfaceCrossing(
  previous,
  current,
  target,
) {
  const validFrame = (frame) =>
    Array.isArray(frame?.player?.position) &&
    frame.player.position.length === 3 &&
    frame.player.position.every(Number.isFinite) &&
    Array.isArray(frame?.platform?.position) &&
    frame.platform.position.length === 3 &&
    frame.platform.position.every(Number.isFinite) &&
    Array.isArray(frame?.platform?.scale) &&
    frame.platform.scale.length === 3 &&
    frame.platform.scale.every((value) => Number.isFinite(value) && value > 0);
  if (!target || !validFrame(previous) || !validFrame(current)) return null;
  if (
    !Number.isFinite(previous.player?.velocityY) ||
    !Number.isFinite(current.player?.velocityY) ||
    current.player.velocityY > 0
  )
    return null;

  const estimatedTopY = (frame) =>
    gameplayPlatformSurfaceHeight(
      { ...target, scale: frame.platform.scale },
      frame.platform.position,
    );
  const previousTopY = estimatedTopY(previous);
  const currentTopY = estimatedTopY(current);
  if (
    !Number.isFinite(previousTopY) ||
    !Number.isFinite(currentTopY)
  )
    return null;
  if (
    previous.player.position[1] <= previousTopY ||
    current.player.position[1] > currentTopY
  )
    return null;

  const insideEstimatedFootprint = (frame) => {
    const player = frame.player.position;
    const platform = frame.platform.position;
    const scale = frame.platform.scale;
    return (
      Math.abs(player[0] - platform[0]) <= 0.55 * scale[0] &&
      Math.abs(player[2] - platform[2]) <= 0.55 * scale[2]
    );
  };
  const counterChanged = (before, after) =>
    Number.isSafeInteger(before) && Number.isSafeInteger(after)
      ? before !== after
      : null;

  return {
    kind: "descending-estimated-platform-top-crossing",
    estimateOnly: true,
    footprint: {
      model: "procedural-xz-half-extents-0.55-times-scale",
      authoritativeContact: false,
    },
    previous: {
      observation: previous,
      estimatedTopY: previousTopY,
      insideEstimatedFootprint: insideEstimatedFootprint(previous),
    },
    current: {
      observation: current,
      estimatedTopY: currentTopY,
      insideEstimatedFootprint: insideEstimatedFootprint(current),
    },
    contactCountersChanged: {
      platform: counterChanged(
        previous.platformContactCount,
        current.platformContactCount,
      ),
      bounce: counterChanged(
        previous.bounceContactCount,
        current.bounceContactCount,
      ),
    },
  };
}

/**
 * Select one transition action from the current support and jump phase.
 * `jumping` means a jump edge has already been sent for this target; a stable
 * support then means the attempt recovered and may be retried, never that a
 * second jump should be held continuously.
 */
export function chooseGameplayPlatformAction({
  observation,
  target,
  jumping = false,
  targetContacted = false,
  groundY = 0.42,
}) {
  if (targetContacted) return { phase: "contacted", keys: [] };
  const player = finitePosition(observation?.player?.position, "player");
  const targetPosition = finitePosition(target?.position, "platform");
  const verticalPhase = gameplayJumpPhase(observation, groundY);
  const supportId = gameplaySupportId(observation, groundY);
  const steering = chooseGameplaySteeringKeys(player, targetPosition);
  if (jumping) {
    if (supportId) return { phase: "recovered", keys: [] };
    return { phase: "jumping", keys: steering };
  }
  if (
    verticalPhase === "ascending" ||
    verticalPhase === "descending" ||
    verticalPhase === "apex"
  )
    return { phase: "airborne", keys: steering };
  if (supportId && gameplayPlatformSurfaceHeight(target) > player[1] + 0.18)
    return {
      phase: "jumping",
      keys: chooseGameplayJumpKeys(player, targetPosition),
    };
  return { phase: "steering", keys: steering };
}

/** Compare each authoritative contact counter against its own attempt baseline. */
export function platformContactProgress(
  observation,
  targetId,
  { baselinePlatformContactCount = 0, baselineBounceContactCount = 0 } = {},
) {
  const platformContactCount =
    observation?.platformContactCounts?.[targetId] ?? 0;
  const bounceContactCount = observation?.bounceContactCounts?.[targetId] ?? 0;
  const grounded = observation?.player?.groundedOn === targetId;
  const platformContact = platformContactCount > baselinePlatformContactCount;
  const bounced = bounceContactCount > baselineBounceContactCount;
  return {
    grounded,
    platformContact,
    bounced,
    contacted: grounded || platformContact || bounced,
    platformContactCount,
    bounceContactCount,
  };
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
