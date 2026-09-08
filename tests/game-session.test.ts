import { describe, expect, it } from "vitest";
import { GameSession } from "../src/lib/game-session";
import { gameProgramSchema, type GameProgram } from "../src/lib/game-program";
import type { Entity } from "../src/lib/protocol";

function session(program: GameProgram, reset = 0) {
  const value = new GameSession();
  value.sync("project", program, reset);
  return value;
}

describe("GameSession", () => {
  it("starts once, emits input edges, and clamps each tick to 0.04 seconds", () => {
    const program: GameProgram = {
      variables: [
        { name: "starts", initial: 0 },
        { name: "inputs", initial: 0 },
      ],
      rules: [
        {
          id: "start",
          trigger: { type: "start" },
          conditions: [],
          actions: [{ type: "add_variable", name: "starts", amount: 1 }],
        },
        {
          id: "right",
          trigger: { type: "input", action: "right" },
          conditions: [],
          actions: [{ type: "add_variable", name: "inputs", amount: 1 }],
        },
        {
          id: "timer",
          trigger: { type: "timer", seconds: 0.03, repeat: true },
          conditions: [],
          actions: [{ type: "add_score", amount: 1 }],
        },
      ],
    };
    const value = session(program);
    value.advance(1, ["right"]);
    expect(value.state?.variables.starts).toBe(1);
    expect(value.state?.variables.inputs).toBe(1);
    expect(value.state?.elapsed).toBe(0.04);
    expect(value.state?.score).toBe(1);

    value.advance(0.04, ["right"]);
    expect(value.state?.variables.inputs).toBe(1);
    value.advance(0.04, []);
    value.advance(0.04, ["right"]);
    expect(value.state?.variables.starts).toBe(1);
    expect(value.state?.variables.inputs).toBe(2);
  });

  it("keeps equivalent program edits running while project or restart changes reset", () => {
    const program: GameProgram = {
      variables: [{ name: "score", initial: 0 }],
      rules: [
        {
          id: "click",
          trigger: { type: "click", entityId: "orb" },
          conditions: [],
          actions: [{ type: "add_variable", name: "score", amount: 1 }],
        },
      ],
    };
    const value = session(program);
    value.advance(0, []);
    value.queueClick("orb");
    value.advance(0, []);
    const runningState = value.state;
    const generation = value.resetGeneration;

    const equivalent = {
      rules: [
        {
          actions: [
            { amount: 1, name: "score", type: "add_variable" as const },
          ],
          conditions: [],
          id: "click",
          trigger: { entityId: "orb", type: "click" as const },
        },
      ],
      variables: [{ initial: 0, name: "score" }],
    } satisfies GameProgram;
    expect(value.sync("project", equivalent, 0)).toBeUndefined();
    expect(value.state).toBe(runningState);
    expect(value.resetGeneration).toBe(generation);

    expect(value.sync("project", equivalent, 1)).toBeUndefined();
    expect(value.state?.variables.score).toBe(0);
    expect(value.resetGeneration).toBe(generation + 1);
    expect(value.sync("another-project", equivalent, 1)).toBeUndefined();
    expect(value.state?.variables.score).toBe(0);
    expect(value.resetGeneration).toBe(generation + 2);
    expect(value.sync("another-project", undefined, 1)).toBe("rules-changed");
    expect(value.state).toBeUndefined();
    expect(value.sync("another-project", undefined, 1)).toBeUndefined();
    expect(value.sync("another-project", equivalent, 1)).toBe("rules-changed");
    expect(value.state?.variables.score).toBe(0);
  });

  it("bounds queued clicks and emits contact rising edges", () => {
    const program: GameProgram = {
      variables: [
        { name: "clicks", initial: 0 },
        { name: "hits", initial: 0 },
      ],
      rules: [
        {
          id: "click",
          trigger: { type: "click", entityId: "orb" },
          conditions: [],
          actions: [{ type: "add_variable", name: "clicks", amount: 1 }],
        },
        {
          id: "collision",
          trigger: { type: "collision", entityId: "wall" },
          conditions: [],
          actions: [{ type: "add_variable", name: "hits", amount: 1 }],
        },
      ],
    };
    const value = session(program);
    value.advance(0, []);
    for (let index = 0; index < 65; index += 1) value.queueClick("orb");
    value.advance(0, []);
    expect(value.state?.variables.clicks).toBe(64);

    value.emitContacts(["wall"]);
    value.emitContacts(["wall"]);
    value.emitContacts([]);
    value.emitContacts(["wall"]);
    expect(value.state?.variables.hits).toBe(2);
  });

  it("emits collections once for the session", () => {
    const program: GameProgram = {
      variables: [{ name: "collected", initial: 0 }],
      rules: [
        {
          id: "collect",
          trigger: { type: "collect", entityId: "coin" },
          conditions: [],
          actions: [{ type: "add_variable", name: "collected", amount: 1 }],
        },
      ],
    };
    const value = session(program);
    value.advance(0, []);
    value.emitCollections(["coin", "coin"]);
    value.emitCollections(["coin"]);
    expect(value.state?.variables.collected).toBe(1);
  });

  it("increments resetGeneration and starts again on the next frame without recursion", () => {
    const program: GameProgram = {
      variables: [{ name: "started", initial: 0 }],
      rules: [
        {
          id: "start",
          trigger: { type: "start" },
          conditions: [],
          actions: [{ type: "add_variable", name: "started", amount: 1 }],
        },
        {
          id: "restart",
          trigger: { type: "input", action: "jump" },
          conditions: [],
          actions: [{ type: "reset" }],
        },
      ],
    };
    const value = session(program);
    value.advance(0, []);
    expect(value.state?.variables.started).toBe(1);
    value.advance(0, ["jump"]);
    expect(value.state?.variables.started).toBe(0);
    expect(value.resetGeneration).toBe(1);
    value.advance(0, []);
    expect(value.state?.variables.started).toBe(1);
    expect(value.resetGeneration).toBe(1);
  });

  it("applies visibility, color, and position overrides while disabling legacy movement", () => {
    const program: GameProgram = {
      variables: [],
      rules: [
        {
          id: "paint",
          trigger: { type: "click", entityId: "source" },
          conditions: [],
          actions: [
            { type: "set_color", entityId: "source", color: "#ff00aa" },
            { type: "set_position", entityId: "source", position: [3, 4, 5] },
          ],
        },
      ],
    };
    const value = session(program);
    value.advance(0, []);
    value.queueClick("source");
    value.advance(0, []);
    const entity = {
      id: "source",
      label: "Source",
      position: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      color: "#ffffff",
      stage: "ready",
      behavior: { type: "move", axis: "y", speed: 1, amplitude: 1 },
    } satisfies Entity;
    expect(value.effectiveEntity(entity)).toMatchObject({
      color: "#ff00aa",
      position: [3, 4, 5],
      behavior: undefined,
    });

    const hiddenProgram: GameProgram = {
      variables: [],
      rules: [
        {
          id: "hide",
          trigger: { type: "click", entityId: "source" },
          conditions: [],
          actions: [
            { type: "set_visibility", entityId: "source", visible: false },
          ],
        },
      ],
    };
    value.sync("project", hiddenProgram, 1);
    value.advance(0, []);
    value.queueClick("source");
    value.advance(0, []);
    expect(value.effectiveEntity(entity)).toBeNull();
  });

  it("preserves the last valid state and stops after an engine error", () => {
    const program: GameProgram = {
      variables: [{ name: "value", initial: 0 }],
      rules: [
        {
          id: "click",
          trigger: { type: "click", entityId: "orb" },
          conditions: [],
          actions: [{ type: "add_variable", name: "value", amount: 1 }],
        },
      ],
    };
    const value = session(program);
    value.advance(0, []);
    const before = value.state;
    const invalid = {
      ...program,
      rules: [
        { ...program.rules[0], trigger: { type: "click", entityId: "bad id" } },
      ],
    } as unknown as GameProgram;
    value.sync("project", invalid, 0);
    expect(value.error).toBeDefined();
    expect(value.state).toBe(before);
    value.queueClick("orb");
    value.advance(0, []);
    expect(value.state).toBe(before);
  });
});

it("preserves separate input press edges between frames without held-key repeats", () => {
  const session = new GameSession();
  session.sync(
    "world",
    gameProgramSchema.parse({
      rules: [
        {
          id: "tap",
          trigger: { type: "input", action: "right" },
          actions: [{ type: "add_score", amount: 7 }],
        },
      ],
    }),
  );
  session.queueInput("right");
  session.queueInput("right");
  session.advance(0.04);
  expect(session.state?.score).toBe(14);
  session.advance(0.04);
  expect(session.state?.score).toBe(14);
  session.queueInput("right");
  session.sync("world", undefined, 1);
  session.advance(0.04);
  expect(session.state).toBeUndefined();
});
