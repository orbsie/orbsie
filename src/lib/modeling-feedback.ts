import { z } from "zod";
import {
  browserModelRecipeSchema,
  type BrowserModelRecipe,
} from "./browser-modeling";

const MAX_MODELING_ERROR_LENGTH = 320;
const MAX_RECIPE_BYTES = 32 * 1024;

const sceneObjectId = z.string().regex(/^[\w-]{1,80}$/);
const nodeId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** A bounded, provider-safe report for a browser modeling build rejection. */
export const modelingFeedbackSchema = z
  .object({
    version: z.literal(1),
    projectId: sceneObjectId,
    entityId: sceneObjectId,
    backend: z.enum(["browser-manifold", "browser-procedural"]),
    nodeId: nodeId.optional(),
    error: z.string().min(1).max(MAX_MODELING_ERROR_LENGTH),
    recipe: browserModelRecipeSchema.optional(),
  })
  .strict()
  .superRefine((feedback, context) => {
    if (
      feedback.backend === "browser-manifold" ||
      feedback.recipe === undefined
    )
      return;
    context.addIssue({
      code: "custom",
      path: ["recipe"],
      message: "Only browser-manifold failures may include a rejected recipe.",
    });
    return;
  })
  .superRefine((feedback, context) => {
    if (feedback.recipe === undefined) return;
    const bytes = new TextEncoder().encode(
      JSON.stringify(feedback.recipe),
    ).byteLength;
    if (bytes > MAX_RECIPE_BYTES)
      context.addIssue({
        code: "custom",
        path: ["recipe"],
        message: "The rejected browser recipe exceeds the feedback size limit.",
      });
  });

export type ModelingFeedback = z.infer<typeof modelingFeedbackSchema>;

function boundedError(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Browser modeling failed.";
  return message.slice(0, MAX_MODELING_ERROR_LENGTH);
}

function boundedRecipe(recipe: BrowserModelRecipe | undefined) {
  if (!recipe) return undefined;
  try {
    const serialized = JSON.stringify(recipe);
    if (new TextEncoder().encode(serialized).byteLength > MAX_RECIPE_BYTES)
      return undefined;
    return recipe;
  } catch {
    return undefined;
  }
}

/** Convert a local builder error into the bounded transport shape. */
export function modelingFeedbackForFailure(input: {
  projectId: string;
  entityId: string;
  backend: ModelingFeedback["backend"];
  recipe?: BrowserModelRecipe;
  error: unknown;
}): ModelingFeedback {
  const message = boundedError(input.error);
  const match = /\bnode ([A-Za-z0-9_-]{1,64})\b/.exec(message);
  return modelingFeedbackSchema.parse({
    version: 1,
    projectId: input.projectId,
    entityId: input.entityId,
    backend: input.backend,
    ...(match ? { nodeId: match[1] } : {}),
    error: message,
    ...(input.backend === "browser-manifold"
      ? { recipe: boundedRecipe(input.recipe) }
      : {}),
  });
}

export const modelingFeedbackLimits = Object.freeze({
  maxErrorLength: MAX_MODELING_ERROR_LENGTH,
  maxRecipeBytes: MAX_RECIPE_BYTES,
});
