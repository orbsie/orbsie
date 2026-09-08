export type Vec3 = readonly [number, number, number];

export type ParcelFrame = {
  normal: Vec3;
  east: Vec3;
  north: Vec3;
  spinPhase: number;
};

export type ParcelTransitionState = {
  progress: number;
  spin: number;
};

const TAU = Math.PI * 2;
const TRANSITION_RESPONSE = 0.95;
const MAX_PLANET_SPIN = 0.08;

function hashProjectId(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unit(value: Vec3): Vec3 {
  const length = Math.hypot(...value);
  return length > 0
    ? [value[0] / length, value[1] / length, value[2] / length]
    : [0, 1, 0];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Return a stable surface point and right-handed tangent basis for a project. */
export function parcelFrame(projectId: string): ParcelFrame {
  const hash = hashProjectId(projectId);
  const latitude = ((hash & 0xffff) / 0xffff - 0.5) * 0.9;
  const longitude = (((hash >>> 16) & 0xffff) / 0xffff - 0.5) * TAU;
  const cosLatitude = Math.cos(latitude);
  const normal = unit([
    cosLatitude * Math.cos(longitude),
    Math.sin(latitude),
    cosLatitude * Math.sin(longitude),
  ]);
  const reference: Vec3 = Math.abs(normal[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0];
  const east = unit(cross(reference, normal));
  const north = unit(cross(normal, east));
  return {
    normal,
    east,
    north,
    spinPhase: ((Math.imul(hash, 2654435761) >>> 0) / 0xffffffff) * TAU,
  };
}

export function clampProgress(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function smoothTransition(value: number, start = 0, end = 1) {
  const range = Math.max(0.0001, end - start);
  const t = clampProgress((value - start) / range);
  return t * t * (3 - 2 * t);
}

export function patchBlend(progress: number) {
  return smoothTransition(progress, 0.18, 0.96);
}

export function globeScale(progress: number) {
  const value = clampProgress(progress);
  return 1 + value * value * 6;
}

export function globeOffsetY(progress: number) {
  const value = clampProgress(progress);
  return -value * 3 * globeScale(value);
}

export function planetSpinRate(progress: number, reducedMotion = false) {
  return reducedMotion ? 0 : MAX_PLANET_SPIN * (1 - clampProgress(progress));
}

export function createParcelTransition(progress = 0): ParcelTransitionState {
  return { progress: clampProgress(progress), spin: 0 };
}

/** Advance the renderer-owned transition without tying it to network progress. */
export function stepParcelTransition(
  state: ParcelTransitionState,
  target: 0 | 1,
  deltaSeconds: number,
  reducedMotion = false,
): ParcelTransitionState {
  const dt = Math.max(
    0,
    Math.min(0.1, Number.isFinite(deltaSeconds) ? deltaSeconds : 0),
  );
  const progress = reducedMotion
    ? target
    : state.progress +
      (target - state.progress) * (1 - Math.exp(-TRANSITION_RESPONSE * dt));
  return {
    progress: clampProgress(progress),
    spin: state.spin + dt * planetSpinRate(progress, reducedMotion),
  };
}
