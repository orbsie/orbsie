import { describe, expect, it } from "vitest";
import { GameSession } from "../src/lib/game-session";
import { gameProgramSchema } from "../src/lib/game-program";
import { entitySchema } from "../src/lib/protocol";
import { stepGameplay, touchesEntity } from "../src/lib/gameplay";
import {
  resolveRuntimeScene,
  runtimeEntityMatrix,
} from "../src/lib/scene-runtime";
const platform = entitySchema.parse({
  id: "platform",
  label: "Platform",
  position: [0, 0, 0],
  stage: "ready",
  geometry: { kind: "platform" },
});
describe("program physics integration", () => {
  it("composes a moving bounce path with downward contact launch", () => {
    const movingBounce = entitySchema.parse({
      id: "moving-bounce",
      label: "Moving bounce platform",
      position: [0, 1, 0],
      stage: "ready",
      geometry: { kind: "platform", detail: "refined" },
      behavior: { type: "bounce" },
    });
    const tree = entitySchema.parse({
      id: "unrelated-tree",
      label: "Unrelated tree",
      position: [-2, 0, 2],
      stage: "ready",
      geometry: { kind: "tree", detail: "refined" },
      behavior: { type: "static" },
    });
    const program = gameProgramSchema.parse({
      rules: [
        {
          id: "start-platform-path",
          trigger: { type: "start" },
          actions: [
            {
              type: "move_path",
              entityId: movingBounce.id,
              points: [
                [0, 1, 0],
                [2, 1, 0],
              ],
              duration: 2,
              loop: true,
            },
          ],
        },
      ],
    });
    const session = new GameSession();
    session.sync("moving-bounce-world", program);
    session.advance(0);

    const first = session.effectiveEntity(movingBounce)!;
    expect(first.behavior).toEqual({ type: "bounce" });
    expect(first.position).toEqual([0, 1, 0]);
    expect(session.effectiveEntity(tree)).toEqual(tree);
    expect(session.state?.pathStates).toHaveProperty("moving-bounce");
    expect(session.state?.pathStates).not.toHaveProperty("unrelated-tree");

    session.advance(0.04);
    const moved = session.effectiveEntity(movingBounce)!;
    expect(moved.position).toEqual([0.04, 1, 0]);
    expect(moved.behavior).toEqual({ type: "bounce" });
    const scene = resolveRuntimeScene({ entities: [movingBounce, tree] });
    const matrix = runtimeEntityMatrix(
      scene,
      moved,
      0.04,
      session.state?.entityOverrides[movingBounce.id]?.position,
    );
    const platformTop = 1 + 0.52 + 0.42;
    const landed = stepGameplay(
      {
        position: [0.04, platformTop + 0.01, 0],
        velocityY: -2,
      },
      { x: 0, z: 0, jump: false },
      [moved, tree],
      [],
      0.04,
      0.02,
      undefined,
      new Map([[moved.id, matrix]]),
    );
    expect(landed.groundedOn).toBeUndefined();
    expect(landed.velocityY).toBeCloseTo(6 * 1.18);

    session.advance(0.04);
    expect(session.effectiveEntity(movingBounce)?.position).toEqual([
      0.08, 1, 0,
    ]);
    expect(session.state?.pathStates).toHaveProperty("moving-bounce");
    expect(session.effectiveEntity(tree)).toEqual(tree);
  });

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
