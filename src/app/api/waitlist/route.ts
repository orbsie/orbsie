import { checkOrigin, HttpError } from "../../../lib/server/auth";
import {
  joinWaitlist,
  normalizeWaitlistEmail,
  waitlistIpHash,
} from "../../../lib/server/waitlist";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, "Enter a valid email address.");
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2048) throw new HttpError(413, "This request is too large.");
        parts.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(parts).toString("utf8"));
    } catch {
      throw new HttpError(400, "Enter a valid email address.");
    }
    const email = normalizeWaitlistEmail(body?.email);
    const result = await joinWaitlist(email, waitlistIpHash(request));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    return Response.json(
      {
        error:
          error instanceof HttpError
            ? error.message
            : "The waitlist is temporarily unavailable. Please try again later.",
      },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          ...(status === 429 ? { "Retry-After": "3600" } : {}),
        },
      },
    );
  }
}
