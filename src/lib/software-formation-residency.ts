import type { Entity } from "./protocol";
import {
  selectFormationResidencyPresentation,
  type FormationResidencyPresentation,
} from "./formation-residency-presentation";
import { formationRecipeIdentity } from "./formation-completion";
import type { FormationProxyVisualBounds } from "./formation-residency-presentation";
import type { WorldNavigationVec3 } from "./world-navigation";

export type SoftwareFormationResidencyOptions = Readonly<{
  entities: readonly Entity[];
  completedRecipeByEntity: ReadonlyMap<string, string>;
  proxyBoundsByEntity: ReadonlyMap<
    string,
    FormationProxyVisualBounds | undefined
  >;
  focus: WorldNavigationVec3;
  visibleIds?: ReadonlySet<string>;
  selectedId?: string;
  previousResidentIds?: ReadonlySet<string>;
  enabled?: boolean;
}>;

/** Keep only completed current recipes eligible for the software proxy path. */
export function selectSoftwareFormationResidency(
  options: SoftwareFormationResidencyOptions,
): FormationResidencyPresentation {
  return selectFormationResidencyPresentation({
    candidates: options.entities.map((entity) => ({
      id: entity.id,
      stage: entity.stage,
      recipeIdentity: formationRecipeIdentity(entity),
      completedRecipeIdentity: options.completedRecipeByEntity.get(entity.id),
      worldCenter: options.proxyBoundsByEntity.get(entity.id)?.center,
    })),
    focus: options.focus,
    visibleIds: options.visibleIds,
    selectedId: options.selectedId,
    previousResidentIds: options.previousResidentIds,
    enabled: options.enabled,
  });
}

export type SoftwareDisplayedGeometry = Readonly<{
  ready: boolean;
  sourceRecipe: Entity["geometry"];
  sourceStage: Entity["stage"];
  sourceColor?: string;
}>;

export function softwareActiveProxyIds(
  options: Readonly<{
    entities: readonly Entity[];
    presentation: Pick<
      FormationResidencyPresentation,
      "proxyIds" | "residentIds"
    >;
    completedRecipeByEntity: ReadonlyMap<string, string>;
    displayedByEntity: ReadonlyMap<
      string,
      SoftwareDisplayedGeometry | undefined
    >;
  }>,
): ReadonlySet<string> {
  const proxyIds = new Set(options.presentation.proxyIds);
  for (const entity of options.entities) {
    if (
      options.presentation.residentIds.has(entity.id) &&
      options.completedRecipeByEntity.get(entity.id) ===
        formationRecipeIdentity(entity) &&
      !softwareGeometryMatchesEntity(
        entity,
        options.displayedByEntity.get(entity.id),
      )
    )
      proxyIds.add(entity.id);
  }
  return proxyIds;
}

export type SoftwareProxyDrawRecord = Readonly<{
  projectId: string;
  revision: number;
  recipeIdentity: string;
}>;

export type SoftwareFormationCompletionRecord = {
  recipeIdentity: string;
  loadedRevision: number;
  fullDrawnRevision?: number;
};

export function softwareProxyDrawnForRevision(
  entity: Entity,
  projectId: string,
  revision: number,
  record: SoftwareProxyDrawRecord | undefined,
): boolean {
  return Boolean(
    record !== undefined &&
    record.projectId === projectId &&
    record.revision === revision &&
    record.recipeIdentity === formationRecipeIdentity(entity),
  );
}

export function softwareGeometryMatchesEntity(
  entity: Entity,
  entry: SoftwareDisplayedGeometry | undefined,
): boolean {
  return Boolean(
    entry?.ready &&
    entry.sourceRecipe === entity.geometry &&
    entry.sourceStage === entity.stage &&
    (entry.sourceColor === undefined || entry.sourceColor === entity.color),
  );
}

/** A proxy is review-ready only when its recorded completed recipe still matches. */
export function softwareEntityVisualReviewReady(
  entity: Entity,
  entry: SoftwareDisplayedGeometry | undefined,
  completion: SoftwareFormationCompletionRecord | undefined,
  currentRevision: number,
  visibleInViewport = true,
  proxyRepresentation = false,
  proxyVisible = false,
  proxyDrawnForRevision = false,
): boolean {
  const currentRecipeIdentity = formationRecipeIdentity(entity);
  const completedCurrentRecipe =
    completion?.recipeIdentity === currentRecipeIdentity;
  if (!completedCurrentRecipe) return false;
  if (softwareGeometryMatchesEntity(entity, entry))
    return (
      !visibleInViewport || completion.fullDrawnRevision === currentRevision
    );
  return (
    proxyRepresentation &&
    entity.stage === "ready" &&
    (!proxyVisible || proxyDrawnForRevision)
  );
}

/** Release only the geometry owned by this lease; stale cleanup cannot evict a newer entry. */
export function releaseOwnedSoftwareGeometry<
  TGeometry,
  TEntry extends Readonly<{ geometry: TGeometry }>,
>(
  entries: Map<string, TEntry>,
  entityId: string,
  ownedGeometry: TGeometry | undefined,
  dispose: (geometry: TGeometry) => void,
): boolean {
  if (ownedGeometry === undefined) return false;
  const current = entries.get(entityId);
  if (current?.geometry === ownedGeometry) {
    entries.delete(entityId);
    dispose(ownedGeometry);
    return true;
  }
  dispose(ownedGeometry);
  return false;
}
