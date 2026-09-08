import { z } from "zod";
import { envelopeSchema, projectSchema } from "./protocol";

export const generationRunStateSchema = z.enum([
  "running",
  "complete",
  "cancelled",
  "interrupted",
]);
export const generationRunSchema = z.object({
  id: z.string().min(1).max(80),
  projectId: z.string().min(1).max(80),
  sequence: z.number().int().min(0).max(256),
  state: generationRunStateSchema,
  checkpoint: projectSchema,
  prompt: z.string().min(1).max(4000),
  selected: z.string().max(80).optional(),
  baseRevision: z.number().int().nonnegative(),
  cloudBaselineCurrent: z.boolean(),
});
export type GenerationRun = z.infer<typeof generationRunSchema>;

/** Restore the original edit scope without exceeding the provider prompt limit. */
export function recoveredGenerationInput(run: GenerationRun) {
  const continuation = `Continue this request from the recovered world. Preserve completed objects and finish only what remains: ${run.prompt}`;
  return {
    prompt:
      run.state === "complete"
        ? ""
        : continuation.length <= 4000
          ? continuation
          : run.prompt,
    selected: run.checkpoint.entities.some(
      (entity) => entity.id === run.selected,
    )
      ? run.selected
      : undefined,
  };
}
export const journalEnvelopeSchema = envelopeSchema.extend({
  projectId: z.string().min(1).max(80),
  runId: z.string().min(1).max(80),
  operationId: z.string().min(1).max(80),
  sequence: z.number().int().min(1).max(256),
});
