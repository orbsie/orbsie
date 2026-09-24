import { resolve } from "node:path";
import { z } from "zod";
import { projectSchema, entitySchema } from "@/lib/protocol";
import {
  boundedJSON,
  checkOrigin,
  getAuth,
  HttpError,
} from "@/lib/server/auth";
import { createChatGPTHostManager } from "@/lib/server/chatgpt-host-manager";
import { ChatGPTHostStaleError } from "@/lib/server/chatgpt-host-service";
import {
  ChatGPTDurableServiceError,
  createChatGPTDurableService,
} from "@/lib/server/chatgpt-durable-service";
import { ChatGPTCredentialVaultError } from "@/lib/server/chatgpt-credential-vault";
import { CHATGPT_STALE_CONNECTION_CODE } from "@/lib/chatgpt-connection-errors";
import {
  admitAuthoringReviewPhase,
  authoringReviewConfigured,
  type AuthoringReviewAdmission,
} from "@/lib/server/authoring-run-admission";
import {
  sceneReviewFeedback,
  sceneReviewStructuralObservationsSchema,
  validateSceneReviewStructuralObservations,
} from "@/lib/server/scene-review-observations";
import {
  ReviewImageValidationError,
  validateSceneReviewImage,
} from "@/lib/review-image";
import {
  clientRunIdFromRequest,
  createGenerationObservation,
  generationRequestId,
  withGenerationRequestId,
} from "@/lib/server/generation-observability";
import {
  authoringReviewCallIndex,
  emitAuthoringReviewDiagnostic,
  type AuthoringReviewDiagnosticScope,
} from "@/lib/server/authoring-review-observability";

export const runtime = "nodejs";
export const maxDuration = 180;

const reviewRequestSchema = z
  .object({
    runId: z.string().uuid(),
    phase: z.enum(["review", "final-review"]),
    model: z.string().min(1).max(256),
    effort: z.string().min(1).max(32),
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
type Identity = { ownerId: string; sessionId: string };

const headers = { "Cache-Control": "no-store" };

function publicError(error: unknown, signal: AbortSignal): HttpError {
  if (signal.aborted)
    return new HttpError(499, "The scene review was canceled.");
  if (error instanceof HttpError) return error;
  if (error instanceof ChatGPTHostStaleError)
    return new HttpError(409, error.message);
  if (error instanceof ReviewImageValidationError)
    return new HttpError(400, "The supplied review image is invalid.");
  if (error instanceof ChatGPTDurableServiceError) {
    if (error.code === "missing" || error.code === "revoked")
      return new HttpError(409, "Connect your ChatGPT account first.");
    if (error.code === "busy")
      return new HttpError(
        409,
        "Another ChatGPT operation is already using this connection.",
      );
    if (error.code === "finalization")
      return new HttpError(
        502,
        "ChatGPT credential finalization could not be completed.",
      );
    return new HttpError(
      502,
      "The ChatGPT scene review could not be completed.",
    );
  }
  if (error instanceof ChatGPTCredentialVaultError)
    return new HttpError(
      error.code === "unauthorized" ? 401 : 502,
      error.code === "unauthorized"
        ? "Sign in to Orbsie first."
        : "ChatGPT connection could not be completed.",
    );
  return new HttpError(502, "The ChatGPT scene review could not be completed.");
}

function identityFromSession(value: unknown): Identity {
  if (!value || typeof value !== "object")
    throw new HttpError(401, "Sign in to Orbsie first.");
  const session = value as {
    user?: { id?: unknown };
    session?: { id?: unknown };
  };
  if (
    typeof session.user?.id !== "string" ||
    !session.user.id ||
    typeof session.session?.id !== "string" ||
    !session.session.id
  )
    throw new HttpError(401, "Sign in to Orbsie first.");
  return { ownerId: session.user.id, sessionId: session.session.id };
}

async function authenticate(request: Request): Promise<Identity> {
  const auth = getAuth();
  if (!auth) throw new HttpError(503, "ChatGPT connection is unavailable.");
  let session: unknown;
  try {
    session = await auth.api.getSession({ headers: request.headers });
  } catch {
    throw new HttpError(503, "ChatGPT connection is unavailable.");
  }
  return identityFromSession(session);
}

function cookieHeaders(admission?: AuthoringReviewAdmission): HeadersInit {
  return admission?.trialCookie ? { "Set-Cookie": admission.trialCookie } : {};
}

export async function POST(request: Request) {
  const requestId = generationRequestId();
  const clientRunId = clientRunIdFromRequest(request);
  const observation = createGenerationObservation({
    layer: "route",
    requestId,
    clientRunId,
    provider: "chatgpt",
  });
  const respond = (response: Response) =>
    withGenerationRequestId(response, requestId);
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(175_000),
  ]);
  let admission: AuthoringReviewAdmission | undefined;
  let reviewScope: AuthoringReviewDiagnosticScope | undefined;
  let reviewCallIndex: ReturnType<typeof authoringReviewCallIndex> | undefined;
  let terminalDiagnostic = false;
  try {
    if (
      process.env.ORBSIE_CHATGPT_HOSTED !== "1" ||
      process.env.ORBSIE_CHATGPT_GENERATION !== "1"
    )
      throw new HttpError(404, "Not found.");
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
    const reviewImage =
      input.reviewImage === undefined
        ? undefined
        : validateSceneReviewImage(input.reviewImage, {
            projectId: input.project.id,
            revision: input.project.revision,
          });
    reviewScope = reviewImage ? "visual+structural" : "structural-only";
    const identity = await authenticate(request);
    const manager = createChatGPTHostManager({
      artifactDirectory: resolve(process.cwd(), ".orbsie/chatgpt-host"),
    });
    const durable = createChatGPTDurableService({ manager });
    const result = await durable.review(
      identity,
      {
        phase: input.phase,
        model: input.model,
        effort: input.effort,
        prompt: input.prompt,
        project: input.project,
        ...(input.selected === undefined ? {} : { selected: input.selected }),
        browserModeling: input.browserModeling,
        ...(reviewImage === undefined ? {} : { reviewImage }),
        ...(feedback === undefined ? {} : { feedback }),
      },
      signal,
      Date.now() + 175_000,
      { requestId, clientRunId },
      async () => {
        admission = await admitAuthoringReviewPhase({
          request,
          project: input.project,
          prompt: input.prompt,
          provider: "chatgpt",
          model: input.model,
          effort: input.effort,
          selected: input.selected,
          localModeling: input.localModeling,
          browserModeling: input.browserModeling,
          runId: input.runId,
          reviewPhase: input.phase,
          signal,
          ownerSession: identity,
        });
        reviewCallIndex = authoringReviewCallIndex(
          input.phase,
          admission.remainingReviewSlots,
        );
        emitAuthoringReviewDiagnostic({
          requestId,
          clientRunId,
          phase: input.phase,
          callIndex: reviewCallIndex,
          scope: reviewScope!,
          state: "admission",
          outcome: "admitted",
        });
        return admission;
      },
    );
    const outcome =
      result.review.verdict === "accept"
        ? "accepted"
        : input.phase === "final-review"
          ? "partial"
          : "revised";
    emitAuthoringReviewDiagnostic({
      requestId,
      clientRunId,
      phase: input.phase,
      callIndex: reviewCallIndex,
      scope: result.review.scope,
      state: "terminal",
      outcome,
    });
    terminalDiagnostic = true;
    observation.terminal({ reason: "completed" });
    const remainingCalls =
      result.review.verdict === "accept" || input.phase === "final-review"
        ? 0
        : (admission?.remainingReviewSlots ?? 0);
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
        { headers: { ...headers, ...cookieHeaders(admission) } },
      ),
    );
  } catch (error) {
    if (admission) await admission.fail(error).catch(() => undefined);
    if (admission && !terminalDiagnostic && reviewScope)
      emitAuthoringReviewDiagnostic({
        requestId,
        clientRunId,
        phase: admission.reviewPhase,
        callIndex: reviewCallIndex,
        scope: reviewScope,
        state: "terminal",
        outcome: signal.aborted ? "cancelled" : "failed",
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
    const body: Record<string, unknown> = { error: safe.message };
    if (error instanceof ChatGPTHostStaleError) {
      body.code = CHATGPT_STALE_CONNECTION_CODE;
      body.error = error.message;
    } else if (error instanceof ChatGPTDurableServiceError) {
      if (error.code === "missing" || error.code === "revoked")
        body.code = "CHATGPT_CONNECTION_REQUIRED";
      if (error.code === "finalization")
        body.code = "CHATGPT_CREDENTIAL_FINALIZATION_FAILED";
    }
    return respond(
      Response.json(body, {
        status: safe.status,
        headers: { ...headers, ...cookieHeaders(admission) },
      }),
    );
  }
}
