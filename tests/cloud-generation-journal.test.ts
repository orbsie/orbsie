import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { blankProject, type Envelope } from "../src/lib/protocol";
import {
  appendCloudGenerationOperation,
  readCloudGenerationRun,
  startCloudGenerationRun,
} from "../src/lib/cloud-generation-journal";
const fetcher = vi.fn();
const project = blankProject();
const run = {
  id: "run-1",
  projectId: project.id,
  sequence: 0,
  state: "running",
  checkpoint: project,
  prompt: "Build a garden",
  baseRevision: 0,
};
beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());
it("keeps start identity and sends no provider credentials", async () => {
  fetcher.mockResolvedValue(Response.json({ run }));
  await expect(
    startCloudGenerationRun({ runId: run.id, project, prompt: run.prompt }),
  ).resolves.toEqual(run);
  const options = fetcher.mock.calls[0][1];
  expect(options.credentials).toBe("same-origin");
  expect(Object.keys(JSON.parse(options.body)).sort()).toEqual([
    "project",
    "prompt",
    "runId",
  ]);
});
it("retries can preserve the exact operation identity after a lost acknowledgement", async () => {
  const op: Envelope = {
    version: 1,
    projectId: project.id,
    runId: run.id,
    sequence: 1,
    operationId: "stable-operation",
    baseRevision: 0,
    command: { type: "commit_revision", message: "Done" },
  };
  fetcher
    .mockRejectedValueOnce(new TypeError("network disconnected"))
    .mockResolvedValueOnce(
      Response.json({ run: { ...run, sequence: 1, state: "complete" } }),
    );
  await expect(appendCloudGenerationOperation(op)).rejects.toThrow(
    "network disconnected",
  );
  await expect(appendCloudGenerationOperation(op)).resolves.toMatchObject({
    sequence: 1,
  });
  expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
});
it("rejects a response for another run", async () => {
  fetcher.mockResolvedValue(Response.json({ run: { ...run, id: "other" } }));
  await expect(readCloudGenerationRun(run.id)).rejects.toThrow(
    "different generation run",
  );
});
it("preserves ownership errors without activating a checkpoint", async () => {
  fetcher.mockResolvedValue(
    Response.json({ error: "Run not found" }, { status: 404 }),
  );
  await expect(readCloudGenerationRun(run.id)).rejects.toMatchObject({
    status: 404,
    message: "Run not found",
  });
});
it("rejects oversized streamed recovery before parsing", async () => {
  let cancelled = false;
  fetcher.mockResolvedValue(
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(601 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      }),
    ),
  );
  await expect(readCloudGenerationRun(run.id)).rejects.toThrow(
    "response budget",
  );
  expect(cancelled).toBe(true);
});
