import { requireGenerationModel } from "../../../lib/server/model-preflight";
import { z } from "zod";
import { generationMaxTokens } from "@/lib/server/generation-limits";
import { projectSchema, entitySchema } from "@/lib/protocol";
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
  TrialExhausted,
  FREE_MODEL,
  type TrialIdentity,
} from "@/lib/server/trial";
export const maxDuration = 180;
export async function POST(request: Request) {
  let identity: TrialIdentity | undefined;
  let remaining: number | undefined;
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
      })
      .safeParse(await boundedJSON(request));
    if (!parsed.success)
      throw new HttpError(400, "Check your connection and world data.");
    const free = parsed.data.provider === "free";
    const maxTokens = generationMaxTokens(free);
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
      await requireGenerationModel("gateway", FREE_MODEL, request.signal);
      identity = trialIdentity(request);
      remaining = await claimTrial(identity);
    }
    if (!free)
      await requireGenerationModel(
        parsed.data.provider as "openrouter" | "gateway",
        parsed.data.model!,
        request.signal,
      );
    const stream = await generateCommands({
      ...parsed.data,
      provider: free
        ? "gateway"
        : (parsed.data.provider as "gateway" | "openrouter"),
      model: free ? FREE_MODEL : parsed.data.model!,
      key: free ? process.env.AI_GATEWAY_API_KEY_FREE! : parsed.data.key!,
      maxTokens,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(175000)]),
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
        ...(identity
          ? {
              "Set-Cookie": identity.cookie,
              "X-Orbsie-Trial-Remaining": String(remaining),
            }
          : {}),
      },
    });
  } catch (e) {
    if (e instanceof TrialExhausted)
      return Response.json(
        { error: e.message, code: "FREE_LIMIT_REACHED", remaining: 0 },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            ...(identity ? { "Set-Cookie": identity.cookie } : {}),
          },
        },
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
      return response;
    }
    if (e instanceof GenerationProviderError && e.status === 401)
      return Response.json(
        { error: e.message, code: "PROVIDER_AUTH_REJECTED" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    if (e instanceof GenerationProviderError && e.status === 403)
      return Response.json(
        { error: e.message, code: "PROVIDER_ACCESS_DENIED" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    if (e instanceof GenerationProviderError)
      return apiError(new HttpError(e.status, e.message));
    return apiError(e);
  }
}
