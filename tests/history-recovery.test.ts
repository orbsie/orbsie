import { beforeEach, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
const db = vi.hoisted(() => ({
  values: new Map<string, any>(),
  queue: Promise.resolve(),
  beforeGet: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("idb-keyval", () => ({
  get: async (key: string) => {
    await db.beforeGet?.();
    return structuredClone(db.values.get(key));
  },
  set: async (key: string, value: unknown) => {
    db.values.set(key, structuredClone(value));
  },
  update: (key: string, change: (value: any) => any) => {
    db.queue = db.queue.then(() => {
      db.values.set(key, structuredClone(change(db.values.get(key))));
    });
    return db.queue;
  },
}));
let orb: typeof import("../src/lib/store").useOrb;
const reload = async () => {
  await db.queue;
  vi.resetModules();
  orb = (await import("../src/lib/store")).useOrb;
  await orb.getState().recover();
};
beforeEach(async () => {
  db.values.clear();
  db.queue = Promise.resolve();
  db.beforeGet = undefined;
  await reload();
});
it("bounds saved stacks and discards malformed, cross-project, and impossible future revisions", async () => {
  const project = { ...blankProject(), revision: 100 };
  const before = { ...project, title: "Valid before", revision: 99 };
  orb.getState().load(project);
  orb.setState({
    history: Array.from({ length: 30 }, (_, i) => ({
      ...project,
      revision: i,
    })),
    future: Array.from({ length: 30 }, (_, i) => ({
      ...project,
      revision: i + 30,
    })),
  });
  await orb.getState().save();
  await reload();
  orb.getState().load(orb.getState().recovered!);
  expect(orb.getState().history).toHaveLength(20);
  expect(orb.getState().history[0].revision).toBe(10);
  expect(orb.getState().future).toHaveLength(20);
  const records = db.values.get("orbsie-history");
  records[project.id].history = [blankProject(), { invalid: true }, before];
  records[project.id].future = [null, { ...project, revision: 101 }];
  db.values.set("orbsie-history", records);
  db.values.set("orbsie-library", {
    ...db.values.get("orbsie-library"),
    malformed: { invalid: true },
    wrongKey: before,
  });
  await reload();
  orb.getState().load(orb.getState().recovered!);
  expect(orb.getState().history).toEqual([before]);
  expect(orb.getState().future).toEqual([]);
  expect(orb.getState().drafts).toHaveLength(1);
});
it("does not restore history onto a different snapshot with the same project ID and revision", async () => {
  const project = { ...blankProject(), revision: 2 };
  const before = { ...project, revision: 1 };
  orb.getState().load(project);
  orb.setState({ history: [before] });
  await orb.getState().save();
  const cloud = { ...project, title: "Different cloud content" };
  db.values.set("orbsie-library", { [cloud.id]: cloud });
  db.values.set("orbsie-draft", { project: cloud });
  await reload();
  orb.getState().load(orb.getState().recovered!);
  expect(orb.getState().project).toEqual(cloud);
  expect(orb.getState().history).toEqual([]);
  expect(orb.getState().future).toEqual([]);
});
it("does not replace recovered metadata when a different project opens during recovery", async () => {
  const project = { ...blankProject(), revision: 2 };
  db.values.set("orbsie-draft", {
    project,
    history: [{ ...project, revision: 1 }],
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  db.beforeGet = () => gate;
  const recovery = orb.getState().recover();
  const next = { ...blankProject(), title: "Selected while loading" };
  orb.getState().load(next);
  release();
  await recovery;
  expect(orb.getState().project).toEqual(next);
  expect(orb.getState().history).toEqual([]);
  expect(orb.getState().recovered).toBeUndefined();
});
it("does not persist history for a rejected stale library save", async () => {
  const project = { ...blankProject(), revision: 3 };
  orb.getState().load(project);
  orb.setState({ history: [{ ...project, revision: 2 }] });
  await orb.getState().save();
  const record = structuredClone(db.values.get("orbsie-history")[project.id]);
  orb.getState().load({ ...project, revision: 1 });
  orb.setState({ history: [{ ...project, revision: 0 }] });
  await orb.getState().save();
  expect(orb.getState().readOnly).toBe(true);
  expect(db.values.get("orbsie-history")[project.id]).toEqual(record);
});
it("restores undo and redo across fresh module reloads while revisions keep increasing", async () => {
  const before = { ...blankProject(), title: "Before", revision: 1 };
  const current = { ...before, title: "After", revision: 2 };
  orb.getState().load(current);
  orb.setState({ history: [before] });
  await orb.getState().save();
  await reload();
  orb.getState().load(orb.getState().recovered!);
  expect(orb.getState().history).toEqual([before]);
  orb.getState().undo();
  await orb.getState().save();
  expect(orb.getState().project).toMatchObject({
    title: "Before",
    revision: 3,
  });
  await reload();
  orb.getState().load(orb.getState().recovered!);
  expect(orb.getState().future).toEqual([current]);
  orb.getState().redo();
  await orb.getState().save();
  expect(orb.getState().project).toMatchObject({ title: "After", revision: 4 });
  expect(orb.getState().readOnly).toBe(false);
});
it("recovers each project's own history when opening a saved library world", async () => {
  const a = { ...blankProject(), title: "A", revision: 2 };
  const b = { ...blankProject(), title: "B", revision: 2 };
  for (const project of [a, b]) {
    orb.getState().load(project);
    orb.setState({
      history: [{ ...project, title: `${project.title} before`, revision: 1 }],
    });
    await orb.getState().save();
  }
  await reload();
  orb
    .getState()
    .load(orb.getState().drafts.find((project) => project.id === a.id)!);
  expect(orb.getState().history[0]?.title).toBe("A before");
  orb
    .getState()
    .load(orb.getState().drafts.find((project) => project.id === b.id)!);
  expect(orb.getState().history[0]?.title).toBe("B before");
});
it("retains history from the older single-draft record format", async () => {
  const project = { ...blankProject(), revision: 2 };
  const before = { ...project, revision: 1 };
  db.values.set("orbsie-draft", { project, history: [before] });
  await reload();
  orb.getState().load(orb.getState().recovered!);
  expect(orb.getState().history).toEqual([before]);
  expect(orb.getState().future).toEqual([]);
});
