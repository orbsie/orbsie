import { type AssetRequestPolicy, isAssetId } from "./asset-catalog";
import type { Command, Entity, Project } from "./protocol";

export type AssetPolicyScope = "selected" | "project";

export interface AssetPolicyContext {
  /** The policy applied to catalog references in this request. */
  readonly requestAssetPolicy: AssetRequestPolicy;
  /** A selected edit is scoped to one stable entity; a creation request is project-wide. */
  readonly scope: AssetPolicyScope;
  readonly selectedEntityId?: string;
  /** True only when the current prompt explicitly requests original/new geometry. */
  readonly explicitNewRequest: boolean;
  readonly prompt: string;
  readonly reason: "prompt" | "entity-policy" | "default";
}

export type AssetPolicyViolationCode =
  | "catalog-asset-forbidden"
  | "policy-downgrade"
  | "scope-violation"
  | "remove-recreate";

export class AssetPolicyError extends Error {
  readonly code: AssetPolicyViolationCode;

  constructor(code: AssetPolicyViolationCode, message: string) {
    super(message);
    this.name = "AssetPolicyError";
    this.code = code;
  }
}

// Replacement progress is deliberately kept out of the serializable request
// context sent to providers. The server/companion owns the context object for
// one command stream, so a WeakMap records that a validated set_geometry was
// actually observed before commit.
const policyState = new WeakMap<
  AssetPolicyContext,
  { replacementApplied: boolean }
>();

function stateFor(context: AssetPolicyContext) {
  let state = policyState.get(context);
  if (!state) {
    state = { replacementApplied: false };
    policyState.set(context, state);
  }
  return state;
}

const explicitNewPatterns = [
  /\bfrom\s+scratch\b/i,
  /\bbrand[- ]new\b/i,
  /\b(?:original|new)\s+(?:model|models|mesh|meshes|geometry|asset|assets|object|objects|shape|form|tree|mushroom|platform|arch|crystal|pond|flower|rock|world|scene)\b/i,
  /\bnew(?:ly)?\s+(?:model|models|mesh|meshes|geometry|asset|assets|object|objects)\b/i,
  /\bgenerate\s+(?:a|an|the)?\s*new\b/i,
  /\b(?:without|don't|do not|never|avoid)\s+(?:using\s+)?(?:the\s+)?(?:catalog|library|prepared|stock|existing)\b/i,
];

const preservedOrForbiddenNewPatterns = [
  /\b(?:keep|preserve|retain|leave)\b[^.!?;\n]{0,50}\b(?:original|existing)\s+(?:model|models|mesh|meshes|geometry|asset|assets|object|objects|shape|form)\b/i,
  /\b(?:don't|do not|never|avoid)\b[^.!?;\n]{0,50}\b(?:generate|create|build|make|use|reuse|select|choose)\w*\b[^.!?;\n]{0,35}\b(?:brand[- ]new|new|original)\s+(?:model|models|mesh|meshes|geometry|asset|assets|object|objects|shape|form)\b/i,
  /\bwithout\s+(?:generat(?:e|ing)|creat(?:e|ing)|build(?:ing)?|mak(?:e|ing))\b[^.!?;\n]{0,35}\b(?:brand[- ]new|new|original)\s+(?:model|models|mesh|meshes|geometry|asset|assets|object|objects|shape|form)\b/i,
];

function explicitlyRequestsNew(prompt: string): boolean {
  // Evaluate short clauses independently so a preservation clause does not
  // hide a later positive request such as “keep the original geometry, but
  // build an original model.”
  return prompt.split(/[.!?;\n]|\b(?:but|however|then)\b/i).some((clause) => {
    if (preservedOrForbiddenNewPatterns.some((pattern) => pattern.test(clause)))
      return false;
    return explicitNewPatterns.some((pattern) => pattern.test(clause));
  });
}

function selectedEntity(
  project: Pick<Project, "entities"> | undefined,
  selectedEntityId: string | undefined,
): Entity | undefined {
  if (!selectedEntityId) return undefined;
  return project?.entities.find((entity) => entity.id === selectedEntityId);
}

/**
 * Derive a conservative request policy before any provider output is parsed.
 * Explicit original/new language applies to the selected object when one is
 * selected; without a selection it applies to the whole creation request.
 * A persisted entity policy is sticky even when the next prompt is ordinary.
 */
export function deriveAssetPolicy(
  prompt: string,
  selectedEntityId?: string,
  project?: Pick<Project, "entities">,
): AssetPolicyContext {
  const entity = selectedEntity(project, selectedEntityId);
  const selected = entity ? entity.id : undefined;
  const explicitNewRequest = explicitlyRequestsNew(prompt);
  if (explicitNewRequest) {
    const context: AssetPolicyContext = {
      requestAssetPolicy: "new-only",
      scope: selected ? "selected" : "project",
      selectedEntityId: selected,
      explicitNewRequest: true,
      prompt,
      reason: "prompt",
    };
    stateFor(context);
    return context;
  }
  if (entity?.assetPolicy === "new-only") {
    const context: AssetPolicyContext = {
      requestAssetPolicy: "new-only",
      scope: "selected",
      selectedEntityId: entity.id,
      explicitNewRequest: false,
      prompt,
      reason: "entity-policy",
    };
    stateFor(context);
    return context;
  }
  const context: AssetPolicyContext = {
    requestAssetPolicy: "catalog-allowed",
    scope: selected ? "selected" : "project",
    selectedEntityId: selected,
    explicitNewRequest: false,
    prompt,
    reason: "default",
  };
  stateFor(context);
  return context;
}

function targetEntity(project: Pick<Project, "entities">, id: string) {
  return project.entities.find((entity) => entity.id === id);
}

function targetIsNewOnly(
  context: AssetPolicyContext,
  id: string,
  entity: Entity | undefined,
): boolean {
  if (entity?.assetPolicy === "new-only") return true;
  return (
    context.requestAssetPolicy === "new-only" &&
    (context.scope === "project" || context.selectedEntityId === id)
  );
}

function requestedPolicy(command: Command): AssetRequestPolicy | undefined {
  if (command.type === "set_geometry" || command.type === "set_material")
    return command.assetPolicy;
  if (command.type === "set_transform" || command.type === "set_behavior")
    return command.assetPolicy;
  return undefined;
}

function withPolicy(command: Command, policy: AssetRequestPolicy): Command {
  if (command.type === "set_geometry")
    return { ...command, assetPolicy: policy };
  if (command.type === "reserve_entity")
    return {
      ...command,
      entity: { ...command.entity, assetPolicy: policy },
    };
  return command;
}

function requireReplacementForCommit(
  project: Pick<Project, "entities">,
  context: AssetPolicyContext,
): void {
  if (
    !context.explicitNewRequest ||
    context.requestAssetPolicy !== "new-only" ||
    context.scope !== "selected" ||
    !context.selectedEntityId
  )
    return;
  const entity = targetEntity(project, context.selectedEntityId);
  const state = policyState.get(context);
  if (
    !entity ||
    entity.assetPolicy !== "new-only" ||
    entity.stage !== "ready" ||
    !entity.geometry ||
    !state?.replacementApplied
  )
    throw new AssetPolicyError(
      "catalog-asset-forbidden",
      `Object ${context.selectedEntityId} needs a completed original geometry before commit.`,
    );
  if (entity.geometry.kind === "asset")
    rejectCatalogAsset(context.selectedEntityId);
}

function rejectCatalogAsset(id: string): never {
  throw new AssetPolicyError(
    "catalog-asset-forbidden",
    `Object ${id} is scoped to original geometry and cannot use a catalog asset.`,
  );
}

/**
 * Validate and annotate one complete command before applyOperation.  The
 * returned command can be sent to both the hosted relay and local companion;
 * neither side needs to trust the model's asset-policy field.
 */
export function enforceAssetPolicy(
  project: Pick<Project, "entities">,
  command: Command,
  context: AssetPolicyContext,
): Command {
  if (command.type === "reserve_entity") {
    if (
      context.requestAssetPolicy === "new-only" &&
      context.scope === "selected"
    )
      throw new AssetPolicyError(
        "scope-violation",
        "Original-geometry edits cannot reserve a replacement or substitute object.",
      );
    const entityPolicy = command.entity.assetPolicy;
    const targetNewOnly =
      entityPolicy === "new-only" ||
      (context.requestAssetPolicy === "new-only" &&
        context.scope === "project");
    if (targetNewOnly && command.entity.geometry?.kind === "asset")
      rejectCatalogAsset(command.entity.id);
    if (targetNewOnly) return withPolicy(command, "new-only");
    return command;
  }

  if (command.type === "commit_revision") {
    requireReplacementForCommit(project, context);
    return command;
  }
  if (command.type === "set_environment" || command.type === "set_game")
    return command;

  const entity = targetEntity(project, command.id);
  const targetNewOnly = targetIsNewOnly(context, command.id, entity);
  const suppliedPolicy = requestedPolicy(command);
  if (targetNewOnly && suppliedPolicy === "catalog-allowed")
    throw new AssetPolicyError(
      "policy-downgrade",
      `Object ${command.id} is marked new-only and cannot be downgraded.`,
    );

  if (command.type === "remove_entity") {
    if (
      (entity?.assetPolicy === "new-only" && context.explicitNewRequest) ||
      (context.requestAssetPolicy === "new-only" &&
        context.scope === "selected" &&
        context.explicitNewRequest)
    )
      throw new AssetPolicyError(
        "remove-recreate",
        `Object ${command.id} cannot be removed during an original-geometry request.`,
      );
    return command;
  }

  if (
    context.requestAssetPolicy === "new-only" &&
    entity &&
    context.scope === "selected" &&
    command.id !== context.selectedEntityId
  )
    throw new AssetPolicyError(
      "scope-violation",
      `Original-geometry edits are scoped to ${context.selectedEntityId ?? "the selected object"}.`,
    );

  if (
    command.type === "set_geometry" &&
    command.geometry.kind === "asset" &&
    targetNewOnly
  )
    rejectCatalogAsset(command.id);

  if (targetNewOnly) {
    if (
      command.type === "set_geometry" &&
      context.explicitNewRequest &&
      context.scope === "selected" &&
      command.id === context.selectedEntityId &&
      command.geometry.kind !== "asset"
    )
      stateFor(context).replacementApplied = true;
    return withPolicy(command, "new-only");
  }
  return command;
}

/** Explicit name for callers that treat policy enforcement as command application. */
export const applyAssetPolicy = enforceAssetPolicy;

export function isCatalogAssetReference(value: unknown): value is string {
  return typeof value === "string" && isAssetId(value);
}
