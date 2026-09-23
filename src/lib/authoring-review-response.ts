import { z } from "zod";
import {
  modelCommandSchemaForCapabilities,
  type ModelCommand,
} from "./protocol";
import {
  parseSceneReviewResult,
  type SceneReviewPhase,
  type SceneReviewScope,
} from "./scene-review";

export type AuthoringReviewResponseExpectation = {
  projectId: string;
  revision: number;
  phase: SceneReviewPhase;
  scope: SceneReviewScope;
  browserModeling: boolean;
  entityIds: readonly string[];
};

/** Parse a public review reply before applying any server-approved command. */
export function parseAuthoringReviewResponse(
  raw: unknown,
  expected: AuthoringReviewResponseExpectation,
) {
  const bindingSchema = z
    .object({
      revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict();
  const parsed = z
    .object({
      review: z.unknown(),
      corrections: z
        .array(
          modelCommandSchemaForCapabilities(false, expected.browserModeling),
        )
        .max(17),
      binding: bindingSchema,
      revision: bindingSchema.shape.revision,
      digest: bindingSchema.shape.digest,
      scope: z.enum(["visual+structural", "structural-only"]),
      remainingCalls: z.number().int().min(0).max(1),
    })
    .strict()
    .parse(raw);
  const review = parseSceneReviewResult(parsed.review, expected);
  if (
    parsed.revision !== parsed.binding.revision ||
    parsed.digest !== parsed.binding.digest ||
    parsed.scope !== review.scope
  )
    throw Error("The scene review reply is inconsistent.");
  const revising = expected.phase === "review" && review.verdict === "revise";
  const corrections = parsed.corrections as unknown as readonly ModelCommand[];
  if (revising) {
    if (
      parsed.remainingCalls !== 1 ||
      corrections.length !== review.corrections.length + 1 ||
      corrections.at(-1)?.type !== "commit_revision" ||
      corrections
        .slice(0, -1)
        .some((command) => command.type === "commit_revision") ||
      parsed.binding.revision !== expected.revision + corrections.length
    )
      throw Error("The scene review correction batch is inconsistent.");
  } else if (
    parsed.remainingCalls !== 0 ||
    corrections.length !== 0 ||
    parsed.binding.revision !== expected.revision
  )
    throw Error("The scene review verdict is inconsistent.");
  return {
    review,
    corrections,
    binding: parsed.binding,
    scope: parsed.scope,
    remainingCalls: parsed.remainingCalls,
  };
}
