import { createHash, timingSafeEqual } from "node:crypto";
import {
  ChatGPTDeviceSessionError,
  type ChatGPTDeviceSession,
} from "./chatgpt-device-session";
import {
  ChatGPTManagedOperationError,
  type ChatGPTManagedOperationController,
  type ChatGPTManagedOperationInitialize,
  type ManagedOperationBinding,
} from "./chatgpt-managed-operation";
import { CHATGPT_MANAGED_CREDENTIAL_CACHE_MAX_BYTES } from "./chatgpt-managed-credential-store";
import {
  validatedClientRunId,
  validatedGenerationRequestId,
  type GenerationObservationCorrelation,
} from "./generation-observability";
import {
  PRIVATE_SCENE_COMPLETION_HEADER,
  PRIVATE_SCENE_COMPLETION_VERSION,
} from "./chatgpt-scene-completion";
import {
  PRIVATE_SCENE_REVIEW_HEADER,
  PRIVATE_SCENE_REVIEW_VERSION,
  parsePrivateSceneReviewRequest,
} from "./chatgpt-scene-review";

type HostSession = Pick<
  ChatGPTDeviceSession,
  "start" | "getSnapshot" | "readAuthStatus" | "cancel" | "logout"
>;

type Route = {
  run(): Promise<unknown>;
};

type LegacyOperation = <T>(operation: () => Promise<T>) => Promise<T>;

export type ChatGPTPrivateLoginSeal = (
  signal: AbortSignal,
) => Promise<Uint8Array>;

export class ChatGPTPrivateLoginSealError extends Error {
  constructor(
    public readonly code:
      "pending" | "unverified" | "managed" | "busy" | "closed" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "ChatGPTPrivateLoginSealError";
  }
}

const headers = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json",
};
const PRIVATE_CONTROL_BODY_MAX_BYTES = 128 * 1024;
const PRIVATE_GENERATION_BODY_MAX_BYTES = 512 * 1024;
const PRIVATE_REVIEW_BODY_MAX_BYTES = 512 * 1024;
const PRIVATE_RESPONSE_MAX_BYTES = 256 * 1024;

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
  if (error instanceof ChatGPTPrivateLoginSealError)
    return privateLoginSealFailure(error);
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

function managedOperationFailure(error: unknown): Response {
  if (error instanceof ChatGPTPrivateLoginSealError)
    return privateLoginSealFailure(error);
  if (error instanceof ChatGPTManagedOperationError) {
    const status =
      error.code === "busy"
        ? 409
        : error.code === "expired"
          ? 410
          : error.code === "stale" || error.code === "replay"
            ? 409
            : error.code === "invalid"
              ? 400
              : error.code === "aborted"
                ? 408
                : 503;
    const message =
      error.code === "busy"
        ? "Another private ChatGPT operation is active."
        : error.code === "expired"
          ? "The private ChatGPT operation has expired."
          : error.code === "stale" || error.code === "replay"
            ? "The private ChatGPT operation is stale."
            : error.code === "invalid"
              ? "The private ChatGPT operation request is invalid."
              : error.code === "aborted"
                ? "The private ChatGPT operation was canceled."
                : "The private ChatGPT operation is unavailable.";
    return response({ error: message }, status);
  }
  return response(
    { error: "The private ChatGPT operation is unavailable." },
    503,
  );
}

function privateLoginSealFailure(error: unknown): Response {
  if (error instanceof ChatGPTPrivateLoginSealError) {
    const status =
      error.code === "pending" ||
      error.code === "unverified" ||
      error.code === "managed"
        ? 409
        : error.code === "busy"
          ? 409
          : error.code === "closed"
            ? 410
            : 503;
    const message =
      error.code === "pending"
        ? "Complete or cancel the ChatGPT sign-in before saving it."
        : error.code === "unverified"
          ? "Verify the ChatGPT connection before saving it."
          : error.code === "managed"
            ? "The ChatGPT connection is already managed by another operation."
            : error.code === "busy"
              ? "Another ChatGPT connection operation is active."
              : error.code === "closed"
                ? "This ChatGPT connection is already sealed."
                : "The ChatGPT connection could not be sealed.";
    return response({ error: message }, status);
  }
  return response(
    { error: "The ChatGPT connection could not be sealed." },
    503,
  );
}

function privateJSON(
  value: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  let body: string;
  try {
    body = JSON.stringify(value);
  } catch {
    return response({ error: "The private ChatGPT response is invalid." }, 502);
  }
  if (Buffer.byteLength(body) > PRIVATE_RESPONSE_MAX_BYTES)
    return response(
      { error: "The private ChatGPT response is too large." },
      502,
    );
  return new Response(body, {
    status,
    headers: { ...headers, ...(extraHeaders ?? {}) },
  });
}

async function readJSON(
  request: Request,
  maxBytes: number,
): Promise<{ value?: unknown; error?: Response }> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    return { error: response({ error: "JSON required." }, 415) };
  const reader = request.body?.getReader();
  if (!reader) return { error: response({ error: "Invalid request." }, 400) };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { error: response({ error: "Request too large." }, 413) };
      }
      chunks.push(part.value);
    }
  } catch {
    return { error: response({ error: "Invalid request." }, 400) };
  } finally {
    reader.releaseLock();
  }
  const raw = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
    };
  } catch {
    return { error: response({ error: "Invalid JSON." }, 400) };
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function operationBinding(value: unknown): ManagedOperationBinding | null {
  const item = record(value);
  if (!item) return null;
  return {
    operationId: item.operationId as string,
    epoch: item.epoch as number,
  };
}

function operationCorrelation(
  headers: Headers,
): GenerationObservationCorrelation | undefined {
  const rawRequestId = headers.get("x-orbsie-request-id");
  const rawClientRunId = headers.get("x-orbsie-client-run-id");
  if (rawRequestId === null && rawClientRunId === null) return undefined;
  const requestId = validatedGenerationRequestId(rawRequestId);
  if (!requestId)
    throw new ChatGPTManagedOperationError(
      "invalid",
      "The private operation correlation is invalid.",
    );
  const clientRunId =
    rawClientRunId === null ? undefined : validatedClientRunId(rawClientRunId);
  if (rawClientRunId !== null && !clientRunId)
    throw new ChatGPTManagedOperationError(
      "invalid",
      "The private operation correlation is invalid.",
    );
  return { requestId, ...(clientRunId ? { clientRunId } : {}) };
}

function requestedSceneCompletionVersion(headers: Headers) {
  const value = headers.get(PRIVATE_SCENE_COMPLETION_HEADER);
  if (value === null) return undefined;
  if (value !== String(PRIVATE_SCENE_COMPLETION_VERSION))
    throw new ChatGPTManagedOperationError(
      "invalid",
      "The private scene completion version is invalid.",
    );
  return PRIVATE_SCENE_COMPLETION_VERSION;
}

function decodeCache(value: unknown): Uint8Array | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length >
      Math.ceil(CHATGPT_MANAGED_CREDENTIAL_CACHE_MAX_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    throw new ChatGPTManagedOperationError(
      "invalid",
      "The private ChatGPT credential cache is invalid.",
    );
  const cache = Buffer.from(value, "base64");
  if (
    cache.length === 0 ||
    cache.length > CHATGPT_MANAGED_CREDENTIAL_CACHE_MAX_BYTES ||
    cache.toString("base64") !== value
  )
    throw new ChatGPTManagedOperationError(
      "invalid",
      "The private ChatGPT credential cache is invalid.",
    );
  return Uint8Array.from(cache);
}

function routeFor(
  request: Request,
  session: HostSession,
  models?: () => Promise<unknown>,
  beforeDisconnect?: () => void,
  withLegacyLock: LegacyOperation = async <T>(operation: () => Promise<T>) =>
    operation(),
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
        ? {
            run: () => withLegacyLock(async () => ({ models: await models() })),
          }
        : response({ error: "Model access is unavailable." }, 503);
    case "POST /login/start":
      return { run: () => withLegacyLock(() => session.start()) };
    case "GET /login/status":
      return {
        run: () =>
          withLegacyLock(async () => {
            const authStatus = (await session.readAuthStatus()).status;
            return { ...session.getSnapshot(), authStatus };
          }),
      };
    case "POST /login/cancel":
      return {
        run: () =>
          withLegacyLock(async () => {
            beforeDisconnect?.();
            await session.cancel();
            return session.getSnapshot();
          }),
      };
    case "POST /logout":
      return {
        run: () =>
          withLegacyLock(async () => {
            beforeDisconnect?.();
            await session.logout();
            return session.getSnapshot();
          }),
      };
    default:
      return response({ error: "Invalid request." }, 400);
  }
}

export function createChatGPTHostHandler({
  session,
  token,
  models,
  generate,
  beforeDisconnect,
  managedOperation,
  privateLoginSeal,
  beforeManagedInitialize,
  legacyRouteAllowed,
  withLegacyLock,
}: {
  session: HostSession;
  token: string;
  models?: () => Promise<unknown>;
  generate?: (
    input: unknown,
    signal: AbortSignal,
  ) => ReadableStream<Uint8Array>;
  beforeDisconnect?: () => void;
  managedOperation?: ChatGPTManagedOperationController;
  privateLoginSeal?: ChatGPTPrivateLoginSeal;
  beforeManagedInitialize?: (signal: AbortSignal) => Promise<void>;
  legacyRouteAllowed?: () => boolean;
  withLegacyLock?: LegacyOperation;
}): (request: Request) => Promise<Response> {
  if (
    typeof token !== "string" ||
    token.length < 32 ||
    token.length > 256 ||
    token.trim() !== token ||
    /[^\x21-\x7e]/.test(token)
  )
    throw Error("A server ChatGPT host token is required.");

  let negotiatedSceneCompletionVersion:
    typeof PRIVATE_SCENE_COMPLETION_VERSION | undefined;
  let negotiatedSceneReviewVersion:
    typeof PRIVATE_SCENE_REVIEW_VERSION | undefined;
  let negotiatedSceneReviewBinding: ManagedOperationBinding | undefined;
  return async (request: Request) => {
    if (request.headers.has("origin"))
      return response(
        { error: "This endpoint is server-to-server only." },
        403,
      );
    if (!sameBearer(request.headers.get("authorization"), token))
      return response({ error: "Unauthorized." }, 401);
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return response({ error: "Invalid request." }, 400);
    }
    if (url.pathname === "/private/login/seal") {
      if (!privateLoginSeal)
        return response(
          { error: "Private login sealing is unavailable." },
          503,
        );
      if (request.method !== "POST")
        return response({ error: "Method not allowed." }, 405);
      if (url.search)
        return response({ error: "Query parameters are not allowed." }, 400);
      const parsed = await readJSON(request, PRIVATE_CONTROL_BODY_MAX_BYTES);
      if (parsed.error) return parsed.error;
      const value = record(parsed.value);
      if (!value || Object.keys(value).length !== 0)
        return response({ error: "Invalid request." }, 400);
      try {
        const cache = await privateLoginSeal(request.signal);
        if (
          !(cache instanceof Uint8Array) ||
          cache.byteLength === 0 ||
          cache.byteLength > CHATGPT_MANAGED_CREDENTIAL_CACHE_MAX_BYTES
        )
          throw new ChatGPTPrivateLoginSealError(
            "unavailable",
            "The ChatGPT credential cache is unavailable.",
          );
        return privateJSON({ cache: Buffer.from(cache).toString("base64") });
      } catch (error) {
        return privateLoginSealFailure(error);
      }
    }
    if (url.pathname.startsWith("/private/operation/")) {
      if (!managedOperation)
        return response({ error: "Private operations are unavailable." }, 503);
      if (request.method !== "POST")
        return response({ error: "Method not allowed." }, 405);
      if (url.search)
        return response({ error: "Query parameters are not allowed." }, 400);
      const isPrivateGeneration =
        url.pathname === "/private/operation/generate";
      const isPrivateReview = url.pathname === "/private/operation/review";
      const parsed = await readJSON(
        request,
        isPrivateGeneration || isPrivateReview
          ? isPrivateReview
            ? PRIVATE_REVIEW_BODY_MAX_BYTES
            : PRIVATE_GENERATION_BODY_MAX_BYTES
          : PRIVATE_CONTROL_BODY_MAX_BYTES,
      );
      if (parsed.error) return parsed.error;
      const value = record(parsed.value);
      if (!value) return response({ error: "Invalid request." }, 400);
      try {
        if (url.pathname === "/private/operation/initialize") {
          const allowed = [
            "operationId",
            "epoch",
            "deadlineAt",
            "initialCredentialCache",
          ];
          if (Object.keys(value).some((key) => !allowed.includes(key)))
            throw new ChatGPTManagedOperationError(
              "invalid",
              "Invalid operation request.",
            );
          const initialCredentialCache = decodeCache(
            value.initialCredentialCache,
          );
          await beforeManagedInitialize?.(request.signal);
          const initialized = await managedOperation.initialize(
            {
              operationId: value.operationId as string,
              epoch: value.epoch as number,
              deadlineAt: value.deadlineAt as number,
              initialCredentialCache,
            },
            request.signal,
          );
          negotiatedSceneCompletionVersion = undefined;
          negotiatedSceneReviewVersion = undefined;
          negotiatedSceneReviewBinding = undefined;
          return privateJSON(initialized);
        }
        const binding = operationBinding(value);
        if (!binding)
          throw new ChatGPTManagedOperationError(
            "invalid",
            "Invalid operation identity.",
          );
        if (url.pathname === "/private/operation/status") {
          if (
            Object.keys(value).some(
              (key) => !["operationId", "epoch"].includes(key),
            )
          )
            throw new ChatGPTManagedOperationError(
              "invalid",
              "Invalid operation request.",
            );
          const completionVersion = requestedSceneCompletionVersion(
            request.headers,
          );
          const reviewHeader = request.headers.get(PRIVATE_SCENE_REVIEW_HEADER);
          if (
            reviewHeader !== null &&
            reviewHeader !== String(PRIVATE_SCENE_REVIEW_VERSION)
          )
            throw new ChatGPTManagedOperationError(
              "invalid",
              "The private scene review version is invalid.",
            );
          const status = await managedOperation.status(binding, request.signal);
          request.signal.throwIfAborted();
          if (completionVersion !== undefined)
            negotiatedSceneCompletionVersion = completionVersion;
          if (reviewHeader !== null)
            negotiatedSceneReviewVersion = PRIVATE_SCENE_REVIEW_VERSION;
          if (reviewHeader !== null)
            negotiatedSceneReviewBinding = {
              operationId: binding.operationId,
              epoch: binding.epoch,
            };
          return privateJSON(status, 200, {
            ...(completionVersion === undefined
              ? {}
              : {
                  [PRIVATE_SCENE_COMPLETION_HEADER]: String(completionVersion),
                }),
            ...(reviewHeader === null
              ? {}
              : { [PRIVATE_SCENE_REVIEW_HEADER]: reviewHeader }),
          });
        }
        if (url.pathname === "/private/operation/models") {
          if (
            Object.keys(value).some(
              (key) => !["operationId", "epoch"].includes(key),
            )
          )
            throw new ChatGPTManagedOperationError(
              "invalid",
              "Invalid operation request.",
            );
          return privateJSON({
            models: await managedOperation.models(binding, request.signal),
          });
        }
        if (url.pathname === "/private/operation/generate") {
          if (
            Object.keys(value).some(
              (key) => !["operationId", "epoch", "input"].includes(key),
            ) ||
            !Object.hasOwn(value, "input")
          )
            throw new ChatGPTManagedOperationError(
              "invalid",
              "Invalid operation request.",
            );
          const completionVersion = requestedSceneCompletionVersion(
            request.headers,
          );
          if (completionVersion !== negotiatedSceneCompletionVersion)
            throw new ChatGPTManagedOperationError(
              "invalid",
              "The private scene completion version was not negotiated.",
            );
          const stream = await managedOperation.generate(
            binding,
            value.input,
            request.signal,
            operationCorrelation(request.headers),
            completionVersion,
          );
          return new Response(stream, {
            headers: {
              "Content-Type": "application/x-ndjson",
              "Cache-Control": "private, no-store",
              "X-Accel-Buffering": "no",
              ...(completionVersion === undefined
                ? {}
                : {
                    [PRIVATE_SCENE_COMPLETION_HEADER]:
                      String(completionVersion),
                  }),
            },
          });
        }
        if (url.pathname === "/private/operation/review") {
          if (negotiatedSceneReviewVersion !== PRIVATE_SCENE_REVIEW_VERSION)
            throw new ChatGPTManagedOperationError(
              "invalid",
              "The private scene review version was not negotiated.",
            );
          if (
            !negotiatedSceneReviewBinding ||
            negotiatedSceneReviewBinding.operationId !== binding.operationId ||
            negotiatedSceneReviewBinding.epoch !== binding.epoch
          )
            throw new ChatGPTManagedOperationError(
              "stale",
              "The managed ChatGPT operation is stale.",
            );
          if (
            request.headers.get(PRIVATE_SCENE_REVIEW_HEADER) !==
            String(PRIVATE_SCENE_REVIEW_VERSION)
          )
            throw new ChatGPTManagedOperationError(
              "invalid",
              "The private scene review version was not negotiated.",
            );
          if (typeof managedOperation.review !== "function")
            return response(
              { error: "Private scene review is unavailable." },
              503,
            );
          let reviewRequest;
          try {
            reviewRequest = parsePrivateSceneReviewRequest(value);
          } catch {
            throw new ChatGPTManagedOperationError(
              "invalid",
              "Invalid private scene review request.",
            );
          }
          if (
            reviewRequest.operationId !== binding.operationId ||
            reviewRequest.epoch !== binding.epoch
          )
            throw new ChatGPTManagedOperationError(
              "stale",
              "The managed ChatGPT operation is stale.",
            );
          const result = await managedOperation.review(
            binding,
            reviewRequest,
            request.signal,
            operationCorrelation(request.headers),
          );
          return privateJSON(result, 200, {
            [PRIVATE_SCENE_REVIEW_HEADER]: String(PRIVATE_SCENE_REVIEW_VERSION),
          });
        }
        if (url.pathname === "/private/operation/seal") {
          if (
            Object.keys(value).some(
              (key) => !["operationId", "epoch"].includes(key),
            )
          )
            throw new ChatGPTManagedOperationError(
              "invalid",
              "Invalid operation request.",
            );
          const sealed = await managedOperation.seal(binding, request.signal);
          return privateJSON({
            operationId: sealed.operationId,
            epoch: sealed.epoch,
            deadlineAt: sealed.deadlineAt,
            expired: sealed.expired,
            cache: sealed.cache
              ? Buffer.from(sealed.cache).toString("base64")
              : null,
          });
        }
        if (url.pathname === "/private/operation/clear") {
          if (
            Object.keys(value).some(
              (key) => !["operationId", "epoch"].includes(key),
            )
          )
            throw new ChatGPTManagedOperationError(
              "invalid",
              "Invalid operation request.",
            );
          await managedOperation.clear(binding);
          negotiatedSceneCompletionVersion = undefined;
          negotiatedSceneReviewVersion = undefined;
          negotiatedSceneReviewBinding = undefined;
          return privateJSON({ cleared: true });
        }
        return response({ error: "Not found." }, 404);
      } catch (error) {
        return managedOperationFailure(error);
      }
    }
    if (
      (legacyRouteAllowed && !legacyRouteAllowed()) ||
      (!legacyRouteAllowed && managedOperation?.hasActiveOperation())
    )
      return response(
        { error: "The private ChatGPT operation must be used." },
        409,
      );
    if (url.pathname === "/generate") {
      if (request.method !== "POST")
        return response({ error: "Method not allowed." }, 405);
      if (url.search)
        return response({ error: "Query parameters are not allowed." }, 400);
      if (!generate)
        return response({ error: "Generation is unavailable." }, 503);
      if (
        request.headers.get("content-type")?.split(";")[0].trim() !==
        "application/json"
      )
        return response({ error: "JSON required." }, 415);
      try {
        const reader = request.body?.getReader();
        if (!reader) return response({ error: "Invalid request." }, 400);
        let bytes = 0;
        const chunks: Uint8Array[] = [];
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > 512 * 1024)
              return response({ error: "Request too large." }, 413);
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
        const raw = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) {
          raw.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const input = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(raw),
        );
        const stream = withLegacyLock
          ? await withLegacyLock(() =>
              Promise.resolve(generate(input, request.signal)),
            )
          : generate(input, request.signal);
        return new Response(stream, {
          headers: {
            "Content-Type": "application/x-ndjson",
            "Cache-Control": "private, no-store",
            "X-Accel-Buffering": "no",
          },
        });
      } catch (error) {
        if (error instanceof ChatGPTPrivateLoginSealError)
          return privateLoginSealFailure(error);
        return response({ error: "Invalid generation request." }, 400);
      }
    }
    if (request.body !== null)
      return response({ error: "Request bodies are not allowed." }, 400);

    const route = routeFor(
      request,
      session,
      models,
      beforeDisconnect,
      withLegacyLock,
    );
    if (route instanceof Response) return route;
    try {
      return response(await route.run());
    } catch (error) {
      return sessionFailure(error);
    }
  };
}
