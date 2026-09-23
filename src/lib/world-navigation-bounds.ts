import type { Entity, Project } from "./protocol";
import { requireCatalogAsset } from "./asset-catalog";
import { entityGeometry } from "./geometry";
import { resolveRuntimeScene } from "./scene-runtime";
import { transformBounds, type LocalBounds } from "./scene-transform";
import type { WorldNavigationBounds } from "./world-navigation";

function normalizedBounds(
  min: readonly number[],
  max: readonly number[],
): LocalBounds | undefined {
  if (
    min.length !== 3 ||
    max.length !== 3 ||
    !min.every(Number.isFinite) ||
    !max.every(Number.isFinite) ||
    min.some((value, axis) => value > max[axis])
  )
    return undefined;
  return {
    min: [min[0], min[1], min[2]],
    max: [max[0], max[1], max[2]],
  };
}

function localEntityBounds(entity: Entity): LocalBounds | undefined {
  if (entity.geometry?.kind === "asset") {
    const asset = requireCatalogAsset(entity.geometry.assetId);
    return normalizedBounds(asset.bounds.min, asset.bounds.max);
  }
  if (entity.geometry?.kind === "generated" && entity.geometry.model) {
    return normalizedBounds(
      entity.geometry.model.bounds.min,
      entity.geometry.model.bounds.max,
    );
  }

  // This is also the geometry used for procedural objects and for an asset
  // placeholder while its model is unavailable.
  const geometry = entityGeometry(
    entity.geometry?.kind === "generated"
      ? { ...entity, geometry: undefined }
      : entity,
  );
  try {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return undefined;
    return normalizedBounds(box.min.toArray(), box.max.toArray());
  } finally {
    geometry.dispose();
  }
}

/** Resolve committed ready-entity bounds through their complete group transforms. */
export function committedWorldNavigationBounds(
  project: Project,
): WorldNavigationBounds[] {
  try {
    const scene = resolveRuntimeScene(project);
    const bounds: WorldNavigationBounds[] = [];
    for (const entity of project.entities) {
      if (entity.stage !== "ready") continue;
      const worldMatrix = scene.entities.get(entity.id)?.worldMatrix;
      if (!worldMatrix) continue;
      try {
        const local = localEntityBounds(entity);
        if (!local) continue;
        bounds.push(transformBounds(worldMatrix, local));
      } catch {
        // Ignore corrupt metadata or an unusable entity. The navigation
        // command will return to the default view if none remain.
      }
    }
    return bounds;
  } catch {
    return [];
  }
}
