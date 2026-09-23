import type { Entity, Project } from "./protocol";
import { requireCatalogAsset } from "./asset-catalog";
import { entityGeometry } from "./geometry";
import { resolveRuntimeScene } from "./scene-runtime";
import { transformBounds, type LocalBounds } from "./scene-transform";
import type { WorldNavigationBounds } from "./world-navigation";

export type WorldNavigationEntityBounds = ReadonlyMap<
  string,
  WorldNavigationBounds | undefined
>;

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

function movingWorldBounds(
  entity: Entity,
  bounds: WorldNavigationBounds,
): WorldNavigationBounds {
  if (entity.stage !== "ready" || entity.behavior?.type !== "move")
    return bounds;
  const amplitude = entity.behavior.amplitude ?? 0.5;
  const axis = entity.behavior.axis ?? "y";
  const axisIndex = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const min = [...bounds.min] as [number, number, number];
  const max = [...bounds.max] as [number, number, number];
  min[axisIndex] -= amplitude;
  max[axisIndex] += amplitude;
  return { min, max };
}

/**
 * Resolve drawable bounds for every entity stage. Entries with unknown or
 * invalid bounds are kept in the map with `undefined` so visibility callers
 * can conservatively leave those entities drawable.
 */
export function worldNavigationBoundsByEntity(
  project: Project,
): WorldNavigationEntityBounds {
  const boundsByEntity = new Map<string, WorldNavigationBounds | undefined>(
    project.entities.map((entity) => [entity.id, undefined]),
  );
  try {
    const scene = resolveRuntimeScene(project);
    for (const entity of project.entities) {
      const worldMatrix = scene.entities.get(entity.id)?.worldMatrix;
      if (!worldMatrix) continue;
      try {
        const local = localEntityBounds(entity);
        if (!local) continue;
        const world = transformBounds(worldMatrix, local);
        boundsByEntity.set(entity.id, movingWorldBounds(entity, world));
      } catch {
        // Keep unknown geometry conservatively drawable.
      }
    }
  } catch {
    // Invalid graph data leaves every entity conservatively visible.
  }
  return boundsByEntity;
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
        if (local) bounds.push(transformBounds(worldMatrix, local));
      } catch {
        // Ignore invalid geometry for framing; this preserves the prior
        // ready-only frame-content behavior.
      }
    }
    return bounds;
  } catch {
    return [];
  }
}
