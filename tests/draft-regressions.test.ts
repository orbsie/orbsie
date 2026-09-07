import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  values: new Map<string, any>(),
  queue: Promise.resolve(),
}));
vi.mock("idb-keyval", () => ({
  get: async (key: string) => structuredClone(db.values.get(key)),
  set: async (key: string, value: unknown) => {
    await Promise.resolve();
    db.values.set(key, structuredClone(value));
  },
  update: (key: string, fn: (value: any) => any) => {
    db.queue = db.queue.then(() => {
      db.values.set(key, structuredClone(fn(db.values.get(key))));
    });
    return db.queue;
  },
}));
import { useOrb } from "../src/lib/store";
import { blankProject } from "../src/lib/protocol";
beforeEach(() => {
  db.values.clear();
  db.queue = Promise.resolve();
  useOrb.setState({ readOnly: false, history: [], future: [] });
});
it("retains simultaneous saves of distinct worlds", async () => {
  const a = blankProject(),
    b = blankProject();
  useOrb.getState().load(a);
  const first = useOrb.getState().save();
  useOrb.getState().load(b);
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
it("keeps a divergent local branch after loading and saving the same cloud ID", async () => {
  const local = { ...blankProject(), title: "Local branch", revision: 3 };
  useOrb.getState().load(local);
  await useOrb.getState().save();
  await useOrb.getState().preserveLocalCopy();
  useOrb.getState().load({ ...local, title: "Cloud branch", revision: 4 });
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
