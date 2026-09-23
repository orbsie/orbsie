import { z } from "zod";
import { SCENE_BINDING_VERSION, type SceneBinding } from "../scene-binding";
import {
  modelCommandSchemaForCapabilities,
  projectSchema,
  type ModelCommand,
  type Project,
} from "../protocol";
import {
  sceneReviewResultSchema,
  type SceneReviewPhase,
  type SceneReviewResult,
} from "../scene-review";
import {
  MAX_REVIEW_IMAGE_BYTES,
  validateSceneReviewImage,
  type SceneReviewImage,
} from "../review-image";

export const PRIVATE_SCENE_REVIEW_VERSION = 1 as const;
export const PRIVATE_SCENE_REVIEW_HEADER = "x-orbsie-scene-review";
export const PRIVATE_SCENE_REVIEW_REQUEST_MAX_BYTES = 512 * 1024;
export const PRIVATE_SCENE_REVIEW_RESPONSE_MAX_BYTES = 256 * 1024;

const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const operationId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const boundedText = (maxBytes: number) =>
  z.string().superRefine((value, context) => {
    if (new TextEncoder().encode(value).byteLength > maxBytes)
      context.addIssue({ code: "custom", message: "Text exceeds its limit." });
  });

const privateSceneReviewRequestSchema = z
  .object({
    operationId,
    epoch: safeInteger.min(1),
    model: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9._:/-]+$/),
    effort: z.string().min(1).max(32),
    project: projectSchema,
    prompt: boundedText(16 * 1024).refine(
      (value) => value.trim().length > 0,
      "Prompt is required.",
    ),
    selected: z
      .string()
      .regex(/^[\w-]{1,80}$/)
      .optional(),
    browserModeling: z.boolean(),
    phase: z.enum(["review", "final-review"]),
    reviewImage: z.unknown().optional(),
    feedback: boundedText(64 * 1024).optional(),
  })
  .strict();

const privateBindingSchema = z
  .object({
    version: z.literal(SCENE_BINDING_VERSION),
    projectId: z.string().min(1).max(80),
    revision: safeInteger,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type PrivateSceneReviewRequest = {
  operationId: string;
  epoch: number;
  model: string;
  effort: string;
  project: Project;
  prompt: string;
  selected?: string;
  browserModeling: boolean;
  phase: SceneReviewPhase;
  reviewImage?: SceneReviewImage;
  feedback?: string;
};

export type PrivateSceneReviewBinding = Pick<
  SceneBinding,
  "version" | "projectId" | "revision" | "digest"
>;

export type PrivateSceneReviewResult = {
  type: "orbsie.private.scene-review";
  version: typeof PRIVATE_SCENE_REVIEW_VERSION;
  operationId: string;
  epoch: number;
  review: SceneReviewResult;
  corrections: readonly ModelCommand[];
  binding: PrivateSceneReviewBinding;
};

function invalidRequest(): Error {
  return Error("Invalid private scene review request.");
}

function invalidResult(): Error {
  return Error("Invalid private scene review result.");
}

function jsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function reviewRequestValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 3 ||
    !Object.hasOwn(record, "operationId") ||
    !Object.hasOwn(record, "epoch") ||
    !Object.hasOwn(record, "input") ||
    !record.input ||
    typeof record.input !== "object" ||
    Array.isArray(record.input)
  )
    return value;
  const input = record.input as Record<string, unknown>;
  if (Object.hasOwn(input, "operationId") || Object.hasOwn(input, "epoch"))
    return value;
  return {
    ...input,
    operationId: record.operationId,
    epoch: record.epoch,
  };
}

/** Validate and normalize the complete private review request before inference. */
export function parsePrivateSceneReviewRequest(
  value: unknown,
): PrivateSceneReviewRequest {
  if (jsonBytes(value) > PRIVATE_SCENE_REVIEW_REQUEST_MAX_BYTES)
    throw invalidRequest();
  const parsed = privateSceneReviewRequestSchema.safeParse(
    reviewRequestValue(value),
  );
  if (!parsed.success) throw invalidRequest();
  let reviewImage: SceneReviewImage | undefined;
  if (parsed.data.reviewImage !== undefined) {
    try {
      reviewImage = validateSceneReviewImage(parsed.data.reviewImage, {
        projectId: parsed.data.project.id,
        revision: parsed.data.project.revision,
      });
    } catch {
      throw invalidRequest();
    }
    // Keep the image limit visible at this boundary even if its validator is
    // changed later. This is the only private review payload that may carry a
    // large opaque value.
    if (
      new TextEncoder().encode(reviewImage.image).byteLength >
      MAX_REVIEW_IMAGE_BYTES
    )
      throw invalidRequest();
  }
  return {
    operationId: parsed.data.operationId,
    epoch: parsed.data.epoch,
    model: parsed.data.model,
    effort: parsed.data.effort,
    project: parsed.data.project,
    prompt: parsed.data.prompt,
    ...(parsed.data.selected === undefined
      ? {}
      : { selected: parsed.data.selected }),
    browserModeling: parsed.data.browserModeling,
    phase: parsed.data.phase,
    ...(reviewImage ? { reviewImage } : {}),
    ...(parsed.data.feedback === undefined
      ? {}
      : { feedback: parsed.data.feedback }),
  };
}

function resultSchema(browserModeling: boolean) {
  return z
    .object({
      type: z.literal("orbsie.private.scene-review"),
      version: z.literal(PRIVATE_SCENE_REVIEW_VERSION),
      operationId,
      epoch: safeInteger.min(1),
      review: sceneReviewResultSchema(browserModeling),
      corrections: z
        .array(modelCommandSchemaForCapabilities(false, browserModeling))
        .max(17),
      binding: privateBindingSchema,
    })
    .strict();
}

/** Validate a host result and bind it to the request's operation and scene. */
export function parsePrivateSceneReviewResult(
  value: unknown,
  expected: {
    operationId: string;
    epoch: number;
    projectId: string;
    revision: number;
    phase: SceneReviewPhase;
    browserModeling: boolean;
  },
): PrivateSceneReviewResult {
  if (jsonBytes(value) > PRIVATE_SCENE_REVIEW_RESPONSE_MAX_BYTES)
    throw invalidResult();
  const parsed = resultSchema(expected.browserModeling).safeParse(value);
  if (!parsed.success) throw invalidResult();
  const result = parsed.data;
  if (
    result.operationId !== expected.operationId ||
    result.epoch !== expected.epoch ||
    result.review.projectId !== expected.projectId ||
    result.review.reviewedRevision !== expected.revision ||
    (expected.phase === "final-review" &&
      (result.review.corrections.length > 0 ||
        result.corrections.length > 0)) ||
    (expected.phase === "review" &&
      result.review.verdict === "revise" &&
      (result.review.corrections.length === 0 ||
        result.corrections.length === 0)) ||
    (result.review.verdict === "accept" && result.corrections.length > 0) ||
    result.binding.projectId !== expected.projectId ||
    result.binding.revision < expected.revision
  )
    throw invalidResult();
  return {
    type: result.type,
    version: result.version,
    operationId: result.operationId,
    epoch: result.epoch,
    review: result.review,
    corrections: result.corrections as unknown as readonly ModelCommand[],
    binding: result.binding,
  };
}

export function privateSceneReviewResult(
  binding: { operationId: string; epoch: number },
  result: {
    review: SceneReviewResult;
    corrections: readonly ModelCommand[];
    binding: SceneBinding;
  },
): PrivateSceneReviewResult {
  return {
    type: "orbsie.private.scene-review",
    version: PRIVATE_SCENE_REVIEW_VERSION,
    operationId: binding.operationId,
    epoch: binding.epoch,
    review: result.review,
    corrections: result.corrections,
    binding: {
      version: result.binding.version,
      projectId: result.binding.projectId,
      revision: result.binding.revision,
      digest: result.binding.digest,
    },
  };
}
