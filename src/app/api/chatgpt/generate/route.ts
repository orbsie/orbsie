import { resolve } from "node:path";
import {
  getAuth,
  checkOrigin,
  boundedJSON,
  HttpError,
} from "@/lib/server/auth";
import { readChatGPTHost } from "@/lib/server/chatgpt-host-registry";
import { createChatGPTHostManager } from "@/lib/server/chatgpt-host-manager";
import { chatGPTSceneRequestSchema } from "@/lib/server/chatgpt-scene-stream";
export const runtime = "nodejs";
export const maxDuration = 180;
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  if (
    process.env.ORBSIE_CHATGPT_HOSTED !== "1" ||
    process.env.ORBSIE_CHATGPT_GENERATION !== "1"
  )
    return Response.json({ error: "Not found." }, { status: 404, headers });
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
    const identity = {
      ownerId: session.user.id,
      sessionId: session.session.id,
    };
    const host = await readChatGPTHost(identity);
    if (!host) throw new HttpError(409, "Connect your ChatGPT account first.");
    const manager = createChatGPTHostManager({
      artifactDirectory: resolve(process.cwd(), ".orbsie/chatgpt-host"),
    });
    const response = await manager.request(host, "generate", {
      input: input.data,
      signal: request.signal,
    });
    if (
      !response.ok ||
      !response.body ||
      response.headers.get("content-type")?.split(";")[0] !==
        "application/x-ndjson"
    ) {
      await response.body?.cancel();
      throw new HttpError(
        502,
        "ChatGPT generation could not start. Check your connection and retry.",
      );
    }
    return new Response(response.body, {
      headers: {
        ...headers,
        "Content-Type": "application/x-ndjson",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
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
