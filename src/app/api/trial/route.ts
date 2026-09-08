import { apiError, HttpError } from "@/lib/server/auth";
import {
  trialEnabled,
  trialIdentity,
  trialRemaining,
  TRIAL_LIMIT,
} from "@/lib/server/trial";
export async function GET(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (
      (origin &&
        origin !==
          (process.env.BETTER_AUTH_URL ?? new URL(request.url).origin)) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new HttpError(403, "Open Orbsie to use free prompts.");
    if (!trialEnabled())
      return Response.json(
        { enabled: false, remaining: 0, limit: TRIAL_LIMIT },
        { headers: { "Cache-Control": "no-store" } },
      );
    const identity = trialIdentity(request);
    return Response.json(
      {
        enabled: true,
        remaining: await trialRemaining(identity),
        limit: TRIAL_LIMIT,
      },
      {
        headers: { "Cache-Control": "no-store", "Set-Cookie": identity.cookie },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}
