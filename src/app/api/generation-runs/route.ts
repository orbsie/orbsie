import { z } from "zod";
import {
  apiError,
  boundedJSON,
  checkOrigin,
  HttpError,
  requireUser,
} from "../../../lib/server/auth";
import {
  startGenerationRun,
  appendGenerationRun,
  readGenerationRun,
  replayGenerationRun,
  latestGenerationRun,
  cancelGenerationRun,
  runIdSchema,
} from "../../../lib/server/generation-runs";
async function handle(request: Request, method: string) {
  try {
    if (method !== "GET") checkOrigin(request);
    const user = await requireUser(request);
    let run;
    if (method === "GET") {
      const params = new URL(request.url).searchParams;
      if (params.has("runId") && params.has("afterSequence")) {
        const result = await replayGenerationRun(
          user.id,
          params.get("runId")!,
          Number(params.get("afterSequence")),
        );
        return Response.json(result, {
          headers: { "Cache-Control": "private, no-store" },
        });
      }
      run = params.has("runId")
        ? await readGenerationRun(user.id, params.get("runId")!)
        : await latestGenerationRun(user.id, params.get("projectId") ?? "");
    } else {
      const body = await boundedJSON(request, 520 * 1024);
      if (method === "POST") run = await startGenerationRun(user.id, body);
      else if (method === "PUT") run = await appendGenerationRun(user.id, body);
      else
        run = await cancelGenerationRun(user.id, runIdSchema.parse(body).runId);
    }
    return Response.json(
      { run },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(
      error instanceof z.ZodError
        ? new HttpError(400, "Invalid generation journal request.")
        : error,
    );
  }
}
export const POST = (request: Request) => handle(request, "POST");
export const PUT = (request: Request) => handle(request, "PUT");
export const PATCH = (request: Request) => handle(request, "PATCH");
export const GET = (request: Request) => handle(request, "GET");
