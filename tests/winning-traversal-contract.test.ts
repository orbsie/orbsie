import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
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
      variables: [{ name: "crystals", initial: 0 }],
      rules: [
        ...collectibleIds.map((entityId) => ({
          trigger: { type: "collect", entityId },
          actions: [
            { type: "add_variable", name: "crystals", amount: 1 },
            { type: "add_score", amount: 1 },
          ],
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
      actions: [
        { type: "add_variable", name: "crystals", amount: 1 },
        { type: "add_score", amount: 1 },
      ],
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
    expectedScore: 5,
    scorePerCollect: 1,
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
    expectedScore: 7,
    scorePerCollect: 1,
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

it("derives the terminal score from the captured ten-point ZIP rules", () => {
  const files = unzipSync(
    readFileSync(
      "docs/evidence/provider-e2e/openrouter-moving-bounce-guidance/openrouter/world.zip",
    ),
  );
  const project = JSON.parse(strFromU8(files["project.json"]));
  expect(
    validateProjectGame(project, {
      expectedCollectibleCount: 5,
      portalComparison: "gte",
    }),
  ).toMatchObject({
    expectedScore: 50,
    scorePerCollect: 10,
    collectibleIds: [
      "crystal1",
      "crystal2",
      "crystal3",
      "crystal4",
      "crystal5",
    ],
  });
});

it("rejects malformed or inconsistent collectible score contracts", () => {
  const uninitialized: any = projectWithGame();
  uninitialized.game.variables[0].initial = 1;
  expect(() => validateProjectGame(uninitialized)).toThrow(
    /initialized to 0/,
  );

  const conditional: any = projectWithGame();
  conditional.game.rules[0].conditions = [
    {
      operand: { type: "variable", name: "crystals" },
      comparison: "eq",
      value: 0,
    },
  ];
  expect(() => validateProjectGame(conditional)).toThrow(/unconditional/);

  const wrongCounter: any = projectWithGame();
  wrongCounter.game.rules[0].actions[0].amount = 2;
  expect(() => validateProjectGame(wrongCounter)).toThrow(
    /increment crystals by exactly 1/,
  );

  const malformedScore: any = projectWithGame();
  malformedScore.game.rules[0].actions[1].amount = 0.5;
  expect(() => validateProjectGame(malformedScore)).toThrow(
    /finite positive integer score amount/,
  );

  const inconsistentScore: any = projectWithGame();
  inconsistentScore.game.rules[1].actions[1].amount = 2;
  expect(() => validateProjectGame(inconsistentScore)).toThrow(
    /one consistent score amount/,
  );
});

it("rejects score and crystals writers outside collectible rules", () => {
  const scoreWriter = projectWithGame();
  scoreWriter.game.rules.push({
    id: "score-on-start",
    trigger: { type: "start" },
    actions: [{ type: "add_score", amount: 1 }],
  } as any);
  expect(() => validateProjectGame(scoreWriter)).toThrow(
    /unrelated score writer/,
  );

  const counterWriter = projectWithGame();
  counterWriter.game.rules.push({
    id: "crystals-on-start",
    trigger: { type: "start" },
    actions: [{ type: "add_variable", name: "crystals", amount: 1 }],
  } as any);
  expect(() => validateProjectGame(counterWriter)).toThrow(
    /unrelated crystals writer/,
  );

  const reset = projectWithGame();
  reset.game.rules.push({
    id: "reset-on-start",
    trigger: { type: "start" },
    actions: [{ type: "reset" }],
  } as any);
  expect(() => validateProjectGame(reset)).toThrow(/cannot use reset actions/);
});
