import { describe, expect, it } from "vitest";
import { GameSession } from "../src/lib/game-session";
import { gameProgramSchema } from "../src/lib/game-program";
import { entitySchema } from "../src/lib/protocol";
import { stepGameplay, touchesEntity } from "../src/lib/gameplay";
const platform = entitySchema.parse({
  id: "platform",
  label: "Platform",
  position: [0, 0, 0],
  stage: "ready",
  geometry: { kind: "platform" },
});
describe("program physics integration", () => {
  it("applies program position to platform support and excludes hidden colliders", () => {
    const session = new GameSession();
    session.sync(
      "world",
      gameProgramSchema.parse({
        rules: [
          {
            id: "move",
            trigger: { type: "start" },
            actions: [
              {
                type: "set_position",
                entityId: "platform",
                position: [3, 2, 0],
              },
            ],
          },
          {
            id: "hide",
            trigger: { type: "input", action: "jump" },
            actions: [
              { type: "set_visibility", entityId: "platform", visible: false },
            ],
          },
        ],
      }),
    );
    session.advance(0);
    const moved = session.effectiveEntity(platform)!;
    const top = 2 + 0.52 + 0.42;
    const falling = {
      position: [3, top + 0.01, 0] as [number, number, number],
      velocityY: -2,
    };
    const result = stepGameplay(
      falling,
      { x: 0, z: 0, jump: false },
      [moved],
      [],
      0,
      0.02,
    );
    expect(result.groundedOn).toBe("platform");
    expect(result.contacts).toContain("platform");
    session.advance(0, ["jump"]);
    expect(session.effectiveEntity(platform)).toBeNull();
    expect(
      stepGameplay(falling, { x: 0, z: 0, jump: false }, [], [], 0, 0.02)
        .groundedOn,
    ).toBeUndefined();
  });
  it("uses multipart geometry and scaled bounds for contact events", () => {
    const entity = entitySchema.parse({
      id: "custom",
      label: "Offset model",
      position: [2, 0, 0],
      scale: [-2, 1, 1],
      stage: "ready",
      geometry: {
        kind: "custom",
        parts: [
          {
            shape: "box",
            position: [1, 1, 0],
            scale: [1, 1, 1],
            color: "#ffffff",
          },
        ],
      },
    });
    expect(touchesEntity(entity, [0, 1, 0], 0)).toBe(true);
    expect(touchesEntity(entity, [3, 1, 0], 0)).toBe(false);
    expect(touchesEntity({ ...entity, stage: "seed" }, [0, 1, 0], 0)).toBe(
      false,
    );
  });
});
