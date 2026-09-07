import { z } from "zod";
import { projectSchema } from "@/lib/protocol";
import { generateCommands } from "@/lib/server/generation";
import {
  requireUser,
  checkOrigin,
  boundedJSON,
  apiError,
  HttpError,
} from "@/lib/server/auth";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await requireUser(request);
    const parsed = z
      .object({
        provider: z.enum(["openrouter", "gateway"]),
        model: z.string().min(1).max(150),
        key: z.string().min(10).max(1024),
        prompt: z.string().min(1).max(4000),
        project: projectSchema,
        selected: z.string().optional(),
      })
      .safeParse(await boundedJSON(request));
    if (!parsed.success)
      throw new HttpError(400, "Check your connection and world data.");
    const stream = await generateCommands({
      ...parsed.data,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(50000)]),
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
