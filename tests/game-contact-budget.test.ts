import { describe, it, expect, vi } from "vitest";
import * as geometry from "../src/lib/geometry";
import { stepGameplay } from "../src/lib/gameplay";
import { entitySchema } from "../src/lib/protocol";
import { gameProgramSchema } from "../src/lib/game-program";
import { GameSession } from "../src/lib/game-session";
describe("collision rule preparation budget", () => {
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
