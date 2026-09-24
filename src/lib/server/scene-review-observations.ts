import { z } from "zod";
import { MAX_SCENE_POSITION, type Project } from "../protocol";
import { HttpError } from "./auth";

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
// Observed bounds can extend beyond an entity anchor after local geometry and
// parent transforms. Keep a finite evidence envelope well beyond the scene's
// ±1,000,000m authoring range without relaxing the byte/object budgets.
const MAX_OBSERVED_COORDINATE = MAX_SCENE_POSITION * 1_000;
const coordinate = z
  .number()
  .finite()
  .min(-MAX_OBSERVED_COORDINATE)
  .max(MAX_OBSERVED_COORDINATE);
const vector3 = z.tuple([coordinate, coordinate, coordinate]);
const directionCoordinate = z.number().finite().min(-1).max(1);
const direction3 = z.tuple([
  directionCoordinate,
  directionCoordinate,
  directionCoordinate,
]);
const assetIds = z.array(z.string().min(1).max(160)).max(160);

const cameraView = z
  .object({
    position: vector3,
    forward: direction3,
  })
  .strict()
  .superRefine((value, context) => {
    if (Math.abs(Math.hypot(...value.forward) - 1) > 0.01)
      context.addIssue({
        code: "custom",
        message: "Camera forward direction must be normalized.",
      });
  });

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
    cameraView: cameraView.optional(),
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
      value.cameraView === undefined &&
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

/** Validate renderer claims against the exact scene being reviewed. */
export function validateSceneReviewStructuralObservations(
  project: Pick<Project, "id" | "revision" | "entities">,
  observations: SceneReviewStructuralObservations | undefined,
) {
  if (!observations) return;
  if (
    observations.projectId !== project.id ||
    observations.revision !== project.revision
  )
    throw new HttpError(
      400,
      "Structural observations belong to another scene revision.",
    );
  const entityIds = new Set(project.entities.map((entity) => entity.id));
  const assertEntity = (id: string) => {
    if (!entityIds.has(id))
      throw new HttpError(
        400,
        "Structural observations contain an unknown object.",
      );
  };
  for (const item of observations.bounds ?? []) assertEntity(item.entityId);
  for (const item of observations.supports ?? []) {
    assertEntity(item.entityId);
    if (item.supportEntityId) assertEntity(item.supportEntityId);
  }
  for (const item of observations.gameReferences ?? []) {
    assertEntity(item.entityId);
    for (const id of item.referencedBy) assertEntity(id);
  }
  for (const item of observations.workerErrors ?? [])
    if (item.entityId) assertEntity(item.entityId);
}

export function sceneReviewFeedback(
  feedback: string | undefined,
  observations: SceneReviewStructuralObservations | undefined,
): string | undefined {
  const observationText = observations
    ? `STRUCTURAL OBSERVATIONS: ${JSON.stringify(observations)}`
    : undefined;
  const combined = feedback
    ? observationText
      ? `${feedback}\n${observationText}`
      : feedback
    : observationText;
  if (
    combined !== undefined &&
    new TextEncoder().encode(combined).byteLength >
      SCENE_REVIEW_OBSERVATIONS_MAX_BYTES
  )
    throw new HttpError(400, "The scene review feedback is too large.");
  return combined;
}
