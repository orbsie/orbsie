import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  browserBuild: vi.fn(),
  db: new Map<string, unknown>(),
}));

vi.mock("../src/lib/cloud-generation-journal", () => ({
  appendCloudGenerationOperation: vi.fn(),
  cancelCloudGenerationRun: vi.fn(),
}));
vi.mock("../src/lib/cloud-generated-models", () => ({
  uploadCloudGeneratedModels: vi.fn(),
  downloadCloudGeneratedModels: async () => true,
}));
vi.mock("../src/lib/browser-modeling-connection", () => ({
  buildBrowserModel: mocks.browserBuild,
}));
vi.mock("idb-keyval", () => ({
  clear: async () => mocks.db.clear(),
  get: async (key: string) => structuredClone(mocks.db.get(key)),
  update: async (key: string, change: (value: unknown) => unknown) => {
    mocks.db.set(key, structuredClone(change(mocks.db.get(key))));
  },
}));

import { blankProject, commandSchema, type Command } from "../src/lib/protocol";
import { fixtureEntities } from "../src/lib/fixtures";
import { useOrb } from "../src/lib/store";
import {
  clearGenerationDiagnostics,
  readGenerationDiagnostics,
} from "../src/lib/generation-diagnostics-client";

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

const replayFixturePath =
  process.env.ORBSIE_GENERATION_DIAGNOSTIC_FIXTURE ??
  new URL(
    "../scripts/fixtures/generation-observability-fixtures.json",
    import.meta.url,
  ).pathname;
const replayFixtures = JSON.parse(
  readFileSync(replayFixturePath, "utf8"),
) as Array<{
  name: string;
  chunks?: string[];
  splitUtf8?: string;
  expected: string;
  readError?: boolean;
  stale?: boolean;
  abort?: string;
}>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function response(commands: Command[]) {
  return new Response(
    `${commands.map((command) => JSON.stringify(command)).join("\n")}\n`,
  );
}

function rawResponse(body: string) {
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

function responseForReplayFixture(fixture: (typeof replayFixtures)[number]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (fixture.readError) {
        controller.error(new Error("fixture reader failure"));
        return;
      }
      if (fixture.splitUtf8 !== undefined) {
        const bytes = encoder.encode(fixture.splitUtf8);
        const splitAt = bytes.findIndex((value) => value === 0xc3);
        controller.enqueue(bytes.slice(0, splitAt + 1));
        controller.enqueue(bytes.slice(splitAt + 1));
      } else {
        for (const chunk of fixture.chunks ?? [])
          controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

function commandsForLantern() {
  const reserve = commandSchema.parse({
    type: "reserve_entity",
    entity: {
      id: "lantern",
      label: "Lantern",
      position: [0, 0, 0],
      color: "#6ead60",
    },
  });
  const geometry = commandSchema.parse({
    type: "set_geometry",
    id: "lantern",
    geometry: {
      kind: "generated",
      detail: "refined",
      collision: "none",
      job: browserJob,
    },
  });
  const commit = commandSchema.parse({
    type: "commit_revision",
    message: "Done",
  });
  return [reserve, geometry, commit];
}

beforeEach(async () => {
  vi.useFakeTimers();
  clearGenerationDiagnostics();
  mocks.db.clear();
  mocks.browserBuild.mockReset();
  vi.stubGlobal("Worker", class {});
  await useOrb.getState().load({
    ...blankProject(),
    entities: [fixtureEntities()[0]],
  });
});

afterEach(() => {
  useOrb.getState().stop();
  clearGenerationDiagnostics();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function waitForPreparation() {
  for (let i = 0; i < 25; i++) {
    if (useOrb.getState().authoringActivity.at(-1)?.kind === "preparing")
      return;
    await vi.advanceTimersByTimeAsync(100);
  }
  throw new Error("The throttled preparation activity was not published.");
}

describe("store authoring activity", () => {
  it("correlates the generation request and clears diagnostics with local data", async () => {
    mocks.browserBuild.mockResolvedValue(browserMetadata);
    const fetcher = vi.fn<typeof fetch>(async () =>
      response(commandsForLantern()),
    );
    vi.stubGlobal("fetch", fetcher);

    await useOrb.getState().run("Build a lantern", connection);
    const [diagnostic] = readGenerationDiagnostics();
    expect(diagnostic).toMatchObject({
      kind: "generation",
      provider: "free",
      terminal: { reason: "completed" },
      initialRevision: 0,
      commandCounts: {
        reserve_entity: 1,
        set_geometry: 1,
        commit_revision: 1,
      },
    });
    const requestInit = fetcher.mock.calls[0]?.[1];
    expect(requestInit?.headers).toMatchObject({
      "X-Orbsie-Client-Run-Id": expect.any(String),
    });
    await useOrb.getState().resetLocalData();
    expect(readGenerationDiagnostics()).toEqual([]);
  });

  it("reports waiting, entity, geometry, applied, and completion at real milestones", async () => {
    const build = deferred<typeof browserMetadata>();
    mocks.browserBuild.mockImplementation(() => build.promise);
    const fetcher = vi.fn<typeof fetch>(async () =>
      response(commandsForLantern()),
    );
    vi.stubGlobal("fetch", fetcher);

    const run = useOrb.getState().run("Build a lantern", connection);
    expect(
      useOrb.getState().authoringActivity.map((event) => event.kind),
    ).toEqual(["waiting"]);
    await waitForPreparation();
    expect(
      useOrb.getState().authoringActivity.map((event) => event.kind),
    ).toEqual(["waiting", "preparing"]);
    expect(useOrb.getState().authoringActivity.at(-1)?.message).toContain(
      "Lantern",
    );

    build.resolve(browserMetadata);
    await run;
    const activity = useOrb.getState().authoringActivity;
    expect(activity.map((event) => event.kind)).toEqual([
      "waiting",
      "preparing",
      "completed",
    ]);
    expect(new Set(activity.map((event) => event.projectId))).toEqual(
      new Set([useOrb.getState().project.id]),
    );
    expect(activity.every((event) => event.runId === activity[0].runId)).toBe(
      true,
    );
    expect(activity.map((event) => event.revision)).toEqual([0, 1, 3]);
    expect(activity[1]!.at - activity[0]!.at).toBeGreaterThanOrEqual(2000);
    expect(
      activity.some((event) => /backend|json|inspect/i.test(event.message)),
    ).toBe(false);
  });

  it("labels an uncommitted edit as a preview and rolls it back on clean EOF", async () => {
    const before = structuredClone(useOrb.getState().project);
    const previewCommand = commandSchema.parse({
      type: "set_label",
      id: before.entities[0]!.id,
      label: "Giant pink mushroom",
    });
    const finishStream = deferred<void>();
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  encoder.encode(`${JSON.stringify(previewCommand)}\n`),
                );
                void finishStream.promise.then(() => controller.close());
              },
            }),
            { headers: { "Content-Type": "application/x-ndjson" } },
          ),
      ),
    );

    const run = useOrb.getState().run("Edit the selected object", connection);
    for (let i = 0; i < 25; i++) {
      if (useOrb.getState().project.revision === before.revision + 1) break;
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(useOrb.getState().project.entities[0]?.label).toBe(
      "Giant pink mushroom",
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(
      useOrb
        .getState()
        .authoringActivity.some(
          (event) =>
            event.message === "Previewing changes to Giant pink mushroom.",
        ),
    ).toBe(true);

    finishStream.resolve();
    await run;
    const diagnostic = readGenerationDiagnostics().find(
      (entry) => entry.kind === "generation",
    );
    expect(
      diagnostic && diagnostic.kind === "generation"
        ? diagnostic.terminal
        : undefined,
    ).toMatchObject({
      reason: "clean-eof-without-commit",
    });
    expect(useOrb.getState().project).toEqual(before);
    expect(mocks.db.get("orbsie-draft")).toMatchObject({ project: before });
    expect(
      useOrb
        .getState()
        .authoringActivity.some((event) =>
          /Applied a change to Giant pink mushroom/i.test(event.message),
        ),
    ).toBe(false);
  });

  it("classifies invalid streamed commands as client validation failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => rawResponse('{"type":"invalid"}\n')),
    );

    await useOrb.getState().run("Build a lantern", connection);
    const diagnostic = readGenerationDiagnostics().find(
      (entry) => entry.kind === "generation",
    );
    expect(
      diagnostic && diagnostic.kind === "generation"
        ? diagnostic.terminal
        : undefined,
    ).toMatchObject({
      reason: "parser-failure",
      failureCode: "invalid-input",
    });
    expect(
      diagnostic && diagnostic.kind === "generation" ? diagnostic.phases : [],
    ).toContainEqual(expect.objectContaining({ phase: "apply" }));
  });

  it("classifies a parsed command rejected by the current scene as validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        rawResponse(
          '{"type":"set_transform","id":"missing-object","position":[0,0,0]}\n',
        ),
      ),
    );

    await useOrb.getState().run("Move the missing object", connection);
    const diagnostic = readGenerationDiagnostics().find(
      (entry) => entry.kind === "generation",
    );
    expect(
      diagnostic && diagnostic.kind === "generation"
        ? diagnostic.terminal
        : undefined,
    ).toMatchObject({
      reason: "parser-failure",
      failureCode: "invalid-input",
    });
    expect(useOrb.getState().error).toContain(
      "Your last working scene is safe.",
    );
  });

  it("replays stream fixtures through the production store", async () => {
    const storeCases = replayFixtures.filter(
      (fixture) => !fixture.stale && fixture.abort === undefined,
    );
    for (const fixture of storeCases) {
      clearGenerationDiagnostics();
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async () => responseForReplayFixture(fixture)),
      );

      await useOrb.getState().run(`Replay ${fixture.name}`, connection);
      const diagnostic = readGenerationDiagnostics().find(
        (entry) => entry.kind === "generation",
      );
      expect(
        diagnostic && diagnostic.kind === "generation"
          ? diagnostic.terminal?.reason
          : undefined,
      ).toBe(fixture.expected);
    }
  });

  it("classifies a thrown reader as transport failure without exposing detail", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("private reader detail"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response(body)),
    );

    await useOrb.getState().run("Build a lantern", connection);
    const diagnostic = readGenerationDiagnostics().find(
      (entry) => entry.kind === "generation",
    );
    expect(
      diagnostic && diagnostic.kind === "generation"
        ? diagnostic.terminal
        : undefined,
    ).toMatchObject({
      reason: "transport-error",
      failureCode: "transport",
    });
    expect(useOrb.getState().error).toContain(
      "Your last working scene is safe.",
    );
    expect(JSON.stringify(readGenerationDiagnostics())).not.toContain(
      "private reader detail",
    );
  });

  it("separates the client output bound from passive observer limits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => rawResponse("x".repeat(100_001))),
    );

    await useOrb.getState().run("Build a lantern", connection);
    const diagnostic = readGenerationDiagnostics().find(
      (entry) => entry.kind === "generation",
    );
    expect(
      diagnostic && diagnostic.kind === "generation"
        ? diagnostic.terminal
        : undefined,
    ).toMatchObject({
      reason: "output-limit",
      failureCode: "output-limit",
    });
  });

  it("maps provider quota responses, including HTTP 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({ error: "quota detail" }, { status: 429 }),
      ),
    );

    await useOrb.getState().run("Build a lantern", connection);
    const diagnostic = readGenerationDiagnostics().find(
      (entry) => entry.kind === "generation",
    );
    expect(
      diagnostic && diagnostic.kind === "generation"
        ? diagnostic.terminal
        : undefined,
    ).toMatchObject({
      reason: "provider-error",
      failureCode: "quota",
      httpStatus: 429,
    });
  });

  it("keeps cancellation terminal when delayed geometry finishes late", async () => {
    const build = deferred<typeof browserMetadata>();
    mocks.browserBuild.mockImplementation(() => build.promise);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => response(commandsForLantern())),
    );

    const run = useOrb.getState().run("Build a lantern", connection);
    await waitForPreparation();
    useOrb.getState().stop();
    build.resolve(browserMetadata);
    await run;

    const activity = useOrb.getState().authoringActivity;
    expect(activity.at(-1)?.kind).toBe("cancelled");
    expect(activity.some((event) => event.kind === "completed")).toBe(false);
    expect(useOrb.getState().building).toBe(false);
    const diagnostic = readGenerationDiagnostics().find(
      (entry) => entry.kind === "generation",
    );
    expect(
      diagnostic && diagnostic.kind === "generation"
        ? diagnostic.terminal
        : undefined,
    ).toMatchObject({ reason: "client-abort" });
  });

  it("does not repopulate cleared activity from a late worker callback", async () => {
    const build = deferred<typeof browserMetadata>();
    mocks.browserBuild.mockImplementation(() => build.promise);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => response(commandsForLantern())),
    );

    const run = useOrb.getState().run("Build a lantern", connection);
    await waitForPreparation();
    await useOrb.getState().resetLocalData();
    build.resolve(browserMetadata);
    await run;

    expect(useOrb.getState().authoringActivity).toEqual([]);
    expect(useOrb.getState().building).toBe(false);
    expect(readGenerationDiagnostics()).toEqual([]);
  });

  it("reports a truthful bounded failure without exposing implementation details", async () => {
    mocks.browserBuild.mockRejectedValueOnce(
      new Error("private worker implementation detail"),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        response(commandsForLantern().slice(0, 2)),
      ),
    );

    await useOrb.getState().run("Build a lantern", connection);
    const activity = useOrb.getState().authoringActivity;
    expect(activity.at(-1)?.kind).toBe("failed");
    expect(activity.at(-1)?.message).toBe(
      "This request could not be completed.",
    );
    expect(
      activity.some((event) => event.message.includes("private worker")),
    ).toBe(false);
  });

  it("drops late callbacks when a new request replaces the active run", async () => {
    const build = deferred<typeof browserMetadata>();
    mocks.browserBuild.mockImplementation(() => build.promise);
    const first = commandsForLantern();
    const second = commandSchema.parse({
      type: "commit_revision",
      message: "Done",
    });
    let request = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        response(request++ === 0 ? first : [second]),
      ),
    );

    const firstRun = useOrb.getState().run("Build a lantern", connection);
    await waitForPreparation();
    const secondRun = useOrb.getState().run("Finish the world", connection);
    await secondRun;
    build.resolve(browserMetadata);
    await firstRun;

    const activity = useOrb.getState().authoringActivity;
    expect(activity.at(-1)?.kind).toBe("completed");
    expect(new Set(activity.map((event) => event.runId)).size).toBe(1);
    expect(activity.map((event) => event.message)).not.toContain(
      "Preparing Lantern geometry…",
    );
    expect(
      readGenerationDiagnostics().some(
        (entry) =>
          entry.kind === "generation" && entry.runId !== activity.at(-1)?.runId,
      ),
    ).toBe(true);
  });
});
