import { describe, expect, it } from "vitest";
import { fixtureEntities } from "../src/lib/fixtures";
import type { Entity } from "../src/lib/protocol";
import { requireCatalogAsset } from "../src/lib/asset-catalog";
import {
  createGameProgramState,
  stepGameProgram,
  type GameProgram,
} from "../src/lib/game-program";
import {
  movingEntityPosition,
  playerSpawnForProject,
  stepGameplay,
  type PlayerState,
} from "../src/lib/gameplay";
import { resolveSceneTransforms } from "../src/lib/scene-transform";

const idle = { x: 0, z: 0, jump: false };
const player = (position: [number, number, number]): PlayerState => ({
  position,
  velocityY: 0,
});
const solidWall = (
  id = "wall",
  height = 1.5,
  stage: Entity["stage"] = "ready",
): Entity => ({
  id,
  label: "Solid wall",
  position: [0, 0, 0],
  scale: [1, 1, 1],
  color: "#ffffff",
  stage,
  geometry: {
    kind: "custom",
    detail: "refined",
    parts: [
      {
        shape: "box",
        position: [0, height / 2, 0],
        scale: [0.08, height, 3],
        color: "#ffffff",
      },
    ],
  },
  behavior: { type: "solid" },
});

describe("gameplay runtime", () => {
  it("keeps the legacy start and authored games without a spawn", () => {
    expect(playerSpawnForProject({ entities: [] })).toEqual([0, 0.5, 5]);

    const distantAuthoredGame = {
      entities: [
        {
          id: "far-platform",
          label: "Far platform",
          position: [12_000, 0, 0] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
          color: "#6ead60",
          stage: "ready" as const,
          geometry: { kind: "platform" as const, detail: "refined" as const },
        },
      ],
      game: {
        variables: [],
        rules: [
          {
            id: "start",
            trigger: { type: "start" as const },
            conditions: [],
            actions: [],
          },
        ],
      },
    };
    expect(playerSpawnForProject(distantAuthoredGame)).toEqual([0, 0.5, 5]);
    expect(
      playerSpawnForProject({
        entities: distantAuthoredGame.entities,
        game: { variables: [], rules: [] },
      }),
    ).toEqual([0, 0.5, 5]);
  });

  it("derives a stable ground-level start beyond distant ready content", () => {
    expect(playerSpawnForProject({ entities: [] })).toEqual([0, 0.5, 5]);
    const distantProject = {
      groups: [
        {
          id: "far-group",
          label: "Far group",
          position: [12_000, 0, 0] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
        },
      ],
      entities: [
        {
          id: "far-rock",
          label: "Far rock",
          parentId: "far-group",
          position: [0, 0, 0] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
          color: "#6ead60",
          stage: "ready" as const,
          geometry: { kind: "rock" as const, detail: "refined" as const },
        },
      ],
    };
    const start = playerSpawnForProject(distantProject);

    expect(start).toEqual(playerSpawnForProject(distantProject));
    expect(start[0]).toBeCloseTo(12_000, 0);
    expect(start[1]).toBe(0.5);
    expect(start[2]).toBeGreaterThan(5);
    expect(Math.hypot(start[0] - 12_000, start[2])).toBeLessThan(8);
  });

  it("chooses the nearest far cluster with a stable ID tie-break", () => {
    const platform = (id: string, x: number): Entity => ({
      id,
      label: id,
      position: [x, 0, 0],
      scale: [1, 1, 1],
      color: "#6ead60",
      stage: "ready",
      geometry: { kind: "platform", detail: "refined" },
    });
    const clusters = {
      entities: [platform("cluster-z", -12_000), platform("cluster-a", 12_000)],
    };
    const start = playerSpawnForProject(clusters);

    expect(start).toEqual(
      playerSpawnForProject({ entities: [...clusters.entities].reverse() }),
    );
    expect(start[0]).toBeCloseTo(12_000, 0);
    expect(start[1]).toBe(0.5);
    expect(start[2]).toBeGreaterThan(5);
    expect(Math.hypot(start[0] - 12_000, start[2])).toBeLessThan(8);
  });

  it("uses an explicit spawn for far games and does not relocate near content", () => {
    const readyNearEntity = {
      id: "near-rock",
      label: "Near rock",
      position: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      color: "#6ead60",
      stage: "ready" as const,
      geometry: { kind: "rock" as const, detail: "refined" as const },
    };
    expect(
      playerSpawnForProject({
        entities: [readyNearEntity],
        game: {
          spawn: [120_000, 1, -300] as [number, number, number],
          variables: [],
          rules: [],
        },
      }),
    ).toEqual([120_000, 1, -300]);
    expect(
      playerSpawnForProject({
        entities: [readyNearEntity],
      }),
    ).toEqual([0, 0.5, 5]);
  });

  it("allows walking past the former circular parcel edge", () => {
    const result = stepGameplay(
      player([8.4, 0.42, 0]),
      { x: 1, z: 0, jump: false },
      [],
      [],
      0,
      0.04,
    );

    expect(result.position[0]).toBeCloseTo(8.56);
    expect(Math.hypot(result.position[0], result.position[2])).toBeGreaterThan(
      8.4,
    );
  });

  it("blocks a thin solid wall and reports its collision contact", () => {
    const wall = solidWall();
    let state = player([-1, 0.42, 0]);
    let result;
    for (let frame = 0; frame < 12; frame++) {
      result = stepGameplay(
        state,
        { x: 1, z: 0, jump: false },
        [wall],
        [],
        frame * 0.04,
        0.04,
        new Set([wall.id]),
      );
      state = result;
    }

    expect(state.position[0]).toBeCloseTo(-0.26);
    expect(result?.contacts).toContain(wall.id);
  });

  it("keeps ready visual walls traversable unless solid behavior is opted in", () => {
    const visualWall = {
      ...solidWall("visual-wall"),
      behavior: { type: "static" as const },
    };
    const result = stepGameplay(
      player([-0.3, 0.42, 0]),
      { x: 1, z: 0, jump: false },
      [visualWall],
      [],
      0,
      0.04,
    );

    expect(result.position[0]).toBeCloseTo(-0.14);
  });

  it("slides along solid walls during diagonal movement", () => {
    const wall = solidWall();
    let state = player([-0.5, 0.42, 0]);
    for (let frame = 0; frame < 10; frame++)
      state = stepGameplay(
        state,
        { x: 1, z: 1, jump: false },
        [wall],
        [],
        frame * 0.04,
        0.04,
      );

    expect(state.position[0]).toBeCloseTo(-0.26);
    expect(state.position[2]).toBeGreaterThan(0.5);
  });

  it("lets the player jump over low walls and pass above separated walls", () => {
    const wall = solidWall("low-wall", 0.45);
    let jumping = player([-0.5, 0.42, 0]);
    for (let frame = 0; frame < 9; frame++)
      jumping = stepGameplay(
        jumping,
        { x: 1, z: 0, jump: true },
        [wall],
        [],
        frame * 0.04,
        0.04,
      );
    expect(jumping.position[0]).toBeGreaterThan(0.3);

    const above = stepGameplay(
      player([-0.5, 2.5, 0]),
      { x: 1, z: 0, jump: false },
      [wall],
      [],
      0,
      0.04,
    );
    expect(above.position[0]).toBeCloseTo(-0.34);
  });

  it("uses transformed world bounds for a far wall inside a rotated group", () => {
    const wall: Entity = {
      ...solidWall("far-wall", 0.45),
      parentId: "far-group",
      geometry: {
        kind: "custom",
        detail: "refined",
        parts: [
          {
            shape: "box",
            position: [0, 0.225, 0],
            scale: [2, 0.45, 0.08],
            color: "#ffffff",
          },
        ],
      },
    };
    const scene = resolveSceneTransforms({
      groups: [
        {
          id: "far-group",
          position: [1_000, 0, 1_000],
          rotation: [0, Math.PI / 2, 0],
          scale: [1, 1, 1],
        },
      ],
      entities: [wall],
    });
    const matrices = new Map([
      [wall.id, scene.entities.get(wall.id)!.worldMatrix],
    ]);
    let state = player([999, 0.42, 1_000]);
    for (let frame = 0; frame < 10; frame++)
      state = stepGameplay(
        state,
        { x: 1, z: 0, jump: false },
        [wall],
        [],
        frame * 0.04,
        0.04,
        undefined,
        matrices,
      );

    expect(state.position[0]).toBeCloseTo(999.74);
  });

  it("ignores unready and unbounded solid entities", () => {
    const unready = solidWall("unready-wall", 1.5, "coarse");
    const unbounded = { ...solidWall("unbounded-wall"), geometry: undefined };
    for (const wall of [unready, unbounded]) {
      const result = stepGameplay(
        player([-0.3, 0.42, 0]),
        { x: 1, z: 0, jump: false },
        [wall],
        [],
        0,
        0.04,
      );
      expect(result.position[0]).toBeCloseTo(-0.14);
    }
  });

  it("runs a far game path and collects and wins beyond the former edge", () => {
    const program: GameProgram = {
      variables: [],
      rules: [
        {
          id: "send-collectible-farther",
          trigger: { type: "start" },
          conditions: [],
          actions: [
            {
              type: "move_path",
              entityId: "far-crystal",
              points: [
                [12_000, 0.8, 0],
                [14_000, 0.8, 0],
              ],
              duration: 1,
              loop: false,
            },
          ],
        },
      ],
    };
    const initial = createGameProgramState(program);
    const started = stepGameProgram(program, initial, { type: "start" });
    const halfway = stepGameProgram(program, started, {
      type: "tick",
      delta: 0.5,
    });
    const pathPosition = halfway.entityOverrides["far-crystal"]?.position;
    expect(pathPosition).toEqual([13_000, 0.8, 0]);
    expect(Math.hypot(pathPosition![0], pathPosition![2])).toBeGreaterThan(8.4);

    const crystal = fixtureEntities().find(
      (entity) => entity.behavior?.type === "collect",
    )!;
    const collectible: Entity = {
      ...crystal,
      id: "far-crystal",
      position: [...pathPosition!],
    };
    const portal: Entity = {
      ...crystal,
      id: "far-portal",
      label: "Far portal",
      position: [...pathPosition!],
      behavior: { type: "portal" },
    };
    const result = stepGameplay(
      player([pathPosition![0], 0.42, pathPosition![2]]),
      idle,
      [collectible, portal],
      [],
      halfway.elapsed,
      0.016,
    );

    expect(result.collected).toContain("far-crystal");
    expect(result.won).toBe(true);
  });

  it.each([
    [-2, 1, 2],
    [2, 1, -2],
    [2, -2, 2],
    [-2, -2, -2],
  ])("lands on a reflected procedural platform (%s, %s, %s)", (x, y, z) => {
    const platform: Entity = {
      id: "reflected",
      label: "Reflected platform",
      stage: "ready",
      position: [0, 2, 0],
      scale: [x, y, z],
      color: "#ffffff",
      geometry: { kind: "platform", detail: "refined" },
    };
    // Independent rendered mesh bounds: base spans -0.025..0.425;
    // the top cap reaches 0.52 before reflection.
    const expectedTop = 2 + Math.max(-0.025 * y, 0.52 * y) + 0.42;
    const result = stepGameplay(
      { position: [0.4, expectedTop + 0.01, 0.4], velocityY: -2 },
      idle,
      [platform],
      [],
      0,
      0.02,
    );
    expect(result.groundedOn).toBe(platform.id);
    expect(result.position[1]).toBeCloseTo(expectedTop);
    const jump = stepGameplay(
      result,
      { x: 0, z: 0, jump: true },
      [platform],
      [],
      0.02,
      0.02,
    );
    expect(jump.velocityY).toBeGreaterThan(0);
    expect(jump.groundedOn).toBeUndefined();
  });
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

  it.each<[string, Entity[]]>([
    ["removed", [] as Entity[]],
    [
      "not-ready",
      [
        {
          ...fixtureEntities().find((e) => e.id === "platform-1")!,
          stage: "seed" as const,
        },
      ],
    ],
    [
      "retyped",
      [
        {
          ...fixtureEntities().find((e) => e.id === "platform-1")!,
          geometry: { kind: "tree" as const, detail: "refined" as const },
        },
      ],
    ],
  ])("does not jump from a stale %s support", (_, currentEntities) => {
    const platform = fixtureEntities().find((e) => e.id === "platform-1")!;
    const pose = movingEntityPosition(platform, 1);
    const top = pose[1] + 0.52 * platform.scale[1] + 0.42;
    const state: PlayerState = {
      position: [pose[0], top, pose[2]],
      velocityY: 0,
      groundedOn: platform.id,
      supportPosition: pose,
      supportTop: top,
    };

    const next = stepGameplay(
      state,
      { x: 0, z: 0, jump: true },
      currentEntities,
      [],
      1,
      0.04,
    );

    expect(next.position[1]).toBeLessThan(state.position[1]);
    expect(next.velocityY).toBeLessThan(0);
    expect(next.groundedOn).toBeUndefined();
    expect(next.supportPosition).toBeUndefined();
    expect(next.supportTop).toBeUndefined();
  });

  it("does not jump after a support footprint shrinks away from the player", () => {
    const platform = fixtureEntities().find((e) => e.id === "platform-1")!;
    const pose = movingEntityPosition(platform, 1);
    const top = pose[1] + 0.52 * platform.scale[1] + 0.42;
    const state: PlayerState = {
      position: [pose[0] + 0.7, top, pose[2]],
      velocityY: 0,
      groundedOn: platform.id,
      supportPosition: pose,
      supportTop: top,
    };
    const shrunk = {
      ...platform,
      scale: [0.1, platform.scale[1], 0.1] as [number, number, number],
    };

    const next = stepGameplay(
      state,
      { x: 0, z: 0, jump: true },
      [shrunk],
      [],
      1,
      0.04,
    );

    expect(next.position[1]).toBeLessThan(state.position[1]);
    expect(next.velocityY).toBeLessThan(0);
    expect(next.groundedOn).toBeUndefined();
    expect(next.supportPosition).toBeUndefined();
    expect(next.supportTop).toBeUndefined();
  });

  it("does not jump after horizontal input walks off a support footprint", () => {
    const platform = fixtureEntities().find((e) => e.id === "platform-1")!;
    const pose = movingEntityPosition(platform, 1);
    const top = pose[1] + 0.52 * platform.scale[1] + 0.42;
    const state: PlayerState = {
      position: [pose[0] + 0.75, top, pose[2]],
      velocityY: 0,
      groundedOn: platform.id,
      supportPosition: pose,
      supportTop: top,
    };

    const next = stepGameplay(
      state,
      { x: 1, z: 0, jump: true },
      [platform],
      [],
      1,
      0.04,
    );

    expect(next.position[1]).toBeLessThan(state.position[1]);
    expect(next.velocityY).toBeLessThan(0);
    expect(next.groundedOn).toBeUndefined();
    expect(next.supportPosition).toBeUndefined();
    expect(next.supportTop).toBeUndefined();
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
