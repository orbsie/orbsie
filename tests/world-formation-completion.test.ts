import { describe, expect, it, vi } from "vitest";
import { entitySchema } from "../src/lib/protocol";
import {
  formationCanHydrateComplete,
  formationRecipeIdentity,
  formationResourceMatchesRecipe,
  markFormationComplete,
  reconcileFormationCompletionRecords,
  type FormationCompletionRecords,
} from "../src/lib/formation-completion";

function entity(
  id: string,
  detail: "coarse" | "refined" = "refined",
  color = "#6ead60",
) {
  return entitySchema.parse({
    id,
    label: id,
    position: [0, 0, 0],
    stage: "ready",
    color,
    geometry: {
      kind: "custom",
      detail,
      parts: [
        {
          shape: "box",
          position: [0, 0, 0],
          scale: [1, 1, 1],
          rotation: [0, 0, 0],
          color,
        },
      ],
    },
  });
}

function completedRecord(
  records: FormationCompletionRecords,
  projectId: string,
  value: ReturnType<typeof entity>,
) {
  return markFormationComplete(
    records,
    projectId,
    value.id,
    formationRecipeIdentity(value),
    formationRecipeIdentity(value),
    value.stage,
    false,
    false,
    1,
  );
}

describe("formation completion hydration", () => {
  it("hydrates a remount with the same ready recipe across project revisions", () => {
    const records: FormationCompletionRecords = new Map();
    const beforeRemount = entity("formation-a");
    const afterRemount = entity("formation-a");
    const recipe = formationRecipeIdentity(afterRemount);

    expect(completedRecord(records, "project-a", beforeRemount)).toBe(true);
    expect(
      formationCanHydrateComplete(
        records,
        "project-a",
        afterRemount.id,
        recipe,
        recipe,
        afterRemount.stage,
        false,
        false,
      ),
    ).toBe(true);
  });

  it("does not hydrate when geometry or rendered color changes", () => {
    const records: FormationCompletionRecords = new Map();
    const original = entity("formation-a");
    expect(completedRecord(records, "project-a", original)).toBe(true);

    for (const changed of [
      entity("formation-a", "coarse"),
      entity("formation-a", "refined", "#9a6245"),
    ])
      expect(
        formationCanHydrateComplete(
          records,
          "project-a",
          changed.id,
          formationRecipeIdentity(changed),
          formationRecipeIdentity(changed),
          changed.stage,
          false,
          false,
        ),
      ).toBe(false);
  });

  it("records completion only for a finished, ready, successfully loaded resource", () => {
    const records: FormationCompletionRecords = new Map();
    const ready = entity("ready");
    const recipe = formationRecipeIdentity(ready);
    const attempts = [
      ["seed", false, false, 1],
      ["ready", true, false, 1],
      ["ready", false, true, 1],
      ["ready", false, false, 0.99],
      ["ready", false, false, Number.NaN],
    ] as const;

    for (const [stage, pending, failed, progress] of attempts)
      expect(
        markFormationComplete(
          records,
          "project-a",
          ready.id,
          recipe,
          recipe,
          stage,
          pending,
          failed,
          progress,
        ),
      ).toBe(false);
    expect(records.size).toBe(0);

    expect(completedRecord(records, "project-a", ready)).toBe(true);
    for (const [stage, pending, failed] of [
      ["seed", false, false],
      ["ready", true, false],
      ["ready", false, true],
    ] as const)
      expect(
        formationCanHydrateComplete(
          records,
          "project-a",
          ready.id,
          recipe,
          recipe,
          stage,
          pending,
          failed,
        ),
      ).toBe(false);
  });

  it("does not reuse or complete a stale resource after a recipe change", () => {
    const records: FormationCompletionRecords = new Map();
    const previous = entity("formation-a");
    const current = entity("formation-a", "coarse");
    const previousRecipe = formationRecipeIdentity(previous);
    const currentRecipe = formationRecipeIdentity(current);
    expect(completedRecord(records, "project-a", previous)).toBe(true);
    expect(formationResourceMatchesRecipe(previousRecipe, currentRecipe)).toBe(
      false,
    );

    expect(
      formationCanHydrateComplete(
        records,
        "project-a",
        current.id,
        currentRecipe,
        previousRecipe,
        current.stage,
        false,
        false,
      ),
    ).toBe(false);
    expect(
      markFormationComplete(
        records,
        "project-a",
        current.id,
        currentRecipe,
        previousRecipe,
        current.stage,
        false,
        false,
        1,
      ),
    ).toBe(false);
    expect(records.get("project-a")?.get(current.id)).toBe(previousRecipe);
  });

  it("avoids rewriting a completion record on subsequent completed frames", () => {
    const records: FormationCompletionRecords = new Map();
    const ready = entity("formation-a");
    const recipe = formationRecipeIdentity(ready);
    expect(completedRecord(records, "project-a", ready)).toBe(true);
    const setRecord = vi.spyOn(records.get("project-a")!, "set");

    expect(
      markFormationComplete(
        records,
        "project-a",
        ready.id,
        recipe,
        recipe,
        ready.stage,
        false,
        false,
        1,
      ),
    ).toBe(true);
    expect(setRecord).not.toHaveBeenCalled();
  });

  it("clears completed recipes when the project changes, an entity leaves, or its recipe changes", () => {
    const records: FormationCompletionRecords = new Map();
    const retained = entity("retained");
    const removed = entity("removed");
    const changed = entity("changed");
    for (const value of [retained, removed, changed])
      expect(completedRecord(records, "project-a", value)).toBe(true);

    reconcileFormationCompletionRecords(
      records,
      "project-a",
      new Map([
        [retained.id, formationRecipeIdentity(retained)],
        [changed.id, formationRecipeIdentity(entity("changed", "coarse"))],
      ]),
    );
    expect([...records.keys()]).toEqual(["project-a"]);
    expect([...records.get("project-a")!.keys()]).toEqual(["retained"]);

    reconcileFormationCompletionRecords(records, "project-b", new Map());
    expect([...records.keys()]).toEqual(["project-b"]);
    expect(records.get("project-b")?.size).toBe(0);
  });
});
