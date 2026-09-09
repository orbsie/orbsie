import { z } from "zod";
import {
  gameProgramSchema,
  collectGameProgramEntityIds,
  validateGameProgramReferences,
} from "./game-program";
import { modelingJobSchema } from "./modeling";
import { generatedModelMetadataSchema } from "./generated-models";
import { browserModelRecipeSchema } from "./browser-modeling";
import {
  catalogAssetIds,
  isAssetId,
  type AssetRequestPolicy,
} from "./asset-catalog";
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
export const browserModelingJobSchema = z
  .object({
    backend: z.literal("browser-manifold"),
    recipe: browserModelRecipeSchema,
  })
  .strict();
const generatedModelingJobSchema = z.union([
  modelingJobSchema,
  browserModelingJobSchema,
]);
export type BrowserModelingJob = z.infer<typeof browserModelingJobSchema>;
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
  color: color.default("#6ead60"),
  geometry: geometrySchema.optional(),
  behavior: behaviorSchema.optional(),
  assetPolicy: assetRequestPolicySchema.optional(),
  stage: z.enum(["seed", "coarse", "ready"]).default("seed"),
});
export type Entity = z.infer<typeof entitySchema>;
export const projectSchema = z
  .object({
    version: z.literal(1),
    id: z.string().max(80),
    title: z.string().max(100),
    seed: z.number().int(),
    revision: z.number().int().min(0),
    entities: z.array(entitySchema).max(160),
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
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_game"), game: gameProgramSchema.nullable() }),
  z.object({ type: z.literal("reserve_entity"), entity: entitySchema }),
  z.object({
    type: z.literal("set_geometry"),
    id: z.string(),
    geometry: geometrySchema,
    assetPolicy: assetRequestPolicySchema.optional(),
  }),
  z.object({
    type: z.literal("set_material"),
    id: z.string(),
    color,
    assetPolicy: assetRequestPolicySchema.optional(),
  }),
  z.object({
    type: z.literal("set_transform"),
    id: z.string(),
    position: vector.optional(),
    scale: vector.optional(),
    assetPolicy: assetRequestPolicySchema.optional(),
  }),
  z.object({
    type: z.literal("set_behavior"),
    id: z.string(),
    behavior: behaviorSchema,
    assetPolicy: assetRequestPolicySchema.optional(),
  }),
  z.object({ type: z.literal("remove_entity"), id: z.string() }),
  z.object({
    type: z.literal("set_environment"),
    sky: color.optional(),
    ground: color.optional(),
    water: color.optional(),
  }),
  z.object({
    type: z.literal("commit_revision"),
    message: z.string().max(1000),
  }),
]);
export type Command = z.infer<typeof commandSchema>;
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
  let environment = project.environment;
  let messages = project.messages;
  let game = project.game;
  if (c.type === "reserve_entity") {
    if (entities.some((e) => e.id === c.entity.id))
      throw Error("Object already exists.");
    if (entities.length >= 160)
      throw Error("This world reached its 160-object limit.");
    if (
      c.entity.assetPolicy === "new-only" &&
      c.entity.geometry?.kind === "asset"
    )
      throw Error("A new-only object cannot use a catalog asset.");
    entities = [...entities, { ...c.entity, stage: "seed" }];
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
                    scale: c.scale ?? e.scale,
                    assetPolicy: nextAssetPolicy,
                  },
      );
    }
  }
  const next: Project = {
    ...project,
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
export function committed(project: Project, baseline?: Project): Project {
  const checkpoint: Project = {
    ...project,
    entities: project.entities.flatMap((e) =>
      e.stage === "ready"
        ? [e]
        : baseline?.entities.find(
              (old) => old.id === e.id && old.stage === "ready",
            )
          ? [baseline.entities.find((old) => old.id === e.id)!]
          : [],
    ),
  };
  return projectSchema.parse(checkpoint);
}
