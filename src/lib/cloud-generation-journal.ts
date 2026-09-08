import {
  generationRunSchema,
  journalEnvelopeSchema,
  type GenerationRun,
} from "./generation-journal";
import type { Envelope, Project } from "./protocol";

export class GenerationJournalError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
async function readResponse(response: Response): Promise<GenerationRun> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new GenerationJournalError(
      "Cloud recovery returned an empty response.",
    );
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    bytes = 0,
    done = false;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        done = true;
        text += decoder.decode();
        break;
      }
      bytes += next.value.byteLength;
      if (bytes > 600 * 1024)
        throw new GenerationJournalError(
          "Cloud recovery exceeds its response budget.",
        );
      text += decoder.decode(next.value, { stream: true });
    }
    const result = JSON.parse(text);
    if (!response.ok)
      throw new GenerationJournalError(
        typeof result?.error === "string"
          ? result.error
          : "Cloud recovery is unavailable.",
        response.status,
      );
    return generationRunSchema.parse(result.run);
  } finally {
    if (!done) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
async function request(method: string, body: unknown, signal?: AbortSignal) {
  const response = await fetch("/api/generation-runs", {
    method,
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000),
  });
  return readResponse(response);
}
export async function startCloudGenerationRun(
  input: { runId: string; project: Project; prompt: string; selected?: string },
  signal?: AbortSignal,
) {
  const run = await request("POST", input, signal);
  if (
    run.id !== input.runId ||
    run.projectId !== input.project.id ||
    run.sequence !== 0 ||
    run.state !== "running"
  )
    throw new GenerationJournalError(
      "Cloud recovery returned a different generation run.",
    );
  return run;
}
/** Caller retries this exact envelope after a lost acknowledgement; never invent a new operation ID. */
export async function appendCloudGenerationOperation(
  envelope: Envelope,
  signal?: AbortSignal,
) {
  const operation = journalEnvelopeSchema.parse(envelope);
  const run = await request(
    "PUT",
    { runId: operation.runId, envelope: operation },
    signal,
  );
  if (
    run.id !== operation.runId ||
    run.projectId !== operation.projectId ||
    run.sequence !== operation.sequence
  )
    throw new GenerationJournalError(
      "Cloud recovery has advanced beyond this operation. Reopen its checkpoint before continuing.",
    );
  return run;
}
export async function readCloudGenerationRun(
  runId: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/generation-runs?runId=${encodeURIComponent(runId)}`,
    {
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    },
  );
  const run = await readResponse(response);
  if (run.id !== runId)
    throw new GenerationJournalError(
      "Cloud recovery returned a different generation run.",
    );
  return run;
}
export async function cancelCloudGenerationRun(runId: string) {
  const run = await request("PATCH", { runId });
  if (run.id !== runId)
    throw new GenerationJournalError(
      "Cloud recovery returned a different generation run.",
    );
  return run;
}
