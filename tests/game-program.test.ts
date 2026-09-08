import { describe, expect, it } from "vitest";
import {
  GAME_PROGRAM_LIMITS,
  collectGameProgramEntityIds,
  collectGameProgramVariableNames,
  createGameProgramState,
  gameProgramSchema,
  stepGameProgram,
  validateGameProgramReferences,
  type GameProgram,
} from "../src/lib/game-program";

const emptyProgram: GameProgram = { variables: [], rules: [] };

describe("game program schema and references", () => {
  it("rejects dangerous or unknown variables and duplicate rule IDs", () => {
    expect(
      gameProgramSchema.safeParse({
        variables: [{ name: "__proto__", initial: 0 }],
        rules: [],
      }).success,
    ).toBe(false);
    expect(
      gameProgramSchema.safeParse({
        variables: [],
        rules: [
          {
            id: "same",
            trigger: { type: "start" },
            actions: [{ type: "set_variable", name: "missing", value: 1 }],
          },
          { id: "same", trigger: { type: "start" }, actions: [] },
        ],
      }).success,
    ).toBe(false);
  });

  it("collects and validates current-project entity references", () => {
    const program: GameProgram = {
      variables: [{ name: "coins", initial: 0 }],
      rules: [
        {
          id: "collect-coin",
          trigger: { type: "collect", entityId: "coin" },
          conditions: [
            {
              operand: { type: "variable", name: "coins" },
              comparison: "gte",
              value: 0,
            },
          ],
          actions: [
            { type: "add_variable", name: "coins", amount: 1 },
            {
              type: "move_path",
              entityId: "door",
              points: [
                [0, 0, 0],
                [1, 0, 0],
              ],
              duration: 1,
              loop: false,
            },
          ],
        },
      ],
    };
    expect(collectGameProgramEntityIds(program)).toEqual(["coin", "door"]);
    expect(collectGameProgramVariableNames(program)).toEqual(["coins"]);
    expect(() => validateGameProgramReferences(program, ["coin"])).toThrow(
      /door/,
    );
    expect(() =>
      validateGameProgramReferences(program, ["coin", "door"]),
    ).not.toThrow();
  });

  it("keeps prototype-looking rule and entity IDs as data keys", () => {
    const program: GameProgram = {
      variables: [],
      rules: [
        {
          id: "constructor",
          trigger: { type: "timer", seconds: 1, repeat: false },
          conditions: [],
          actions: [
            {
              type: "set_visibility",
              entityId: "__proto__",
              visible: false,
            },
          ],
        },
      ],
    };
    const initial = createGameProgramState(program);
    expect(initial.timerElapsed.constructor).toBe(0);
    const next = stepGameProgram(program, initial, {
      type: "tick",
      delta: 1,
    });
    expect(next.entityOverrides["__proto__"]).toEqual({ visible: false });
    expect(next.timerElapsed.constructor).toBe(0);
  });
});

describe("game program deterministic stepping", () => {
  it("fires start rules once and preserves identity for an unrelated event", () => {
    const program: GameProgram = {
      variables: [{ name: "started", initial: 0 }],
      rules: [
        {
          id: "start-once",
          trigger: { type: "start" },
          conditions: [],
          actions: [{ type: "set_variable", name: "started", value: 1 }],
        },
      ],
    };
    const initial = createGameProgramState(program);
    const unrelated = stepGameProgram(program, initial, {
      type: "click",
      entityId: "other",
    });
    expect(unrelated).toBe(initial);
    const started = stepGameProgram(program, initial, { type: "start" });
    expect(started.variables.started).toBe(1);
    const second = stepGameProgram(program, started, { type: "start" });
    expect(second).toBe(started);
  });

  it("matches conditions and applies variable, score, and entity overrides", () => {
    const program: GameProgram = {
      variables: [{ name: "coins", initial: 2 }],
      rules: [
        {
          id: "coin-click",
          trigger: { type: "click", entityId: "coin" },
          conditions: [
            {
              operand: { type: "variable", name: "coins" },
              comparison: "gte",
              value: 2,
            },
            { operand: { type: "score" }, comparison: "eq", value: 0 },
          ],
          actions: [
            { type: "add_variable", name: "coins", amount: 1 },
            { type: "add_score", amount: 10 },
            { type: "set_color", entityId: "door", color: "#ff00aa" },
            { type: "set_visibility", entityId: "door", visible: false },
            { type: "set_position", entityId: "door", position: [1, 2, 3] },
          ],
        },
      ],
    };
    const next = stepGameProgram(program, createGameProgramState(program), {
      type: "click",
      entityId: "coin",
    });
    expect(next.variables.coins).toBe(3);
    expect(next.score).toBe(10);
    expect(next.entityOverrides.door).toEqual({
      color: "#ff00aa",
      visible: false,
      position: [1, 2, 3],
    });
  });

  it("advances repeat timers with bounded catch-up", () => {
    const program: GameProgram = {
      variables: [],
      rules: [
        {
          id: "pulse",
          trigger: { type: "timer", seconds: 0.1, repeat: true },
          conditions: [],
          actions: [{ type: "add_score", amount: 1 }],
        },
      ],
    };
    const initial = createGameProgramState(program);
    const next = stepGameProgram(program, initial, { type: "tick", delta: 60 });
    expect(next.score).toBe(GAME_PROGRAM_LIMITS.maxTimerCatchupPerRule);
    expect(next.elapsed).toBe(60);
    expect(next.timerElapsed.pulse).toBeCloseTo(0);
  });

  it("does not lose a decimal-boundary timer firing", () => {
    const program: GameProgram = {
      variables: [],
      rules: [
        {
          id: "pulse",
          trigger: { type: "timer", seconds: 0.1, repeat: true },
          conditions: [],
          actions: [{ type: "add_score", amount: 1 }],
        },
      ],
    };
    const next = stepGameProgram(program, createGameProgramState(program), {
      type: "tick",
      delta: 0.3,
    });
    expect(next.score).toBe(3);
    expect(next.timerElapsed.pulse).toBeCloseTo(0);
  });

  it("fires non-repeating timers once even when the condition is false", () => {
    const program: GameProgram = {
      variables: [{ name: "ready", initial: 0 }],
      rules: [
        {
          id: "one-shot",
          trigger: { type: "timer", seconds: 1, repeat: false },
          conditions: [
            {
              operand: { type: "variable", name: "ready" },
              comparison: "eq",
              value: 1,
            },
          ],
          actions: [{ type: "add_score", amount: 5 }],
        },
      ],
    };
    const initial = createGameProgramState(program);
    const afterFirst = stepGameProgram(program, initial, {
      type: "tick",
      delta: 1,
    });
    expect(afterFirst.score).toBe(0);
    const afterReady = stepGameProgram(
      program,
      { ...afterFirst, variables: { ready: 1 } },
      { type: "tick", delta: 1 },
    );
    expect(afterReady.score).toBe(0);
  });

  it("interpolates bounded movement paths and clears completed paths", () => {
    const program: GameProgram = {
      variables: [],
      rules: [
        {
          id: "move",
          trigger: { type: "input", action: "right" },
          conditions: [],
          actions: [
            {
              type: "move_path",
              entityId: "orb",
              points: [
                [0, 0, 0],
                [2, 0, 0],
                [2, 2, 0],
              ],
              duration: 2,
              loop: false,
            },
          ],
        },
      ],
    };
    const initial = createGameProgramState(program);
    const moving = stepGameProgram(program, initial, {
      type: "input",
      action: "right",
    });
    expect(moving.entityOverrides.orb.position).toEqual([0, 0, 0]);
    const halfway = stepGameProgram(program, moving, {
      type: "tick",
      delta: 1,
    });
    expect(halfway.entityOverrides.orb.position).toEqual([2, 0, 0]);
    const finished = stepGameProgram(program, halfway, {
      type: "tick",
      delta: 1,
    });
    expect(finished.entityOverrides.orb.position).toEqual([2, 2, 0]);
    expect(finished.pathStates.orb).toBeUndefined();
  });

  it("cancels an active path when an explicit position is set", () => {
    const program: GameProgram = {
      variables: [],
      rules: [
        {
          id: "move",
          trigger: { type: "input", action: "right" },
          conditions: [],
          actions: [
            {
              type: "move_path",
              entityId: "orb",
              points: [
                [0, 0, 0],
                [10, 0, 0],
              ],
              duration: 10,
              loop: false,
            },
          ],
        },
        {
          id: "teleport",
          trigger: { type: "input", action: "left" },
          conditions: [],
          actions: [
            { type: "set_position", entityId: "orb", position: [3, 4, 5] },
          ],
        },
      ],
    };
    const moving = stepGameProgram(program, createGameProgramState(program), {
      type: "input",
      action: "right",
    });
    const teleported = stepGameProgram(program, moving, {
      type: "input",
      action: "left",
    });
    const afterTick = stepGameProgram(program, teleported, {
      type: "tick",
      delta: 1,
    });
    expect(afterTick.entityOverrides.orb.position).toEqual([3, 4, 5]);
    expect(afterTick.pathStates.orb).toBeUndefined();
  });

  it("stops terminal actions but permits an explicit reset without retriggering start", () => {
    const program: GameProgram = {
      variables: [{ name: "started", initial: 0 }],
      rules: [
        {
          id: "start",
          trigger: { type: "start" },
          conditions: [],
          actions: [{ type: "set_variable", name: "started", value: 1 }],
        },
        {
          id: "win",
          trigger: { type: "click", entityId: "goal" },
          conditions: [],
          actions: [{ type: "win" }, { type: "add_score", amount: 10 }],
        },
        {
          id: "reset",
          trigger: { type: "input", action: "jump" },
          conditions: [],
          actions: [{ type: "reset" }],
        },
      ],
    };
    const started = stepGameProgram(program, createGameProgramState(program), {
      type: "start",
    });
    const won = stepGameProgram(program, started, {
      type: "click",
      entityId: "goal",
    });
    expect(won.status).toBe("won");
    expect(won.score).toBe(0);
    const ignored = stepGameProgram(program, won, {
      type: "input",
      action: "right",
    });
    expect(ignored).toBe(won);
    const reset = stepGameProgram(program, won, {
      type: "input",
      action: "jump",
    });
    expect(reset.status).toBe("playing");
    expect(reset.variables.started).toBe(0);
    expect(reset.firedRuleIds).toEqual([]);
    expect(reset.resetCount).toBe(1);
  });

  it("caps the total actions executed by one event", () => {
    const program: GameProgram = {
      variables: [],
      rules: Array.from({ length: 33 }, (_, index) => ({
        id: `rule-${index}`,
        trigger: { type: "input" as const, action: "left" as const },
        conditions: [],
        actions: Array.from({ length: 8 }, () => ({
          type: "add_score" as const,
          amount: 1,
        })),
      })),
    };
    expect(() =>
      stepGameProgram(program, createGameProgramState(program), {
        type: "input",
        action: "left",
      }),
    ).toThrow(/action budget/);
  });
});
