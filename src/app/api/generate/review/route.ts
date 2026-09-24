import { z } from "zod";
import { projectSchema, entitySchema } from "../../../../lib/protocol";
import {
  checkOrigin,
  boundedJSON,
  HttpError,
} from "../../../../lib/server/auth";
import {
  trialEnabled,
  trialIdentity,
  FREE_MODEL,
  type TrialIdentity,
} from "../../../../lib/server/trial";
import { requireGenerationModel } from "../../../../lib/server/model-preflight";
import {
  GenerationFormatConfigError,
  parseGenerationFormatOverrides,
  resolveGenerationOutputFormat,
} from "../../../../lib/server/generation-output-format";
import {
  admitAuthoringReviewPhase,
  authoringReviewConfigured,
  type AuthoringReviewAdmission,
} from "../../../../lib/server/authoring-run-admission";
import {
  AuthoringRunLedgerError,
  type AuthoringReviewPhase,
} from "../../../../lib/server/authoring-run-ledger";
import {
  executeSceneReview,
  SceneReviewExecutionError,
} from "../../../../lib/server/scene-review-execution";
import {
  ReviewImageValidationError,
  validateSceneReviewImage,
} from "../../../../lib/review-image";
import {
  clientRunIdFromRequest,
  createGenerationObservation,
  generationRequestId,
  withGenerationRequestId,
} from "../../../../lib/server/generation-observability";
import {
  sceneReviewFeedback,
  sceneReviewStructuralObservationsSchema,
  validateSceneReviewStructuralObservations,
} from "../../../../lib/server/scene-review-observations";
import {
  authoringReviewCallIndex,
  emitAuthoringReviewDiagnostic,
  type AuthoringReviewDiagnosticFailureKind,
  type AuthoringReviewDiagnosticScope,
} from "../../../../lib/server/authoring-review-observability";
import { isRecommendedModel } from "../../../../lib/model-modes";

export const runtime = "nodejs";
export const maxDuration = 180;

const reviewRequestSchema = z
  .object({
    runId: z.string().uuid(),
    phase: z.enum(["review", "final-review"]),
    provider: z.enum(["free", "openrouter", "gateway"]),
    model: z.string().max(150).optional(),
    key: z.string().max(1024).optional(),
    prompt: z.string().min(1).max(4000),
    project: projectSchema,
    localModeling: z.literal(false).default(false),
    browserModeling: z.boolean().default(false),
    selected: entitySchema.shape.id.optional(),
    reviewImage: z.unknown().optional(),
    feedback: z
      .string()
      .max(64 * 1024)
      .optional(),
    structuralObservations: sceneReviewStructuralObservationsSchema.optional(),
  })
  .strict();

type ReviewRequest = z.infer<typeof reviewRequestSchema>;

function reviewFailureKind(
  error: unknown,
  signal: AbortSignal,
): AuthoringReviewDiagnosticFailureKind {
  if (signal.aborted) return "route-aborted";
  if (error instanceof SceneReviewExecutionError) return error.code;
  if (error instanceof AuthoringRunLedgerError) return "authoring-ledger";
  if (error instanceof ReviewImageValidationError)
    return "review-image-validation";
  if (error instanceof GenerationFormatConfigError)
    return "generation-format-config";
  if (error instanceof HttpError) return "http-error";
  return "unknown";
}

function publicError(error: unknown, signal: AbortSignal): HttpError {
  if (signal.aborted)
    return new HttpError(499, "The scene review was canceled.");
  if (error instanceof HttpError) return error;
  if (error instanceof AuthoringRunLedgerError) {
    return new HttpError(
      error.code === "invalid-input" ? 400 : 409,
      "The authoring review is no longer available for this scene.",
    );
  }
  if (error instanceof ReviewImageValidationError)
    return new HttpError(400, "The supplied review image is invalid.");
  if (error instanceof SceneReviewExecutionError) {
    if (
      error.code === "invalid-input" ||
      error.code === "unsupported-image" ||
      error.code === "semantic-validation"
    )
      return new HttpError(400, error.message);
    if (error.code === "aborted")
      return new HttpError(499, "The scene review was canceled.");
    return new HttpError(502, error.message);
  }
  if (error instanceof GenerationFormatConfigError)
    return new HttpError(503, "The scene review format is unavailable.");
  return new HttpError(502, "The scene review could not be completed.");
}

function requestedModel(input: ReviewRequest) {
  if (input.provider === "free") return FREE_MODEL;
  if (!input.model || !input.key || input.key.length < 10)
    throw new HttpError(400, "Check your connection and world data.");
  return input.model;
}

function cookieHeaders(admission?: AuthoringReviewAdmission): HeadersInit {
  return admission?.trialCookie ? { "Set-Cookie": admission.trialCookie } : {};
}

export async function POST(request: Request) {
  const requestId = generationRequestId();
  const observation = createGenerationObservation({
    layer: "route",
    requestId,
    clientRunId: clientRunIdFromRequest(request),
  });
  const respond = (response: Response) =>
    withGenerationRequestId(response, requestId);
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(175_000),
  ]);
  let admission: AuthoringReviewAdmission | undefined;
  let identity: TrialIdentity | undefined;
  let reviewScope: AuthoringReviewDiagnosticScope | undefined;
  let reviewCallIndex: ReturnType<typeof authoringReviewCallIndex> | undefined;
  let reviewAdmitted = false;
  let reviewTerminalEmitted = false;
  try {
    checkOrigin(request);
    if (new URL(request.url).search)
      throw new HttpError(400, "Invalid review request.");
    if (!authoringReviewConfigured())
      throw new HttpError(
        503,
        "Authoring review is temporarily unavailable. Retry shortly.",
      );
    const parsed = reviewRequestSchema.safeParse(
      await boundedJSON(request, 512 * 1024),
    );
    if (!parsed.success)
      throw new HttpError(400, "Check your connection and world data.");
    const input = parsed.data;
    validateSceneReviewStructuralObservations(
      input.project,
      input.structuralObservations,
    );
    const feedback = sceneReviewFeedback(
      input.feedback,
      input.structuralObservations,
    );
    const model = requestedModel(input);
    const provider = input.provider === "free" ? "gateway" : input.provider;
    if (input.provider === "free" && !trialEnabled())
      throw new HttpError(
        503,
        "Free prompts are temporarily unavailable. Connect your provider to continue.",
      );
    if (input.provider !== "free" && input.key === undefined)
      throw new HttpError(400, "Check your connection and world data.");

    const catalogModel = await requireGenerationModel(provider, model, signal);
    const outputFormat = resolveGenerationOutputFormat({
      provider,
      model,
      capabilities: catalogModel.capabilities,
      overrides: parseGenerationFormatOverrides(),
    });

    const validatedImage =
      input.reviewImage === undefined
        ? undefined
        : validateSceneReviewImage(input.reviewImage, {
            projectId: input.project.id,
            revision: input.project.revision,
          });
    if (
      validatedImage &&
      catalogModel.capabilities?.imageInput?.supported !== true
    )
      throw new HttpError(
        400,
        "This model does not support image review. Retry with structural feedback.",
      );
    reviewScope = validatedImage ? "visual+structural" : "structural-only";

    if (input.provider === "free") identity = trialIdentity(request);
    observation.phase("admission");
    admission = await admitAuthoringReviewPhase({
      request,
      project: input.project,
      prompt: input.prompt,
      provider: input.provider,
      model,
      selected: input.selected,
      localModeling: input.localModeling,
      browserModeling: input.browserModeling,
      runId: input.runId,
      reviewPhase: input.phase as AuthoringReviewPhase,
      signal,
      ...(identity ? { trialIdentity: identity } : {}),
    });
    reviewAdmitted = true;
    reviewCallIndex = authoringReviewCallIndex(
      input.phase,
      admission.remainingReviewSlots,
    );
    emitAuthoringReviewDiagnostic({
      requestId,
      clientRunId: observation.clientRunId,
      phase: input.phase,
      callIndex: reviewCallIndex,
      scope: reviewScope,
      state: "admission",
      outcome: "admitted",
    });
    observation.phase("provider-start");
    const result = await executeSceneReview({
      provider,
      model,
      ...(isRecommendedModel(model) ? { effort: "low" as const } : {}),
      outputFormat,
      key:
        input.provider === "free"
          ? process.env.AI_GATEWAY_API_KEY_FREE!
          : input.key!,
      project: input.project,
      prompt: input.prompt,
      selected: input.selected,
      browserModeling: input.browserModeling,
      phase: input.phase,
      reviewImage: validatedImage,
      feedback,
      capabilities: catalogModel.capabilities,
      signal,
    });
    await admission.complete(
      result.binding,
      result.review.verdict === "accept",
      signal,
    );
    emitAuthoringReviewDiagnostic({
      requestId,
      clientRunId: observation.clientRunId,
      phase: input.phase,
      callIndex: reviewCallIndex,
      scope: result.review.scope,
      state: "terminal",
      outcome:
        result.review.verdict === "accept"
          ? "accepted"
          : input.phase === "final-review"
            ? "partial"
            : "revised",
    });
    reviewTerminalEmitted = true;
    observation.terminal({ reason: "completed" });
    const remainingCalls =
      result.review.verdict === "accept" || input.phase === "final-review"
        ? 0
        : admission.remainingReviewSlots;
    return respond(
      Response.json(
        {
          review: result.review,
          corrections: result.corrections,
          binding: {
            revision: result.binding.revision,
            digest: result.binding.digest,
          },
          revision: result.binding.revision,
          digest: result.binding.digest,
          scope: result.review.scope,
          remainingCalls,
        },
        {
          headers: {
            "Cache-Control": "no-store",
            ...cookieHeaders(admission),
          },
        },
      ),
    );
  } catch (error) {
    await admission?.fail(error);
    if (reviewAdmitted && !reviewTerminalEmitted && reviewScope)
      emitAuthoringReviewDiagnostic({
        requestId,
        clientRunId: observation.clientRunId,
        phase: admission?.reviewPhase ?? "review",
        callIndex: reviewCallIndex,
        scope: reviewScope,
        state: "terminal",
        outcome: signal.aborted ? "cancelled" : "failed",
        failureKind: reviewFailureKind(error, signal),
      });
    const safe = publicError(error, signal);
    observation.terminal({
      reason:
        safe.status === 499
          ? signal.reason?.name === "TimeoutError"
            ? "deadline"
            : "client-abort"
          : safe.status === 400
            ? "parser-failure"
            : "provider-error",
      abortSource:
        safe.status === 499
          ? signal.reason?.name === "TimeoutError"
            ? "deadline"
            : "client"
          : undefined,
      failureCode:
        safe.status === 499
          ? signal.reason?.name === "TimeoutError"
            ? "timeout"
            : "cancelled"
          : safe.status === 400
            ? "invalid-input"
            : "host-unavailable",
      httpStatus: safe.status,
    });
    return respond(
      Response.json(
        { error: safe.message },
        {
          status: safe.status,
          headers: {
            "Cache-Control": "no-store",
            ...cookieHeaders(admission),
          },
        },
      ),
    );
  }
}
