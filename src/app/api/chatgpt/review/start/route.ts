import { resolve } from "node:path";
import { z } from "zod";
import { entitySchema, projectSchema } from "@/lib/protocol";
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
  admitReviewOnlyAuthoringRun,
  authoringReviewConfigured,
} from "@/lib/server/authoring-run-admission";
import {
  clientRunIdFromRequest,
  createGenerationObservation,
  generationRequestId,
  withGenerationRequestId,
} from "@/lib/server/generation-observability";

export const runtime = "nodejs";
export const maxDuration = 30;

const ROUTE_DEADLINE_MS = 25_000;

const reviewStartRequestSchema = z
  .object({
    priorRunId: z.string().uuid(),
    model: z.string().min(1).max(256),
    effort: z.string().min(1).max(32),
    prompt: z.string().min(1).max(4000),
    project: projectSchema,
    localModeling: z.literal(false).default(false),
    browserModeling: z.boolean().default(false),
    selected: entitySchema.shape.id.optional(),
  })
  .strict();

type ReviewStartRequest = z.infer<typeof reviewStartRequestSchema>;
type Identity = { ownerId: string; sessionId: string };

function routeError(error: unknown, signal: AbortSignal): HttpError {
  if (signal.aborted)
    return new HttpError(499, "The review start was canceled.");
  if (error instanceof HttpError) return error;
  if (error instanceof ChatGPTHostStaleError)
    return new HttpError(409, error.message);
  if (error instanceof ChatGPTDurableServiceError) {
    if (error.code === "missing" || error.code === "revoked")
      return new HttpError(409, "Connect your ChatGPT account first.");
    if (error.code === "busy")
      return new HttpError(
        409,
        "Another ChatGPT operation is already using this connection.",
      );
    if (error.code === "login-pending")
      return new HttpError(
        409,
        "Finish the active ChatGPT sign-in before starting a review.",
      );
    return new HttpError(
      503,
      "ChatGPT model access is temporarily unavailable. Retry shortly.",
    );
  }
  if (error instanceof ChatGPTCredentialVaultError)
    return new HttpError(
      error.code === "unauthorized" ? 401 : 503,
      error.code === "unauthorized"
        ? "Sign in to Orbsie first."
        : "ChatGPT connection is temporarily unavailable.",
    );
  return new HttpError(
    503,
    "Authoring review is temporarily unavailable. Retry shortly.",
  );
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

function errorCode(error: unknown): string | undefined {
  if (error instanceof ChatGPTHostStaleError)
    return CHATGPT_STALE_CONNECTION_CODE;
  if (
    error instanceof ChatGPTDurableServiceError &&
    (error.code === "missing" || error.code === "revoked")
  )
    return "CHATGPT_CONNECTION_REQUIRED";
  if (error instanceof HttpError && error.status === 401)
    return "CHATGPT_CONNECTION_REQUIRED";
  return undefined;
}

export async function POST(request: Request) {
  const requestId = generationRequestId();
  const observation = createGenerationObservation({
    layer: "route",
    requestId,
    clientRunId: clientRunIdFromRequest(request),
    provider: "chatgpt",
  });
  const respond = (response: Response) =>
    withGenerationRequestId(response, requestId);
  const routeDeadlineAt = Date.now() + ROUTE_DEADLINE_MS;
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(ROUTE_DEADLINE_MS),
  ]);

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

    const parsed = reviewStartRequestSchema.safeParse(
      await boundedJSON(request, 512 * 1024),
    );
    if (!parsed.success)
      throw new HttpError(400, "Check your connection and world data.");
    const input: ReviewStartRequest = parsed.data;
    const identity = await authenticate(request);
    const manager = createChatGPTHostManager({
      artifactDirectory: resolve(process.cwd(), ".orbsie/chatgpt-host"),
    });
    const durable = createChatGPTDurableService({ manager });
    signal.throwIfAborted();

    // Catalog lookup validates both the owned host connection and the model
    // before the review-only run is admitted. This route never invokes inference.
    if (typeof durable.models !== "function")
      throw new HttpError(
        503,
        "ChatGPT model access is temporarily unavailable. Retry shortly.",
      );
    const catalog = await durable.models(identity, signal, routeDeadlineAt);
    if (catalog === null)
      throw new ChatGPTDurableServiceError(
        "missing",
        "ChatGPT connection is unavailable.",
      );
    const model = catalog.find((candidate) => candidate.model === input.model);
    if (!model || !model.supportedReasoningEfforts.includes(input.effort))
      throw new HttpError(400, "Choose an available ChatGPT model and effort.");

    signal.throwIfAborted();
    observation.phase("admission");
    const admitted = await admitReviewOnlyAuthoringRun({
      request,
      project: input.project,
      prompt: input.prompt,
      provider: "chatgpt",
      model: input.model,
      effort: input.effort,
      selected: input.selected,
      localModeling: input.localModeling,
      browserModeling: input.browserModeling,
      priorRunId: input.priorRunId,
      signal,
      ownerSession: identity,
    });

    observation.terminal({ reason: "completed" });
    return respond(
      Response.json(
        {
          runId: admitted.runId,
          reviewImageSupported:
            model.inputModalities?.includes("image") === true,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      ),
    );
  } catch (error) {
    const safe = routeError(error, signal);
    const timedOut =
      safe.status === 499 && signal.reason?.name === "TimeoutError";
    observation.terminal({
      reason:
        safe.status === 499
          ? timedOut
            ? "deadline"
            : "client-abort"
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
    return respond(
      Response.json(
        {
          ...(errorCode(error) ? { code: errorCode(error) } : {}),
          error: safe.message,
        },
        {
          status: safe.status,
          headers: { "Cache-Control": "private, no-store" },
        },
      ),
    );
  }
}
