/** Foreground loopback modeling boundary; never import into a hosted route. */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { modelingJobSchema, type ModelingJob } from "../src/lib/modeling";
import { validateGeneratedGLB } from "../src/lib/generated-glb";
import type {
  BlenderModelingResult,
  BlenderModelingOptions,
} from "./blender-modeling";

export type ModelingBuilder = (
  job: ModelingJob,
  options: BlenderModelingOptions,
) => Promise<BlenderModelingResult>;
const BODY_LIMIT = 512 * 1024;
const DEFAULT_DEADLINE = 45000;
function allowedOrigin(value: string) {
  const url = new URL(value);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    )
  )
    throw Error("One exact HTTPS origin or HTTP loopback origin is required.");
  return value;
}
/** build must honor AbortSignal. A timed-out builder retains admission until it settles. */
export async function startModelingCompanion({
  build,
  origin,
  token = randomBytes(32).toString("base64url"),
  deadlineMs = DEFAULT_DEADLINE,
}: {
  build: ModelingBuilder;
  origin: string;
  token?: string;
  /** Shorter deadlines support deterministic tests; production ceiling remains 45 seconds. */
  deadlineMs?: number;
}) {
  allowedOrigin(origin);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw Error("A 256-bit capability is required.");
  if (
    !Number.isInteger(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs > DEFAULT_DEADLINE
  )
    throw Error("Invalid modeling deadline.");
  let host = "",
    closed = false,
    active: AbortController | undefined;
  const handlers = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;
  const server = createServer((request, response) => {
    const handled = handle(request, response).catch(() => {
      if (!response.destroyed) {
        if (!response.headersSent)
          send(response, 500, "Local modeling unavailable.");
        else
          response.end(
            JSON.stringify({ type: "error", error: "Local modeling failed." }) +
              "\n",
          );
      }
    });
    handlers.add(handled);
    void handled.finally(() => handlers.delete(handled));
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 30;
  const send = (response: ServerResponse, status: number, error: string) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error }));
  };
  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (
      closed ||
      request.headers.host !== host ||
      request.headers.origin !== origin
    )
      return send(response, 403, "Request denied.");
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    if (request.method === "OPTIONS") {
      const method = request.headers["access-control-request-method"];
      const headers = String(
        request.headers["access-control-request-headers"] ?? "",
      )
        .toLowerCase()
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      if (
        !["GET", "POST"].includes(String(method)) ||
        !["/health", "/model"].includes(request.url ?? "") ||
        headers.some((h) => !["authorization", "content-type"].includes(h))
      )
        return send(response, 403, "Request denied.");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST");
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      if (request.headers["access-control-request-private-network"] === "true")
        response.setHeader("Access-Control-Allow-Private-Network", "true");
      response.writeHead(204);
      response.end();
      return;
    }
    const actual = Buffer.from(request.headers.authorization ?? ""),
      expected = Buffer.from(`Bearer ${token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return send(response, 401, "Connection required.");
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          protocolVersion: 1,
          capability: "local-blender",
          status: active ? "busy" : "ready",
        }),
      );
      return;
    }
    if (request.method !== "POST" || request.url !== "/model")
      return send(response, 404, "Not found.");
    if (active)
      return send(response, 409, "A modeling job is already running.");
    if (
      request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
      "application/json"
    )
      return send(response, 415, "JSON required.");
    if (Number(request.headers["content-length"] ?? 0) > BODY_LIMIT)
      return send(response, 413, "Modeling job too large.");
    const controller = new AbortController();
    active = controller;
    const abort = () => controller.abort();
    response.on("close", abort);
    request.on("aborted", abort);
    const timer = setTimeout(() => {
      abort();
      if (!response.destroyed) {
        if (!response.headersSent)
          send(response, 408, "Modeling deadline reached.");
        else
          response.end(
            JSON.stringify({
              type: "error",
              error: "Modeling deadline reached.",
            }) + "\n",
          );
      }
      if (!request.complete) request.destroy();
    }, deadlineMs);
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > BODY_LIMIT) {
          send(response, 413, "Modeling job too large.");
          return;
        }
        chunks.push(chunk);
      }
      const parsed = modelingJobSchema.safeParse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      if (!parsed.success) {
        send(response, 400, "Invalid modeling job.");
        return;
      }
      controller.signal.throwIfAborted();
      response.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        Connection: "close",
      });
      response.flushHeaders();
      let progressCount = 0;
      const result = await build(parsed.data, {
        signal: controller.signal,
        onProgress(progress) {
          controller.signal.throwIfAborted();
          if (++progressCount > 512) throw Error("Progress limit.");
          if (
            !["validation", "modeling", "exporting", "complete"].includes(
              progress.stage,
            ) ||
            !Number.isFinite(progress.progress) ||
            progress.progress < 0 ||
            progress.progress > 1
          )
            throw Error("Invalid progress.");
          // Never forward a builder diagnostic string: it may contain local paths.
          response.write(
            JSON.stringify({
              type: "progress",
              stage: progress.stage,
              progress: progress.progress,
              message: {
                validation: "Validating model",
                modeling: "Building model",
                exporting: "Exporting model",
                complete: "Model ready",
              }[progress.stage],
            }) + "\n",
          );
          if (response.writableLength > 128 * 1024) throw Error("Slow client.");
        },
      });
      controller.signal.throwIfAborted();
      validateGeneratedGLB(result.glb);
      if (
        createHash("sha256").update(result.glb).digest("hex") !== result.sha256
      )
        throw Error("Integrity failure.");
      // Explicit result fields exclude filesystem paths and injected builder metadata.
      response.end(
        JSON.stringify({
          type: "result",
          glb: Buffer.from(result.glb).toString("base64"),
          sha256: result.sha256,
          bounds: result.bounds,
          materialStats: result.materialStats,
          objects: result.objects,
          blenderVersion: result.blenderVersion,
        }) + "\n",
      );
    } catch {
      abort();
      if (!response.destroyed && !response.writableEnded) {
        if (!response.headersSent)
          send(response, 400, "Invalid or interrupted modeling job.");
        else
          response.end(
            JSON.stringify({
              type: "error",
              error: "Local modeling failed or was interrupted.",
            }) + "\n",
          );
      }
    } finally {
      clearTimeout(timer);
      response.off("close", abort);
      request.off("aborted", abort);
      if (active === controller) active = undefined;
    }
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Local bind failed.");
  host = `127.0.0.1:${address.port}`;
  return {
    url: `http://${host}`,
    token,
    close() {
      if (closing) return closing;
      closed = true;
      active?.abort();
      closing = (async () => {
        const done = new Promise<void>((resolve) =>
          server.close(() => resolve()),
        );
        server.closeAllConnections();
        await done;
        // Let the abort-aware builder release its process and job directory
        // before a foreground launcher exits.
        await Promise.allSettled([...handlers]);
      })();
      return closing;
    },
  };
}
