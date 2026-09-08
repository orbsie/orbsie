import { describe, expect, it } from "vitest";
import { gameProgramSchema } from "../src/lib/game-program";
import {
  applyOperation,
  blankProject,
  committed,
  projectSchema,
  type Command,
  type Cursor,
  type Project,
} from "../src/lib/protocol";

const game = gameProgramSchema.parse({
  rules: [
    {
      id: "click_goal",
      trigger: { type: "click", entityId: "goal" },
      actions: [{ type: "win" }],
    },
  ],
});
function world(): Project {
  return projectSchema.parse({
    ...blankProject(),
    entities: [
      {
        id: "goal",
        label: "Goal",
        position: [0, 0, 0],
        stage: "ready",
        geometry: { kind: "crystal" },
      },
    ],
  });
}
function apply(project: Project, command: Command) {
  const cursor: Cursor = { runId: "game", sequence: 0, seen: new Set() };
  return applyOperation(
    project,
    {
      version: 1,
      projectId: project.id,
      runId: "game",
      operationId: "one",
      sequence: 1,
      baseRevision: project.revision,
      command,
    },
    cursor,
  ).project;
}
describe("game program project integration", () => {
  it("preserves programs through JSON and committed snapshots", () => {
    const project = apply(world(), { type: "set_game", game });
    expect(
      projectSchema.parse(JSON.parse(JSON.stringify(project))).game,
    ).toEqual(game);
    expect(committed(project).game).toEqual(game);
    expect(project.revision).toBe(1);
  });
  it("rejects unknown references on imported projects and commands", () => {
    expect(() => apply(blankProject(), { type: "set_game", game })).toThrow(
      "Unknown game-program entity",
    );
    expect(projectSchema.safeParse({ ...blankProject(), game }).success).toBe(
      false,
    );
  });
  it("requires completed targets before installing a program", () => {
    const project = world();
    project.entities[0].stage = "seed";
    expect(() => apply(project, { type: "set_game", game })).toThrow(
      "Unknown game-program entity",
    );
  });
  it("rejects referenced entity removal until rules are removed", () => {
    const project = apply(world(), { type: "set_game", game });
    expect(() => apply(project, { type: "remove_entity", id: "goal" })).toThrow(
      "Unknown game-program entity",
    );
    const cleared = apply(project, { type: "set_game", game: null });
    expect(cleared.game).toBeUndefined();
    expect(
      apply(cleared, { type: "remove_entity", id: "goal" }).entities,
    ).toEqual([]);
    expect(project.entities).toHaveLength(1);
  });
  it("retains baseline geometry during rebuild and refuses broken checkpoints", () => {
    const baseline = apply(world(), { type: "set_game", game });
    const rebuilding = structuredClone(baseline);
    rebuilding.entities[0].stage = "seed";
    expect(committed(rebuilding, baseline).entities).toEqual(baseline.entities);
    expect(() => committed(rebuilding)).toThrow("Unknown game-program entity");
  });
  it("preserves newly built rule targets when a later coarse update is rejected", () => {
    const project = apply(world(), { type: "set_game", game });
    const snapshot = structuredClone(project);
    expect(() =>
      apply(project, {
        type: "set_geometry",
        id: "goal",
        geometry: { kind: "tree", detail: "coarse" },
      }),
    ).toThrow("require refined geometry");
    expect(project).toEqual(snapshot);
    expect(committed(project, blankProject())).toEqual(project);
    const refined = apply(project, {
      type: "set_geometry",
      id: "goal",
      geometry: { kind: "tree", detail: "refined" },
    });
    expect(refined.entities[0].geometry?.kind).toBe("tree");
    expect(committed(refined).game).toEqual(game);
    const coarseImport = structuredClone(project);
    coarseImport.entities[0].stage = "coarse";
    expect(projectSchema.safeParse(coarseImport).success).toBe(false);
  });
  it("keeps legacy projects valid without a program", () => {
    expect(committed(world()).game).toBeUndefined();
  });
});
