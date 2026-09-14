import { resolve } from "node:path";
import { z } from "zod";
import {
  getAuth,
  checkOrigin,
  boundedJSON,
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
import { chatGPTSceneRequestSchema } from "@/lib/server/chatgpt-scene-stream";
import {
  clientRunIdFromRequest,
  createGenerationObservation,
  generationRequestId,
  observeGenerationStream,
  withGenerationRequestId,
} from "@/lib/server/generation-observability";
import {
  admitInitialAuthoringRun,
  type InitialAuthoringAdmission,
} from "@/lib/server/authoring-run-admission";
export const runtime = "nodejs";
export const maxDuration = 180;
const ROUTE_DEADLINE_MS = 180_000;
const hostedAuthoringRequestSchema = chatGPTSceneRequestSchema
  .extend({ authoringReview: z.boolean().default(false) })
  .strict();
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  const requestId = generationRequestId();
  const routeObservation = createGenerationObservation({
    layer: "route",
    requestId,
    clientRunId: clientRunIdFromRequest(request),
    provider: "chatgpt",
  });
  const respond = (response: Response) =>
    withGenerationRequestId(response, requestId);
  if (
    process.env.ORBSIE_CHATGPT_HOSTED !== "1" ||
    process.env.ORBSIE_CHATGPT_GENERATION !== "1"
  ) {
    routeObservation.terminal({
      reason: "unknown",
      failureCode: "unknown",
      httpStatus: 404,
    });
    return respond(
      Response.json({ error: "Not found." }, { status: 404, headers }),
    );
  }
  const routeDeadlineAt = Date.now() + ROUTE_DEADLINE_MS;
  const routeSignal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(ROUTE_DEADLINE_MS),
  ]);
  let authoringAdmission: InitialAuthoringAdmission | undefined;
  try {
    checkOrigin(request);
    if (new URL(request.url).search)
      throw new HttpError(400, "Invalid generation request.");
    const auth = getAuth();
    if (!auth) throw new HttpError(503, "ChatGPT connection is unavailable.");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id || !session.session?.id)
      throw new HttpError(401, "Sign in to Orbsie first.");
    const input = hostedAuthoringRequestSchema.safeParse(
      await boundedJSON(request, 512 * 1024),
    );
    if (!input.success) throw new HttpError(400, "Invalid generation request.");
    const { authoringReview, ...sceneInput } = input.data;
    if (
      sceneInput.generationFeedback &&
      sceneInput.generationFeedback.projectId !== sceneInput.project.id
    )
      throw new HttpError(400, "Invalid generation request.");
    const identity = {
      ownerId: session.user.id,
      sessionId: session.session.id,
    };
    if (authoringReview) {
      authoringAdmission = await admitInitialAuthoringRun({
        request,
        project: sceneInput.project,
        prompt: sceneInput.prompt,
        provider: "chatgpt",
        model: sceneInput.model,
        effort: sceneInput.effort,
        selected: sceneInput.selected,
        localModeling: sceneInput.localModeling,
        browserModeling: sceneInput.browserModeling,
        signal: routeSignal,
        ownerSession: identity,
      });
    }
    const manager = createChatGPTHostManager({
      artifactDirectory: resolve(process.cwd(), ".orbsie/chatgpt-host"),
    });
    routeSignal.throwIfAborted();
    const durable = createChatGPTDurableService({ manager });
    const body = await durable.generate(
      identity,
      sceneInput,
      routeSignal,
      routeDeadlineAt,
      {
        requestId,
        clientRunId: routeObservation.clientRunId,
      },
      authoringAdmission,
    );
    if (!body) throw new HttpError(409, "Connect your ChatGPT account first.");
    return respond(
      new Response(
        observeGenerationStream(body, routeObservation, routeSignal),
        {
          headers: {
            ...headers,
            "Content-Type": "application/x-ndjson",
            "X-Accel-Buffering": "no",
            ...(authoringAdmission
              ? { "X-Orbsie-Authoring-Run-Id": authoringAdmission.runId }
              : {}),
          },
        },
      ),
    );
  } catch (error) {
    if (authoringAdmission) await authoringAdmission.fail(error);
    const timedOut =
      routeSignal.aborted && routeSignal.reason?.name === "TimeoutError";
    const clientAborted = routeSignal.aborted && !timedOut;
    const status =
      error instanceof ChatGPTHostStaleError
        ? 409
        : error instanceof ChatGPTDurableServiceError
          ? error.code === "missing" ||
            error.code === "revoked" ||
            error.code === "busy"
            ? 409
            : 502
          : error instanceof ChatGPTCredentialVaultError
            ? error.code === "unauthorized"
              ? 401
              : 502
            : error instanceof HttpError
              ? error.status
              : 502;
    const failureCode = timedOut
      ? "timeout"
      : clientAborted
        ? "cancelled"
        : error instanceof ChatGPTHostStaleError
          ? "connection-required"
          : error instanceof ChatGPTDurableServiceError
            ? error.code === "missing" || error.code === "revoked"
              ? "connection-required"
              : error.code === "expired"
                ? "timeout"
                : error.code === "busy" ||
                    error.code === "unavailable" ||
                    error.code === "finalization"
                  ? "host-unavailable"
                  : "transport"
            : error instanceof ChatGPTCredentialVaultError
              ? error.code === "unauthorized"
                ? "connection-required"
                : "host-unavailable"
              : error instanceof HttpError
                ? error.status === 400 || error.status === 413
                  ? "invalid-input"
                  : error.status === 401
                    ? "connection-required"
                    : error.status >= 500
                      ? "host-unavailable"
                      : "unknown"
                : "transport";
    routeObservation.terminal({
      reason: timedOut
        ? "deadline"
        : clientAborted
          ? "client-abort"
          : error instanceof HttpError &&
              (error.status === 400 || error.status === 413)
            ? "parser-failure"
            : "transport-error",
      abortSource: timedOut ? "deadline" : clientAborted ? "client" : undefined,
      failureCode,
      httpStatus: status,
    });
    if (error instanceof ChatGPTHostStaleError)
      return respond(
        Response.json(
          { code: CHATGPT_STALE_CONNECTION_CODE, error: error.message },
          { status: 409, headers },
        ),
      );
    if (error instanceof ChatGPTDurableServiceError)
      return respond(
        Response.json(
          {
            ...(error.code === "missing" || error.code === "revoked"
              ? { code: "CHATGPT_CONNECTION_REQUIRED" }
              : {}),
            error: error.message,
          },
          {
            status:
              error.code === "missing" ||
              error.code === "revoked" ||
              error.code === "busy"
                ? 409
                : 502,
            headers,
          },
        ),
      );
    if (error instanceof ChatGPTCredentialVaultError)
      return respond(
        Response.json(
          {
            ...(error.code === "unauthorized"
              ? { code: "CHATGPT_CONNECTION_REQUIRED" }
              : {}),
            error:
              error.code === "unauthorized"
                ? "Sign in to Orbsie first."
                : "ChatGPT connection could not be completed.",
          },
          { status: error.code === "unauthorized" ? 401 : 502, headers },
        ),
      );
    return respond(
      Response.json(
        {
          ...(error instanceof HttpError && [401, 409].includes(error.status)
            ? { code: "CHATGPT_CONNECTION_REQUIRED" }
            : {}),
          error:
            error instanceof HttpError
              ? error.message
              : "ChatGPT generation could not be completed.",
        },
        { status: error instanceof HttpError ? error.status : 502, headers },
      ),
    );
  }
}
