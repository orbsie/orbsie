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
  await orb.getState().load(original);
  const release = blockedRelay({
    type: "set_geometry",
    id: original.entities[0].id,
    geometry: { kind: "mushroom", detail: "refined" },
  });
  const generation = orb.getState().run("Change the old world");
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
  await orb.getState().load(next);
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
  "keeps a streamed $name edit provisional until its commit marker",
  async ({ command, changed }) => {
    const project = readyProject();
    await orb.getState().load(project);
    await orb.getState().save();
    const release = blockedRelay(command);
    const generation = orb.getState().run("Edit this object");
    await waitFor(() => changed(orb.getState().project));
    expect(db.values.get("orbsie-draft")?.project).toEqual(project);

    release();
    await generation;
    expect(orb.getState().project).toEqual(project);
    expect(db.values.get("orbsie-draft")?.project).toEqual(project);
  },
);

it("keeps unfinished reservations out of an interrupted checkpoint", async () => {
  const project = readyProject();
  await orb.getState().load(project);
  await orb.getState().save();
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
  const generation = orb.getState().run("Build this world");
  await waitFor(() =>
    orb
      .getState()
      .project.entities.some((entity) => entity.id === "finished-new"),
  );
  expect(db.values.get("orbsie-draft")?.project).toEqual(project);
  await reload();
  const recovered = orb.getState().recovered!;
  expect(recovered).toEqual(project);
  expect(
    recovered.entities.some((entity) => entity.id === "unfinished-new"),
  ).toBe(false);
  expect(
    recovered.entities.find((entity) => entity.id === project.entities[0].id),
  ).toEqual(project.entities[0]);
  release();
  await generation;
});

it("restores the last committed project and UI history after a failed edit", async () => {
  const project = readyProject({ entities: fixtureEntities().slice(0, 2) });
  await orb.getState().load(project);
  await orb.getState().save();
  const earlier = { ...project, title: "Earlier title" };
  const redoEntry = { ...project, title: "Future title" };
  orb.getState().set({
    selected: "tree-0",
    history: [earlier],
    future: [redoEntry],
    playing: true,
    score: ["tree-0"],
    won: true,
    lost: false,
    gameScore: 5,
    ruleRestartCount: 2,
    reset: 3,
  });
  const commands: Command[] = [
    { type: "set_material", id: "tree-0", color: "#ff66aa" },
    {
      type: "reserve_entity",
      entity: {
        ...fixtureEntities()[2],
        id: "unfinished-new",
        stage: "seed",
        geometry: undefined,
      },
    },
    { type: "set_material", id: "missing-object", color: "#ffffff" },
  ];
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        `${commands.map((command) => JSON.stringify(command)).join("\n")}\n`,
      ),
  );
  vi.stubGlobal("fetch", fetcher);

  await orb.getState().run("Make the selected tree pink");

  const failed = orb.getState();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(failed.building).toBe(false);
  expect(failed.project.entities).toHaveLength(2);
  expect(failed.project).toEqual(project);
  expect(failed.project.entities[1]).toEqual(project.entities[1]);
  expect(failed.selected).toBe("tree-0");
  expect(failed.playing).toBe(true);
  expect(failed.score).toEqual(["tree-0"]);
  expect(failed.won).toBe(true);
  expect(failed.lost).toBe(false);
  expect(failed.gameScore).toBe(5);
  expect(failed.ruleRestartCount).toBe(2);
  expect(failed.reset).toBe(3);
  expect(failed.history).toEqual([earlier]);
  expect(failed.future).toEqual([redoEntry]);
  expect(db.values.get("orbsie-draft")?.project).toEqual(project);
  expect(failed.error).toBe(
    "The model returned a scene change that could not be applied. Your last working scene is safe.",
  );
  expect(failed.generationRecovery).toEqual({
    projectId: project.id,
    prompt: "Make the selected tree pink",
    selected: "tree-0",
    checkpoint: project,
  });

  // A later selection alone must not make the failed request recover against
  // that object. Undoing or redoing the local revision invalidates the stale
  // checkpoint before a recovery action can restore it.
  orb.getState().set({ selected: "tree-1" });
  expect(orb.getState().generationRecovery).toBeDefined();
  orb.getState().undo();
  expect(orb.getState().generationRecovery).toBeUndefined();
  orb.getState().redo();
  expect(orb.getState().generationRecovery).toBeUndefined();
});

it("restores initial-generation UI state and reports clean EOF without a commit", async () => {
  const project = blankProject();
  await orb.getState().load(project);
  orb.getState().set({
    playing: true,
    score: ["seed"],
    won: true,
    lost: false,
    gameScore: 9,
    ruleRestartCount: 4,
    reset: 2,
  });
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        `${JSON.stringify({ type: "set_environment", sky: "#123456" })}\n`,
      ),
  );

  await orb.getState().run("Create a world that stops early");

  const failed = orb.getState();
  expect(failed.project).toEqual(project);
  expect(failed.phase).toBe("editing");
  expect(failed.playing).toBe(true);
  expect(failed.score).toEqual(["seed"]);
  expect(failed.won).toBe(true);
  expect(failed.gameScore).toBe(9);
  expect(failed.ruleRestartCount).toBe(4);
  expect(failed.reset).toBe(2);
  expect(failed.error).toBe(
    "The model stopped before finishing this scene update. Your last working scene is safe.",
  );
  expect(failed.generationRecovery?.checkpoint).toEqual(project);
});

it("ignores a canceled run's late bytes after a newer committed run", async () => {
  const project = readyProject();
  await orb.getState().load(project);
  await orb.getState().save();
  orb.getState().set({
    selected: "tree-0",
    playing: true,
    score: ["tree-0"],
    won: true,
    gameScore: 5,
  });
  let lateController!: ReadableStreamDefaultController<Uint8Array>;
  let request = 0;
  vi.stubGlobal("fetch", async () => {
    request++;
    if (request === 1) {
      const partial = new TextEncoder().encode(
        `${JSON.stringify({ type: "set_material", id: "tree-0", color: "#123456" })}\n`,
      );
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            lateController = controller;
            controller.enqueue(partial);
          },
        }),
      );
    }
    const commands = [
      { type: "set_material", id: "tree-0", color: "#abcdef" },
      { type: "commit_revision", message: "New run complete." },
    ];
    return new Response(
      `${commands.map((command) => JSON.stringify(command)).join("\n")}\n`,
    );
  });

  const abandoned = orb.getState().run("Abandon this edit");
  await waitFor(() => orb.getState().project.entities[0]?.color === "#123456");
  orb.getState().stop();
  expect(orb.getState().project).toEqual(project);
  expect(orb.getState().selected).toBe("tree-0");
  expect(orb.getState().playing).toBe(true);
  expect(orb.getState().score).toEqual(["tree-0"]);
  expect(orb.getState().won).toBe(true);
  expect(orb.getState().gameScore).toBe(5);

  await orb.getState().run("Start a fresh edit");
  expect(orb.getState().project.entities[0]?.color).toBe("#abcdef");
  lateController.enqueue(
    new TextEncoder().encode(
      `${JSON.stringify({ type: "set_material", id: "tree-0", color: "#ff0000" })}\n${JSON.stringify({ type: "commit_revision", message: "Late stale commit." })}\n`,
    ),
  );
  lateController.close();
  await abandoned;

  expect(orb.getState().project.entities[0]?.color).toBe("#abcdef");
  expect(db.values.get("orbsie-draft")?.project.entities[0]?.color).toBe(
    "#abcdef",
  );
});

it("retains safe server diagnostics for an explicit retry without automatic calls", async () => {
  const project = readyProject();
  await orb.getState().load(project);
  const failure = {
    error: "raw provider detail and secret-node must not be forwarded",
    code: "INVALID_SCENE_UPDATE",
    diagnostic: {
      operation: 2,
      finishReason: "stop",
      issues: [
        {
          code: "invalid_type",
          path: ["geometry", "job", "recipe", "nodes", 2],
          reason: "unreachable_recipe_node",
        },
      ],
    },
  };
  const commit = { type: "commit_revision", message: "Ready." };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(failure)))
    .mockResolvedValueOnce(new Response(`${JSON.stringify(commit)}\n`));
  vi.stubGlobal("fetch", fetcher);

  await orb.getState().run("Repair the selected shape");

  expect(fetcher).toHaveBeenCalledOnce();
  const failed = orb.getState();
  const feedback = failed.generationRecovery?.feedback;
  expect(feedback).toEqual({
    version: 1,
    projectId: project.id,
    code: "INVALID_SCENE_UPDATE",
    finishReason: "stop",
    issues: [
      {
        code: "invalid_type",
        path: ["geometry", "job", "recipe", "nodes", 2],
        reason: "unreachable_recipe_node",
      },
    ],
  });
  expect(JSON.stringify(feedback)).not.toContain("secret-node");

  // No retry is started until this explicit second run.
  await orb
    .getState()
    .run("Repair the selected shape", undefined, undefined, feedback);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const retryPayload = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
  expect(retryPayload.generationFeedback).toEqual(feedback);
  expect(JSON.stringify(retryPayload)).not.toContain("secret-node");
  expect(orb.getState().generationRecovery).toBeUndefined();
});

it("does not reuse failure feedback for a new prompt or a switched project", async () => {
  const project = readyProject();
  await orb.getState().load(project);
  const failure = {
    error: "invalid scene",
    code: "INVALID_SCENE_JSON",
    diagnostic: { finishReason: null, issues: [] },
  };
  const commit = { type: "commit_revision", message: "Ready." };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(`${JSON.stringify(failure)}\n`))
    .mockResolvedValueOnce(new Response(`${JSON.stringify(commit)}\n`));
  vi.stubGlobal("fetch", fetcher);

  await orb.getState().run("First prompt");
  expect(orb.getState().generationRecovery?.feedback).toBeDefined();
  const nextProject = readyProject({ id: crypto.randomUUID() });
  await orb.getState().load(nextProject);
  expect(orb.getState().generationRecovery).toBeUndefined();

  await orb.getState().run("Unrelated new prompt");
  const newPromptPayload = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
  expect(newPromptPayload.generationFeedback).toBeUndefined();
});

it("does not let a delayed old save mark a switched world or draft pointer", async () => {
  const oldProject = readyProject({ title: "Old world" });
  const nextProject = readyProject({
    id: crypto.randomUUID(),
    title: "New world",
  });
  await orb.getState().load(oldProject);
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
  await orb.getState().load(nextProject);
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
  const generation = orb.getState().run("Create a tiny world");
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
  const generation = orb.getState().run("Create a tiny world");
  expect(orb.getState().phase).toBe("descending");
  await generation;
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(orb.getState().phase).toBe("editing");
});

it("preserves a same-project edit arriving while cloud recovery saves its local copy", async () => {
  const original = readyProject();
  await orb.getState().load(original);
  const recovery = { ...original, title: "Cloud checkpoint" };
  const edited = { ...original, title: "New local edit" };
  db.beforeUpdate = async () => {
    db.beforeUpdate = undefined;
    orb.getState().set({ project: edited });
  };
  expect(await orb.getState().loadCloud(recovery)).toBe(false);
  expect(orb.getState().project).toBe(edited);
});

it("reports cloud open as stale if its account scope changes during final save", async () => {
  const original = readyProject();
  await orb.getState().load(original);
  let current = true;
  db.beforeDraftUpdate = async () => {
    db.beforeDraftUpdate = undefined;
    current = false;
  };
  expect(
    await orb.getState().loadCloud(
      { ...original, title: "Cloud" },
      () => current,
      () => current,
    ),
  ).toBe(false);
});

it("accepts its own cross-project installation after the old project scope expires", async () => {
  const original = readyProject();
  await orb.getState().load(original);
  const next = readyProject({ id: crypto.randomUUID() });
  expect(
    await orb
      .getState()
      .loadCloud(next, () => orb.getState().project.id === original.id),
  ).toBe(true);
  expect(orb.getState().project.id).toBe(next.id);
});
