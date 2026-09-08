import { afterEach, beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => new Map<string, unknown>());
vi.mock("idb-keyval", () => ({
  get: async (key: string) => db.get(key),
  set: async (key: string, value: unknown) => {
    db.set(key, structuredClone(value));
  },
  update: async (key: string, change: (value: unknown) => unknown) => {
    db.set(key, structuredClone(change(db.get(key))));
  },
}));
import { useOrb } from "../src/lib/store";
import { blankProject, type Command, type Project } from "../src/lib/protocol";
import { fixtureEntities } from "../src/lib/fixtures";

beforeEach(() => {
  db.clear();
  useOrb
    .getState()
    .load({ ...blankProject(), entities: [fixtureEntities()[0]] });
});
afterEach(() => vi.unstubAllGlobals());
function relay(commands: Command[]) {
  const text = commands.map((command) => JSON.stringify(command)).join("\n");
  const bytes = new TextEncoder().encode(text);
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            // Exercise a split JSON record and a final record without a newline.
            controller.enqueue(bytes.slice(0, 17));
            controller.enqueue(bytes.slice(17));
            controller.close();
          },
        }),
      ),
  );
}
const finish: Command = { type: "commit_revision", message: "Ready." };
const partial: Command[] = [
  {
    type: "set_geometry",
    id: "tree-0",
    geometry: { kind: "mushroom", detail: "coarse" },
  },
  {
    type: "reserve_entity",
    entity: {
      ...fixtureEntities()[6],
      id: "finished-new",
      stage: "seed",
      geometry: undefined,
    },
  },
  {
    type: "set_geometry",
    id: "finished-new",
    geometry: { kind: "crystal", detail: "refined" },
  },
  {
    type: "reserve_entity",
    entity: {
      ...fixtureEntities()[6],
      id: "unfinished-new",
      stage: "seed",
      geometry: undefined,
    },
  },
];
it.each([false, true])(
  "rejects clean relay EOF without a final commit (earlier commit: %s)",
  async (earlierCommit) => {
    const original = structuredClone(useOrb.getState().project.entities[0]);
    relay(earlierCommit ? [finish, ...partial] : partial);
    await useOrb.getState().run("Change this world");
    const state = useOrb.getState();
    expect(state.error).toContain("before committing");
    expect(state.building).toBe(false);
    expect(state.notice).not.toContain("Your world is saved");
    expect(
      state.project.entities.find((entity) => entity.id === original.id),
    ).toEqual(original);
    expect(
      state.project.entities.find((entity) => entity.id === "finished-new")
        ?.stage,
    ).toBe("ready");
    expect(
      state.project.entities.some((entity) => entity.id === "unfinished-new"),
    ).toBe(false);
    expect(
      (db.get("orbsie-draft") as { project: Project }).project.entities,
    ).toEqual(state.project.entities);
  },
);
it("accepts a final commit without a trailing newline", async () => {
  relay([finish]);
  await useOrb.getState().run("Finish this world");
  expect(useOrb.getState().error).toBe("");
  expect(useOrb.getState().notice).toBe("Your world is saved on this device.");
  expect(useOrb.getState().project.messages.at(-1)?.text).toBe("Ready.");
});
