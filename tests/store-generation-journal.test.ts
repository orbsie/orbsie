import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  cancel: vi.fn(),
  upload: vi.fn(),
  build: vi.fn(),
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
vi.mock("../src/lib/modeling-connection", () => ({
  buildLocalModel: mocks.build,
}));
vi.mock("idb-keyval", () => ({
  get: async (key: string) => structuredClone(mocks.db.get(key)),
  update: async (key: string, change: (value: unknown) => unknown) => {
    mocks.db.set(key, structuredClone(change(mocks.db.get(key))));
  },
}));
import { useOrb, type GenerationJournalConnection } from "../src/lib/store";
import {
  applyOperation,
  commandSchema,
  blankProject,
  type Command,
  type Envelope,
} from "../src/lib/protocol";
import { fixtureEntities } from "../src/lib/fixtures";
import { GAME_RULES_RESTART_NOTICE } from "../src/lib/game-session";
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
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify(command) +
            '\n{"type":"commit_revision","message":"Done"}\n',
        ),
    ),
  );
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
  mocks.build.mockReset();
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
  gate.resolve(durable);
  await run;
  expect(useOrb.getState().project.entities[0].color).toBe("#ff66aa");
  expect(mocks.append).toHaveBeenCalledTimes(2);
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
it.each([false, true])(
  "uploads model bytes before acknowledgement and retains restart=%s through progress",
  async (restarted) => {
    const gate = deferred<boolean>();
    mocks.upload.mockImplementationOnce(() => gate.promise);
    mocks.build.mockImplementation(async (_connection, _job, options) => {
      if (restarted)
        useOrb.getState().set({
          ruleRestartCount: useOrb.getState().ruleRestartCount + 1,
          notice: GAME_RULES_RESTART_NOTICE,
        });
      options.onProgress({ message: "Exporting geometry" });
      return {
        version: 1,
        sha256: "a".repeat(64),
        bytes: 32,
        source: "local-blender",
        blenderVersion: "test",
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        createdAt: "2026-09-08T00:00:00.000Z",
      };
    });
    useOrb.getState().set({
      modelingConnection: {
        url: "http://127.0.0.1:1234",
        token: "a".repeat(43),
      },
    });
    const before = useOrb.getState().project.entities[0].geometry;
    relay(
      commandSchema.parse({
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
      }),
    );
    const run = useOrb.getState().run("Build a box", connection, journal);
    await vi.waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
    expect(mocks.append).not.toHaveBeenCalled();
    expect(useOrb.getState().project.entities[0].geometry).toEqual(before);
    gate.resolve(true);
    await run;
    expect(mocks.append.mock.calls[0][0].command.geometry.model.sha256).toBe(
      "a".repeat(64),
    );
    expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.append.mock.invocationCallOrder[0],
    );
    expect(useOrb.getState().notice).toBe(
      restarted
        ? GAME_RULES_RESTART_NOTICE
        : "Your world is saved on this device.",
    );
  },
);

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
    await useOrb.getState().save();
    expect((mocks.db.get("orbsie-draft") as any).project.entities[0]).toEqual(
      final,
    );
  },
);
