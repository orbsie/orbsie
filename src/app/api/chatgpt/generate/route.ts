import { resolve } from "node:path";
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
export const runtime = "nodejs";
export const maxDuration = 180;
const ROUTE_DEADLINE_MS = 180_000;
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  if (
    process.env.ORBSIE_CHATGPT_HOSTED !== "1" ||
    process.env.ORBSIE_CHATGPT_GENERATION !== "1"
  )
    return Response.json({ error: "Not found." }, { status: 404, headers });
  const routeDeadlineAt = Date.now() + ROUTE_DEADLINE_MS;
  const routeSignal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(ROUTE_DEADLINE_MS),
  ]);
  try {
    checkOrigin(request);
    if (new URL(request.url).search)
      throw new HttpError(400, "Invalid generation request.");
    const auth = getAuth();
    if (!auth) throw new HttpError(503, "ChatGPT connection is unavailable.");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id || !session.session?.id)
      throw new HttpError(401, "Sign in to Orbsie first.");
    const input = chatGPTSceneRequestSchema.safeParse(
      await boundedJSON(request, 512 * 1024),
    );
    if (!input.success) throw new HttpError(400, "Invalid generation request.");
    if (
      input.data.generationFeedback &&
      input.data.generationFeedback.projectId !== input.data.project.id
    )
      throw new HttpError(400, "Invalid generation request.");
    const identity = {
      ownerId: session.user.id,
      sessionId: session.session.id,
    };
    const manager = createChatGPTHostManager({
      artifactDirectory: resolve(process.cwd(), ".orbsie/chatgpt-host"),
    });
    routeSignal.throwIfAborted();
    const durable = createChatGPTDurableService({ manager });
    const body = await durable.generate(
      identity,
      input.data,
      routeSignal,
      routeDeadlineAt,
    );
    if (!body) throw new HttpError(409, "Connect your ChatGPT account first.");
    return new Response(body, {
      headers: {
        ...headers,
        "Content-Type": "application/x-ndjson",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof ChatGPTHostStaleError)
      return Response.json(
        { code: CHATGPT_STALE_CONNECTION_CODE, error: error.message },
        { status: 409, headers },
      );
    if (error instanceof ChatGPTDurableServiceError)
      return Response.json(
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
      );
    if (error instanceof ChatGPTCredentialVaultError)
      return Response.json(
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
      );
    return Response.json(
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
    );
  }
}
