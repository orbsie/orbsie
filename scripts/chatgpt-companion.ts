/** Trusted loopback boundary; never import into a hosted route or browser bundle. */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  applyOperation,
  commandSchema,
  projectSchema,
  type Cursor,
  type Command,
} from "../src/lib/protocol";
import { systemPrompt } from "../src/lib/server/generation";

export interface CompanionClient {
  generate(
    instructions: string,
    input: unknown,
    onText: (delta: string) => void,
    signal: AbortSignal,
  ): Promise<unknown>;
  close(): void;
}
const requestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(5000),
    project: projectSchema,
    selected: z
      .string()
      .regex(/^[\w-]{1,80}$/)
      .optional(),
  })
  .strict();
const BODY_LIMIT = 1024 * 1024;
export function companionOrigin(value = "https://orbsie.com") {
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
    throw Error(
      "ORBSIE_ORIGIN must be one exact HTTPS origin or an explicit HTTP loopback origin.",
    );
  return value;
}
export async function startChatGPTCompanion({
  client,
  model,
  origin = "https://orbsie.com",
  token = randomBytes(32).toString("base64url"),
  deadlineMs = 180000,
}: {
  client: CompanionClient;
  model: string;
  origin?: string;
  token?: string;
  deadlineMs?: number;
}) {
  companionOrigin(origin);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw Error("A 256-bit capability is required.");
  let host = "",
    active: AbortController | undefined,
    closed = false;
  const send = (res: ServerResponse, status: number, error: string) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error }));
  };
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, "Local companion unavailable.");
      else res.end();
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 30;
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (closed || req.headers.host !== host || req.headers.origin !== origin)
      return send(res, 403, "Request denied.");
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      const method = req.headers["access-control-request-method"];
      const headers = String(
        req.headers["access-control-request-headers"] ?? "",
      )
        .toLowerCase()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (
        !["GET", "POST"].includes(String(method)) ||
        headers.some((h) => !["authorization", "content-type"].includes(h)) ||
        !["/health", "/generate"].includes(req.url ?? "")
      )
        return send(res, 403, "Request denied.");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      if (req.headers["access-control-request-private-network"] === "true")
        res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.writeHead(204);
      res.end();
      return;
    }
    const supplied = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return send(res, 401, "Connection required.");
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          protocolVersion: 1,
          model,
          effort: "low",
          status: active ? "busy" : "ready",
        }),
      );
      return;
    }
    if (req.method !== "POST" || req.url !== "/generate")
      return send(res, 404, "Not found.");
    if (active) return send(res, 429, "A local generation is already running.");
    if (
      req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
      "application/json"
    )
      return send(res, 415, "JSON required.");
    const controller = new AbortController();
    active = controller;
    const abort = () => controller.abort();
    res.on("close", abort);
    const timer = setTimeout(() => {
      abort();
      if (!req.complete) req.destroy();
    }, deadlineMs);
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > BODY_LIMIT) {
          send(res, 413, "Request too large.");
          return;
        }
        chunks.push(chunk);
      }
      const parsed = requestSchema.safeParse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      if (!parsed.success) return send(res, 400, "Invalid generation request.");
      const { prompt, project, selected } = parsed.data;
      if (
        selected &&
        !project.entities.some((entity) => entity.id === selected)
      )
        return send(res, 400, "Invalid selected object.");
      if (
        new Set(project.entities.map((entity) => entity.id)).size !==
        project.entities.length
      )
        return send(res, 400, "Invalid generation request.");
      controller.signal.throwIfAborted();
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        Connection: "close",
      });
      res.flushHeaders();
      let working = project,
        buffer = "",
        count = 0,
        total = 0,
        commit: Command | undefined;
      let cursor: Cursor = {
        runId: randomUUID(),
        sequence: 0,
        seen: new Set(),
      };
      function emit(line: string) {
        if (!line.trim()) return;
        controller.signal.throwIfAborted();
        if (++count > 250) throw Error("Invalid command sequence.");
        const command = commandSchema.parse(JSON.parse(line));
        const applied = applyOperation(
          working,
          {
            version: 1,
            projectId: working.id,
            runId: cursor.runId,
            operationId: randomUUID(),
            sequence: cursor.sequence + 1,
            baseRevision: working.revision,
            command,
          },
          cursor,
        );
        working = applied.project;
        cursor = applied.cursor;
        if (commit) res.write(JSON.stringify(commit) + "\n");
        commit = undefined;
        if (command.type === "commit_revision") commit = command;
        else if (
          !res.write(JSON.stringify(command) + "\n") &&
          res.writableLength > BODY_LIMIT
        )
          throw Error("Client too slow.");
      }
      await client.generate(
        systemPrompt,
        {
          instruction: prompt,
          selectedEntityId: selected,
          project: { ...project, messages: [] },
        },
        (delta) => {
          controller.signal.throwIfAborted();
          total += Buffer.byteLength(delta);
          buffer += delta;
          if (total > 2 * BODY_LIMIT || buffer.length > 100000)
            throw Error("Output limit.");
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          lines.forEach(emit);
        },
        controller.signal,
      );
      emit(buffer);
      controller.signal.throwIfAborted();
      if (!commit) throw Error("Missing commit.");
      res.end(JSON.stringify(commit) + "\n");
    } catch {
      controller.abort();
      if (!res.destroyed) {
        if (!res.headersSent)
          send(res, 400, "Invalid or interrupted generation request.");
        else
          res.end(
            JSON.stringify({
              error:
                "Local generation failed or was interrupted. Finished objects are preserved; retry to continue.",
            }) + "\n",
          );
      }
    } finally {
      clearTimeout(timer);
      res.off("close", abort);
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
    async close() {
      if (closed) return;
      closed = true;
      active?.abort();
      client.close();
      const done = new Promise<void>((resolve) =>
        server.close(() => resolve()),
      );
      server.closeAllConnections();
      await done;
    },
  };
}
