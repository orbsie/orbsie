import { z } from "zod";

const identifier = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[\w-]+$/);
const projectId = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const coordinate = z.number().finite().min(-1000).max(1000);
const vector3 = z.tuple([coordinate, coordinate, coordinate]);
const assetIds = z.array(z.string().min(1).max(160)).max(160);

const bounds = z
  .object({
    entityId: identifier,
    min: vector3,
    max: vector3,
  })
  .strict();

const support = z
  .object({
    entityId: identifier,
    supportEntityId: identifier.nullable(),
    grounded: z.boolean().optional(),
  })
  .strict();

const gameReference = z
  .object({
    entityId: identifier,
    referencedBy: z.array(identifier).max(32),
  })
  .strict();

const workerError = z
  .object({
    entityId: identifier.optional(),
    code: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

/**
 * Renderer facts are evidence supplied to the reviewer, not authority for a
 * scene mutation. Keep the transport closed and small enough to stringify
 * before ledger admission.
 */
export const sceneReviewStructuralObservationsSchema = z
  .object({
    projectId,
    revision,
    renderer: z.enum(["webgl", "software"]).optional(),
    renderedRevision: revision.optional(),
    transitionSettled: z.boolean().optional(),
    readyAssetIds: assetIds.optional(),
    pendingAssetIds: assetIds.optional(),
    failedAssetIds: assetIds.optional(),
    errors: z.array(z.string().trim().min(1).max(500)).max(32).optional(),
    bounds: z.array(bounds).max(160).optional(),
    supports: z.array(support).max(160).optional(),
    gameReferences: z.array(gameReference).max(160).optional(),
    workerErrors: z.array(workerError).max(32).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.renderer === undefined &&
      value.renderedRevision === undefined &&
      value.transitionSettled === undefined &&
      value.readyAssetIds === undefined &&
      value.pendingAssetIds === undefined &&
      value.failedAssetIds === undefined &&
      value.errors === undefined &&
      value.bounds === undefined &&
      value.supports === undefined &&
      value.gameReferences === undefined &&
      value.workerErrors === undefined
    )
      context.addIssue({
        code: "custom",
        message: "Structural observations must contain renderer evidence.",
      });
  });

export type SceneReviewStructuralObservations = z.infer<
  typeof sceneReviewStructuralObservationsSchema
>;

export const SCENE_REVIEW_OBSERVATIONS_MAX_BYTES = 64 * 1024;
