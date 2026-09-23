import { validateChatGPTModels } from "@/lib/server/chatgpt-models";
import { resolve } from "node:path";
import { checkOrigin, getAuth, HttpError } from "@/lib/server/auth";
import type { readChatGPTHost } from "@/lib/server/chatgpt-host-registry";
import { createChatGPTHostManager } from "@/lib/server/chatgpt-host-manager";
import { ChatGPTHostStaleError } from "@/lib/server/chatgpt-host-service";
import {
  ChatGPTDurableServiceError,
  createChatGPTDurableService,
} from "@/lib/server/chatgpt-durable-service";
import { ChatGPTCredentialVaultError } from "@/lib/server/chatgpt-credential-vault";
import { CHATGPT_STALE_CONNECTION_CODE } from "@/lib/chatgpt-connection-errors";

export const runtime = "nodejs";
export const maxDuration = 180;

const MAX_RESPONSE_BYTES = 64 * 1024;
const VERIFICATION_URL = "https://auth.openai.com/codex/device";
const lifecycleValues = new Set([
  "idle",
  "pending",
  "completed",
  "failed",
  "cancelled",
  "expired",
]);
const authStatusValues = new Set(["unknown", "connected", "disconnected"]);
const actions = new Set(["start", "status", "cancel", "logout", "models"]);

type Identity = { ownerId: string; sessionId: string };
type Host = Awaited<ReturnType<typeof readChatGPTHost>>;
type RouteContext = { params: Promise<{ action: string }> };

class RouteFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const headers = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers });
}

function failure(status: number, message: string): never {
  throw new RouteFailure(status, message);
}

function publicError(error: unknown): Response {
  if (error instanceof RouteFailure)
    return json({ error: error.message }, error.status);
  if (error instanceof ChatGPTHostStaleError)
    return json(
      { code: CHATGPT_STALE_CONNECTION_CODE, error: error.message },
      409,
    );
  if (error instanceof ChatGPTDurableServiceError) {
    const status =
      error.code === "missing"
        ? 409
        : error.code === "revoked"
          ? 409
          : error.code === "login-pending"
            ? 409
            : error.code === "busy"
              ? 409
              : error.code === "expired" ||
                  error.code === "insufficient-headroom"
                ? 503
                : 502;
    return json(
      {
        ...(error.code === "login-pending"
          ? { code: "CHATGPT_LOGIN_PENDING" }
          : {}),
        ...(error.code === "missing" || error.code === "revoked"
          ? { code: "CHATGPT_CONNECTION_REQUIRED" }
          : {}),
        error: error.message,
      },
      status,
    );
  }
  if (error instanceof ChatGPTCredentialVaultError) {
    const status =
      error.code === "unauthorized"
        ? 401
        : error.code === "active-connection"
          ? 409
          : 502;
    return json(
      {
        error:
          status === 502
            ? "ChatGPT connection could not be completed."
            : error.message,
      },
      status,
    );
  }
  if (error instanceof HttpError) {
    const mapped =
      error.status === 401
        ? "Unauthorized."
        : error.status === 403
          ? "This request must come from your Orbsie app."
          : error.status === 503
            ? "ChatGPT hosting is unavailable."
            : "Invalid request.";
    return json(
      { error: mapped },
      error.status >= 400 && error.status < 600 ? error.status : 500,
    );
  }
  return json({ error: "ChatGPT connection could not be completed." }, 502);
}

function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function identityFromSession(value: unknown): Identity {
  if (!value || typeof value !== "object") failure(401, "Unauthorized.");
  const session = value as {
    user?: { id?: unknown };
    session?: { id?: unknown };
  };
  if (!text(session.user?.id, 256) || !text(session.session?.id, 256))
    failure(401, "Unauthorized.");
  return { ownerId: session.user.id, sessionId: session.session.id };
}

async function authenticate(request: Request): Promise<Identity> {
  const auth = getAuth();
  if (!auth) failure(503, "ChatGPT hosting is unavailable.");
  let session: unknown;
  try {
    session = await auth.api.getSession({ headers: request.headers });
  } catch {
    failure(503, "ChatGPT hosting is unavailable.");
  }
  return identityFromSession(session);
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response || typeof response.body?.getReader !== "function")
    failure(502, "ChatGPT host is unavailable.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let complete = false;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        complete = true;
        break;
      }
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES)
        failure(502, "ChatGPT host is unavailable.");
      chunks.push(next.value);
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!response.ok) failure(502, "ChatGPT host is unavailable.");
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    failure(502, "ChatGPT host is unavailable.");
  }
  return value;
}

function challenge(value: unknown) {
  if (!value || typeof value !== "object")
    failure(502, "ChatGPT host returned an invalid response.");
  const source = value as Record<string, unknown>;
  if (
    !text(source.loginId, 512) ||
    !text(source.userCode, 256) ||
    source.verificationUrl !== VERIFICATION_URL ||
    !Number.isSafeInteger(source.expiresAt) ||
    (source.expiresAt as number) <= 0
  )
    failure(502, "ChatGPT host returned an invalid response.");
  return {
    userCode: source.userCode,
    verificationUrl: VERIFICATION_URL,
    expiresAt: source.expiresAt,
  };
}

function snapshot(value: unknown) {
  if (!value || typeof value !== "object")
    failure(502, "ChatGPT host returned an invalid response.");
  const source = value as Record<string, unknown>;
  if (
    !lifecycleValues.has(source.lifecycle as string) ||
    !authStatusValues.has(source.authStatus as string)
  )
    failure(502, "ChatGPT host returned an invalid response.");
  const result: Record<string, unknown> = {
    lifecycle: source.lifecycle,
    authStatus: source.authStatus,
  };
  if (source.pending !== undefined) {
    if (source.lifecycle !== "pending")
      failure(502, "ChatGPT host returned an invalid response.");
    result.pending = challenge(source.pending);
  }
  return result;
}

function disconnected() {
  return { lifecycle: "idle", authStatus: "disconnected" } as const;
}

async function hostResponse(
  manager: ReturnType<typeof createChatGPTHostManager>,
  host: NonNullable<Host>,
  operation: "models" | "status" | "start" | "cancel" | "logout",
) {
  return readResponse(await manager.request(host, operation));
}

async function requireEmptyBody(request: Request) {
  if (!request.body) return;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        for (;;) {
          const next = await reader.read();
          if (next.done) return;
          if (next.value.byteLength)
            failure(400, "Request bodies are not allowed.");
        }
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new RouteFailure(408, "Request timed out.")),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function run(
  request: Request,
  method: "GET" | "POST",
  context: RouteContext,
) {
  const routeDeadlineAt = Date.now() + maxDuration * 1000;
  if (process.env.ORBSIE_CHATGPT_HOSTED !== "1")
    return json({ error: "Not found." }, 404);

  let action: string;
  try {
    action = (await context.params).action;
  } catch {
    return json({ error: "Not found." }, 404);
  }
  if (!actions.has(action)) return json({ error: "Not found." }, 404);
  const expected = ["status", "models"].includes(action) ? "GET" : "POST";
  if (method !== expected) return json({ error: "Method not allowed." }, 405);

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  if (url.search)
    return json(
      { error: "Query parameters and request bodies are not allowed." },
      400,
    );
  if (method === "POST") checkOrigin(request);
  await requireEmptyBody(request);

  const identity = await authenticate(request);
  const manager = createChatGPTHostManager({
    artifactDirectory: resolve(process.cwd(), ".orbsie/chatgpt-host"),
  });
  const durable = createChatGPTDurableService({ manager });

  if (action === "models") {
    const durableModels = await durable.models(
      identity,
      request.signal,
      routeDeadlineAt,
    );
    if (durableModels) return json({ models: durableModels });
    if (!(await durable.legacyAccessAllowed(identity, request.signal)))
      failure(409, "Connect your ChatGPT account first.");
    const host = await manager.read(identity);
    if (!host) failure(409, "Connect your ChatGPT account first.");
    const value = await hostResponse(manager, host, "models");
    const models = validateChatGPTModels(
      value && typeof value === "object"
        ? (value as { models?: unknown }).models
        : undefined,
    );
    return json({ models });
  }
  if (action === "status") {
    const restored = await durable.status(
      identity,
      request.signal,
      routeDeadlineAt,
    );
    if (restored) return json(restored);
    if (!(await durable.legacyAccessAllowed(identity, request.signal)))
      return json(disconnected());
    const host = await manager.read(identity);
    if (!host) return json(disconnected());
    const value = await hostResponse(manager, host, "status");
    if (
      value &&
      typeof value === "object" &&
      (value as Record<string, unknown>).lifecycle === "completed" &&
      (value as Record<string, unknown>).authStatus === "connected"
    ) {
      const completed = await durable.completeAdmittedLogin(
        identity,
        host,
        request.signal,
      );
      if (!completed)
        await durable.migrateLegacyLogin(identity, host, request.signal);
    }
    return json(snapshot(value));
  }

  if (action === "start") {
    const admitted = await durable.start(identity, request.signal);
    try {
      return json(
        challenge(
          await hostResponse(
            manager,
            admitted.host as NonNullable<Host>,
            "start",
          ),
        ),
      );
    } catch (error) {
      await durable
        .cancelIntent(identity, admitted.intent.epoch)
        .catch(() => undefined);
      await manager.disconnect(identity).catch(() => undefined);
      throw error;
    }
  }

  let host: NonNullable<Host> | null = null;
  let remoteFailed = false;
  let durableRevoked = false;
  let capturedOwnerHosts: Parameters<
    typeof manager.disconnectCapturedHosts
  >[0] = [];
  try {
    host = await manager.read(identity);
  } catch (error) {
    // A stale runtime may still be explicitly disconnected, but must never
    // receive a cancel/logout RPC from a newer deployment.
    if (!(error instanceof ChatGPTHostStaleError)) remoteFailed = true;
  }
  let remote: unknown;
  if (action === "logout") {
    // Revoke before any provider call. A slow/failed remote logout must not
    // leave a cache that a new browser session can restore.
    const revocation = await durable.disconnect(identity);
    durableRevoked = revocation.revoked;
    capturedOwnerHosts = revocation.hosts;
  }
  if (host && !(action === "logout" && durableRevoked)) {
    try {
      remote = await hostResponse(manager, host, action as "cancel" | "logout");
    } catch {
      remoteFailed = true;
    }
  }
  let disconnectedHost = false;
  try {
    if (action === "logout")
      await manager.disconnectCapturedHosts(capturedOwnerHosts);
    else disconnectedHost = await manager.disconnect(identity);
  } catch {
    throw new RouteFailure(502, "ChatGPT host cleanup could not be completed.");
  }
  if (remoteFailed)
    throw new RouteFailure(502, "ChatGPT request could not be completed.");
  if (action === "logout") return json(disconnected());
  if (action === "cancel")
    await durable.cancelIntent(identity).catch(() => undefined);
  if (!host || disconnectedHost) return json(disconnected());
  return json(snapshot(remote));
}

export function GET(request: Request, context: RouteContext) {
  return run(request, "GET", context).catch(publicError);
}

export function POST(request: Request, context: RouteContext) {
  return run(request, "POST", context).catch(publicError);
}
