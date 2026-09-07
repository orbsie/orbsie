import { describe, expect, it } from "vitest";
import { fixtureEntities } from "../src/lib/fixtures";
import {
  movingEntityPosition,
  stepGameplay,
  type PlayerState,
} from "../src/lib/gameplay";

const idle = { x: 0, z: 0, jump: false };
const player = (position: [number, number, number]): PlayerState => ({
  position,
  velocityY: 0,
});

describe("gameplay runtime", () => {
  it("lands only after crossing a platform top", () => {
    const platform = fixtureEntities().find((e) => e.id === "platform-1")!;
    const center = movingEntityPosition(platform, 0);
    const top = center[1] + 0.52 * platform.scale[1] + 0.42;
    const landed = stepGameplay(
      { position: [center[0], top + 0.01, center[2]], velocityY: -2 },
      idle,
      [platform],
      [],
      0,
      0.02,
    );
    expect(landed.position[1]).toBeCloseTo(top);
    expect(landed.groundedOn).toBe(platform.id);

    const below = stepGameplay(
      { position: [center[0], top - 0.5, center[2]], velocityY: -2 },
      idle,
      [platform],
      [],
      0,
      0.02,
    );
    expect(below.position[1]).toBeLessThan(top - 0.5);
  });

  it("carries a grounded player by a moving platform displacement", () => {
    const platform = fixtureEntities().find((e) => e.id === "platform-1")!;
    const start = movingEntityPosition(platform, 0);
    const state: PlayerState = {
      position: [start[0], start[1] + 1, start[2]],
      velocityY: 0,
      groundedOn: platform.id,
    };
    const next = stepGameplay(state, idle, [platform], [], 0.04, 0.04);
    const displacement =
      movingEntityPosition(platform, 0.04)[0] - movingEntityPosition(platform, 0)[0];
    expect(next.position[0]).toBeCloseTo(state.position[0] + displacement);
  });

  it("collects the final crystal and wins at the portal in one step", () => {
    const entities = fixtureEntities();
    const portal = entities.find((e) => e.id === "portal")!;
    const finalCrystal = entities.find((e) => e.id === "crystal-4")!;
    finalCrystal.position = [...portal.position];
    const prior = entities
      .filter((e) => e.behavior?.type === "collect" && e.id !== finalCrystal.id)
      .map((e) => e.id);
    const result = stepGameplay(
      player([portal.position[0], 0.42, portal.position[2]]),
      idle,
      entities,
      prior,
      1,
      0.016,
    );
    expect(result.collected).toContain(finalCrystal.id);
    expect(result.won).toBe(true);
  });

  it("keeps collected IDs while compatible edits add objectives", () => {
    const entities = fixtureEntities();
    const prior = ["crystal-0", "crystal-1"];
    entities.push({
      ...entities.find((e) => e.id === "crystal-4")!,
      id: "crystal-new",
      position: [7, 0.8, 7],
    });
    expect(stepGameplay(player([0, 0.42, 5]), idle, entities, prior, 0, 0.016).collected)
      .toEqual(prior);
  });
});
