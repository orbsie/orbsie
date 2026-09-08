import { expect, it } from "vitest";
import { blankProject } from "../src/lib/protocol";
import { fixtureEntities } from "../src/lib/fixtures";
import {
  generationRunSchema,
  recoveredGenerationInput,
  recoveredGenerationProject,
  type GenerationRun,
} from "../src/lib/generation-journal";

function checkpoint(): GenerationRun {
  const project = { ...blankProject(), entities: fixtureEntities() };
  return {
    id: "recovery-run",
    projectId: project.id,
    sequence: 2,
    state: "interrupted",
    checkpoint: project,
    prompt: "Make this pink",
    selected: project.entities[0].id,
    baseRevision: 0,
    cloudBaselineCurrent: true,
  };
}

it("restores a scoped interrupted edit and its continuation instruction", () => {
  const run = checkpoint();
  const input = recoveredGenerationInput(run);
  expect(input.selected).toBe(run.selected);
  expect(input.prompt).toContain("Preserve completed objects");
  expect(input.prompt.endsWith(run.prompt)).toBe(true);
});

it("preserves every original instruction in a maximum-length prompt", () => {
  const run = {
    ...checkpoint(),
    prompt: "x".repeat(3950) + " Only change the selected object.".padEnd(50),
  };
  expect(run.prompt.length).toBe(4000);
  expect(recoveredGenerationInput(run).prompt).toBe(run.prompt);
});

it("does not select an object removed before the last checkpoint", () => {
  expect(
    recoveredGenerationInput({ ...checkpoint(), selected: "deleted" }).selected,
  ).toBeUndefined();
});

it("does not queue a new request for a completed generation", () => {
  expect(
    recoveredGenerationInput({ ...checkpoint(), state: "complete" }).prompt,
  ).toBe("");
});

it("uses the finished recovery snapshot for both installed geometry and selection", () => {
  const run = checkpoint();
  const ready = structuredClone(run.checkpoint);
  run.checkpoint.entities[0].stage = "coarse";
  run.recoveryCheckpoint = ready;
  expect(recoveredGenerationProject(run)).toEqual(ready);
  expect(recoveredGenerationInput(run).selected).toBe(ready.entities[0].id);
});

it("does not restore a dangling coarse selection from a legacy response", () => {
  const run = checkpoint();
  run.checkpoint.entities[0].stage = "coarse";
  expect(recoveredGenerationInput(run).selected).toBeUndefined();
});

it("rejects recovery snapshots with different identity, revision or unfinished entities", () => {
  const run = checkpoint();
  for (const invalid of [
    { ...run.checkpoint, id: "different" },
    { ...run.checkpoint, revision: run.checkpoint.revision + 1 },
    {
      ...run.checkpoint,
      entities: [{ ...run.checkpoint.entities[0], stage: "coarse" }],
    },
  ])
    expect(
      generationRunSchema.safeParse({ ...run, recoveryCheckpoint: invalid })
        .success,
    ).toBe(false);
});
