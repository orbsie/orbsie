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

it("returns the same collectible and portal contract used by traversal", () => {
  expect(validateProjectGame(projectWithGame())).toEqual({
    collectibleIds,
    collectRuleIds: collectibleIds,
    portalId: "portal",
    ruleCount: 6,
  });
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
