import type { Entity } from "./protocol";
import { gameplayEntityForVisualState } from "./gameplay";

export type DisplayedGameplayRecipe = Pick<Entity, "geometry" | "stage"> & {
  recipeIdentity: string;
};
export type DisplayedGameplayRecipeRegistry = Map<
  string,
  DisplayedGameplayRecipe
>;
export type DisplayedGameplayRecipeScope = {
  projectId: string;
  registry: DisplayedGameplayRecipeRegistry;
};

/** Starts a fresh per-project registry before children can commit resources. */
export function displayedGameplayRecipeScopeForProject(
  scope: DisplayedGameplayRecipeScope,
  projectId: string,
): DisplayedGameplayRecipeScope {
  return scope.projectId === projectId
    ? scope
    : { projectId, registry: new Map() };
}

/** Records only recipes whose Formation resource has committed to the scene. */
export function recordDisplayedGameplayRecipe(
  registry: DisplayedGameplayRecipeRegistry,
  entity: Pick<Entity, "id" | "geometry" | "stage">,
  recipeIdentity: string,
): void {
  const current = registry.get(entity.id);
  if (
    current?.recipeIdentity === recipeIdentity &&
    current.stage === entity.stage &&
    current.geometry === entity.geometry
  )
    return;
  registry.set(entity.id, {
    geometry: entity.geometry,
    stage: entity.stage,
    recipeIdentity,
  });
}

/** Resolves a per-entity displayed recipe without sharing readiness by asset ID. */
export function gameplayEntityFromDisplayedRecipe(
  entity: Entity,
  registry: ReadonlyMap<string, DisplayedGameplayRecipe>,
  currentRecipeIdentity: string,
): Entity {
  const displayed = registry.get(entity.id);
  const displayedRecipeIsCurrent =
    displayed?.recipeIdentity === currentRecipeIdentity &&
    displayed.stage === entity.stage;
  return gameplayEntityForVisualState(
    entity,
    displayedRecipeIsCurrent,
    displayed,
  );
}

/** True only when the committed visual is the current ready objective recipe. */
export function displayedGameplayRecipeMatchesCurrent(
  displayed: DisplayedGameplayRecipe | undefined,
  currentRecipeIdentity: string | undefined,
  currentStage: Entity["stage"] | undefined,
): boolean {
  return (
    currentStage === "ready" &&
    displayed?.stage === "ready" &&
    displayed.recipeIdentity === currentRecipeIdentity
  );
}
