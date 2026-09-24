import { z } from "zod";
import { entitySchema, projectSchema } from "../../../../../lib/protocol";
import {
  boundedJSON,
  checkOrigin,
  HttpError,
} from "../../../../../lib/server/auth";
import {
  admitReviewOnlyAuthoringRun,
  authoringReviewConfigured,
} from "../../../../../lib/server/authoring-run-admission";
import { requireGenerationModel } from "../../../../../lib/server/model-preflight";
import {
  FREE_MODEL,
  trialEnabled,
  trialIdentity,
  type TrialIdentity,
} from "../../../../../lib/server/trial";
import {
  clientRunIdFromRequest,
  createGenerationObservation,
  generationRequestId,
  withGenerationRequestId,
} from "../../../../../lib/server/generation-observability";

export const runtime = "nodejs";
export const maxDuration = 30;

const reviewStartRequestSchema = z
  .object({
    priorRunId: z.string().uuid(),
    provider: z.enum(["free", "openrouter", "gateway"]),
    model: z.string().min(1).max(150).optional(),
    key: z.string().max(1024).optional(),
    prompt: z.string().min(1).max(4000),
    project: projectSchema,
    localModeling: z.literal(false).default(false),
    browserModeling: z.boolean().default(false),
    selected: entitySchema.shape.id.optional(),
  })
  .strict();

type ReviewStartRequest = z.infer<typeof reviewStartRequestSchema>;

function requestedModel(input: ReviewStartRequest) {
  if (input.provider === "free") return FREE_MODEL;
  if (!input.model || !input.key || input.key.length < 10)
    throw new HttpError(400, "Check your connection and world data.");
  return input.model;
}

function routeError(error: unknown, signal: AbortSignal): HttpError {
  if (signal.aborted)
    return new HttpError(499, "The review start was canceled.");
  if (error instanceof HttpError) return error;
  return new HttpError(
    503,
    "Authoring review is temporarily unavailable. Retry shortly.",
  );
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
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
  let identity: TrialIdentity | undefined;
  try {
    checkOrigin(request);
    if (new URL(request.url).search)
      throw new HttpError(400, "Invalid review request.");
    if (!authoringReviewConfigured())
      throw new HttpError(
        503,
        "Authoring review is temporarily unavailable. Retry shortly.",
      );

    const parsed = reviewStartRequestSchema.safeParse(
      await boundedJSON(request, 512 * 1024),
    );
    if (!parsed.success)
      throw new HttpError(400, "Check your connection and world data.");
    const input = parsed.data;
    const model = requestedModel(input);
    const free = input.provider === "free";
    if (free) {
      if (!trialEnabled())
        throw new HttpError(
          503,
          "Free prompts are temporarily unavailable. Connect your provider to continue.",
        );
      if (JSON.stringify(input.project).length > 60_000)
        throw new HttpError(
          413,
          "Connect your provider to keep building this larger world.",
        );
    }

    const catalogModel = await requireGenerationModel(
      input.provider === "free" ? "gateway" : input.provider,
      model,
      signal,
    );
    if (free) identity = trialIdentity(request);

    observation.phase("admission");
    const admitted = await admitReviewOnlyAuthoringRun({
      request,
      project: input.project,
      prompt: input.prompt,
      provider: input.provider,
      model: catalogModel.id,
      selected: input.selected,
      localModeling: input.localModeling,
      browserModeling: input.browserModeling,
      priorRunId: input.priorRunId,
      signal,
      ...(identity ? { trialIdentity: identity } : {}),
    });

    observation.terminal({ reason: "completed" });
    const headers = new Headers({ "Cache-Control": "no-store" });
    const cookie = admitted.trialCookie ?? identity?.cookie;
    if (cookie) headers.set("Set-Cookie", cookie);
    if (admitted.trialRemaining !== null)
      headers.set("X-Orbsie-Trial-Remaining", String(admitted.trialRemaining));
    return respond(
      Response.json(
        {
          runId: admitted.runId,
          reviewImageSupported:
            catalogModel.capabilities?.imageInput?.supported === true,
        },
        { headers },
      ),
    );
  } catch (error) {
    const safe = routeError(error, signal);
    const timedOut =
      safe.status === 499 && signal.reason?.name === "TimeoutError";
    observation.terminal({
      reason: timedOut
        ? "deadline"
        : safe.status === 499
          ? "client-abort"
          : safe.status === 400 || safe.status === 413
            ? "parser-failure"
            : safe.status >= 500
              ? "transport-error"
              : "provider-error",
      ...(safe.status === 499
        ? { abortSource: timedOut ? "deadline" : "client" }
        : {}),
      failureCode: timedOut
        ? "timeout"
        : safe.status === 499
          ? "cancelled"
          : safe.status === 400 || safe.status === 413
            ? "invalid-input"
            : safe.status === 429
              ? "quota"
              : safe.status >= 500
                ? "host-unavailable"
                : "unknown",
      httpStatus: safe.status,
    });
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (identity) {
      headers.set("Set-Cookie", identity.cookie);
      if (safe.status === 429) headers.set("X-Orbsie-Trial-Remaining", "0");
    }
    return respond(
      Response.json({ error: safe.message }, { status: safe.status, headers }),
    );
  }
}
