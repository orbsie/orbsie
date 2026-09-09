import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  cancel: vi.fn(),
  upload: vi.fn(),
  browserBuild: vi.fn(),
  db: new Map<string, unknown>(),
}));
vi.mock("../src/lib/cloud-generation-journal", () => ({
  appendCloudGenerationOperation: mocks.append,
  cancelCloudGenerationRun: mocks.cancel,
}));
vi.mock("../src/lib/cloud-generated-models", () => ({
  uploadCloudGeneratedModels: mocks.upload,
  downloadCloudGeneratedModels: async () => true,
}));
vi.mock("../src/lib/browser-modeling-connection", () => ({
  buildBrowserModel: mocks.browserBuild,
}));
vi.mock("idb-keyval", () => ({
  get: async (key: string) => structuredClone(mocks.db.get(key)),
  update: async (key: string, change: (value: unknown) => unknown) => {
    mocks.db.set(key, structuredClone(change(mocks.db.get(key))));
  },
}));
import { getExperienceMetrics } from "../src/lib/experience-metrics";
import { useOrb, type GenerationJournalConnection } from "../src/lib/store";
import {
  applyOperation,
  commandSchema,
  blankProject,
  type Command,
  type Envelope,
} from "../src/lib/protocol";
import { fixtureEntities } from "../src/lib/fixtures";
import type { GenerationRun } from "../src/lib/generation-journal";
let durable: GenerationRun;
let current: boolean;
const journal: GenerationJournalConnection = {
  isCurrent: () => current,
  begin: async (project, id, prompt, selected) =>
    (durable = {
      id,
      projectId: project.id,
      sequence: 0,
      state: "running",
      checkpoint: project,
      prompt,
      selected,
      baseRevision: project.revision,
      cloudBaselineCurrent: true,
    }),
};
const connection = { provider: "free" as const, model: "", key: "" };
const browserMetadata = {
  version: 1,
  sha256: "a".repeat(64),
  bytes: 32,
  source: "browser-manifold" as const,
  kernelVersion: "3.3.2",
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  createdAt: "2026-09-08T00:00:00.000Z",
};
const browserJob = {
  backend: "browser-manifold" as const,
  recipe: {
    version: 1 as const,
    revision: 0,
    output: "box" as const,
    nodes: [
      {
        id: "box",
        kind: "box" as const,
        size: [2, 2, 2] as [number, number, number],
      },
    ],
  },
};
function accept(envelope: Envelope) {
  durable = {
    ...durable,
    sequence: envelope.sequence,
    state: envelope.command.type === "commit_revision" ? "complete" : "running",
    checkpoint: applyOperation(durable.checkpoint, envelope, {
      runId: durable.id,
      sequence: durable.sequence,
      seen: new Set(),
    }).project,
  };
  return durable;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function relay(command: Command) {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify(command) +
          '\n{"type":"commit_revision","message":"Done"}\n',
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
function change(): Command {
  return {
    type: "set_material",
    id: useOrb.getState().project.entities[0].id,
    color: "#ff66aa",
  };
}
beforeEach(() => {
  current = true;
  mocks.db.clear();
  mocks.append.mockReset();
  mocks.cancel.mockReset().mockResolvedValue(undefined);
  mocks.upload.mockReset().mockResolvedValue(true);
  mocks.browserBuild.mockReset();
  vi.stubGlobal("Worker", class {});
  useOrb
    .getState()
    .load({ ...blankProject(), entities: [fixtureEntities()[0]] });
  mocks.append.mockImplementation(async (envelope: Envelope) =>
    accept(envelope),
  );
});
afterEach(() => {
  useOrb.getState().stop();
  vi.unstubAllGlobals();
});
it("does not apply an operation before its durable acknowledgement", async () => {
  const gate = deferred<GenerationRun>();
  mocks.append.mockImplementationOnce(async (envelope: Envelope) => {
    accept(envelope);
    return gate.promise;
  });
  const before = useOrb.getState().project.entities[0].color;
  relay(change());
  const run = useOrb.getState().run("Recolor", connection, journal);
  await vi.waitFor(() => expect(mocks.append).toHaveBeenCalledOnce());
  expect(useOrb.getState().project.entities[0].color).toBe(before);
  expect(
    getExperienceMetrics(useOrb.getState().project.id)[0].sceneUpdates,
  ).toEqual([]);
  gate.resolve(durable);
  await run;
  expect(useOrb.getState().project.entities[0].color).toBe("#ff66aa");
  expect(mocks.append).toHaveBeenCalledTimes(2);
  const [metrics] = getExperienceMetrics(useOrb.getState().project.id);
  expect(metrics.outcome).toBe("success");
  expect(metrics.milestones.generationComplete).not.toBeNull();
  expect(metrics.sceneUpdates).toHaveLength(1);
  expect(metrics.sceneUpdates[0].entityId).toBe(
    useOrb.getState().project.entities[0].id,
  );
  expect(metrics.sceneUpdates[0].drawnAt).toBeNull();
});
it("keeps a lost-ACK checkpoint recoverable without applying or resending the operation", async () => {
  mocks.append.mockImplementationOnce(async (envelope: Envelope) => {
    accept(envelope);
    throw Error("Acknowledgement lost");
  });
  const before = useOrb.getState().project.entities[0].color;
  relay(change());
  await useOrb.getState().run("Recolor", connection, journal);
  expect(durable.sequence).toBe(1);
  expect(durable.checkpoint.entities[0].color).toBe("#ff66aa");
  expect(useOrb.getState().project.entities[0].color).toBe(before);
  expect(mocks.append).toHaveBeenCalledOnce();
  expect(useOrb.getState().building).toBe(false);
});
it.each(["cancel", "account change"])(
  "suppresses local application after %s during an acknowledgement",
  async (reason) => {
    const gate = deferred<GenerationRun>();
    mocks.append.mockImplementationOnce(async (envelope: Envelope) => {
      accept(envelope);
      return gate.promise;
    });
    const before = useOrb.getState().project.entities[0].color;
    relay(change());
    const run = useOrb.getState().run("Recolor", connection, journal);
    await vi.waitFor(() => expect(mocks.append).toHaveBeenCalledOnce());
    if (reason === "cancel") useOrb.getState().stop();
    else current = false;
    gate.resolve(durable);
    await run;
    expect(useOrb.getState().project.entities[0].color).toBe(before);
    expect(mocks.append).toHaveBeenCalledOnce();
    expect(mocks.cancel).toHaveBeenCalled();
    expect(useOrb.getState().building).toBe(false);
  },
);
it("rejects a legacy modeling job before cloud acknowledgement or model upload", async () => {
  const legacyCommand = commandSchema.parse({
    type: "set_geometry",
    id: useOrb.getState().project.entities[0].id,
    geometry: {
      kind: "generated",
      detail: "refined",
      collision: "none",
      job: {
        version: 1,
        parts: [{ id: "box", shape: "box", color: "#ffffff" }],
      },
    },
  });
  const fetcher = relay(legacyCommand);
  const before = useOrb.getState().project.entities[0].geometry;
  await useOrb.getState().run("Build a box", connection, journal);
  expect(useOrb.getState().error).toContain("browser-manifold");
  expect(useOrb.getState().project.entities[0].geometry).toEqual(before);
  expect(mocks.append).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.cancel).toHaveBeenCalled();
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
    localModeling: false,
    browserModeling: true,
  });
});

it("uploads browser model bytes before durable acknowledgement", async () => {
  const gate = deferred<boolean>();
  mocks.upload.mockImplementationOnce(() => gate.promise);
  mocks.browserBuild.mockResolvedValueOnce(browserMetadata);
  const browserCommand = commandSchema.parse({
    type: "set_geometry",
    id: useOrb.getState().project.entities[0].id,
    geometry: {
      kind: "generated",
      detail: "refined",
      collision: "none",
      job: browserJob,
    },
  });
  const fetcher = relay(browserCommand);
  const before = useOrb.getState().project.entities[0].geometry;
  const run = useOrb.getState().run("Build a browser box", connection, journal);
  await vi.waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
  expect(mocks.append).not.toHaveBeenCalled();
  expect(useOrb.getState().project.entities[0].geometry).toEqual(before);
  gate.resolve(true);
  await run;
  expect(mocks.browserBuild).toHaveBeenCalledOnce();
  expect(mocks.append.mock.calls[0][0].command.geometry.model).toEqual(
    browserMetadata,
  );
  expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.append.mock.invocationCallOrder[0],
  );
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
    localModeling: false,
    browserModeling: true,
  });
});

it.each(["stop", "stream error"])(
  "preserves the newest finished geometry on %s during a later coarse replacement",
  async (ending) => {
    const entityId = useOrb.getState().project.entities[0].id;
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                stream = controller;
                controller.enqueue(
                  encoder.encode(
                    [
                      {
                        type: "set_geometry",
                        id: entityId,
                        geometry: { kind: "mushroom", detail: "refined" },
                      },
                      {
                        type: "set_geometry",
                        id: entityId,
                        geometry: { kind: "tree", detail: "coarse" },
                      },
                    ]
                      .map((command) => JSON.stringify(command))
                      .join("\n") + "\n",
                  ),
                );
              },
            }),
          ),
      ),
    );
    const run = useOrb
      .getState()
      .run("Refine this object", connection, journal);
    await vi.waitFor(() =>
      expect(useOrb.getState().project.entities[0].stage).toBe("coarse"),
    );
    if (ending === "stop") useOrb.getState().stop();
    stream.close();
    await run;
    const final = useOrb.getState().project.entities[0];
    expect(final.id).toBe(entityId);
    expect(final.stage).toBe("ready");
    expect(final.geometry?.kind).toBe("mushroom");
    const [metrics] = getExperienceMetrics(useOrb.getState().project.id);
    expect(metrics.outcome).toBe(ending === "stop" ? "cancelled" : "error");
    expect(metrics.milestones.generationComplete).toBeNull();
    await useOrb.getState().save();
    expect((mocks.db.get("orbsie-draft") as any).project.entities[0]).toEqual(
      final,
    );
  },
);

it("keeps schema internals out of failed model updates and preserves finished entities", async () => {
  const before = structuredClone(useOrb.getState().project.entities);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            type: "set_geometry",
            id: before[0].id,
            geometry: {
              kind: "generated",
              job: {
                backend: "browser-manifold",
                recipe: {
                  version: 1,
                  revision: 0,
                  output: "invalid",
                  nodes: [{ id: "invalid", kind: "unsupported-internal-node" }],
                },
              },
            },
          }) + "\n",
        ),
    ),
  );
  await useOrb.getState().run("Change the shape", connection);
  expect(useOrb.getState().error).toBe(
    "The model returned an invalid scene change. Try a simpler edit. Your finished world is safe.",
  );
  expect(useOrb.getState().project.entities).toEqual(before);
  expect(useOrb.getState().building).toBe(false);
});
