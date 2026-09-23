import { MAX_SCENE_POSITION } from "./protocol";
import type { WorldNavigationCameraPose } from "./world-navigation";

export type RenderOriginVec3 = readonly [x: number, y: number, z: number];

/** Renderer origin moves in 1024-unit cells, keeping nearby GPU coordinates small. */
export const RENDER_ORIGIN_CELL_SIZE = 1024;
/** Rebase after the focus moves more than three quarters of a cell per axis. */
export const RENDER_ORIGIN_REBASE_THRESHOLD = RENDER_ORIGIN_CELL_SIZE * 0.75;

const ZERO_ORIGIN: RenderOriginVec3 = [0, 0, 0];

function isFiniteVec3(value: unknown): value is RenderOriginVec3 {
  return (
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
  );
}

function isWorldPosition(value: unknown): value is RenderOriginVec3 {
  return (
    isFiniteVec3(value) &&
    value.every((component) => Math.abs(component) <= MAX_SCENE_POSITION)
  );
}

function isRenderOrigin(value: unknown): value is RenderOriginVec3 {
  return (
    isFiniteVec3(value) &&
    value.every(
      (component) =>
        Math.abs(component) <= MAX_SCENE_POSITION + RENDER_ORIGIN_CELL_SIZE &&
        Number.isSafeInteger(component / RENDER_ORIGIN_CELL_SIZE),
    )
  );
}

function quantizeOrigin(focus: RenderOriginVec3): RenderOriginVec3 {
  return focus.map((component) => {
    const absoluteCell = Math.abs(component / RENDER_ORIGIN_CELL_SIZE);
    const lowerCell = Math.floor(absoluteCell);
    const roundedCell = lowerCell + (absoluteCell - lowerCell > 0.5 ? 1 : 0);
    const cell = Math.sign(component) * roundedCell;
    const origin = cell * RENDER_ORIGIN_CELL_SIZE;
    return Object.is(origin, -0) ? 0 : origin;
  }) as [number, number, number];
}

/** True when a valid focus has moved past the current origin's rebase threshold. */
export function shouldRebaseRenderOrigin(
  focus: RenderOriginVec3,
  origin: RenderOriginVec3,
): boolean {
  if (!isWorldPosition(focus) || !isRenderOrigin(origin)) return true;
  return focus.some(
    (component, axis) =>
      Math.abs(component - origin[axis]) > RENDER_ORIGIN_REBASE_THRESHOLD,
  );
}

/**
 * Keep the previous quantized origin until the focus crosses three quarters
 * of a cell on an axis, then select the nearest 1024-unit origin for every
 * axis (exact half-cell ties round toward zero). Invalid focus values retain
 * a valid prior origin or safely fall back to world zero.
 */
export function selectRenderOrigin(
  focus: RenderOriginVec3,
  previousOrigin?: RenderOriginVec3,
): RenderOriginVec3 {
  if (!isWorldPosition(focus))
    return isRenderOrigin(previousOrigin)
      ? [...previousOrigin]
      : [...ZERO_ORIGIN];
  if (
    isRenderOrigin(previousOrigin) &&
    !shouldRebaseRenderOrigin(focus, previousOrigin)
  )
    return [...previousOrigin];
  return quantizeOrigin(focus);
}

/** Convert an authoritative world position into renderer-local coordinates. */
export function worldToRenderLocal(
  world: RenderOriginVec3,
  origin: RenderOriginVec3,
): RenderOriginVec3 | undefined {
  if (!isWorldPosition(world) || !isRenderOrigin(origin)) return undefined;
  return [world[0] - origin[0], world[1] - origin[1], world[2] - origin[2]];
}

/** Convert a renderer-local position back to a bounded authoritative world position. */
export function renderLocalToWorld(
  local: RenderOriginVec3,
  origin: RenderOriginVec3,
): RenderOriginVec3 | undefined {
  if (!isFiniteVec3(local) || !isRenderOrigin(origin)) return undefined;
  const world: RenderOriginVec3 = [
    local[0] + origin[0],
    local[1] + origin[1],
    local[2] + origin[2],
  ];
  return isWorldPosition(world) ? world : undefined;
}

/** Translate both ends of a world-space camera pose by the same render origin. */
export function worldCameraPoseToRenderLocal(
  pose: WorldNavigationCameraPose,
  origin: RenderOriginVec3,
): WorldNavigationCameraPose | undefined {
  if (
    !pose ||
    !isFiniteVec3(pose.position) ||
    !isWorldPosition(pose.target) ||
    !isRenderOrigin(origin)
  )
    return undefined;
  return {
    position: [
      pose.position[0] - origin[0],
      pose.position[1] - origin[1],
      pose.position[2] - origin[2],
    ],
    target: [
      pose.target[0] - origin[0],
      pose.target[1] - origin[1],
      pose.target[2] - origin[2],
    ],
  };
}
