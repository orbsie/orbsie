import { Readable } from "node:stream";
import { once } from "node:events";
import { createChatGPTGeneration } from "../src/lib/server/chatgpt-generation";
import { createChatGPTSceneStream } from "../src/lib/server/chatgpt-scene-stream";
import { listChatGPTModels } from "../src/lib/server/chatgpt-models";
import { createServer } from "node:http";
import { createIsolatedChatGPTRpc } from "../src/lib/server/chatgpt-runtime";
import { ChatGPTDeviceSession } from "../src/lib/server/chatgpt-device-session";
import { createChatGPTHostHandler } from "../src/lib/server/chatgpt-host";

/** One private host process per owner session; never a shared account service. */
export async function startChatGPTHostServer(options: {
  token: string;
  hostname?: string;
  port?: number;
  allowGeneration?: boolean;
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
  const active = new Set<AbortController>();
  const stopGeneration = () => {
    for (const controller of active) controller.abort();
  };
  const generator = options.allowGeneration
    ? createChatGPTGeneration({
        rpc,
        models: () => listChatGPTModels(rpc, session),
        dispose: () => rpc.close(),
      })
    : undefined;
  const handle = createChatGPTHostHandler({
    session,
    token: options.token,
    models: () => listChatGPTModels(rpc, session),
    beforeDisconnect: stopGeneration,
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
    if (isGeneration) active.add(controller);
    outgoing.once("close", () => {
      if (!outgoing.writableFinished) controller.abort();
    });
    incoming.once("aborted", () => controller.abort());
    try {
      // Auth endpoints accept no payload. Reject without buffering input.
      if (
        !isGeneration &&
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
          ...(isGeneration
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
      active.delete(controller);
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
      clearTimeout(expiry);
      clearInterval(maintenance);
      server.close();
      server.closeAllConnections();
      try {
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
    // Bound even abandoned browser sessions; caller must provision a new host.
    expiry = setTimeout(() => void close(), 10 * 60 * 1000);
    maintenance = setInterval(() => session.getSnapshot(), 5_000);
    const address = server.address();
    if (!address || typeof address === "string") throw Error();
    return { port: address.port, close };
  } catch {
    await close();
    throw Error("ChatGPT host could not start.");
  }
}
