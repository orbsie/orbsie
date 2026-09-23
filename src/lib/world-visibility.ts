import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3 } from "three";
import type { Entity } from "./protocol";
import type { WorldNavigationBounds } from "./world-navigation";
import type { WorldNavigationEntityBounds } from "./world-navigation-bounds";

/** Small world-space allowance for particle/formation extent and edge jitter. */
export const WORLD_VISIBILITY_FORMATION_MARGIN = 2;

function validWorldBounds(
  value: WorldNavigationBounds | undefined,
): value is WorldNavigationBounds {
  return (
    !!value &&
    Array.isArray(value.min) &&
    Array.isArray(value.max) &&
    value.min.length === 3 &&
    value.max.length === 3 &&
    value.min.every(Number.isFinite) &&
    value.max.every(Number.isFinite) &&
    value.min.every((minimum, axis) => minimum <= value.max[axis])
  );
}

function validCamera(camera: PerspectiveCamera): boolean {
  return (
    Number.isFinite(camera.fov) &&
    camera.fov > 0 &&
    camera.fov < 180 &&
    Number.isFinite(camera.aspect) &&
    camera.aspect > 0 &&
    Number.isFinite(camera.zoom) &&
    camera.zoom > 0 &&
    Number.isFinite(camera.near) &&
    camera.near > 0 &&
    Number.isFinite(camera.far) &&
    camera.far > camera.near
  );
}

/**
 * Select entity IDs whose world AABBs intersect a perspective camera frustum.
 * Unknown and invalid bounds are retained conservatively. Camera matrices are
 * refreshed from its current pose before constructing the shared CPU frustum.
 */
export function selectVisibleWorldEntityIds(
  entities: readonly Pick<Entity, "id">[],
  boundsByEntity: WorldNavigationEntityBounds,
  camera: PerspectiveCamera,
): ReadonlySet<string> {
  const allIds = () => new Set(entities.map((entity) => entity.id));
  try {
    if (!validCamera(camera)) return allIds();
    camera.updateProjectionMatrix();
    camera.updateWorldMatrix(true, false);
    const viewProjection = new Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    if (!viewProjection.elements.every(Number.isFinite)) return allIds();
    const frustum = new Frustum().setFromProjectionMatrix(viewProjection);
    if (
      frustum.planes.some(
        (plane) =>
          !Number.isFinite(plane.constant) ||
          !plane.normal.toArray().every(Number.isFinite),
      )
    )
      return allIds();

    const visible = new Set<string>();
    for (const entity of entities) {
      const bounds = boundsByEntity.get(entity.id);
      if (!validWorldBounds(bounds)) {
        visible.add(entity.id);
        continue;
      }
      const box = new Box3(
        new Vector3(...bounds.min),
        new Vector3(...bounds.max),
      ).expandByScalar(WORLD_VISIBILITY_FORMATION_MARGIN);
      if (frustum.intersectsBox(box)) visible.add(entity.id);
    }
    return visible;
  } catch {
    // Frustum failures must not make authored entities disappear.
    return allIds();
  }
}
