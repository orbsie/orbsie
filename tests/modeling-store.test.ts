import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: new Map<string, unknown>(),
}));

vi.mock("idb-keyval", () => ({
  get: async (key: string) => structuredClone(mocks.db.get(key)),
  update: async (key: string, change: (value: unknown) => unknown) => {
    mocks.db.set(key, structuredClone(change(mocks.db.get(key))));
  },
}));

import { fixtureEntities } from "../src/lib/fixtures";
import { blankProject, commandSchema } from "../src/lib/protocol";
import { useOrb } from "../src/lib/store";

const localJob = {
  version: 1 as const,
  parts: [{ id: "body", shape: "box" as const, color: "#ffffff" }],
};

beforeEach(() => {
  mocks.db.clear();
  const project = { ...blankProject(), entities: [fixtureEntities()[0]] };
  useOrb.getState().load(project);
  useOrb.getState().set({ selected: project.entities[0].id });
});

afterEach(() => {
  useOrb.getState().stop();
  vi.unstubAllGlobals();
});

function relay(model?: unknown) {
  const command = commandSchema.parse({
    type: "set_geometry",
    id: useOrb.getState().project.entities[0].id,
    geometry: {
      kind: "generated",
      detail: "refined",
      job: localJob,
      ...(model ? { model } : {}),
    },
  });
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify(command) +
          '\n{"type":"commit_revision","message":"Built"}\n',
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

it("rejects legacy modeling jobs without invoking an external builder", async () => {
  const fetcher = relay();
  const original = structuredClone(
    useOrb.getState().project.entities[0].geometry,
  );
  await useOrb.getState().run("Build this model");
  expect(useOrb.getState().error).toContain("browser-manifold");
  expect(useOrb.getState().project.entities[0].geometry).toEqual(original);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
    localModeling: false,
    browserModeling: false,
  });
});

it("rejects provider-supplied legacy model identity before any builder call", async () => {
  const fetcher = relay({
    version: 1,
    sha256: "a".repeat(64),
    bytes: 32,
    source: "local-blender",
    blenderVersion: "test",
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    createdAt: "2026-09-08T00:00:00.000Z",
  });
  await useOrb.getState().run("Build this model");
  expect(useOrb.getState().error).toContain("browser-manifold");
  expect(fetcher).toHaveBeenCalledOnce();
});
