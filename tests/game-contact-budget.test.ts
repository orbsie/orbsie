import { describe, it, expect, vi } from "vitest";
import * as geometry from "../src/lib/geometry";
import {
  registerContactBounds,
  stepGameplay,
  touchesEntity,
} from "../src/lib/gameplay";
import { entitySchema } from "../src/lib/protocol";
import { gameProgramSchema } from "../src/lib/game-program";
import { GameSession } from "../src/lib/game-session";
describe("collision rule preparation budget", () => {
  it("uses renderer-supplied bounds without rebuilding procedural geometry", () => {
    const entity = entitySchema.parse({
      id: "supplied-tree",
      label: "Supplied tree",
      position: [0, 0, 0],
      scale: [2, 3, 2],
      stage: "ready",
      geometry: { kind: "tree", detail: "refined" },
    });
    const bounds = { min: [-0.2, 0, -0.2], max: [0.2, 1, 0.2] };
    const spy = vi.spyOn(geometry, "entityGeometry");
    try {
      registerContactBounds(entity.geometry!, bounds);
      bounds.min[0] = -100;
      bounds.max[0] = 100;
      expect(touchesEntity(entity, [0, 0.5, 0], 0)).toBe(true);
      expect(touchesEntity(entity, [10, 0.5, 0], 0)).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("applies supplied bounds with scale and moving poses", () => {
    const entity = entitySchema.parse({
      id: "moving-supplied",
      label: "Moving supplied",
      position: [0, 0, 0],
      scale: [2, 1, 1],
      stage: "ready",
      behavior: { type: "move", axis: "x", speed: 1, amplitude: 1 },
      geometry: { kind: "custom", detail: "refined" },
    });
    registerContactBounds(entity.geometry!, {
      min: [-1, -0.5, -0.5],
      max: [1, 0.5, 0.5],
    });
    expect(touchesEntity(entity, [3.1, 0, 0], 0)).toBe(false);
    expect(touchesEntity(entity, [3.1, 0, 0], Math.PI / 2)).toBe(true);
    entity.scale = [-2, 1, 1];
    registerContactBounds(entity.geometry!, {
      min: [0, -0.5, -0.5],
      max: [1, 0.5, 0.5],
    });
    expect(touchesEntity(entity, [-1, 0, 0], 0)).toBe(true);
    expect(touchesEntity(entity, [1, 0, 0], 0)).toBe(false);
  });

  it("rejects invalid bounds and does not reuse another recipe identity", () => {
    const recipeA = { kind: "tree", detail: "refined" } as const;
    const recipeB = { kind: "tree", detail: "refined" } as const;
    expect(() =>
      registerContactBounds(recipeA, {
        min: [0, 0, 0],
        max: [Number.POSITIVE_INFINITY, 1, 1],
      }),
    ).toThrow(/finite/);
    expect(() =>
      registerContactBounds(recipeA, {
        min: [1, 0, 0],
        max: [0, 1, 1],
      }),
    ).toThrow(/ordered/);

    registerContactBounds(recipeA, {
      min: [-10, -10, -10],
      max: [10, 10, 10],
    });
    const entity = entitySchema.parse({
      id: "new-recipe",
      label: "New recipe",
      position: [0, 0, 0],
      stage: "ready",
      geometry: recipeB,
    });
    const spy = vi.spyOn(geometry, "entityGeometry");
    try {
      expect(touchesEntity(entity, [2, 0, 0], 0)).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("prepares only subscribed collision targets and does no contact preparation for legacy worlds", () => {
    const entities = Array.from({ length: 40 }, (_, index) =>
      entitySchema.parse({
        id: `tree-${index}`,
        label: "Tree",
        position: [0, 0, 0],
        stage: "ready",
        geometry: { kind: "tree" },
      }),
    );
    const spy = vi.spyOn(geometry, "entityGeometry");
    try {
      const session = new GameSession();
      session.sync("world", undefined);
      const run = () =>
        stepGameplay(
          { position: [0, 0.42, 0], velocityY: 0 },
          { x: 0, z: 0, jump: false },
          entities,
          [],
          0,
          0.016,
          session.collisionTargets,
        );
      expect(run().contacts).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
      session.sync(
        "world",
        gameProgramSchema.parse({
          rules: [
            {
              id: "touch",
              trigger: { type: "collision", entityId: "tree-9" },
              actions: [{ type: "add_score", amount: 1 }],
            },
          ],
        }),
      );
      expect(run().contacts).toEqual(["tree-9"]);
      expect(spy).toHaveBeenCalledTimes(1);
      run();
      expect(spy).toHaveBeenCalledTimes(1);
      session.sync("world", undefined);
      expect(run().contacts).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
  it("retains target selection across equivalent program snapshots and updates edited targets", () => {
    const session = new GameSession();
    const game = gameProgramSchema.parse({
      rules: [
        {
          id: "touch",
          trigger: { type: "collision", entityId: "a" },
          actions: [],
        },
      ],
    });
    session.sync("world", game);
    const original = session.collisionTargets;
    session.sync("world", structuredClone(game));
    expect(session.collisionTargets).toBe(original);
    session.sync("world", {
      ...game,
      rules: [
        { ...game.rules[0], trigger: { type: "collision", entityId: "b" } },
      ],
    });
    expect([...session.collisionTargets]).toEqual(["b"]);
  });
});
