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
    databaseHooks: {
      session: {
        delete: {
          before: async (session) => {
            // Run before the session FK cascades away the runtime cleanup metadata.
            // Logout must still revoke the app session when the host API is unavailable.
            if (process.env.ORBSIE_CHATGPT_HOSTED !== "1") return;
            try {
              const { createChatGPTHostManager } =
                await import("./chatgpt-host-manager");
              await createChatGPTHostManager({
                artifactDirectory: `${process.cwd()}/.orbsie/chatgpt-host`,
              }).teardownSession({
                ownerId: session.userId,
                sessionId: session.id,
              });
            } catch {
              // Sandbox lifetime is bounded independently; never log host credentials.
              console.warn(
                "ChatGPT session cleanup failed; runtime expiry remains enforced.",
              );
            }
          },
        },
      },
    },
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
      "Sign in to publish or save to your cloud library.",
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
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Invalid request.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    bytes = 0,
    done = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        done = true;
        text += decoder.decode();
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > max) throw new HttpError(413, "This request is too large.");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid request.");
  } finally {
    if (!done) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
