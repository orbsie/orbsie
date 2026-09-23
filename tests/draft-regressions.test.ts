import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  values: new Map<string, any>(),
  queue: Promise.resolve(),
  beforeUpdate: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("idb-keyval", () => ({
  get: async (key: string) => structuredClone(db.values.get(key)),
  set: async (key: string, value: unknown) => {
    await Promise.resolve();
    db.values.set(key, structuredClone(value));
  },
  update: (key: string, fn: (value: any) => any) => {
    db.queue = db.queue.then(async () => {
      await db.beforeUpdate?.();
      db.values.set(key, structuredClone(fn(db.values.get(key))));
    });
    return db.queue;
  },
}));
import { useOrb } from "../src/lib/store";
import { blankProject } from "../src/lib/protocol";
import { fixtureEntities } from "../src/lib/fixtures";
import { decodeWorld, encodeWorld } from "../src/lib/export";
beforeEach(() => {
  db.values.clear();
  db.queue = Promise.resolve();
  db.beforeUpdate = undefined;
  useOrb.setState({ readOnly: false, history: [], future: [] });
});
it("reports a recovered exact local revision as saved and clears that status for a changed copy", async () => {
  const project = blankProject();
  useOrb.setState({ drafts: [structuredClone(project)], saved: false });
  await useOrb.getState().load(project);
  expect(useOrb.getState().saved).toBe(true);
  await useOrb.getState().load({ ...project, title: "Unsaved change" });
  expect(useOrb.getState().saved).toBe(false);
});
it.each([1, 2])(
  "discards a cloud open invalidated during persistence step %s and preserves the new draft",
  async (step) => {
    const local = {
      ...blankProject(),
      title: "Previous account draft",
      revision: 1,
    };
    const cloud = { ...local, title: "Previous account cloud", revision: 2 };
    const next = { ...blankProject(), title: "Current draft", revision: 3 };
    await useOrb.getState().load(local);
    await useOrb.getState().save();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let updates = 0,
      valid = true;
    db.beforeUpdate = async () => {
      if (++updates === step) {
        entered();
        await gate;
      }
    };
    const opening = useOrb.getState().loadCloud(cloud, () => valid);
    await waiting;
    valid = false;
    await useOrb.getState().load(next);
    const saving = useOrb.getState().save();
    release();
    await opening;
    await saving;
    expect(useOrb.getState().project).toEqual(next);
    expect(db.values.get("orbsie-draft").project).toEqual(next);
    expect(db.values.get("orbsie-library")[local.id]).toEqual(local);
  },
);
it("retains simultaneous saves of distinct worlds", async () => {
  const a = blankProject(),
    b = blankProject();
  await useOrb.getState().load(a);
  const first = useOrb.getState().save();
  await useOrb.getState().load(b);
  const second = useOrb.getState().save();
  await Promise.all([first, second]);
  expect(Object.keys(db.values.get("orbsie-library")).sort()).toEqual(
    [a.id, b.id].sort(),
  );
});
it("persists undo and redo as newer revisions without making the writer read-only", async () => {
  const before = { ...blankProject(), revision: 1, title: "Before" };
  const after = { ...before, revision: 2, title: "After" };
  useOrb.getState().load(after);
  await useOrb.getState().save();
  useOrb.setState({ history: [before] });
  useOrb.getState().undo();
  await useOrb.getState().save();
  expect(useOrb.getState().readOnly).toBe(false);
  expect(db.values.get("orbsie-library")[after.id]).toMatchObject({
    revision: 3,
    title: "Before",
  });
  useOrb.getState().redo();
  await useOrb.getState().save();
  expect(db.values.get("orbsie-library")[after.id]).toMatchObject({
    revision: 4,
    title: "After",
  });
});
it("preserves distant object positions through undo, local save, and share export", async () => {
  const entity = fixtureEntities()[0];
  const before = {
    ...blankProject(),
    revision: 1,
    entities: [
      { ...entity, position: [1_500, 0, -1_200] as [number, number, number] },
    ],
  };
  const after = {
    ...before,
    revision: 2,
    entities: [
      {
        ...entity,
        position: [500_000, 0, -250_000] as [number, number, number],
      },
    ],
  };
  await useOrb.getState().load(after);
  await useOrb.getState().save();
  useOrb.setState({ history: [before] });

  useOrb.getState().undo();
  await useOrb.getState().save();
  expect(useOrb.getState().project.entities[0].position).toEqual([
    1_500, 0, -1_200,
  ]);

  useOrb.getState().redo();
  await useOrb.getState().save();
  const saved = db.values.get("orbsie-library")[after.id];
  expect(saved.entities[0].position).toEqual([500_000, 0, -250_000]);
  expect(decodeWorld(encodeWorld(saved)).entities[0].position).toEqual([
    500_000, 0, -250_000,
  ]);
});
it("keeps a divergent local branch after loading and saving the same cloud ID", async () => {
  const local = { ...blankProject(), title: "Local branch", revision: 3 };
  await useOrb.getState().load(local);
  await useOrb.getState().save();
  await useOrb.getState().preserveLocalCopy();
  await useOrb
    .getState()
    .load({ ...local, title: "Cloud branch", revision: 4 });
  await useOrb.getState().save();
  const copies = Object.values(
    db.values.get("orbsie-library"),
  ) as (typeof local)[];
  expect(copies.find((p) => p.id === local.id)?.title).toBe("Cloud branch");
  expect(copies.find((p) => p.id !== local.id)).toMatchObject({
    title: "Local branch (local recovery)",
    revision: 3,
  });
});
it("opens a lower cloud revision and saves subsequent edits while retaining the higher local branch", async () => {
  const local = { ...blankProject(), title: "Divergent local", revision: 20 };
  useOrb.getState().load(local);
  await useOrb.getState().save();
  const cloud = { ...local, title: "Cloud choice", revision: 5 };
  await useOrb.getState().loadCloud(cloud);
  expect(db.values.get("orbsie-library")[local.id]).toMatchObject({
    title: "Cloud choice",
    revision: 5,
  });
  useOrb.setState({
    project: { ...cloud, title: "Edited cloud", revision: 6 },
  });
  await useOrb.getState().save();
  expect(useOrb.getState().readOnly).toBe(false);
  const library = db.values.get("orbsie-library");
  expect(library[local.id]).toMatchObject({
    title: "Edited cloud",
    revision: 6,
  });
  expect(
    Object.values(library).some(
      (p: any) =>
        p.id !== local.id &&
        p.title === "Divergent local (local recovery)" &&
        p.revision === 20,
    ),
  ).toBe(true);
});
