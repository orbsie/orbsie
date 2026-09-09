import { z } from "zod";
import {
  gameProgramSchema,
  collectGameProgramEntityIds,
  validateGameProgramReferences,
} from "./game-program";
import { modelingJobSchema } from "./modeling";
import { generatedModelMetadataSchema } from "./generated-models";
import { browserModelRecipeSchema } from "./browser-modeling";
import { browserProceduralSourceSchema } from "./browser-procedural";
import {
  catalogAssetIds,
  isAssetId,
  type AssetRequestPolicy,
} from "./asset-catalog";
import {
  computeKeepWorldLocalTRS,
  MAX_SCENE_GROUPS,
  resolveSceneTransforms,
} from "./scene-transform";
function mutableVector(
  value: readonly [number, number, number],
): [number, number, number] {
  return [value[0], value[1], value[2]];
}
export const vector = z.tuple([
  z.number().finite().min(-100).max(100),
  z.number().finite().min(-100).max(100),
  z.number().finite().min(-100).max(100),
]);
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const partSchema = z.object({
  shape: z.enum(["box", "sphere", "cone", "cylinder", "torus"]),
  position: vector,
  scale: vector,
  rotation: vector.optional(),
  color,
});
const geometryDetail = z.enum(["coarse", "refined"]).default("refined");
const proceduralGeometryKind = z.enum([
  "tree",
  "mushroom",
  "platform",
  "arch",
  "crystal",
  "pond",
  "flower",
  "rock",
  "custom",
]);
export const proceduralGeometrySchema = z.object({
  kind: proceduralGeometryKind,
  parts: z.array(partSchema).max(32).optional(),
  detail: geometryDetail,
  tint: color.optional(),
});
export const assetGeometrySchema = z.object({
  kind: z.literal("asset"),
  assetId: z
    .enum(catalogAssetIds)
    .refine(isAssetId, "Unknown catalog asset ID."),
  detail: geometryDetail,
  tint: color.optional(),
});
const browserAuthoringMetadataSchema = z
  .object({
    source: browserProceduralSourceSchema,
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const browserProceduralModelingJobSchema = z
  .object({
    backend: z.literal("browser-procedural"),
    source: browserProceduralSourceSchema,
  })
  .strict();

const browserModelingInputJobSchema = z
  .object({
    backend: z.literal("browser-manifold"),
    recipe: browserModelRecipeSchema,
  })
  .strict();
export const browserModelingJobSchema = browserModelingInputJobSchema
  .extend({ authoring: browserAuthoringMetadataSchema.optional() })
  .strict();
const generatedModelingJobSchema = z.union([
  modelingJobSchema,
  browserModelingJobSchema,
]);
export type BrowserModelingJob = z.infer<typeof browserModelingJobSchema>;
export type BrowserProceduralModelingJob = z.infer<
  typeof browserProceduralModelingJobSchema
>;
export const generatedGeometrySchema = z
  .object({
    kind: z.literal("generated"),
    collision: z.enum(["none", "platform"]).default("none"),
    job: generatedModelingJobSchema,
    model: generatedModelMetadataSchema.optional(),
    detail: geometryDetail,
    tint: color.optional(),
  })
  .strict()
  .superRefine((geometry, context) => {
    if (!geometry.model) return;
    const expectedSource =
      "backend" in geometry.job ? "browser-manifold" : "local-blender";
    if (geometry.model.source !== expectedSource)
      context.addIssue({
        code: "custom",
        path: ["model", "source"],
        message: `Generated model metadata must use ${expectedSource} for this job.`,
      });
  });
export type GeneratedGeometryRecipe = z.infer<typeof generatedGeometrySchema>;
export const geometrySchema = z.union([
  proceduralGeometrySchema,
  assetGeometrySchema,
  generatedGeometrySchema,
]);
export type AssetGeometryRecipe = z.infer<typeof assetGeometrySchema>;
export type ProceduralGeometryRecipe = z.infer<typeof proceduralGeometrySchema>;
export type GeometryRecipe = z.infer<typeof geometrySchema>;
export const assetRequestPolicySchema = z.enum(["catalog-allowed", "new-only"]);
export const entityAssetPolicy = assetRequestPolicySchema;
export type EntityAssetPolicy = AssetRequestPolicy;
export const behaviorSchema = z.object({
  type: z.enum(["static", "collect", "move", "portal", "bloom", "bounce"]),
  speed: z.number().min(0).max(5).optional(),
  amplitude: z.number().min(0).max(8).optional(),
  axis: z.enum(["x", "y", "z"]).optional(),
});
export const entitySchema = z.object({
  id: z.string().regex(/^[\w-]{1,80}$/),
  label: z.string().max(100),
  position: vector,
  scale: vector.default([1, 1, 1]),
  rotation: vector.optional(),
  parentId: z
    .string()
    .regex(/^[\w-]{1,80}$/)
    .nullable()
    .optional(),
  color: color.default("#6ead60"),
  geometry: geometrySchema.optional(),
  behavior: behaviorSchema.optional(),
  assetPolicy: assetRequestPolicySchema.optional(),
  stage: z.enum(["seed", "coarse", "ready"]).default("seed"),
});
export type Entity = z.infer<typeof entitySchema>;
export const groupSchema = z.object({
  id: z.string().regex(/^[\w-]{1,80}$/),
  label: z.string().max(100),
  position: vector,
  rotation: vector.optional(),
  scale: vector.default([1, 1, 1]).superRefine((scale, context) => {
    if (scale.some((component) => component <= 0))
      context.addIssue({
        code: "custom",
        message: "Group scale must be positive and finite.",
      });
  }),
  parentId: z
    .string()
    .regex(/^[\w-]{1,80}$/)
    .nullable()
    .optional(),
});
export type Group = z.infer<typeof groupSchema>;
export const projectSchema = z
  .object({
    version: z.literal(1),
    id: z.string().max(80),
    title: z.string().max(100),
    seed: z.number().int(),
    revision: z.number().int().min(0),
    entities: z.array(entitySchema).max(160),
    groups: z.array(groupSchema).max(MAX_SCENE_GROUPS).optional(),
    environment: z.object({ sky: color, ground: color, water: color }),
    game: gameProgramSchema.optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          text: z.string().max(5000),
          entityId: z.string().optional(),
        }),
      )
      .max(500),
  })
  .superRefine((project, context) => {
    try {
      resolveSceneTransforms({
        groups: project.groups,
        entities: project.entities,
      });
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["groups"],
        message:
          error instanceof Error ? error.message : "Invalid scene hierarchy.",
      });
      return;
    }
    if (!project.game) return;
    try {
      validateGameProgramReferences(
        project.game,
        project.entities
          .filter((entity) => entity.stage === "ready")
          .map((entity) => entity.id),
      );
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["game"],
        message:
          error instanceof Error ? error.message : "Invalid game references.",
      });
    }
  });
export type Project = z.infer<typeof projectSchema>;
const setGameCommandSchema = z.object({
  type: z.literal("set_game"),
  game: gameProgramSchema.nullable(),
});
const setMaterialCommandSchema = z.object({
  type: z.literal("set_material"),
  id: z.string(),
  color,
  assetPolicy: assetRequestPolicySchema.optional(),
});
const setTransformCommandSchema = z.object({
  type: z.literal("set_transform"),
  id: z.string(),
  position: vector.optional(),
  rotation: vector.optional(),
  scale: vector.optional(),
  assetPolicy: assetRequestPolicySchema.optional(),
});
const createGroupCommandSchema = z.object({
  type: z.literal("create_group"),
  group: groupSchema,
});
const removeGroupCommandSchema = z.object({
  type: z.literal("remove_group"),
  id: z.string(),
});
const setGroupTransformCommandSchema = z.object({
  type: z.literal("set_group_transform"),
  id: z.string(),
  position: vector.optional(),
  rotation: vector.optional(),
  scale: vector.optional(),
});
const setParentCommandSchema = z.object({
  type: z.literal("set_parent"),
  id: z.string(),
  parentId: z
    .string()
    .regex(/^[\w-]{1,80}$/)
    .nullable(),
  keepWorldTransform: z.boolean(),
});
const setBehaviorCommandSchema = z.object({
  type: z.literal("set_behavior"),
  id: z.string(),
  behavior: behaviorSchema,
  assetPolicy: assetRequestPolicySchema.optional(),
});
const removeEntityCommandSchema = z.object({
  type: z.literal("remove_entity"),
  id: z.string(),
});
const setEnvironmentCommandSchema = z.object({
  type: z.literal("set_environment"),
  sky: color.optional(),
  ground: color.optional(),
  water: color.optional(),
});
const commitRevisionCommandSchema = z.object({
  type: z.literal("commit_revision"),
  message: z.string().max(1000),
});
function reserveEntityCommandSchema<T extends z.ZodType>(entity: T) {
  return z.object({ type: z.literal("reserve_entity"), entity });
}
function setGeometryCommandSchema<T extends z.ZodType>(
  geometry: T,
  strict = false,
) {
  const schema = z.object({
    type: z.literal("set_geometry"),
    id: z.string(),
    geometry,
    assetPolicy: assetRequestPolicySchema.optional(),
  });
  return strict ? schema.strict() : schema;
}
export const commandSchema = z.discriminatedUnion("type", [
  setGameCommandSchema,
  reserveEntityCommandSchema(entitySchema),
  setGeometryCommandSchema(geometrySchema),
  setMaterialCommandSchema,
  setTransformCommandSchema,
  createGroupCommandSchema,
  removeGroupCommandSchema,
  setGroupTransformCommandSchema,
  setParentCommandSchema,
  setBehaviorCommandSchema,
  removeEntityCommandSchema,
  setEnvironmentCommandSchema,
  commitRevisionCommandSchema,
]);
export type Command = z.infer<typeof commandSchema>;

const modelEntityBaseSchema = entitySchema
  .omit({ geometry: true, rotation: true, parentId: true })
  .strict();
const modelSetTransformCommandSchema = z
  .object({
    type: z.literal("set_transform"),
    id: z.string(),
    position: vector.optional(),
    scale: vector.optional(),
    assetPolicy: assetRequestPolicySchema.optional(),
  })
  .strict();
function modelGeometrySchema(localModeling: boolean, browserModeling: boolean) {
  const generated =
    localModeling || browserModeling
      ? z
          .object({
            kind: z.literal("generated"),
            collision: z.enum(["none", "platform"]).default("none"),
            job:
              localModeling && browserModeling
                ? z.union([
                    modelingJobSchema,
                    browserProceduralModelingJobSchema,
                    browserModelingInputJobSchema,
                  ])
                : localModeling
                  ? modelingJobSchema
                  : z.union([
                      browserProceduralModelingJobSchema,
                      browserModelingInputJobSchema,
                    ]),
            detail: z.literal("refined"),
            tint: color.optional(),
          })
          .strict()
      : null;
  if (!generated)
    return z.union([proceduralGeometrySchema, assetGeometrySchema]);
  return z.union([proceduralGeometrySchema, assetGeometrySchema, generated]);
}
export function modelCommandSchemaForCapabilities(
  localModeling: boolean,
  browserModeling: boolean,
) {
  const geometry = modelGeometrySchema(localModeling, browserModeling);
  const reserveEntity = reserveEntityCommandSchema(modelEntityBaseSchema);
  const setGeometry = setGeometryCommandSchema(geometry, true);
  return z.discriminatedUnion("type", [
    setGameCommandSchema,
    reserveEntity,
    setGeometry,
    setMaterialCommandSchema,
    modelSetTransformCommandSchema,
    setBehaviorCommandSchema,
    removeEntityCommandSchema,
    setEnvironmentCommandSchema,
    commitRevisionCommandSchema,
  ]);
}
type BrowserProceduralGeneratedGeometry = {
  kind: "generated";
  collision: "none" | "platform";
  job: BrowserProceduralModelingJob;
  detail: "refined";
  tint?: string;
};
type BrowserProceduralSetGeometryCommand = Omit<
  Extract<Command, { type: "set_geometry" }>,
  "geometry"
> & { geometry: BrowserProceduralGeneratedGeometry };
/** The model stream is canonical commands plus one browser-only source command. */
export type ModelCommand = Command | BrowserProceduralSetGeometryCommand;
/** Parse advertised model output while preserving capability-specific errors. */
export function parseModelCommandForProcessing(
  input: unknown,
  localModeling: boolean,
  browserModeling: boolean,
): ModelCommand {
  const advertised = modelCommandSchemaForCapabilities(
    localModeling,
    browserModeling,
  ).safeParse(input);
  if (advertised.success) return advertised.data as ModelCommand;
  // Let the modeling policy produce its stable unavailable/unsupported error
  // for a job sent outside the advertised capability. Trusted model metadata
  // and canonical authoring metadata remain rejected by this fallback.
  const capabilityProbe = modelCommandSchemaForCapabilities(
    true,
    true,
  ).safeParse(input);
  if (
    capabilityProbe.success &&
    capabilityProbe.data.type === "set_geometry" &&
    capabilityProbe.data.geometry.kind === "generated" &&
    !("model" in capabilityProbe.data.geometry)
  )
    return capabilityProbe.data as ModelCommand;
  throw advertised.error;
}
const modelCommandJSONSchemaCache = new Map<string, object>();
export function modelCommandJSONSchemaForCapabilities(
  localModeling: boolean,
  browserModeling: boolean,
) {
  const key = `${localModeling ? 1 : 0}:${browserModeling ? 1 : 0}`;
  const cached = modelCommandJSONSchemaCache.get(key);
  if (cached) return cached;
  const schema = z.toJSONSchema(
    modelCommandSchemaForCapabilities(localModeling, browserModeling),
  );
  modelCommandJSONSchemaCache.set(key, schema);
  return schema;
}
export const envelopeSchema = z.object({
  version: z.literal(1),
  projectId: z.string(),
  runId: z.string(),
  operationId: z.string(),
  sequence: z.number().int().min(1),
  baseRevision: z.number().int().min(0),
  command: commandSchema,
});
export type Envelope = z.infer<typeof envelopeSchema>;
export type Cursor = { runId: string; sequence: number; seen: Set<string> };
export function blankProject(): Project {
  return {
    version: 1,
    id: crypto.randomUUID(),
    title: "An untitled little world",
    seed: 42,
    revision: 0,
    entities: [],
    environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
    messages: [],
  };
}
export function applyOperation(
  project: Project,
  input: unknown,
  cursor: Cursor,
): { project: Project; cursor: Cursor } {
  const op = envelopeSchema.parse(input);
  if (cursor.seen.has(op.operationId)) return { project, cursor };
  if (op.projectId !== project.id || op.runId !== cursor.runId)
    throw Error("This change belongs to another world or an expired run.");
  if (op.sequence !== cursor.sequence + 1)
    throw Error(
      "A scene update arrived out of order. Retry from your saved world.",
    );
  if (op.baseRevision !== project.revision)
    throw Error(
      "Your world has a newer revision. This change was not applied.",
    );
  const c = op.command;
  let entities = project.entities;
  let groups = project.groups;
  let environment = project.environment;
  let messages = project.messages;
  let game = project.game;
  if (c.type === "reserve_entity") {
    if (
      entities.some((e) => e.id === c.entity.id) ||
      groups?.some((group) => group.id === c.entity.id)
    )
      throw Error("Object already exists.");
    if (entities.length >= 160)
      throw Error("This world reached its 160-object limit.");
    if (
      c.entity.assetPolicy === "new-only" &&
      c.entity.geometry?.kind === "asset"
    )
      throw Error("A new-only object cannot use a catalog asset.");
    entities = [...entities, { ...c.entity, stage: "seed" }];
  } else if (c.type === "create_group") {
    if (
      entities.some((e) => e.id === c.group.id) ||
      groups?.some((group) => group.id === c.group.id)
    )
      throw Error("Object already exists.");
    if ((groups?.length ?? 0) >= MAX_SCENE_GROUPS)
      throw Error(`This world reached its ${MAX_SCENE_GROUPS}-group limit.`);
    groups = [...(groups ?? []), c.group];
  } else if (c.type === "remove_group") {
    const existingGroup = groups?.find((group) => group.id === c.id);
    if (!existingGroup) throw Error("That group no longer exists.");
    if (
      groups?.some((group) => group.parentId === c.id) ||
      entities.some((entity) => entity.parentId === c.id)
    )
      throw Error("A group with children cannot be removed.");
    groups = groups!.filter((group) => group.id !== c.id);
  } else if (c.type === "set_environment") {
    environment = {
      sky: c.sky ?? environment.sky,
      ground: c.ground ?? environment.ground,
      water: c.water ?? environment.water,
    };
  } else if (c.type === "set_game") {
    if (c.game)
      validateGameProgramReferences(
        c.game,
        entities
          .filter((entity) => entity.stage === "ready")
          .map((entity) => entity.id),
      );
    game = c.game ?? undefined;
  } else if (c.type === "commit_revision") {
    messages = [...messages, { role: "assistant", text: c.message }];
  } else if (c.type === "set_group_transform") {
    const existingGroup = groups?.find((group) => group.id === c.id);
    if (!existingGroup) throw Error("That group no longer exists.");
    groups = groups!.map((group) =>
      group.id !== c.id
        ? group
        : {
            ...group,
            position: c.position ?? group.position,
            rotation: c.rotation ?? group.rotation,
            scale: c.scale ?? group.scale,
          },
    );
  } else if (c.type === "set_parent") {
    const existingGroup = groups?.find((group) => group.id === c.id);
    const existingEntity = entities.find((entity) => entity.id === c.id);
    if (!existingGroup && !existingEntity)
      throw Error("That scene object no longer exists.");

    const candidateGroups = existingGroup
      ? groups!.map((group) =>
          group.id === c.id ? { ...group, parentId: c.parentId } : group,
        )
      : groups;
    const candidateEntities = existingEntity
      ? entities.map((entity) =>
          entity.id === c.id ? { ...entity, parentId: c.parentId } : entity,
        )
      : entities;
    const currentScene = resolveSceneTransforms({
      groups,
      entities,
    });
    // Validate parent namespace, cycles, and depth before doing any matrix
    // work. The candidate is still private, so every failure is atomic.
    const candidateScene = resolveSceneTransforms({
      groups: candidateGroups,
      entities: candidateEntities,
    });
    let nextGroups = candidateGroups;
    let nextEntities = candidateEntities;
    if (c.keepWorldTransform) {
      const oldWorld = currentScene.get(c.id)!.worldMatrix;
      const parentWorld =
        c.parentId === null
          ? undefined
          : candidateScene.groups.get(c.parentId)!.worldMatrix;
      const local = computeKeepWorldLocalTRS(oldWorld, parentWorld);
      if (existingGroup)
        nextGroups = candidateGroups!.map((group) =>
          group.id !== c.id
            ? group
            : {
                ...group,
                position: mutableVector(local.position),
                rotation: mutableVector(local.rotation),
                scale: mutableVector(local.scale),
                parentId: c.parentId,
              },
        );
      else
        nextEntities = candidateEntities.map((entity) =>
          entity.id !== c.id
            ? entity
            : {
                ...entity,
                position: mutableVector(local.position),
                rotation: mutableVector(local.rotation),
                scale: mutableVector(local.scale),
                parentId: c.parentId,
              },
        );
    }
    groups = nextGroups;
    entities = nextEntities;
  } else {
    const existing = entities.find((e) => e.id === c.id);
    if (!existing) throw Error("That object no longer exists.");
    if (c.type === "remove_entity") {
      entities = entities.filter((e) => e.id !== c.id);
    } else {
      if (
        c.type === "set_geometry" &&
        c.geometry.detail !== "refined" &&
        game &&
        collectGameProgramEntityIds(game).includes(c.id)
      )
        throw Error(
          "Objects used by game rules require refined geometry. Replace the rules before using coarse geometry.",
        );
      if (
        existing.assetPolicy === "new-only" &&
        c.assetPolicy === "catalog-allowed"
      )
        throw Error("An object marked new-only cannot be downgraded.");
      if (
        c.type === "set_geometry" &&
        c.geometry.kind === "asset" &&
        (existing.assetPolicy === "new-only" || c.assetPolicy === "new-only")
      )
        throw Error("A new-only object cannot use a catalog asset.");
      if (
        c.type !== "set_geometry" &&
        c.assetPolicy === "new-only" &&
        existing.geometry?.kind === "asset"
      )
        throw Error(
          "A catalog object must be replaced before it is marked new-only.",
        );
      const nextAssetPolicy =
        existing.assetPolicy === "new-only" || c.assetPolicy === "new-only"
          ? "new-only"
          : (c.assetPolicy ?? existing.assetPolicy);
      entities = entities.map((e) =>
        e.id !== c.id
          ? e
          : c.type === "set_geometry"
            ? {
                ...e,
                geometry: c.geometry,
                assetPolicy: nextAssetPolicy,
                stage: c.geometry.detail === "coarse" ? "coarse" : "ready",
              }
            : c.type === "set_material"
              ? {
                  ...e,
                  color: c.color,
                  assetPolicy: nextAssetPolicy,
                  geometry: e.geometry
                    ? { ...e.geometry, tint: c.color }
                    : undefined,
                }
              : c.type === "set_behavior"
                ? { ...e, behavior: c.behavior, assetPolicy: nextAssetPolicy }
                : {
                    ...e,
                    position: c.position ?? e.position,
                    ...(c.rotation !== undefined
                      ? { rotation: c.rotation }
                      : {}),
                    scale: c.scale ?? e.scale,
                    assetPolicy: nextAssetPolicy,
                  },
      );
    }
  }
  const next: Project = {
    ...project,
    ...(groups === undefined ? {} : { groups }),
    entities,
    environment,
    messages,
    game,
    revision: project.revision + 1,
  };
  projectSchema.parse(next);
  return {
    project: next,
    cursor: {
      runId: cursor.runId,
      sequence: op.sequence,
      seen: new Set([...cursor.seen, op.operationId]),
    },
  };
}

/**
 * Validate a model command stream without executing a browser-only source.
 * Procedural jobs advance the server shadow revision and mark their target
 * ready for subsequent command-reference checks; the browser store executes
 * and normalizes the source before applying the canonical operation.
 */
export function applyModelOperation(
  project: Project,
  input: unknown,
  cursor: Cursor,
): { project: Project; cursor: Cursor } {
  const raw = z
    .object({
      version: z.literal(1),
      projectId: z.string(),
      runId: z.string(),
      operationId: z.string(),
      sequence: z.number().int().min(1),
      baseRevision: z.number().int().min(0),
      command: z.unknown(),
    })
    .parse(input);
  const command = parseModelCommandForProcessing(raw.command, true, true);
  if (cursor.seen.has(raw.operationId)) return { project, cursor };
  if (raw.projectId !== project.id || raw.runId !== cursor.runId)
    throw Error("This change belongs to another world or an expired run.");
  if (raw.sequence !== cursor.sequence + 1)
    throw Error(
      "A scene update arrived out of order. Retry from the saved world.",
    );
  if (raw.baseRevision !== project.revision)
    throw Error(
      "Your world has a newer revision. This change was not applied.",
    );
  if (
    command.type === "set_geometry" &&
    command.geometry.kind === "generated" &&
    "backend" in command.geometry.job &&
    command.geometry.job.backend === "browser-procedural"
  ) {
    const existing = project.entities.find(
      (entity) => entity.id === command.id,
    );
    if (!existing) throw Error("That object no longer exists.");
    if (
      existing.assetPolicy === "new-only" &&
      command.assetPolicy === "catalog-allowed"
    )
      throw Error("A new-only object cannot be downgraded.");
    const nextAssetPolicy =
      existing.assetPolicy === "new-only" || command.assetPolicy === "new-only"
        ? "new-only"
        : (command.assetPolicy ?? existing.assetPolicy);
    const next: Project = {
      ...project,
      entities: project.entities.map((entity) =>
        entity.id === command.id
          ? {
              ...entity,
              // The server shadow must not retain a replaced catalog mesh or
              // pretend that an unresolved source already produced a GLB.
              geometry: undefined,
              assetPolicy: nextAssetPolicy,
              stage: "ready" as const,
            }
          : entity,
      ),
      revision: project.revision + 1,
    };
    projectSchema.parse(next);
    return {
      project: next,
      cursor: {
        runId: cursor.runId,
        sequence: raw.sequence,
        seen: new Set([...cursor.seen, raw.operationId]),
      },
    };
  }
  return applyOperation(
    project,
    { ...raw, command: commandSchema.parse(command) },
    cursor,
  );
}

export function committed(project: Project, baseline?: Project): Project {
  const hierarchyPresent =
    project.groups !== undefined ||
    baseline?.groups !== undefined ||
    project.entities.some(
      (entity) =>
        entity.parentId !== undefined || entity.rotation !== undefined,
    ) ||
    baseline?.entities.some(
      (entity) =>
        entity.parentId !== undefined || entity.rotation !== undefined,
    ) === true;
  const checkpoint: Project = {
    ...project,
    entities: project.entities.flatMap((e) =>
      e.stage === "ready"
        ? [e]
        : (() => {
            const old = baseline?.entities.find(
              (candidate) =>
                candidate.id === e.id && candidate.stage === "ready",
            );
            if (!old) return [];
            if (!hierarchyPresent) return [old];
            // A hierarchy checkpoint keeps the current local transform and
            // parent relationship. Restoring a baseline entity wholesale
            // could point at an ancestor that was removed during the run.
            const restored: Entity = {
              ...old,
              position: e.position,
              scale: e.scale,
            };
            if (e.rotation === undefined) delete restored.rotation;
            else restored.rotation = e.rotation;
            if (e.parentId === undefined) delete restored.parentId;
            else restored.parentId = e.parentId;
            return [restored];
          })(),
    ),
  };
  return projectSchema.parse(checkpoint);
}
