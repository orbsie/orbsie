import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  build: vi.fn(),
  db: new Map<string, unknown>(),
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
import { useOrb } from "../src/lib/store";
import { blankProject, commandSchema } from "../src/lib/protocol";
import { fixtureEntities } from "../src/lib/fixtures";
const connection = { url: "http://127.0.0.1:1234", token: "a".repeat(43) };
const metadata = {
  version: 1,
  sha256: "a".repeat(64),
  bytes: 32,
  source: "local-blender",
  blenderVersion: "test",
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  createdAt: "2026-09-08T00:00:00.000Z",
};
beforeEach(() => {
  mocks.db.clear();
  mocks.build.mockReset();
  const project = { ...blankProject(), entities: [fixtureEntities()[0]] };
  useOrb.getState().load(project);
  useOrb
    .getState()
    .set({ modelingConnection: connection, selected: project.entities[0].id });
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
      job: {
        version: 1,
        parts: [{ id: "box", shape: "box", color: "#ffffff" }],
      },
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
it("keeps previous geometry until the builder completes and sends no capability upstream", async () => {
  let finish!: (value: unknown) => void;
  mocks.build.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const fetcher = relay();
  const original = structuredClone(
    useOrb.getState().project.entities[0].geometry,
  );
  const running = useOrb.getState().run("Build this model");
  await vi.waitFor(() => expect(mocks.build).toHaveBeenCalledOnce());
  expect(useOrb.getState().project.entities[0].geometry).toEqual(original);
  const body = String(fetcher.mock.calls[0][1]?.body);
  expect(JSON.parse(body).localModeling).toBe(true);
  expect(JSON.parse(body).browserModeling).toBe(false);
  expect(body).not.toContain(connection.token);
  finish(metadata);
  await running;
  expect(useOrb.getState().error).toBe("");
  expect(useOrb.getState().project.entities[0].geometry).toMatchObject({
    kind: "generated",
    model: metadata,
  });
});
it("does not apply a late model after cancellation", async () => {
  let finish!: (value: unknown) => void;
  mocks.build.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  relay();
  const original = structuredClone(
    useOrb.getState().project.entities[0].geometry,
  );
  const running = useOrb.getState().run("Build this model");
  await vi.waitFor(() => expect(mocks.build).toHaveBeenCalledOnce());
  useOrb.getState().stop();
  finish(metadata);
  await running;
  expect(useOrb.getState().project.entities[0].geometry).toEqual(original);
});
it("rejects model-supplied artifact identity and unavailable local construction", async () => {
  relay(metadata);
  await useOrb.getState().run("Build this model");
  expect(useOrb.getState().error).toContain("identities");
  expect(mocks.build).not.toHaveBeenCalled();
  useOrb.getState().set({ modelingConnection: undefined });
  relay();
  await useOrb.getState().run("Build this model");
  expect(useOrb.getState().error).toContain("Connect the local Blender");
  expect(mocks.build).not.toHaveBeenCalled();
});
