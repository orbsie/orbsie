import { z } from "zod";
import { companionOrigin } from "./generation-connection";
import { modelingJobSchema, type ModelingJob } from "./modeling";
import {
  saveGeneratedModel,
  MAX_GENERATED_MODEL_BYTES,
} from "./generated-models";

export type ModelingConnection = { url: string; token: string };
const point = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const progressSchema = z.object({
  type: z.literal("progress"),
  stage: z.enum(["validation", "modeling", "exporting", "complete"]),
  progress: z.number().min(0).max(1),
  message: z.string().max(500),
});
export type ModelingProgress = z.infer<typeof progressSchema>;
const resultSchema = z.object({
  type: z.literal("result"),
  glb: z
    .string()
    .max(4 * Math.ceil(MAX_GENERATED_MODEL_BYTES / 3))
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bounds: z.object({ min: point, max: point, size: point }),
  blenderVersion: z.string().min(1).max(64),
});
function checked(connection: ModelingConnection) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(connection.token))
    throw Error("Invalid local modeling connection.");
  return { url: companionOrigin(connection.url), token: connection.token };
}
export function readModelingLink(hash: string): ModelingConnection | null {
  if (!hash.startsWith("#builder=")) return null;
  try {
    if (hash.length > 2048) throw Error();
    return checked(JSON.parse(decodeURIComponent(hash.slice(9))));
  } catch {
    throw Error(
      "This local Blender connection link is invalid. Open a new link from the companion.",
    );
  }
}
function request(
  connection: ModelingConnection,
  path: string,
  signal?: AbortSignal,
): [string, RequestInit] {
  const value = checked(connection);
  return [
    `${value.url}${path}`,
    {
      headers: {
        Authorization: `Bearer ${value.token}`,
        "Content-Type": "application/json",
      },
      credentials: "omit",
      mode: "cors",
      redirect: "error",
      signal,
    },
  ];
}
async function readLines(
  response: Response,
  consume: (line: string) => void,
  budget: number,
) {
  if (!response.body) throw Error("Local modeling returned no response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let count = 0,
    pending = "",
    finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        pending += decoder.decode();
        finished = true;
        break;
      }
      count += value.byteLength;
      if (count > budget)
        throw Error("Local modeling response exceeds its size budget.");
      pending += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (line) consume(line);
      }
    }
    if (pending.trim()) consume(pending.trim());
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export async function checkModelingConnection(
  connection: ModelingConnection,
  signal?: AbortSignal,
) {
  const timeout = AbortSignal.timeout(10000);
  const response = await fetch(
    ...request(
      connection,
      "/health",
      signal ? AbortSignal.any([signal, timeout]) : timeout,
    ),
  );
  if (!response.ok)
    throw Error("Local Blender is unavailable. Reconnect the companion.");
  let payload = "";
  await readLines(
    response,
    (line) => {
      payload += line;
    },
    4096,
  );
  return z
    .object({
      protocolVersion: z.literal(1),
      capability: z.literal("local-blender"),
      status: z.enum(["ready", "busy"]),
    })
    .parse(JSON.parse(payload));
}
/** Connection capabilities stay in memory and travel only to the exact loopback origin. */
export async function buildLocalModel(
  connection: ModelingConnection,
  input: ModelingJob,
  options: {
    signal?: AbortSignal;
    onProgress?: (event: ModelingProgress) => void;
  } = {},
) {
  const job = modelingJobSchema.parse(input);
  const timeout = AbortSignal.timeout(60000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const [url, init] = request(connection, "/model", signal);
  const response = await fetch(url, {
    ...init,
    method: "POST",
    body: JSON.stringify(job),
  });
  if (!response.ok)
    throw Error(
      response.status === 409
        ? "Blender is already building another model."
        : "Local modeling could not start.",
    );
  let result: z.infer<typeof resultSchema> | undefined;
  await readLines(
    response,
    (line) => {
      if (result)
        throw Error("Local modeling sent data after its completed result.");
      const value = JSON.parse(line);
      if (value.type === "error")
        throw Error("Local modeling failed. Your previous model is preserved.");
      if (value.type === "progress")
        options.onProgress?.(progressSchema.parse(value));
      else result = resultSchema.parse(value);
    },
    4 * 1024 * 1024,
  );
  signal.throwIfAborted();
  if (!result) throw Error("Local modeling ended without a completed model.");
  const final = result as z.infer<typeof resultSchema>;
  const glb = Uint8Array.from(atob(final.glb), (character) =>
    character.charCodeAt(0),
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", glb));
  const hash = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== final.sha256)
    throw Error("Local modeling returned a model with an invalid digest.");
  signal.throwIfAborted();
  return saveGeneratedModel(glb, {
    blenderVersion: final.blenderVersion,
    bounds: { min: final.bounds.min, max: final.bounds.max },
  });
}
