import { createServer } from "node:http";
import { createIsolatedChatGPTRpc } from "../src/lib/server/chatgpt-runtime";
import { ChatGPTDeviceSession } from "../src/lib/server/chatgpt-device-session";
import { createChatGPTHostHandler } from "../src/lib/server/chatgpt-host";

/** One private host process per owner session; never a shared account service. */
export async function startChatGPTHostServer(options: {
  token: string;
  hostname?: string;
  port?: number;
}) {
  if (
    typeof options.token !== "string" ||
    options.token.length < 32 ||
    options.token.length > 256 ||
    /[^\x21-\x7e]/.test(options.token)
  )
    throw Error("A private host capability is required.");
  const rpc = await createIsolatedChatGPTRpc();
  const session = new ChatGPTDeviceSession({
    ownerId: "isolated-host",
    sessionId: crypto.randomUUID(),
    rpc,
  });
  const handle = createChatGPTHostHandler({ session, token: options.token });
  const server = createServer(async (incoming, outgoing) => {
    try {
      // Auth endpoints accept no payload. Reject without buffering input.
      if (
        incoming.headers["transfer-encoding"] ||
        (incoming.headers["content-length"] &&
          incoming.headers["content-length"] !== "0")
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
        }),
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch {
      outgoing.writeHead(500, { "Cache-Control": "private, no-store" });
      outgoing.end();
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  let closing: Promise<void> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let maintenance: ReturnType<typeof setInterval> | undefined;
  const close = () =>
    (closing ??= (async () => {
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
