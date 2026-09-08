import { expect, it } from "vitest";
import { GameSession } from "../src/lib/game-session";
import { gameProgramSchema } from "../src/lib/game-program";
import { stepGameplay } from "../src/lib/gameplay";
import type { Entity } from "../src/lib/protocol";

it("falls safely when a running rule hides support without restarting score or timers", () => {
  const platform: Entity = {
    id: "support",
    label: "Support",
    stage: "ready",
    position: [0, 2, 0],
    scale: [2, 1, 2],
    color: "#ffffff",
    geometry: { kind: "platform", detail: "refined" },
  };
  const program = gameProgramSchema.parse({
    variables: [],
    rules: [
      {
        id: "reward",
        trigger: { type: "start" },
        actions: [{ type: "add_score", amount: 7 }],
      },
      {
        id: "hide",
        trigger: { type: "input", action: "right" },
        actions: [
          { type: "set_visibility", entityId: "support", visible: false },
        ],
      },
      {
        id: "timer",
        trigger: { type: "timer", seconds: 1 },
        actions: [{ type: "add_score", amount: 2 }],
      },
    ],
  });
  const session = new GameSession();
  session.sync("project", program);
  session.advance(0.04);
  const landed = stepGameplay(
    { position: [0, 2.95, 0], velocityY: -2 },
    { x: 0, z: 0, jump: false },
    [platform],
    ["crystal"],
    0,
    0.02,
  );
  expect(landed.groundedOn).toBe("support");
  session.advance(0.04, ["right"]);
  expect(session.effectiveEntity(platform)).toBeNull();
  let falling = stepGameplay(
    landed,
    { x: 0, z: 0, jump: true },
    [],
    landed.collected,
    0.04,
    0.04,
  );
  expect(falling.velocityY).toBeLessThan(0);
  expect(falling.groundedOn).toBeUndefined();
  expect(falling.collected).toEqual(["crystal"]);
  expect(session.state?.score).toBe(7);
  expect(session.state?.elapsed).toBeCloseTo(0.08);
  expect(session.resetGeneration).toBe(0);
  for (let frame = 0; frame < 100; frame++) {
    session.advance(0.04);
    falling = stepGameplay(
      falling,
      { x: 0, z: 0, jump: false },
      [],
      falling.collected,
      frame * 0.04,
      0.04,
    );
  }
  expect(falling.position).toEqual([0, 0.42, 0]);
  expect(falling.velocityY).toBe(0);
  expect(falling.collected).toEqual(["crystal"]);
  expect(session.state?.score).toBe(9);
  expect(session.state?.elapsed).toBeCloseTo(4.08);
  expect(session.resetGeneration).toBe(0);
});
