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
  vi.unstubAllGlobals();
});

describe("store authoring activity", () => {
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
    await vi.waitFor(() =>
      expect(useOrb.getState().authoringActivity.at(-1)?.kind).toBe(
        "preparing",
      ),
    );
    expect(
      useOrb.getState().authoringActivity.map((event) => event.kind),
    ).toEqual(["waiting", "constructing", "applied", "preparing"]);
    expect(useOrb.getState().authoringActivity.at(-1)?.message).toContain(
      "Lantern",
    );

    build.resolve(browserMetadata);
    await run;
    const activity = useOrb.getState().authoringActivity;
    expect(activity.map((event) => event.kind)).toEqual([
      "waiting",
      "constructing",
      "applied",
      "preparing",
      "applied",
      "applied",
      "completed",
    ]);
    expect(new Set(activity.map((event) => event.projectId))).toEqual(
      new Set([useOrb.getState().project.id]),
    );
    expect(activity.every((event) => event.runId === activity[0].runId)).toBe(
      true,
    );
    expect(activity.map((event) => event.revision)).toEqual([
      0, 0, 1, 1, 2, 3, 3,
    ]);
    expect(
      activity.some((event) => /backend|json|inspect/i.test(event.message)),
    ).toBe(false);
  });

  it("keeps cancellation terminal when delayed geometry finishes late", async () => {
    const build = deferred<typeof browserMetadata>();
    mocks.browserBuild.mockImplementation(() => build.promise);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => response(commandsForLantern())),
    );

    const run = useOrb.getState().run("Build a lantern", connection);
    await vi.waitFor(() =>
      expect(useOrb.getState().authoringActivity.at(-1)?.kind).toBe(
        "preparing",
      ),
    );
    useOrb.getState().stop();
    build.resolve(browserMetadata);
    await run;

    const activity = useOrb.getState().authoringActivity;
    expect(activity.at(-1)?.kind).toBe("cancelled");
    expect(activity.some((event) => event.kind === "completed")).toBe(false);
    expect(useOrb.getState().building).toBe(false);
  });

  it("does not repopulate cleared activity from a late worker callback", async () => {
    const build = deferred<typeof browserMetadata>();
    mocks.browserBuild.mockImplementation(() => build.promise);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => response(commandsForLantern())),
    );

    const run = useOrb.getState().run("Build a lantern", connection);
    await vi.waitFor(() =>
      expect(useOrb.getState().authoringActivity.at(-1)?.kind).toBe(
        "preparing",
      ),
    );
    await useOrb.getState().resetLocalData();
    build.resolve(browserMetadata);
    await run;

    expect(useOrb.getState().authoringActivity).toEqual([]);
    expect(useOrb.getState().building).toBe(false);
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
    await vi.waitFor(() =>
      expect(useOrb.getState().authoringActivity.at(-1)?.kind).toBe(
        "preparing",
      ),
    );
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
  });
});
