import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  browserBuild: vi.fn(),
  db: new Map<string, unknown>(),
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

import { fixtureEntities } from "../src/lib/fixtures";
import { useOrb } from "../src/lib/store";
import { blankProject, commandSchema } from "../src/lib/protocol";
import { assertModelingCommand } from "../src/lib/modeling-policy";

const browserMetadata = {
  version: 1,
  sha256: "b".repeat(64),
  bytes: 1024,
  source: "browser-manifold" as const,
  kernelVersion: "3.3.2",
  bounds: {
    min: [-1, -1, -1] as [number, number, number],
    max: [1, 1, 1] as [number, number, number],
  },
  createdAt: "2026-09-08T00:00:00.000Z",
};
const browserJob = {
  backend: "browser-manifold" as const,
  recipe: {
    version: 1 as const,
    revision: 0,
    output: "box",
    nodes: [
      {
        id: "box",
        kind: "box" as const,
        size: [2, 2, 2] as [number, number, number],
      },
    ],
  },
};
const localJob = {
  version: 1 as const,
  parts: [{ id: "body", shape: "box" as const, color: "#ffffff" }],
};

beforeEach(() => {
  mocks.db.clear();
  vi.stubGlobal("Worker", class {});
  mocks.browserBuild.mockReset().mockResolvedValue(browserMetadata);
  const project = { ...blankProject(), entities: [fixtureEntities()[0]] };
  useOrb.getState().load(project);
  useOrb.getState().set({
    selected: project.entities[0].id,
  });
});

afterEach(() => {
  useOrb.getState().stop();
  vi.unstubAllGlobals();
});

function relay(job: unknown) {
  const command = commandSchema.parse({
    type: "set_geometry",
    id: useOrb.getState().project.entities[0].id,
    geometry: { kind: "generated", detail: "refined", job },
  });
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify(command) +
          '\n{"type":"commit_revision","message":"Built in browser"}\n',
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

it("accepts a browser-manifold recipe without a Blender companion", async () => {
  const fetcher = relay(browserJob);
  await useOrb.getState().run("Build this browser model");
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
    browserModeling: true,
    localModeling: false,
  });
  expect(mocks.browserBuild).toHaveBeenCalledOnce();
  expect(mocks.browserBuild.mock.calls[0][0]).toEqual(browserJob.recipe);
  expect(mocks.browserBuild.mock.calls[0][1]).toMatchObject({
    color: "#6d9d58",
  });
  expect(useOrb.getState().project.entities[0].geometry).toMatchObject({
    kind: "generated",
    model: browserMetadata,
  });
});

it("keeps the previous geometry when a browser build resolves after cancellation", async () => {
  let finish!: (metadata: typeof browserMetadata) => void;
  mocks.browserBuild.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  relay(browserJob);
  const original = structuredClone(
    useOrb.getState().project.entities[0].geometry,
  );
  const running = useOrb.getState().run("Build this browser model");
  await vi.waitFor(() => expect(mocks.browserBuild).toHaveBeenCalledOnce());
  useOrb.getState().stop();
  finish(browserMetadata);
  await running;
  expect(useOrb.getState().project.entities[0].geometry).toEqual(original);
});

it("ignores a browser build that resolves after loading another project", async () => {
  let finish!: (metadata: typeof browserMetadata) => void;
  mocks.browserBuild.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  relay(browserJob);
  const running = useOrb.getState().run("Build this browser model");
  await vi.waitFor(() => expect(mocks.browserBuild).toHaveBeenCalledOnce());
  const loaded = {
    ...blankProject(),
    id: "loaded-world",
    entities: [fixtureEntities()[1]],
  };
  useOrb.getState().load(loaded);
  finish(browserMetadata);
  await running;
  expect(useOrb.getState().project.id).toBe(loaded.id);
  expect(useOrb.getState().project.entities).toEqual(loaded.entities);
});

it("keeps the newer run when an older browser build resolves late", async () => {
  const oldMetadata = browserMetadata;
  const newMetadata = { ...browserMetadata, sha256: "d".repeat(64) };
  const finishes: ((metadata: typeof browserMetadata) => void)[] = [];
  mocks.browserBuild.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishes.push(resolve);
      }),
  );
  relay(browserJob);
  const oldRun = useOrb.getState().run("Build the first browser model");
  await vi.waitFor(() => expect(mocks.browserBuild).toHaveBeenCalledOnce());
  relay(browserJob);
  const newRun = useOrb.getState().run("Build the newer browser model");
  await vi.waitFor(() => expect(mocks.browserBuild).toHaveBeenCalledTimes(2));
  finishes[0](oldMetadata);
  await Promise.resolve();
  finishes[1](newMetadata);
  await Promise.all([oldRun, newRun]);
  expect(useOrb.getState().project.entities[0].geometry).toMatchObject({
    model: newMetadata,
  });
});

it("rejects legacy jobs without invoking an external builder", async () => {
  relay(localJob);
  await useOrb.getState().run("Build this local model");
  expect(useOrb.getState().error).toContain("browser-manifold");
  expect(mocks.browserBuild).not.toHaveBeenCalled();
});

it("rejects browser metadata attached to a legacy job and Blender metadata attached to a browser job", () => {
  expect(() =>
    commandSchema.parse({
      type: "set_geometry",
      id: "tree-0",
      geometry: {
        kind: "generated",
        detail: "refined",
        job: localJob,
        model: browserMetadata,
      },
    }),
  ).toThrow("local-blender");
  expect(() =>
    commandSchema.parse({
      type: "set_geometry",
      id: "tree-0",
      geometry: {
        kind: "generated",
        detail: "refined",
        job: browserJob,
        model: {
          ...browserMetadata,
          source: "local-blender",
          blenderVersion: "4.0.2",
          kernelVersion: undefined,
        },
      },
    }),
  ).toThrow("browser-manifold");
});

it("rejects provider-supplied browser identities and coarse browser jobs", () => {
  const withModel = commandSchema.parse({
    type: "set_geometry",
    id: "tree-0",
    geometry: {
      kind: "generated",
      detail: "refined",
      job: browserJob,
      model: browserMetadata,
    },
  });
  expect(() => assertModelingCommand(withModel, false, true)).toThrow(
    "browser builder",
  );
  const coarse = commandSchema.parse({
    type: "set_geometry",
    id: "tree-0",
    geometry: { kind: "generated", detail: "coarse", job: browserJob },
  });
  expect(() => assertModelingCommand(coarse, false, true)).toThrow("refined");
  expect(() => assertModelingCommand(coarse, false)).toThrow("unavailable");
});
