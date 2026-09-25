import { MAX_SCENE_POSITION } from "./protocol";

export type WorldNavigationVec3 = readonly [number, number, number];
export type WorldNavigationVec2 = readonly [number, number];
export type WorldNavigationViewportSize = Readonly<{
  width: number;
  height: number;
}>;

/** World-space axis-aligned bounds for one committed entity. */
export type WorldNavigationBounds = Readonly<{
  min: WorldNavigationVec3;
  max: WorldNavigationVec3;
}>;

/**
 * Shared camera intent for every renderer. Heading is a clockwise bearing
 * from geographic north (-Z) toward the top of the screen. At heading zero,
 * the camera belongs on the +Z side of the target and looks toward -Z.
 */
export type WorldNavigationState = Readonly<{
  target: WorldNavigationVec3;
  heading: number;
  distance: number;
}>;

export type WorldNavigationCameraPose = Readonly<{
  position: WorldNavigationVec3;
  target: WorldNavigationVec3;
}>;

export type WorldNavigationProjectState = Readonly<{
  projectId: string;
  navigation: WorldNavigationState;
}>;

export type WorldNavigationCommand =
  | Readonly<{ type: "pan"; delta: WorldNavigationVec2 }>
  | Readonly<{ type: "zoom"; factor: number }>
  | Readonly<{ type: "rotate_to_heading"; heading: number }>
  | Readonly<{ type: "north_reset" }>
  | Readonly<{
      type: "frame_content";
      /**
       * World-space bounds from committed entities, with parent transforms
       * already resolved by the scene graph before framing.
       */
      committedEntityBounds: readonly WorldNavigationBounds[];
      /** Shared camera projection inputs; aspect is width / height. */
      viewportAspect: number;
      /** Vertical field of view in radians. */
      verticalFovRadians: number;
    }>;

export const WORLD_NAVIGATION_LIMITS = Object.freeze({
  maxTargetCoordinate: MAX_SCENE_POSITION,
  minDistance: 4,
  maxDistance: MAX_SCENE_POSITION * 32,
});

const TWO_PI = Math.PI * 2;
/** Fixed shared camera elevation used by both renderer adapters. */
export const WORLD_NAVIGATION_CAMERA_ELEVATION_RADIANS = Math.PI / 6;
const WORLD_NAVIGATION_MIN_FAR_PLANE = 250;
export const WORLD_NAVIGATION_DEFAULT_DISTANCE = 24;
export const WORLD_NAVIGATION_PLAY_MIN_DISTANCE = 12;
const FRAME_MARGIN = 1.1;

/** Keep the play camera's horizontal framing at least as wide as a square view. */
export function worldNavigationPlayMinimumDistance(
  viewport?: WorldNavigationViewportSize,
): number {
  if (
    !viewport ||
    !Number.isFinite(viewport.width) ||
    viewport.width <= 0 ||
    !Number.isFinite(viewport.height) ||
    viewport.height <= 0
  )
    return WORLD_NAVIGATION_PLAY_MIN_DISTANCE;
  const portraitScale = viewport.height / viewport.width;
  if (!Number.isFinite(portraitScale))
    return WORLD_NAVIGATION_PLAY_MIN_DISTANCE;
  return Math.min(
    WORLD_NAVIGATION_LIMITS.maxDistance,
    Math.max(
      WORLD_NAVIGATION_PLAY_MIN_DISTANCE,
      WORLD_NAVIGATION_PLAY_MIN_DISTANCE * portraitScale,
    ),
  );
}

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

function normalizedHeading(heading: number) {
  const normalized = ((heading % TWO_PI) + TWO_PI) % TWO_PI;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function boundedTarget(target: WorldNavigationVec3): WorldNavigationVec3 {
  const fallback: WorldNavigationVec3 = [0, 0, 0];
  if (
    !Array.isArray(target) ||
    target.length !== 3 ||
    !target.every(
      (component) => typeof component === "number" && !Number.isNaN(component),
    )
  )
    return fallback;
  return [
    clamp(
      target[0],
      -WORLD_NAVIGATION_LIMITS.maxTargetCoordinate,
      WORLD_NAVIGATION_LIMITS.maxTargetCoordinate,
    ),
    clamp(
      target[1],
      -WORLD_NAVIGATION_LIMITS.maxTargetCoordinate,
      WORLD_NAVIGATION_LIMITS.maxTargetCoordinate,
    ),
    clamp(
      target[2],
      -WORLD_NAVIGATION_LIMITS.maxTargetCoordinate,
      WORLD_NAVIGATION_LIMITS.maxTargetCoordinate,
    ),
  ];
}

function boundedDistance(distance: number): number {
  if (Number.isNaN(distance)) return WORLD_NAVIGATION_DEFAULT_DISTANCE;
  return clamp(
    distance,
    WORLD_NAVIGATION_LIMITS.minDistance,
    WORLD_NAVIGATION_LIMITS.maxDistance,
  );
}

export function createWorldNavigationState(
  initial: Partial<WorldNavigationState> = {},
): WorldNavigationState {
  return {
    target: boundedTarget(initial.target ?? [0, 0, 0]),
    heading: Number.isFinite(initial.heading)
      ? normalizedHeading(initial.heading!)
      : 0,
    distance: boundedDistance(
      initial.distance ?? WORLD_NAVIGATION_DEFAULT_DISTANCE,
    ),
  };
}

/** Keep a navigation view while its project stays mounted; reset on project change. */
export function worldNavigationProjectState(
  projectId: string,
  previous?: WorldNavigationProjectState,
): WorldNavigationProjectState {
  if (previous?.projectId === projectId) return previous;
  return { projectId, navigation: createWorldNavigationState() };
}

/**
 * Project a shared navigation state to a renderer-neutral camera pose.
 * Heading zero puts the camera on +Z and looks toward geographic north (-Z).
 */
export function worldNavigationCameraPose(
  state: WorldNavigationState,
): WorldNavigationCameraPose {
  const navigation = createWorldNavigationState(state);
  const horizontalDistance =
    navigation.distance * Math.cos(WORLD_NAVIGATION_CAMERA_ELEVATION_RADIANS);
  return {
    position: [
      navigation.target[0] + Math.sin(navigation.heading) * horizontalDistance,
      navigation.target[1] +
        navigation.distance *
          Math.sin(WORLD_NAVIGATION_CAMERA_ELEVATION_RADIANS),
      navigation.target[2] + Math.cos(navigation.heading) * horizontalDistance,
    ],
    target: navigation.target,
  };
}

/**
 * Derive a temporary play camera target from the authoritative player world
 * position while retaining the editor's heading and any zoom wider than the
 * comfortable play minimum. The saved state is never changed, so ending play
 * restores the authored view automatically.
 */
export function worldNavigationFollowState(
  savedNavigation: WorldNavigationState,
  playerPosition: WorldNavigationVec3,
  viewport?: WorldNavigationViewportSize,
): WorldNavigationState {
  const saved = createWorldNavigationState(savedNavigation);
  const positionIsFinite =
    Array.isArray(playerPosition) &&
    playerPosition.length === 3 &&
    playerPosition.every(Number.isFinite);
  return {
    ...saved,
    target: positionIsFinite ? boundedTarget(playerPosition) : saved.target,
    distance: Math.max(
      saved.distance,
      worldNavigationPlayMinimumDistance(viewport),
    ),
  };
}

/** Preserve the original shared landing look start and end on the navigation target. */
export function worldNavigationLandingLookTarget(
  progress: number,
  target: WorldNavigationVec3,
): WorldNavigationVec3 {
  const amount = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  const start: WorldNavigationVec3 = [0, 0.35, 0];
  return [
    start[0] + (target[0] - start[0]) * amount,
    start[1] + (target[1] - start[1]) * amount,
    start[2] + (target[2] - start[2]) * amount,
  ];
}

/** Scale the depth range with camera distance so distant framed worlds remain visible. */
export function worldNavigationFarPlane(state: WorldNavigationState): number {
  return Math.max(
    WORLD_NAVIGATION_MIN_FAR_PLANE,
    boundedDistance(state.distance) * 2,
  );
}

/** Ground direction from the target toward the top of the screen. */
export function worldDirectionForHeading(heading: number): WorldNavigationVec3 {
  if (!Number.isFinite(heading))
    throw new RangeError("Navigation heading must be finite.");
  const bearing = normalizedHeading(heading);
  return [Math.sin(bearing), 0, -Math.cos(bearing)];
}

function normalizedEntityBounds(
  bounds: WorldNavigationBounds,
): WorldNavigationBounds | undefined {
  if (!bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max))
    return undefined;
  if (
    bounds.min.length !== 3 ||
    bounds.max.length !== 3 ||
    !bounds.min.every(Number.isFinite) ||
    !bounds.max.every(Number.isFinite)
  )
    return undefined;
  const limit = WORLD_NAVIGATION_LIMITS.maxTargetCoordinate;
  const min = bounds.min.map((value) => clamp(value, -limit, limit)) as [
    number,
    number,
    number,
  ];
  const max = bounds.max.map((value) => clamp(value, -limit, limit)) as [
    number,
    number,
    number,
  ];
  if (min.some((value, axis) => value > max[axis])) return undefined;
  return { min, max };
}

function unionBounds(
  entityBounds: readonly WorldNavigationBounds[],
): WorldNavigationBounds | undefined {
  let min: [number, number, number] | undefined;
  let max: [number, number, number] | undefined;
  for (const candidate of entityBounds) {
    const bounds = normalizedEntityBounds(candidate);
    if (!bounds) continue;
    if (!min || !max) {
      min = [...bounds.min];
      max = [...bounds.max];
      continue;
    }
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], bounds.min[axis]);
      max[axis] = Math.max(max[axis], bounds.max[axis]);
    }
  }
  return min && max ? { min, max } : undefined;
}

function frameContent(
  entityBounds: readonly WorldNavigationBounds[],
  viewportAspect: number,
  verticalFovRadians: number,
): Pick<WorldNavigationState, "target" | "distance"> {
  if (!Number.isFinite(viewportAspect) || viewportAspect <= 0)
    throw new RangeError("Viewport aspect must be finite and positive.");
  if (
    !Number.isFinite(verticalFovRadians) ||
    verticalFovRadians <= 0 ||
    verticalFovRadians >= Math.PI
  )
    throw new RangeError(
      "Vertical field of view must be finite and between 0 and π.",
    );
  const bounds = Array.isArray(entityBounds)
    ? unionBounds(entityBounds)
    : undefined;
  if (!bounds)
    return {
      target: [0, 0, 0],
      distance: WORLD_NAVIGATION_DEFAULT_DISTANCE,
    };
  const target: WorldNavigationVec3 = [
    bounds.min[0] + (bounds.max[0] - bounds.min[0]) / 2,
    bounds.min[1] + (bounds.max[1] - bounds.min[1]) / 2,
    bounds.min[2] + (bounds.max[2] - bounds.min[2]) / 2,
  ];
  const halfX = (bounds.max[0] - bounds.min[0]) / 2;
  const halfY = (bounds.max[1] - bounds.min[1]) / 2;
  const halfZ = (bounds.max[2] - bounds.min[2]) / 2;
  const radius = Math.hypot(halfX, halfY, halfZ);
  const verticalHalfAngle = verticalFovRadians / 2;
  const horizontalHalfAngle = Math.atan(
    Math.tan(verticalHalfAngle) * viewportAspect,
  );
  const narrowHalfAngle = Math.min(verticalHalfAngle, horizontalHalfAngle);
  const requiredDistance =
    radius === 0
      ? WORLD_NAVIGATION_LIMITS.minDistance
      : (radius * FRAME_MARGIN) / Math.sin(narrowHalfAngle);
  if (
    !Number.isFinite(requiredDistance) ||
    requiredDistance > WORLD_NAVIGATION_LIMITS.maxDistance
  )
    throw new RangeError(
      "Content cannot be framed within the navigation distance limit for this viewport.",
    );
  return {
    target: boundedTarget(target),
    distance: boundedDistance(requiredDistance),
  };
}

function requireFinitePair(value: WorldNavigationVec2, label: string) {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every(Number.isFinite)
  )
    throw new RangeError(`${label} must contain two finite numbers.`);
}

/** Apply a pure navigation command and return a fresh normalized state. */
export function applyWorldNavigationCommand(
  state: WorldNavigationState,
  command: WorldNavigationCommand,
): WorldNavigationState {
  const current = createWorldNavigationState(state);
  switch (command.type) {
    case "pan": {
      requireFinitePair(command.delta, "Pan delta");
      return {
        ...current,
        target: boundedTarget([
          current.target[0] + command.delta[0],
          current.target[1],
          current.target[2] + command.delta[1],
        ]),
      };
    }
    case "zoom": {
      if (!Number.isFinite(command.factor) || command.factor <= 0)
        throw new RangeError("Zoom factor must be finite and positive.");
      return {
        ...current,
        distance: boundedDistance(current.distance * command.factor),
      };
    }
    case "rotate_to_heading": {
      if (!Number.isFinite(command.heading))
        throw new RangeError("Navigation heading must be finite.");
      return { ...current, heading: normalizedHeading(command.heading) };
    }
    case "north_reset":
      return { ...current, heading: 0 };
    case "frame_content":
      return {
        ...current,
        ...frameContent(
          command.committedEntityBounds,
          command.viewportAspect,
          command.verticalFovRadians,
        ),
      };
  }
}
