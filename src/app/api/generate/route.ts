import { requireGenerationModel } from "../../../lib/server/model-preflight";
import { z } from "zod";
import { generationMaxTokens } from "@/lib/server/generation-limits";
import { projectSchema, entitySchema } from "@/lib/protocol";
import { modelingFeedbackSchema } from "@/lib/modeling-feedback";
import { generationFeedbackSchema } from "@/lib/generation-feedback";
import {
  generateCommands,
  GenerationProviderError,
} from "@/lib/server/generation";
import {
  checkOrigin,
  boundedJSON,
  apiError,
  HttpError,
} from "@/lib/server/auth";
import {
  trialEnabled,
  trialIdentity,
  claimTrial,
  refundTrial,
  TrialExhausted,
  FREE_MODEL,
  type TrialIdentity,
} from "@/lib/server/trial";
import {
  GenerationFormatConfigError,
  parseGenerationFormatOverrides,
  resolveGenerationOutputFormat,
} from "@/lib/server/generation-output-format";
import type { GenerationOutputFormat } from "@/lib/server/generation-output-format";
import {
  admitInitialAuthoringRun,
  authoringReviewConfigured,
  type InitialAuthoringAdmission,
} from "@/lib/server/authoring-run-admission";
import {
  clientRunIdFromRequest,
  createGenerationObservation,
  generationRequestId,
  observeGenerationStream,
  withGenerationRequestId,
} from "@/lib/server/generation-observability";
export const maxDuration = 180;
export async function POST(request: Request) {
  const requestId = generationRequestId();
  const routeObservation = createGenerationObservation({
    layer: "route",
    requestId,
    clientRunId: clientRunIdFromRequest(request),
  });
  const respond = (response: Response) =>
    withGenerationRequestId(response, requestId);
  const generationSignal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(175000),
  ]);
  const routeFailure = (error?: unknown) => {
    const timedOut =
      generationSignal.aborted &&
      generationSignal.reason?.name === "TimeoutError";
    const clientAborted = generationSignal.aborted && !timedOut;
    const httpStatus =
      error instanceof GenerationProviderError
        ? error.providerStatus
        : error instanceof TrialExhausted
          ? 429
          : error instanceof HttpError
            ? error.status
            : 500;
    const providerRejected = error instanceof GenerationProviderError;
    const quota = error instanceof TrialExhausted || httpStatus === 402;
    routeObservation.terminal({
      reason: timedOut
        ? "deadline"
        : clientAborted
          ? "client-abort"
          : providerRejected || quota
            ? "provider-error"
            : error instanceof HttpError &&
                (error.status === 400 || error.status === 413)
              ? "parser-failure"
              : "transport-error",
      abortSource: timedOut ? "deadline" : clientAborted ? "client" : undefined,
      failureCode: timedOut
        ? "timeout"
        : clientAborted
          ? "cancelled"
          : quota
            ? "quota"
            : providerRejected
              ? "provider-rejected"
              : error instanceof HttpError
                ? error.status === 400 || error.status === 413
                  ? "invalid-input"
                  : error.status === 401
                    ? "connection-required"
                    : error.status >= 500
                      ? "host-unavailable"
                      : "unknown"
                : error instanceof GenerationFormatConfigError
                  ? "invalid-input"
                  : "transport",
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    });
  };
  let identity: TrialIdentity | undefined;
  let remaining: number | undefined;
  let legacyTrialClaimed = false;
  let admittedModelId: string | undefined;
  let admittedReviewImageInput = false;
  let authoringAdmission: InitialAuthoringAdmission | undefined;
  let providerObservation:
    ReturnType<typeof createGenerationObservation> | undefined;
  try {
    checkOrigin(request);
    const parsed = z
      .object({
        provider: z.enum(["openrouter", "gateway", "free"]),
        model: z.string().max(150).optional(),
        key: z.string().max(1024).optional(),
        prompt: z.string().min(1).max(4000),
        project: projectSchema,
        localModeling: z.literal(false).default(false),
        browserModeling: z.boolean().default(false),
        selected: entitySchema.shape.id.optional(),
        modelingFeedback: modelingFeedbackSchema.optional(),
        generationFeedback: generationFeedbackSchema.optional(),
        authoringReview: z.boolean().default(false),
      })
      .safeParse(await boundedJSON(request));
    if (!parsed.success)
      throw new HttpError(400, "Check your connection and world data.");
    if (parsed.data.authoringReview && !authoringReviewConfigured())
      throw new HttpError(
        503,
        "Authoring review is temporarily unavailable. Retry shortly.",
      );
    if (
      parsed.data.generationFeedback &&
      parsed.data.generationFeedback.projectId !== parsed.data.project.id
    )
      throw new HttpError(400, "Check your connection and world data.");
    const formatOverrides = parseGenerationFormatOverrides();
    const free = parsed.data.provider === "free";
    const maxTokens = generationMaxTokens(free);
    let outputFormat: GenerationOutputFormat;
    if (
      !free &&
      (!parsed.data.model || !parsed.data.key || parsed.data.key.length < 10)
    )
      throw new HttpError(400, "Check your connection and world data.");
    if (free) {
      if (!trialEnabled())
        throw new HttpError(
          503,
          "Free prompts are temporarily unavailable. Connect your provider to continue.",
        );
      // Bound input as well as output for the public shared credential.
      if (JSON.stringify(parsed.data.project).length > 60000)
        throw new HttpError(
          413,
          "Connect your provider to keep building this larger world.",
        );
      const model = await requireGenerationModel(
        "gateway",
        FREE_MODEL,
        request.signal,
      );
      admittedModelId = model.id;
      admittedReviewImageInput =
        model.capabilities?.imageInput?.supported === true;
      outputFormat = resolveGenerationOutputFormat({
        provider: "gateway",
        model: FREE_MODEL,
        capabilities: model.capabilities,
        overrides: formatOverrides,
      });
      identity = trialIdentity(request);
      if (!parsed.data.authoringReview) {
        remaining = await claimTrial(identity);
        legacyTrialClaimed = true;
      }
    } else {
      const model = await requireGenerationModel(
        parsed.data.provider as "openrouter" | "gateway",
        parsed.data.model!,
        request.signal,
      );
      admittedModelId = model.id;
      admittedReviewImageInput =
        model.capabilities?.imageInput?.supported === true;
      outputFormat = resolveGenerationOutputFormat({
        provider: parsed.data.provider as "openrouter" | "gateway",
        model: parsed.data.model!,
        capabilities: model.capabilities,
        overrides: formatOverrides,
      });
    }
    if (parsed.data.authoringReview) {
      authoringAdmission = await admitInitialAuthoringRun({
        request,
        project: parsed.data.project,
        prompt: parsed.data.prompt,
        provider: free
          ? "free"
          : (parsed.data.provider as "gateway" | "openrouter"),
        model: admittedModelId!,
        selected: parsed.data.selected,
        localModeling: parsed.data.localModeling,
        browserModeling: parsed.data.browserModeling,
        signal: generationSignal,
        trialIdentity: identity,
      });
      if (authoringAdmission.trialRemaining !== null)
        remaining = authoringAdmission.trialRemaining;
    }
    providerObservation = createGenerationObservation({
      layer: "provider",
      requestId,
      clientRunId: routeObservation.clientRunId,
      provider: free
        ? "free"
        : (parsed.data.provider as "gateway" | "openrouter"),
      admittedModel: admittedModelId,
    });
    const stream = await generateCommands({
      ...parsed.data,
      provider: free
        ? "gateway"
        : (parsed.data.provider as "gateway" | "openrouter"),
      model: free ? FREE_MODEL : parsed.data.model!,
      key: free ? process.env.AI_GATEWAY_API_KEY_FREE! : parsed.data.key!,
      maxTokens,
      signal: generationSignal,
      outputFormat,
      observability: providerObservation,
      lifecycle: authoringAdmission?.lifecycle,
    });
    return respond(
      new Response(
        observeGenerationStream(stream, routeObservation, generationSignal),
        {
          headers: {
            "Content-Type": "application/x-ndjson",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
            ...(identity || authoringAdmission?.trialCookie
              ? {
                  "Set-Cookie":
                    authoringAdmission?.trialCookie ?? identity!.cookie,
                  ...(remaining === undefined
                    ? {}
                    : { "X-Orbsie-Trial-Remaining": String(remaining) }),
                }
              : {}),
            ...(authoringAdmission
              ? {
                  "X-Orbsie-Authoring-Run-Id": authoringAdmission.runId,
                  "X-Orbsie-Review-Image-Supported": admittedReviewImageInput
                    ? "1"
                    : "0",
                }
              : {}),
          },
        },
      ),
    );
  } catch (e) {
    if (
      identity &&
      legacyTrialClaimed &&
      e instanceof GenerationProviderError &&
      e.providerStatus === 402
    ) {
      // This catch only runs before the NDJSON response is returned, so no
      // partial stream can earn a refund. Keep the provider's 402 response if
      // reconciliation fails, and omit a stale remaining-count header.
      legacyTrialClaimed = false;
      try {
        remaining = await refundTrial(identity);
      } catch {
        remaining = undefined;
      }
    }
    if (authoringAdmission) await authoringAdmission.fail(e);
    if (providerObservation) {
      const providerAborted = generationSignal.aborted;
      providerObservation.terminal({
        reason: providerAborted
          ? generationSignal.reason?.name === "TimeoutError"
            ? "deadline"
            : "client-abort"
          : e instanceof GenerationProviderError
            ? "provider-error"
            : "transport-error",
        abortSource: providerAborted
          ? generationSignal.reason?.name === "TimeoutError"
            ? "deadline"
            : "client"
          : undefined,
        failureCode: providerAborted
          ? generationSignal.reason?.name === "TimeoutError"
            ? "timeout"
            : "cancelled"
          : e instanceof GenerationProviderError
            ? e.status === 402
              ? "quota"
              : "provider-rejected"
            : "transport",
        httpStatus: generationSignal.aborted
          ? undefined
          : e instanceof GenerationProviderError
            ? e.providerStatus
            : 500,
      });
    }
    routeFailure(e);
    if (e instanceof GenerationFormatConfigError)
      return respond(apiError(new HttpError(500, e.message)));
    if (e instanceof TrialExhausted)
      return respond(
        Response.json(
          { error: e.message, code: "FREE_LIMIT_REACHED", remaining: 0 },
          {
            status: 429,
            headers: {
              "Cache-Control": "no-store",
              ...(identity ? { "Set-Cookie": identity.cookie } : {}),
            },
          },
        ),
      );
    if (identity) {
      const response = apiError(
        e instanceof GenerationProviderError
          ? new HttpError(
              e.status,
              "Free generation is temporarily unavailable. Connect your provider to continue.",
            )
          : e,
      );
      response.headers.set("Set-Cookie", identity.cookie);
      if (remaining !== undefined)
        response.headers.set("X-Orbsie-Trial-Remaining", String(remaining));
      response.headers.set("Cache-Control", "no-store");
      return respond(response);
    }
    if (e instanceof GenerationProviderError && e.status === 401)
      return respond(
        Response.json(
          { error: e.message, code: "PROVIDER_AUTH_REJECTED" },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        ),
      );
    if (e instanceof GenerationProviderError && e.status === 403)
      return respond(
        Response.json(
          { error: e.message, code: "PROVIDER_ACCESS_DENIED" },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        ),
      );
    if (e instanceof GenerationProviderError)
      return respond(apiError(new HttpError(e.status, e.message)));
    return respond(apiError(e));
  }
}
