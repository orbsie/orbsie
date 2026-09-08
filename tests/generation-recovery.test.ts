import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  values: new Map<string, any>(),
  queue: Promise.resolve(),
  beforeUpdate: undefined as (() => Promise<void>) | undefined,
  beforeDraftUpdate: undefined as (() => Promise<void>) | undefined,
}));

vi.mock("idb-keyval", () => ({
  get: async (key: string) => structuredClone(db.values.get(key)),
  update: (key: string, change: (value: unknown) => unknown) => {
    db.queue = db.queue.then(async () => {
      if (key === "orbsie-draft") await db.beforeDraftUpdate?.();
      else await db.beforeUpdate?.();
      db.values.set(key, structuredClone(change(db.values.get(key))));
    });
    return db.queue;
  },
}));

import { blankProject, type Command, type Project } from "../src/lib/protocol";
import { fixtureEntities } from "../src/lib/fixtures";

let orb: typeof import("../src/lib/store").useOrb;

async function reload() {
  vi.resetModules();
  orb = (await import("../src/lib/store")).useOrb;
  await orb.getState().recover();
}

async function waitFor(check: () => boolean) {
  await vi.waitFor(() => expect(check()).toBe(true));
}

function blockedRelay(first: Command) {
  const encoder = new TextEncoder();
  const firstLine = encoder.encode(`${JSON.stringify(first)}\n`);
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(firstLine);
          },
          async pull(controller) {
            await released;
            controller.close();
          },
        }),
      ),
  );
  return release;
}

function readyProject(overrides: Partial<Project> = {}): Project {
  return {
    ...blankProject(),
    entities: [fixtureEntities()[0]],
    ...overrides,
  };
}

beforeEach(async () => {
  db.values.clear();
  db.queue = Promise.resolve();
  db.beforeUpdate = undefined;
  db.beforeDraftUpdate = undefined;
  vi.unstubAllGlobals();
  await reload();
});

it("ignores an old stream EOF after switching to a different world", async () => {
  const original = readyProject();
  orb.getState().load(original);
  const release = blockedRelay({
    type: "set_geometry",
    id: original.entities[0].id,
    geometry: { kind: "mushroom", detail: "refined" },
  });
  const generation = orb.getState().run("Change the old world", false);
  await waitFor(
    () => orb.getState().project.entities[0]?.geometry?.kind === "mushroom",
  );

  const next = readyProject({
    id: crypto.randomUUID(),
    entities: [
      {
        ...fixtureEntities()[0],
        stage: "coarse",
        geometry: { kind: "rock", detail: "coarse" },
      },
    ],
  });
  orb.getState().load(next);
  await orb.getState().save();
  release();
  await generation;

  expect(orb.getState().project).toEqual(next);
  expect(orb.getState().building).toBe(false);
  expect(orb.getState().error).toBe("");
  expect(orb.getState().recovered).toEqual(
    expect.objectContaining({ id: next.id }),
  );
  expect(db.values.get("orbsie-draft").project).toEqual(
    expect.objectContaining({ id: next.id }),
  );
  expect(db.values.get("orbsie-draft").project.entities).toEqual([]);
});

it.each([
  {
    name: "material",
    command: {
      type: "set_material",
      id: "tree-0",
      color: "#ff66aa",
    } satisfies Command,
    changed: (project: Project) => project.entities[0].color === "#ff66aa",
  },
  {
    name: "behavior",
    command: {
      type: "set_behavior",
      id: "tree-0",
      behavior: { type: "move", speed: 1, axis: "x", amplitude: 2 },
    } satisfies Command,
    changed: (project: Project) =>
      project.entities[0].behavior?.type === "move",
  },
])(
  "checkpoints a committed $name edit before a blocked stream commits",
  async ({ command, changed }) => {
    const project = readyProject();
    orb.getState().load(project);
    const release = blockedRelay(command);
    const generation = orb.getState().run("Edit this object", false);
    await waitFor(() => {
      const saved = db.values.get("orbsie-draft")?.project as
        Project | undefined;
      return Boolean(saved && changed(saved));
    });

    await reload();
    const recovered = orb.getState().recovered;
    expect(recovered).toBeDefined();
    expect(changed(recovered!)).toBe(true);
    expect(recovered!.entities[0].stage).toBe("ready");

    release();
    await generation;
  },
);

it("keeps unfinished reservations out of an interrupted checkpoint", async () => {
  const project = readyProject();
  orb.getState().load(project);
  const commands: Command[] = [
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
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            const bytes = new TextEncoder().encode(
              commands.map((command) => JSON.stringify(command)).join("\n"),
            );
            controller.enqueue(bytes);
          },
          async pull(controller) {
            await blocked;
            controller.close();
          },
        }),
      ),
  );
  const generation = orb.getState().run("Build this world", false);
  await waitFor(() => {
    const saved = db.values.get("orbsie-draft")?.project as Project | undefined;
    return Boolean(
      saved?.entities.some((entity) => entity.id === "finished-new"),
    );
  });
  await reload();
  const recovered = orb.getState().recovered!;
  expect(
    recovered.entities.some((entity) => entity.id === "finished-new"),
  ).toBe(true);
  expect(
    recovered.entities.some((entity) => entity.id === "unfinished-new"),
  ).toBe(false);
  expect(
    recovered.entities.find((entity) => entity.id === project.entities[0].id),
  ).toEqual(project.entities[0]);
  release();
  await generation;
});

it("does not let a delayed old save mark a switched world or draft pointer", async () => {
  const oldProject = readyProject({ title: "Old world" });
  const nextProject = readyProject({
    id: crypto.randomUUID(),
    title: "New world",
  });
  orb.getState().load(oldProject);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const enteredGate = new Promise<void>((resolve) => {
    entered = resolve;
  });
  db.beforeDraftUpdate = async () => {
    db.beforeDraftUpdate = undefined;
    entered();
    await gate;
  };
  const saving = orb.getState().save();
  await enteredGate;
  orb.getState().load(nextProject);
  const newerPointer = {
    project: nextProject,
    history: [],
    future: [],
    savedAt: Date.now() + 1,
  };
  db.values.set("orbsie-draft", newerPointer);
  release();
  await saving;

  expect(orb.getState().project).toEqual(nextProject);
  expect(orb.getState().saved).toBe(false);
  expect(orb.getState().recovered).toBeUndefined();
  expect(orb.getState().drafts).toEqual([]);
  expect(orb.getState().draftHistory).toEqual({});
  expect(orb.getState().readOnly).toBe(false);
  expect(db.values.get("orbsie-library")[oldProject.id]).toEqual(oldProject);
  expect(db.values.get("orbsie-draft")).toEqual(newerPointer);
});

function stubBrowser(reducedMotion = true) {
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: reducedMotion }),
    addEventListener: () => undefined,
  });
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
}

it("stopping initial generation settles descent in editing", async () => {
  stubBrowser(true);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          async pull(controller) {
            await blocked;
            controller.close();
          },
        }),
      ),
  );
  const generation = orb.getState().run("Create a tiny world", false);
  await waitFor(() => orb.getState().phase === "descending");
  orb.getState().stop();
  expect(orb.getState().phase).toBe("editing");
  release();
  await generation;
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(orb.getState().phase).toBe("editing");
});

it("finishes the landing transition after a fast initial generation", async () => {
  stubBrowser(true);
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({ type: "commit_revision", message: "Ready." }),
      ),
  );
  await orb.getState().run("Create a tiny world", false);
  expect(orb.getState().phase).toBe("descending");
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(orb.getState().phase).toBe("editing");
});
