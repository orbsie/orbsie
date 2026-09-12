import { expect, it } from "vitest";
import { validateProjectGame } from "../scripts/lib/winning-traversal-contract.mjs";

const collectibleIds = [
  "crystal-1",
  "crystal-2",
  "crystal-3",
  "crystal-4",
  "crystal-5",
];

function projectWithGame() {
  return {
    revision: 1,
    entities: [
      ...collectibleIds.map((id) => ({
        id,
        behavior: { type: "collect" },
        position: [0, 0, 0],
      })),
      {
        id: "portal",
        behavior: { type: "portal" },
        position: [0, 0, 0],
      },
    ],
    game: {
      rules: [
        ...collectibleIds.map((entityId) => ({
          trigger: { type: "collect", entityId },
          actions: [{ type: "add_score", amount: 1 }],
        })),
        {
          trigger: { type: "collision", entityId: "portal" },
          conditions: [
            {
              operand: { type: "variable", name: "crystals" },
              comparison: "eq",
              value: 5,
            },
          ],
          actions: [{ type: "win" }],
        },
      ],
    },
  };
}

function projectWithSevenGame() {
  const project: any = projectWithGame();
  const extraIds = ["crystal-6", "crystal-7"];
  project.entities.splice(
    -1,
    0,
    ...extraIds.map((id) => ({
      id,
      behavior: { type: "collect" },
      position: [0, 0, 0],
    })),
  );
  project.game.rules.splice(
    -1,
    0,
    ...extraIds.map((entityId) => ({
      trigger: { type: "collect", entityId },
      actions: [{ type: "add_score", amount: 1 }],
    })),
  );
  const portalRule = project.game.rules.at(-1);
  portalRule.conditions[0].value = 7;
  portalRule.conditions[0].comparison = "gte";
  return project;
}

it("returns the same collectible and portal contract used by traversal", () => {
  expect(validateProjectGame(projectWithGame())).toEqual({
    collectibleIds,
    collectRuleIds: collectibleIds,
    portalId: "portal",
    ruleCount: 6,
  });
});

it("accepts the captured seven-crystal greater-than-or-equal contract explicitly", () => {
  const project = projectWithSevenGame();
  expect(
    validateProjectGame(project, {
      expectedCollectibleCount: 7,
      portalComparison: "gte",
    }),
  ).toEqual({
    collectibleIds: [...collectibleIds, "crystal-6", "crystal-7"],
    collectRuleIds: [...collectibleIds, "crystal-6", "crystal-7"],
    portalId: "portal",
    ruleCount: 8,
  });
  expect(() => validateProjectGame(project)).toThrow(/contain five unique/);
});

it("rejects a project program when its portal gate is missing", () => {
  const project = projectWithGame();
  project.game.rules.pop();
  expect(() => validateProjectGame(project)).toThrow(
    "Flagship game must win on portal collision (portal).",
  );
});

it("does not treat a legacy entity-only snapshot as a program", () => {
  expect(() =>
    validateProjectGame({ entities: projectWithGame().entities }),
  ).toThrow("Flagship snapshot must contain a project.game program.");
});

it("rejects duplicate collection rules and contradictory win paths", () => {
  const duplicateCollection = projectWithGame();
  duplicateCollection.game.rules.splice(1, 0, {
    trigger: { type: "collect", entityId: collectibleIds[0] },
    actions: [{ type: "add_score", amount: 1 }],
  });
  expect(() => validateProjectGame(duplicateCollection)).toThrow(
    /collect each crystal exactly once/,
  );

  const contradictoryWin = projectWithGame();
  contradictoryWin.game.rules.push({
    trigger: { type: "input", key: "up" },
    actions: [{ type: "win" }],
  } as any);
  expect(() => validateProjectGame(contradictoryWin)).toThrow(
    /exactly one winning path/,
  );
});

it("rejects a portal gate with a contradictory crystals condition", () => {
  const project: any = projectWithGame();
  project.game.rules.at(-1).conditions.push({
    operand: { type: "variable", name: "crystals" },
    comparison: "gte",
    value: 5,
  });
  expect(() => validateProjectGame(project)).toThrow(/gated by crystals == 5/);
});
