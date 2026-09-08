import { expect, it } from "vitest";
import { blankProject } from "../src/lib/protocol";
import { fixtureEntities } from "../src/lib/fixtures";
import {
  recoveredGenerationInput,
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
