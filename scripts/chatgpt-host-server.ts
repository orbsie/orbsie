import { Readable } from "node:stream";
import { once } from "node:events";
import { createChatGPTGeneration } from "../src/lib/server/chatgpt-generation";
import { createChatGPTSceneStream } from "../src/lib/server/chatgpt-scene-stream";
import { listChatGPTModels } from "../src/lib/server/chatgpt-models";
import { createServer } from "node:http";
import { createIsolatedChatGPTRpc } from "../src/lib/server/chatgpt-runtime";
import { ChatGPTDeviceSession } from "../src/lib/server/chatgpt-device-session";
import {
  ChatGPTPrivateLoginSealError,
  createChatGPTHostHandler,
} from "../src/lib/server/chatgpt-host";
import { createChatGPTManagedOperationController } from "../src/lib/server/chatgpt-managed-operation";

/** The host process must never outlive the registry's absolute host cap. */
export const CHATGPT_HOST_PROCESS_MAX_LIFETIME_MS = 40 * 60 * 1000;

/** One private host process per owner session; never a shared account service. */
export async function startChatGPTHostServer(options: {
  token: string;
  hostname?: string;
  port?: number;
  allowGeneration?: boolean;
  setTimeoutFn?: typeof setTimeout;
}) {
  if (
    typeof options.token !== "string" ||
    options.token.length < 32 ||
    options.token.length > 256 ||
    /[^\x21-\x7e]/.test(options.token)
  )
    throw Error("A private host capability is required.");
  const rpc = await createIsolatedChatGPTRpc({
    allowGeneration: options.allowGeneration,
  });
  const session = new ChatGPTDeviceSession({
    ownerId: "isolated-host",
    sessionId: crypto.randomUUID(),
    rpc,
  });
  const activeRequests = new Set<AbortController>();
  const activeGenerations = new Set<AbortController>();
  const stopGeneration = () => {
    for (const controller of activeGenerations) controller.abort();
  };
  const generator = options.allowGeneration
    ? createChatGPTGeneration({
        rpc,
        models: () => listChatGPTModels(rpc, session),
        dispose: () => rpc.close(),
      })
    : undefined;
  const managedOperation = createChatGPTManagedOperationController({
    createRuntime: (runtimeOptions) => createIsolatedChatGPTRpc(runtimeOptions),
  });
  let managedAdopted = false;
  let legacyQueue = Promise.resolve();
  const withLegacyLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = legacyQueue;
    let release!: () => void;
    legacyQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
  const withPublicLegacyLock = <T>(operation: () => Promise<T>) =>
    withLegacyLock(async () => {
      if (managedAdopted)
        throw new ChatGPTPrivateLoginSealError(
          "managed",
          "The ChatGPT connection is already managed.",
        );
      return operation();
    });
  let legacyLifecycle: "available" | "sealing" | "sealed" = "available";
  let legacyTerminationStarted = false;
  let legacyRuntimeClosed = false;
  const stopLegacy = async (
    signal: AbortSignal,
    includeCache: boolean,
  ): Promise<Uint8Array | null> => {
    if (legacyLifecycle === "sealed") {
      if (includeCache)
        throw new ChatGPTPrivateLoginSealError(
          "closed",
          "The legacy ChatGPT login is already sealed.",
        );
      managedAdopted = true;
      return null;
    }
    if (legacyLifecycle === "sealing")
      throw new ChatGPTPrivateLoginSealError(
        "busy",
        "Another legacy ChatGPT login operation is active.",
      );
    legacyLifecycle = "sealing";
    try {
      signal.throwIfAborted();
      stopGeneration();
      await session.close();
      legacyTerminationStarted = true;
      // From this point onward the legacy session is never admitted again,
      // even if process termination or snapshot retrieval fails.
      managedAdopted = true;
      await rpc.close();
      legacyRuntimeClosed = true;
      legacyLifecycle = "sealed";
      if (!includeCache) return null;
      const snapshot = await rpc.getCredentialSnapshot();
      if (!snapshot?.cache || snapshot.cache.byteLength === 0)
        throw new ChatGPTPrivateLoginSealError(
          "unavailable",
          "The ChatGPT credential cache is unavailable.",
        );
      const cache = Uint8Array.from(snapshot.cache);
      signal.throwIfAborted();
      return cache;
    } catch (error) {
      if (legacyRuntimeClosed) legacyLifecycle = "sealed";
      else if (legacyTerminationStarted) legacyLifecycle = "sealing";
      else legacyLifecycle = "available";
      if (error instanceof ChatGPTPrivateLoginSealError) throw error;
      throw new ChatGPTPrivateLoginSealError(
        "unavailable",
        "The legacy ChatGPT login could not be sealed.",
      );
    }
  };
  const privateLoginSeal = (signal: AbortSignal): Promise<Uint8Array> =>
    withLegacyLock(async () => {
      if (legacyLifecycle === "sealed")
        throw new ChatGPTPrivateLoginSealError(
          "closed",
          "The legacy ChatGPT login is already sealed.",
        );
      if (legacyLifecycle === "sealing")
        throw new ChatGPTPrivateLoginSealError(
          "busy",
          "Another legacy ChatGPT login operation is active.",
        );
      if (managedOperation.hasActiveOperation() || managedAdopted)
        throw new ChatGPTPrivateLoginSealError(
          "managed",
          "A managed ChatGPT operation is already active.",
        );
      const before = session.getSnapshot();
      if (before.lifecycle === "pending")
        throw new ChatGPTPrivateLoginSealError(
          "pending",
          "The ChatGPT device login is still pending.",
        );
      if (before.lifecycle !== "completed")
        throw new ChatGPTPrivateLoginSealError(
          "unverified",
          "The ChatGPT device login has not been verified.",
        );
      if ((await session.readAuthStatus()).status !== "connected")
        throw new ChatGPTPrivateLoginSealError(
          "unverified",
          "The ChatGPT account is not connected.",
        );
      const cache = await stopLegacy(signal, true);
      if (!cache)
        throw new ChatGPTPrivateLoginSealError(
          "unavailable",
          "The ChatGPT credential cache is unavailable.",
        );
      return cache;
    });
  const beforeManagedInitialize = (signal: AbortSignal) =>
    withLegacyLock(async () => {
      signal.throwIfAborted();
      if (legacyLifecycle === "sealing")
        throw new ChatGPTPrivateLoginSealError(
          "busy",
          "Another ChatGPT connection operation is active.",
        );
      if (activeGenerations.size > 0)
        throw new ChatGPTPrivateLoginSealError(
          "busy",
          "A legacy ChatGPT generation is still active.",
        );
      if (legacyLifecycle === "sealed") {
        managedAdopted = true;
        return;
      }
      const before = session.getSnapshot();
      if (before.lifecycle === "pending")
        throw new ChatGPTPrivateLoginSealError(
          "pending",
          "Complete or cancel the ChatGPT sign-in before restoring it.",
        );
      if (before.lifecycle === "completed" || before.authStatus === "connected")
        throw new ChatGPTPrivateLoginSealError(
          "managed",
          "Seal the existing ChatGPT login before restoring it.",
        );
      if (before.authStatus === "unknown") {
        let status: "connected" | "disconnected";
        try {
          status = (await session.readAuthStatus()).status as
            "connected" | "disconnected";
        } catch {
          throw new ChatGPTPrivateLoginSealError(
            "unverified",
            "The existing ChatGPT connection could not be verified.",
          );
        }
        if (status === "connected")
          throw new ChatGPTPrivateLoginSealError(
            "managed",
            "Seal the existing ChatGPT login before restoring it.",
          );
      }
      await stopLegacy(signal, false);
    });
  const handle = createChatGPTHostHandler({
    session,
    token: options.token,
    models: () => listChatGPTModels(rpc, session),
    beforeDisconnect: stopGeneration,
    managedOperation,
    privateLoginSeal,
    beforeManagedInitialize,
    legacyRouteAllowed: () => !managedAdopted,
    withLegacyLock: withPublicLegacyLock,
    ...(generator
      ? {
          generate: (input: unknown, signal: AbortSignal) =>
            createChatGPTSceneStream(input, generator, signal),
        }
      : {}),
  });
  const server = createServer(async (incoming, outgoing) => {
    const controller = new AbortController();
    const isGeneration =
      incoming.url === "/generate" && incoming.method === "POST";
    const isPrivateRequest =
      incoming.method === "POST" &&
      ((incoming.url?.startsWith("/private/operation/") ?? false) ||
        (incoming.url?.startsWith("/private/login/seal") ?? false));
    const carriesBody = isGeneration || isPrivateRequest;
    if (carriesBody) activeRequests.add(controller);
    if (isGeneration) activeGenerations.add(controller);
    outgoing.once("close", () => {
      if (!outgoing.writableFinished) controller.abort();
    });
    incoming.once("aborted", () => controller.abort());
    try {
      // Auth endpoints accept no payload. Reject without buffering input.
      if (
        !carriesBody &&
        (incoming.headers["transfer-encoding"] ||
          (incoming.headers["content-length"] &&
            incoming.headers["content-length"] !== "0"))
      ) {
        outgoing.writeHead(400, {
          "Cache-Control": "private, no-store",
          Connection: "close",
        });
        outgoing.end();
        return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value))
          for (const item of value) headers.append(name, item);
        else if (value !== undefined) headers.set(name, value);
      }
      const path = incoming.url ?? "/";
      if (!path.startsWith("/") || path.startsWith("//")) throw Error();
      const response = await handle(
        new Request(`http://orbsie-host.invalid${path}`, {
          method: incoming.method,
          headers,
          signal: controller.signal,
          ...(carriesBody
            ? {
                body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
                duplex: "half",
              }
            : {}),
        } as RequestInit),
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      const reader = response.body?.getReader();
      try {
        if (reader)
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            controller.signal.throwIfAborted();
            if (!outgoing.write(part.value))
              await once(outgoing, "drain", { signal: controller.signal });
          }
        outgoing.end();
      } finally {
        await reader?.cancel().catch(() => undefined);
        reader?.releaseLock();
      }
    } catch {
      if (!outgoing.headersSent)
        outgoing.writeHead(500, { "Cache-Control": "private, no-store" });
      outgoing.end();
    } finally {
      controller.abort();
      activeRequests.delete(controller);
      activeGenerations.delete(controller);
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  let closing: Promise<void> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let maintenance: ReturnType<typeof setInterval> | undefined;
  const close = () =>
    (closing ??= (async () => {
      stopGeneration();
      for (const controller of activeRequests) controller.abort();
      clearTimeout(expiry);
      clearInterval(maintenance);
      server.close();
      server.closeAllConnections();
      try {
        await managedOperation.close();
        await session.close();
      } finally {
        await rpc.close();
      }
    })());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, options.hostname ?? "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    // Keep this process aligned with the registry's absolute cap. The
    // registry/backend still shorten the effective lifetime for idle and
    // session expiry, while an explicit generation renewal can carry a
    // running host beyond its initial ten-minute allowance.
    expiry = (options.setTimeoutFn ?? setTimeout)(
      () => void close(),
      CHATGPT_HOST_PROCESS_MAX_LIFETIME_MS,
    );
    maintenance = setInterval(() => session.getSnapshot(), 5_000);
    const address = server.address();
    if (!address || typeof address === "string") throw Error();
    return { port: address.port, close };
  } catch {
    await close();
    throw Error("ChatGPT host could not start.");
  }
}
