import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { blankProject, type Envelope } from "../src/lib/protocol";
import {
  appendCloudGenerationOperation,
  readCloudGenerationRun,
  startCloudGenerationRun,
  settleCloudGenerationRecovery,
} from "../src/lib/cloud-generation-journal";
const fetcher = vi.fn();
const project = blankProject();
const run = {
  id: "run-1",
  projectId: project.id,
  sequence: 0,
  state: "running" as const,
  checkpoint: project,
  prompt: "Build a garden",
  baseRevision: 0,
  cloudBaselineCurrent: true,
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
          c.enqueue(new Uint8Array(1101 * 1024));
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

it("rejects a cloud baseline that changes before cancellation completes", async () => {
  fetcher.mockResolvedValue(
    Response.json({
      run: { ...run, state: "cancelled", cloudBaselineCurrent: false },
    }),
  );
  await expect(settleCloudGenerationRecovery(run)).rejects.toThrow(
    "newer cloud save",
  );
  expect(fetcher.mock.calls[0][1].method).toBe("PATCH");
});
it("rechecks completed recovery instead of trusting its earlier baseline", async () => {
  fetcher.mockResolvedValue(
    Response.json({
      run: { ...run, state: "complete", cloudBaselineCurrent: false },
    }),
  );
  await expect(
    settleCloudGenerationRecovery({ ...run, state: "complete" }),
  ).rejects.toThrow("newer cloud save");
  expect(fetcher.mock.calls[0][0]).toContain("?runId=run-1");
});
it("returns the latest settled checkpoint after a concurrent final operation", async () => {
  const final = {
    ...run,
    state: "complete",
    sequence: 2,
    checkpoint: { ...project, revision: 1 },
  };
  fetcher.mockResolvedValue(Response.json({ run: final }));
  await expect(settleCloudGenerationRecovery(run)).resolves.toEqual(final);
});
it("rejects an embedded checkpoint for another world", async () => {
  fetcher.mockResolvedValue(
    Response.json({
      run: {
        ...run,
        state: "cancelled",
        checkpoint: { ...project, id: "other-world" },
      },
    }),
  );
  await expect(settleCloudGenerationRecovery(run)).rejects.toThrow(
    "different world",
  );
});
