import type { Entity } from "./protocol";

export type FormationCompletionRecords = Map<string, Map<string, string>>;

function canonicalRecipeValue(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalRecipeValue).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalRecipeValue(record[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/** Stable across project revisions and object key order; covers rendered inputs. */
export function formationRecipeIdentity(
  entity: Pick<Entity, "geometry" | "color">,
): string {
  return canonicalRecipeValue([entity.geometry ?? null, entity.color]);
}

export function formationResourceMatchesRecipe(
  resourceRecipeIdentity: string | undefined,
  recipeIdentity: string,
): boolean {
  return resourceRecipeIdentity === recipeIdentity;
}

export function formationCanHydrateComplete(
  records: ReadonlyMap<string, ReadonlyMap<string, string>>,
  projectId: string,
  entityId: string,
  recipeIdentity: string,
  resourceRecipeIdentity: string | undefined,
  stage: Entity["stage"],
  pending: boolean,
  failed: boolean,
): boolean {
  return (
    stage === "ready" &&
    formationResourceMatchesRecipe(resourceRecipeIdentity, recipeIdentity) &&
    !pending &&
    !failed &&
    records.get(projectId)?.get(entityId) === recipeIdentity
  );
}

export function markFormationComplete(
  records: FormationCompletionRecords,
  projectId: string,
  entityId: string,
  recipeIdentity: string,
  resourceRecipeIdentity: string | undefined,
  stage: Entity["stage"],
  pending: boolean,
  failed: boolean,
  progress: number,
): boolean {
  if (
    stage !== "ready" ||
    !formationResourceMatchesRecipe(resourceRecipeIdentity, recipeIdentity) ||
    pending ||
    failed ||
    !Number.isFinite(progress) ||
    progress < 1
  )
    return false;
  let projectRecords = records.get(projectId);
  if (!projectRecords) {
    projectRecords = new Map();
    records.set(projectId, projectRecords);
  }
  if (projectRecords.get(entityId) === recipeIdentity) return true;
  projectRecords.set(entityId, recipeIdentity);
  return true;
}

export function reconcileFormationCompletionRecords(
  records: FormationCompletionRecords,
  projectId: string,
  recipeByEntity: ReadonlyMap<string, string>,
): void {
  for (const id of records.keys()) if (id !== projectId) records.delete(id);
  let projectRecords = records.get(projectId);
  if (!projectRecords) {
    projectRecords = new Map();
    records.set(projectId, projectRecords);
  }
  for (const [entityId, recipeIdentity] of projectRecords)
    if (recipeByEntity.get(entityId) !== recipeIdentity)
      projectRecords.delete(entityId);
}
