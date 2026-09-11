import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  values: new Map<string, any>(),
  queue: Promise.resolve(),
  gets: [] as string[],
  cleared: 0,
}));
vi.mock("idb-keyval", () => ({
  get: async (key: string) => {
    db.gets.push(key);
    return structuredClone(db.values.get(key));
  },
  set: async (key: string, value: unknown) => {
    db.values.set(key, structuredClone(value));
  },
  update: (key: string, fn: (value: any) => any) => {
    db.queue = db.queue.then(() => {
      db.values.set(key, structuredClone(fn(db.values.get(key))));
    });
    return db.queue;
  },
  clear: async () => {
    db.cleared += 1;
    db.values.clear();
  },
}));
import { useOrb } from "../src/lib/store";
import { blankProject } from "../src/lib/protocol";

beforeEach(() => {
  db.values.clear();
  db.queue = Promise.resolve();
  db.gets = [];
  db.cleared = 0;
  useOrb.setState({
    recovered: undefined,
    drafts: [],
    draftHistory: {},
    readOnly: false,
    history: [],
    future: [],
  });
});

it("recover reads only the current draft record at mount", async () => {
  const project = { ...blankProject(), title: "Current draft" };
  const other = { ...blankProject(), title: "Library world" };
  db.values.set("orbsie-draft", { project, history: [], future: [] });
  db.values.set("orbsie-library", { [other.id]: other });
  await useOrb.getState().recover();
  expect(db.gets).toEqual(["orbsie-draft"]);
  expect(useOrb.getState().recovered).toEqual(project);
  expect(useOrb.getState().drafts).toEqual([project]);
  expect(useOrb.getState().draftHistory).toEqual({});
});

it("loadDrafts reads the library and dedupes the current draft", async () => {
  const draft = { ...blankProject(), title: "Draft" };
  const libraryCopy = { ...draft, title: "Library copy" };
  const other = { ...blankProject(), title: "Library world" };
  db.values.set("orbsie-draft", { project: draft, history: [], future: [] });
  db.values.set("orbsie-library", {
    [libraryCopy.id]: libraryCopy,
    [other.id]: other,
  });
  await useOrb.getState().recover();
  expect(useOrb.getState().drafts).toEqual([draft]);
  await useOrb.getState().loadDrafts();
  expect(useOrb.getState().drafts.map((p) => p.title)).toEqual([
    "Library copy",
    "Library world",
  ]);
  expect(
    useOrb.getState().drafts.filter((p) => p.id === draft.id),
  ).toHaveLength(1);
});

it("readHistoryFor prefers the history record and rejects malformed entries", async () => {
  const project = { ...blankProject(), title: "Draft", revision: 2 };
  const before = { ...project, title: "Before", revision: 1 };
  db.values.set("orbsie-draft", { project, history: [], future: [] });
  db.values.set("orbsie-history", {
    [project.id]: {
      project,
      history: [before, { invalid: true }, blankProject()],
      future: [],
    },
  });
  const history = await useOrb.getState().readHistoryFor(project);
  expect(history?.history).toEqual([before]);
  expect(useOrb.getState().draftHistory[project.id]).toBeDefined();
});

it("readHistoryFor falls back to the single-draft record format", async () => {
  const project = { ...blankProject(), title: "Draft", revision: 2 };
  const before = { ...project, title: "Before", revision: 1 };
  db.values.set("orbsie-draft", { project, history: [before], future: [] });
  const history = await useOrb.getState().readHistoryFor(project);
  expect(history?.history).toEqual([before]);
});

it("readHistoryFor rejects a draft checkpoint for a different project", async () => {
  const project = { ...blankProject(), title: "Draft", revision: 2 };
  const unrelated = { ...blankProject(), title: "Other" };
  db.values.set("orbsie-draft", { project: unrelated, history: [] });
  expect(await useOrb.getState().readHistoryFor(project)).toBeUndefined();
});

it("resetLocalData clears every local store", async () => {
  const project = blankProject();
  db.values.set("orbsie-draft", { project, history: [], future: [] });
  db.values.set("orbsie-library", { [project.id]: project });
  db.values.set("orbsie-history", { [project.id]: { project, history: [] } });
  useOrb.setState({ recovered: project, drafts: [project] });
  await useOrb.getState().resetLocalData();
  expect(db.cleared).toBe(1);
  expect(db.values.size).toBe(0);
  expect(useOrb.getState().recovered).toBeUndefined();
  expect(useOrb.getState().drafts).toEqual([]);
  expect(useOrb.getState().draftHistory).toEqual({});
});
