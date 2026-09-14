import { z } from "zod";
import { modelCommandSchemaForCapabilities } from "./protocol";

export type SceneReviewPhase = "review" | "final-review";
export type SceneReviewScope = "visual+structural" | "structural-only";

const identifier = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[\w-]+$/);
const issueSchema = z
  .object({
    summary: z.string().trim().min(1).max(300),
    entityIds: z.array(identifier).max(16),
  })
  .strict();

/** Model output shape. A parsed result still needs scene/asset-policy validation. */
export function sceneReviewResultSchema(browserModeling: boolean) {
  return z
    .object({
      version: z.literal(1),
      projectId: identifier,
      reviewedRevision: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER),
      scope: z.enum(["visual+structural", "structural-only"]),
      verdict: z.enum(["accept", "revise"]),
      summary: z.string().trim().min(1).max(600),
      issues: z.array(issueSchema).max(8),
      corrections: z
        .array(modelCommandSchemaForCapabilities(false, browserModeling))
        .max(16),
    })
    .strict()
    .superRefine((result, context) => {
      if (
        result.verdict === "accept" &&
        (result.issues.length || result.corrections.length)
      )
        context.addIssue({
          code: "custom",
          path: ["verdict"],
          message:
            "Acceptance cannot include unresolved defects or corrections.",
        });
      if (result.verdict === "revise" && !result.issues.length)
        context.addIssue({
          code: "custom",
          path: ["issues"],
          message: "A revision verdict must identify a concrete defect.",
        });
      if (
        result.corrections.some((command) => command.type === "commit_revision")
      )
        context.addIssue({
          code: "custom",
          path: ["corrections"],
          message: "The review lifecycle owns the correction commit.",
        });
    });
}

export type SceneReviewResult = z.infer<
  ReturnType<typeof sceneReviewResultSchema>
>;

/**
 * Bind the verdict to the caller's admitted phase and actual evidence scope.
 * This does not authorize a model call or apply corrections: callers must first
 * admit the server ledger phase, then validate corrections against its bound scene.
 */
export function parseSceneReviewResult(
  raw: unknown,
  expected: {
    projectId: string;
    revision: number;
    scope: SceneReviewScope;
    phase: SceneReviewPhase;
    browserModeling: boolean;
    entityIds: readonly string[];
  },
): SceneReviewResult {
  const result = sceneReviewResultSchema(expected.browserModeling).parse(raw);
  if (
    result.projectId !== expected.projectId ||
    result.reviewedRevision !== expected.revision
  )
    throw Error("This review belongs to another world or revision.");
  if (result.scope !== expected.scope)
    throw Error("The review scope does not match the supplied evidence.");
  if (expected.phase === "final-review" && result.corrections.length)
    throw Error("The final review cannot apply more corrections.");
  if (
    expected.phase === "review" &&
    result.verdict === "revise" &&
    !result.corrections.length
  )
    throw Error("The first review must provide a correction for its defect.");
  const entities = new Set(expected.entityIds);
  if (
    result.issues.some((issue) =>
      issue.entityIds.some((id) => !entities.has(id)),
    )
  )
    throw Error(
      "A review issue refers to an object outside the reviewed scene.",
    );
  return result;
}
