import { Matrix4, Vector3 } from "three";

type Point = readonly [number, number, number];
export type SupportBounds = { min: Point; max: Point };
const EPSILON = 1e-9;

function usable(matrix: Matrix4) {
  return (
    matrix.elements.every(Number.isFinite) &&
    matrix.elements[3] === 0 &&
    matrix.elements[7] === 0 &&
    matrix.elements[11] === 0 &&
    matrix.elements[15] === 1 &&
    Number.isFinite(matrix.determinant()) &&
    matrix.determinant() !== 0
  );
}

/** Vertical ray against the transformed box, including rotated/sheared faces.
 * Returns the upper surface, not the top of its world-axis-aligned bounds.
 * Bounds remain a collision proxy, as in the existing platform contract.
 */
export function supportSurfaceHeight(
  matrix: Matrix4,
  bounds: SupportBounds,
  x: number,
  z: number,
): number | undefined {
  if (
    !usable(matrix) ||
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    ![...bounds.min, ...bounds.max].every(Number.isFinite) ||
    bounds.min.some((v, axis) => v > bounds.max[axis])
  )
    return undefined;
  const inverse = matrix.clone().invert();
  const origin = new Vector3(x, 0, z).applyMatrix4(inverse);
  // Transform a direction without normalization: t must remain world height.
  const direction = new Vector3(
    inverse.elements[4],
    inverse.elements[5],
    inverse.elements[6],
  );
  let enter = -Infinity;
  let leave = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const start = origin.getComponent(axis);
    const delta = direction.getComponent(axis);
    if (delta === 0) {
      if (
        start < bounds.min[axis] - EPSILON ||
        start > bounds.max[axis] + EPSILON
      )
        return undefined;
      continue;
    }
    const a = (bounds.min[axis] - start) / delta;
    const b = (bounds.max[axis] - start) / delta;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave + EPSILON) return undefined;
  }
  return Number.isFinite(leave) ? leave : undefined;
}

/** Carry an existing world contact through an exact support pose change. */
export function carrySupportContact(
  previous: Matrix4,
  next: Matrix4,
  contact: Point,
): [number, number, number] | undefined {
  if (!usable(previous) || !usable(next) || !contact.every(Number.isFinite))
    return undefined;
  const result = new Vector3(...contact)
    .applyMatrix4(previous.clone().invert())
    .applyMatrix4(next);
  return result.toArray().every(Number.isFinite) ? result.toArray() : undefined;
}
