import { checkOrigin, getAuth } from "@/lib/server/auth";
import { splitSetCookieHeader } from "better-auth/cookies";

export const runtime = "nodejs";

const responseHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json",
};

type PublicUser = {
  id: string;
  name: string;
  isAnonymous: boolean;
};

function errorResponse(status: number, error: string) {
  return Response.json({ error }, { status, headers: responseHeaders });
}

function publicUser(value: unknown): PublicUser | null {
  if (!value || typeof value !== "object") return null;
  const user = value as {
    id?: unknown;
    name?: unknown;
    isAnonymous?: unknown;
  };
  if (
    typeof user.id !== "string" ||
    user.id.length === 0 ||
    typeof user.name !== "string"
  )
    return null;
  return {
    id: user.id,
    name: user.name,
    isAnonymous: user.isAnonymous === true,
  };
}

function existingUser(value: unknown): PublicUser | null {
  if (!value || typeof value !== "object") return null;
  const session = value as { session?: unknown; user?: unknown };
  if (!session.session || typeof session.session !== "object") return null;
  const sessionId = (session.session as { id?: unknown }).id;
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  return publicUser(session.user);
}

function cookies(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const value = headers.get("set-cookie");
  return value ? splitSetCookieHeader(value) : [];
}

function responseWithCookies(body: PublicUser, setCookies: string[]) {
  const headers = new Headers(responseHeaders);
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return Response.json({ user: body }, { status: 200, headers });
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
  } catch {
    return errorResponse(403, "This request must come from your Orbsie app.");
  }

  const auth = getAuth();
  if (!auth) return errorResponse(503, "Cloud accounts are not configured.");

  try {
    const existing = await auth.api.getSession({ headers: request.headers });
    if (existing !== null && existing !== undefined) {
      const currentUser = existingUser(existing);
      if (!currentUser) return errorResponse(401, "Unauthorized.");
      return responseWithCookies(currentUser, []);
    }

    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.delete("content-type");
    const bootstrap = await auth.handler(
      new Request(new URL("/api/auth/sign-in/anonymous", request.url), {
        method: "POST",
        headers,
      }),
    );
    if (bootstrap.status === 429)
      return errorResponse(
        429,
        "Too many session attempts. Try again shortly.",
      );
    if (bootstrap.status !== 200)
      return errorResponse(502, "Could not start a private Orbsie session.");

    let payload: unknown;
    try {
      payload = await bootstrap.json();
    } catch {
      return errorResponse(502, "Could not start a private Orbsie session.");
    }
    const user = publicUser(
      payload && typeof payload === "object"
        ? (payload as { user?: unknown }).user
        : undefined,
    );
    if (!user)
      return errorResponse(502, "Could not start a private Orbsie session.");
    const setCookies = cookies(bootstrap);
    if (setCookies.length === 0)
      return errorResponse(502, "Could not start a private Orbsie session.");
    return responseWithCookies(user, setCookies);
  } catch {
    return errorResponse(503, "Could not start a private Orbsie session.");
  }
}
