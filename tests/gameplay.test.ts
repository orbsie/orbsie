import { describe, expect, it } from "vitest";
import { fixtureEntities } from "../src/lib/fixtures";
import type { Entity } from "../src/lib/protocol";
import { requireCatalogAsset } from "../src/lib/asset-catalog";
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
  it("uses scaled catalog bounds for platforms and excludes unfinished assets", () => {
    const platform: Entity = {
      id: "catalog-platform",
      label: "Grass platform",
      position: [0, 2, 0],
      scale: [2, 3, 2],
      color: "#ffffff",
      stage: "ready",
      geometry: {
        kind: "asset",
        assetId: "kenney.nature.platform-grass",
        detail: "refined",
      },
    };
    const bounds = requireCatalogAsset("kenney.nature.platform-grass").bounds;
    const top = 2 + bounds.max[1] * 3 + 0.42;
    const falling: PlayerState = {
      position: [0, top + 0.01, 0],
      velocityY: -2,
    };
    const landed = stepGameplay(falling, idle, [platform], [], 0, 0.02);
    expect(landed.groundedOn).toBe(platform.id);
    expect(landed.position[1]).toBeCloseTo(top);
    const pending = stepGameplay(
      falling,
      idle,
      [{ ...platform, stage: "seed" }],
      [],
      0,
      0.02,
    );
    expect(pending.groundedOn).toBeUndefined();
  });
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
      supportPosition: start,
    };
    const next = stepGameplay(state, idle, [platform], [], 0.04, 0.04);
    const displacement =
      movingEntityPosition(platform, 0.04)[0] -
      movingEntityPosition(platform, 0)[0];
    expect(next.position[0]).toBeCloseTo(state.position[0] + displacement);
  });

  it("reconciles a compatible platform speed edit from its last pose", () => {
    const platform = fixtureEntities().find((e) => e.id === "platform-1")!;
    const oldPose = movingEntityPosition(platform, 1);
    const edited = {
      ...platform,
      behavior: { ...platform.behavior!, speed: 0.2 },
    };
    const newPose = movingEntityPosition(edited, 1.016);
    const result = stepGameplay(
      {
        position: [oldPose[0] + 0.2, 1.4, oldPose[2]],
        velocityY: 0,
        groundedOn: platform.id,
        supportPosition: oldPose,
      },
      idle,
      [edited],
      [],
      1.016,
      0.016,
    );
    expect(result.position[0]).toBeCloseTo(newPose[0] + 0.2);
  });

  it("requires 3D contact for elevated, scaled, and moving pickup poses", () => {
    const crystal = fixtureEntities().find((e) => e.id === "crystal-0")!;
    const elevated = stepGameplay(
      player([crystal.position[0], 0.42, crystal.position[2]]),
      idle,
      [{ ...crystal, position: [crystal.position[0], 3, crystal.position[2]] }],
      [],
      0,
      0,
    );
    expect(elevated.collected).toEqual([]);

    // The scaled crystal reaches the avatar with its actual custom geometry
    // even though its center is more than the old 0.85 X/Z radius away.
    const scaled = {
      ...crystal,
      id: "scaled-crystal",
      position: [1, 0.8, 0] as [number, number, number],
      scale: [3, 3, 3] as [number, number, number],
    };
    const scaledResult = stepGameplay(
      player([2, 0.42, 0]),
      idle,
      [scaled],
      [],
      0,
      0,
    );
    expect(scaledResult.collected).toContain(scaled.id);

    // A moving pickup is represented by the current pose supplied by the
    // project snapshot; only the pose that reaches the avatar is collected.
    const movingHigh = {
      ...crystal,
      id: "moving-crystal",
      position: [0, 3, 0] as [number, number, number],
    };
    const movingLow = {
      ...movingHigh,
      position: [0, 0.8, 0] as [number, number, number],
    };
    expect(
      stepGameplay(player([0, 0.42, 0]), idle, [movingHigh], [], 0, 0)
        .collected,
    ).toEqual([]);
    expect(
      stepGameplay(player([0, 0.42, 0]), idle, [movingLow], [], 0, 0).collected,
    ).toContain(movingLow.id);
  });

  it("does not win at an elevated portal from underneath", () => {
    const portal = fixtureEntities().find((e) => e.id === "portal")!;
    const elevatedPortal = {
      ...portal,
      position: [0, 3, 0] as [number, number, number],
    };
    const result = stepGameplay(
      player([0, 0.42, 0]),
      idle,
      [elevatedPortal],
      [],
      0,
      0,
    );
    expect(result.won).toBe(false);
  });

  it.each([
    ["grows", 1.8],
    ["shrinks", 0.45],
  ])(
    "keeps a rider on the rendered surface when a platform %s",
    (_, scaleY) => {
      const platform = fixtureEntities().find((e) => e.id === "platform-1")!;
      const pose = movingEntityPosition(platform, 1);
      const oldTop = pose[1] + 0.52 * platform.scale[1] + 0.42;
      const edited = {
        ...platform,
        scale: [platform.scale[0], scaleY, platform.scale[2]] as [
          number,
          number,
          number,
        ],
      };
      const expectedTop =
        movingEntityPosition(edited, 1.016)[1] + 0.52 * scaleY + 0.42;
      const result = stepGameplay(
        {
          position: [pose[0], oldTop, pose[2]],
          velocityY: 0,
          groundedOn: platform.id,
          supportPosition: pose,
          supportTop: oldTop,
        },
        idle,
        [edited],
        [],
        1.016,
        0.016,
      );

      expect(result.position[1]).toBeCloseTo(expectedTop);
      expect(result.supportTop).toBeCloseTo(expectedTop);
      expect(result.groundedOn).toBe(platform.id);
    },
  );

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
    expect(
      stepGameplay(player([0, 0.42, 5]), idle, entities, prior, 0, 0.016)
        .collected,
    ).toEqual(prior);
  });

  it("does not let a removed collectible satisfy a replacement objective", () => {
    const entities = fixtureEntities();
    const portal = entities.find((e) => e.id === "portal")!;
    const replacement = {
      ...entities.find((e) => e.id === "crystal-0")!,
      id: "crystal-replacement",
      position: [0, 0.8, 0] as [number, number, number],
    };
    const current = entities.filter(
      (e) => e.behavior?.type !== "collect" || e.id === "crystal-0",
    );
    current[current.findIndex((e) => e.id === "crystal-0")] = replacement;

    const result = stepGameplay(
      player([portal.position[0], 0.42, portal.position[2]]),
      idle,
      current,
      ["crystal-0"],
      0,
      0.016,
    );

    expect(result.collected).toEqual(["crystal-0"]);
    expect(result.won).toBe(false);
  });

  it("preserves removed collectible history after completing current objectives", () => {
    const entities = fixtureEntities();
    const portal = entities.find((e) => e.id === "portal")!;
    const replacement = {
      ...entities.find((e) => e.id === "crystal-0")!,
      id: "crystal-replacement",
      position: [...portal.position] as [number, number, number],
    };
    const current = entities.filter((e) => e.behavior?.type !== "collect");
    current.push(replacement);

    const result = stepGameplay(
      player([portal.position[0], 0.42, portal.position[2]]),
      idle,
      current,
      ["crystal-0"],
      0,
      0.016,
    );

    expect(result.collected).toEqual(["crystal-0", "crystal-replacement"]);
    expect(result.won).toBe(true);
  });
});
