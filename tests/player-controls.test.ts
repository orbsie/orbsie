import { describe, expect, it } from "vitest";
import { playerControlsHelp } from "../src/lib/player-controls";
import type { GameProgram } from "../src/lib/game-program";
import type { Project } from "../src/lib/protocol";

const movement = "W A S D / Arrow keys to move · Space to jump";

function project(
  overrides: Partial<Pick<Project, "entities" | "game">> = {},
): Pick<Project, "entities" | "game"> {
  return { entities: [], game: undefined, ...overrides };
}

function game(trigger: GameProgram["rules"][number]["trigger"]): GameProgram {
  return {
    variables: [],
    rules: [{ id: "rule", trigger, conditions: [], actions: [] }],
  };
}

describe("standalone player controls help", () => {
  it("keeps the legacy bloom instruction when bloom behavior is enabled", () => {
    expect(
      playerControlsHelp(
        project({
          entities: [
            {
              id: "flower",
              label: "Flower",
              position: [0, 0, 0],
              scale: [1, 1, 1],
              color: "#ffffff",
              stage: "ready",
              behavior: { type: "bloom" },
            } as Project["entities"][number],
          ],
        }),
      ),
    ).toBe(`${movement} · Click flowers to bloom`);
  });

  it("does not promise bloom clicks for a program-driven world", () => {
    expect(
      playerControlsHelp(
        project({ game: game({ type: "input", action: "right" }) }),
      ),
    ).toBe(movement);
  });

  it("describes declared game clicks without exposing model labels", () => {
    expect(
      playerControlsHelp(
        project({
          game: game({ type: "click", entityId: "model-supplied-id" }),
        }),
      ),
    ).toBe(`${movement} · Click objects to interact`);
  });

  it("does not add object instructions when no object interaction is enabled", () => {
    expect(playerControlsHelp(project())).toBe(movement);
  });

  it("uses touch-specific movement help when touch controls are visible", () => {
    expect(playerControlsHelp(project(), true)).toBe(
      "Use the controls below to move and jump",
    );
    expect(
      playerControlsHelp(
        project({ game: game({ type: "click", entityId: "target" }) }),
        true,
      ),
    ).toBe("Use the controls below to move and jump · Tap objects to interact");
  });
});
