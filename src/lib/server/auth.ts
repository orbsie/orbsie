import { betterAuth, type BetterAuthOptions } from "better-auth";
import { Pool } from "pg";
let pool: Pool | undefined;
let auth: ReturnType<typeof betterAuth> | undefined;
export function database() {
  if (!process.env.DATABASE_URL)
    throw Error("Cloud storage is not configured.");
  return (pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
  }));
}
export function getAuth() {
  if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) return null;
  return (auth ??= betterAuth<BetterAuthOptions>({
    database: database(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    socialProviders:
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            },
          }
        : undefined,
    rateLimit: { enabled: true, window: 60, max: 30 },
  }));
}
export async function requireUser(request: Request) {
  const auth = getAuth();
  if (!auth)
    throw new HttpError(
      503,
      "Cloud accounts are not configured yet. Your local world is safe.",
    );
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    throw new HttpError(
      401,
      "Sign in to use your AI connection or cloud saving.",
    );
  return session.user;
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
  if (!origin || origin !== allowed)
    throw new HttpError(403, "This request must come from your Orbsie app.");
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function apiError(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof HttpError
          ? error.message
          : "The request could not be completed. Your saved world is safe.",
    },
    { status: error instanceof HttpError ? error.status : 500 },
  );
}
export async function boundedJSON(request: Request, max = 500000) {
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, "This world is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid request.");
  }
}
