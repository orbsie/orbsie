import { createHash, timingSafeEqual } from "node:crypto";
import {
  ChatGPTDeviceSessionError,
  type ChatGPTDeviceSession,
} from "./chatgpt-device-session";

type HostSession = Pick<
  ChatGPTDeviceSession,
  "start" | "getSnapshot" | "readAuthStatus" | "cancel" | "logout"
>;

type Route = {
  run(): Promise<unknown>;
};

const headers = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json",
};

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers });
}

function sameBearer(header: string | null, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = header.slice("Bearer ".length);
  if (!supplied || supplied.length > 4096) return false;
  const left = createHash("sha256").update(supplied).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function sessionFailure(error: unknown): Response {
  if (error instanceof ChatGPTDeviceSessionError) {
    const message = {
      "already-pending": "A ChatGPT sign-in attempt is already in progress.",
      cancelled: "ChatGPT sign-in was canceled.",
      expired: "The ChatGPT sign-in code expired. Start again.",
      "invalid-response": "ChatGPT returned an invalid sign-in response.",
      "start-failed": "ChatGPT sign-in could not be started.",
      "status-failed": "ChatGPT account status could not be checked.",
      "logout-failed": "ChatGPT sign-out could not be completed.",
      closed: "This ChatGPT sign-in session is closed.",
    }[error.code];
    const status =
      error.code === "already-pending"
        ? 409
        : error.code === "expired"
          ? 410
          : error.code === "closed"
            ? 503
            : 502;
    return response({ error: message }, status);
  }
  return response({ error: "ChatGPT connection could not be completed." }, 502);
}

function routeFor(
  request: Request,
  session: HostSession,
  models?: () => Promise<unknown>,
): Route | Response {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return response({ error: "Invalid request." }, 400);
  }
  if (url.search)
    return response({ error: "Query parameters are not allowed." }, 400);
  const expectedMethod = {
    "/login/start": "POST",
    "/models": "GET",
    "/login/status": "GET",
    "/login/cancel": "POST",
    "/logout": "POST",
  }[url.pathname];
  if (!expectedMethod) return response({ error: "Not found." }, 404);
  if (request.method !== expectedMethod)
    return response({ error: "Method not allowed." }, 405);
  const key = `${request.method} ${url.pathname}`;
  switch (key) {
    case "GET /models":
      return models
        ? { run: async () => ({ models: await models() }) }
        : response({ error: "Model access is unavailable." }, 503);
    case "POST /login/start":
      return { run: () => session.start() };
    case "GET /login/status":
      return {
        run: async () => {
          const authStatus = (await session.readAuthStatus()).status;
          return { ...session.getSnapshot(), authStatus };
        },
      };
    case "POST /login/cancel":
      return {
        run: async () => {
          await session.cancel();
          return session.getSnapshot();
        },
      };
    case "POST /logout":
      return {
        run: async () => {
          await session.logout();
          return session.getSnapshot();
        },
      };
    default:
      return response({ error: "Invalid request." }, 400);
  }
}

export function createChatGPTHostHandler({
  session,
  token,
  models,
}: {
  session: HostSession;
  token: string;
  models?: () => Promise<unknown>;
}): (request: Request) => Promise<Response> {
  if (
    typeof token !== "string" ||
    token.length < 32 ||
    token.length > 256 ||
    token.trim() !== token ||
    /[^\x21-\x7e]/.test(token)
  )
    throw Error("A server ChatGPT host token is required.");

  return async (request: Request) => {
    if (request.headers.has("origin"))
      return response(
        { error: "This endpoint is server-to-server only." },
        403,
      );
    if (!sameBearer(request.headers.get("authorization"), token))
      return response({ error: "Unauthorized." }, 401);
    if (request.body !== null)
      return response({ error: "Request bodies are not allowed." }, 400);

    const route = routeFor(request, session, models);
    if (route instanceof Response) return route;
    try {
      return response(await route.run());
    } catch (error) {
      return sessionFailure(error);
    }
  };
}
