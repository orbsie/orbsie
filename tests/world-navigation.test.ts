import { describe, expect, it } from "vitest";
import { requireCatalogAsset } from "../src/lib/asset-catalog";
import {
  resolveSceneTransforms,
  transformBounds,
} from "../src/lib/scene-transform";
import {
  applyWorldNavigationCommand,
  createWorldNavigationState,
  worldNavigationCameraPose,
  worldDirectionForHeading,
  worldNavigationFarPlane,
  worldNavigationFollowState,
  worldNavigationLandingLookTarget,
  worldNavigationPlayMinimumDistance,
  worldNavigationProjectState,
  WORLD_NAVIGATION_LIMITS,
  WORLD_NAVIGATION_PLAY_MIN_DISTANCE,
  type WorldNavigationBounds,
  type WorldNavigationVec3,
} from "../src/lib/world-navigation";
import { committedWorldNavigationBounds } from "../src/lib/world-navigation-bounds";
import {
  selectWorldTerrainChunks,
  worldTerrainChunkKeyAt,
} from "../src/lib/world-terrain";
import type { Project } from "../src/lib/protocol";

function navigationTestProject(
  id: string,
  entities: Project["entities"],
  groups: NonNullable<Project["groups"]> = [],
): Project {
  return {
    version: 1,
    id,
    title: "Navigation bounds fixture",
    seed: 1,
    revision: 1,
    entities,
    groups,
    environment: {
      sky: "#ffffff",
      ground: "#ffffff",
      water: "#ffffff",
    },
    messages: [],
  };
}

const portraitProjection = {
  viewportAspect: 390 / 844,
  verticalFovRadians: (43 * Math.PI) / 180,
};
const landscapeProjection = {
  viewportAspect: 844 / 390,
  verticalFovRadians: (43 * Math.PI) / 180,
};

describe("shared world navigation", () => {
  it("uses clockwise bearings from north (-Z)", () => {
    expect(worldDirectionForHeading(0)).toEqual([0, 0, -1]);
    const east = worldDirectionForHeading(Math.PI / 2);
    expect(east[0]).toBeCloseTo(1);
    expect(east[1]).toBe(0);
    expect(east[2]).toBeCloseTo(0);

    const quarterTurn = applyWorldNavigationCommand(
      createWorldNavigationState(),
      { type: "rotate_to_heading", heading: Math.PI * 2 + Math.PI / 2 },
    );
    expect(quarterTurn.heading).toBeCloseTo(Math.PI / 2);
    const reverseTurn = applyWorldNavigationCommand(quarterTurn, {
      type: "rotate_to_heading",
      heading: -Math.PI / 2,
    });
    expect(reverseTurn.heading).toBeCloseTo((Math.PI * 3) / 2);
    expect(reverseTurn.heading).toBeGreaterThanOrEqual(0);
    expect(reverseTurn.heading).toBeLessThan(Math.PI * 2);
  });

  it("projects heading zero from the +Z side and rotates the camera pose", () => {
    const north = worldNavigationCameraPose(
      createWorldNavigationState({
        target: [1200, 5, -900],
        heading: 0,
        distance: 24,
      }),
    );
    expect(north.target).toEqual([1200, 5, -900]);
    expect(north.position[0]).toBeCloseTo(1200);
    expect(north.position[1]).toBeCloseTo(17);
    expect(north.position[2]).toBeGreaterThan(north.target[2]);

    const east = worldNavigationCameraPose(
      createWorldNavigationState({
        target: [1200, 5, -900],
        heading: Math.PI / 2,
        distance: 24,
      }),
    );
    expect(east.position[0]).toBeGreaterThan(east.target[0]);
    expect(east.position[2]).toBeCloseTo(east.target[2]);
    expect(east.target).toEqual(north.target);
  });

  it("follows far player travel for camera and terrain, then restores saved navigation", () => {
    const savedNavigation = createWorldNavigationState({
      target: [12_000, 4, -8_000],
      heading: 1.7,
      distance: 600,
    });
    const savedSnapshot = JSON.stringify(savedNavigation);
    const farPlayer: WorldNavigationVec3 = [65_430, 9, -72_190];
    const playView = worldNavigationFollowState(savedNavigation, farPlayer);

    expect(playView.target).toEqual(farPlayer);
    expect(worldNavigationCameraPose(playView).target).toEqual(farPlayer);
    expect(playView.heading).toBe(savedNavigation.heading);
    expect(playView.distance).toBe(savedNavigation.distance);
    expect(JSON.stringify(savedNavigation)).toBe(savedSnapshot);

    const terrain = selectWorldTerrainChunks({
      focus: playView.target,
      distance: playView.distance,
      aspect: portraitProjection.viewportAspect,
    });
    expect(terrain).toHaveLength(49);
    const terrainCenter = terrain[24];
    expect(terrainCenter).toEqual(
      worldTerrainChunkKeyAt(farPlayer[0], farPlayer[2], terrainCenter.lod),
    );

    const resetView = worldNavigationFollowState(savedNavigation, [0, 0.5, 5]);
    expect(resetView.target).toEqual([0, 0.5, 5]);
    expect(resetView.heading).toBe(savedNavigation.heading);
    expect(resetView.distance).toBe(savedNavigation.distance);
    expect(worldNavigationCameraPose(savedNavigation).target).toEqual(
      savedNavigation.target,
    );
    expect(JSON.stringify(savedNavigation)).toBe(savedSnapshot);
  });

  it("widens close editor zoom only in the temporary play view", () => {
    const savedNavigation = createWorldNavigationState({
      target: [12_000, 4, -8_000],
      heading: 2.25,
      distance: WORLD_NAVIGATION_LIMITS.minDistance,
    });
    const savedSnapshot = JSON.stringify(savedNavigation);
    const farPlayer: WorldNavigationVec3 = [12_000, 0.5, 5.5];
    const playView = worldNavigationFollowState(savedNavigation, farPlayer);

    expect(playView.target).toEqual(farPlayer);
    expect(playView.heading).toBe(savedNavigation.heading);
    expect(playView.distance).toBe(WORLD_NAVIGATION_PLAY_MIN_DISTANCE);
    expect(worldNavigationCameraPose(playView).target).toEqual(farPlayer);
    const terrain = selectWorldTerrainChunks({
      focus: playView.target,
      distance: playView.distance,
      aspect: portraitProjection.viewportAspect,
    });
    expect(terrain).toHaveLength(49);
    expect(terrain[24]).toEqual(
      worldTerrainChunkKeyAt(farPlayer[0], farPlayer[2], terrain[24].lod),
    );
    expect(savedNavigation.distance).toBe(WORLD_NAVIGATION_LIMITS.minDistance);
    expect(JSON.stringify(savedNavigation)).toBe(savedSnapshot);
  });

  it("widens the temporary play minimum for portrait viewports only", () => {
    const savedNavigation = createWorldNavigationState({ distance: 4 });
    const portraitViewport = { width: 412, height: 786 };
    const portraitMinimum = (12 * 786) / 412;

    expect(worldNavigationPlayMinimumDistance(portraitViewport)).toBeCloseTo(
      portraitMinimum,
    );
    expect(
      worldNavigationFollowState(savedNavigation, [0, 0.5, 5], portraitViewport)
        .distance,
    ).toBeCloseTo(portraitMinimum);
    expect(
      worldNavigationPlayMinimumDistance({ width: 844, height: 390 }),
    ).toBe(WORLD_NAVIGATION_PLAY_MIN_DISTANCE);
    expect(
      worldNavigationFollowState(savedNavigation, [0, 0.5, 5], {
        width: 844,
        height: 390,
      }).distance,
    ).toBe(WORLD_NAVIGATION_PLAY_MIN_DISTANCE);
  });

  it("defaults invalid viewport dimensions to the shared play minimum", () => {
    for (const viewport of [
      undefined,
      { width: 0, height: 786 },
      { width: 412, height: Number.NaN },
      { width: Number.POSITIVE_INFINITY, height: 786 },
    ])
      expect(worldNavigationPlayMinimumDistance(viewport)).toBe(
        WORLD_NAVIGATION_PLAY_MIN_DISTANCE,
      );
  });

  it("keeps invalid player coordinates from corrupting the saved view", () => {
    const savedNavigation = createWorldNavigationState({
      target: [45, 2, -13],
      heading: 0.7,
      distance: 55,
    });
    expect(
      worldNavigationFollowState(savedNavigation, [Number.NaN, 0, 0]),
    ).toEqual(savedNavigation);
    expect(
      worldNavigationFollowState(savedNavigation, [
        WORLD_NAVIGATION_LIMITS.maxTargetCoordinate * 2,
        0,
        0,
      ]).target,
    ).toEqual([WORLD_NAVIGATION_LIMITS.maxTargetCoordinate, 0, 0]);
  });

  it("starts at the shared landing look point and ends at the pose target", () => {
    const target = [1200, 5, -900] as const;
    expect(worldNavigationLandingLookTarget(0, target)).toEqual([0, 0.35, 0]);
    expect(worldNavigationLandingLookTarget(1, target)).toEqual(target);
  });

  it("preserves navigation within one project and resets it for another", () => {
    const initial = worldNavigationProjectState("project-a");
    const moved = {
      projectId: initial.projectId,
      navigation: createWorldNavigationState({
        target: [3200, 12, -800],
        heading: 1.3,
        distance: 600,
      }),
    };

    expect(worldNavigationProjectState("project-a", moved)).toBe(moved);
    const changedProject = worldNavigationProjectState("project-b", moved);
    expect(changedProject.projectId).toBe("project-b");
    expect(changedProject.navigation).toEqual(createWorldNavigationState());
    expect(moved.navigation.target).toEqual([3200, 12, -800]);
  });

  it("expands the camera far plane with distance for distant worlds", () => {
    expect(worldNavigationFarPlane(createWorldNavigationState())).toBe(250);
    expect(
      worldNavigationFarPlane(
        createWorldNavigationState({ distance: 1_000_000 }),
      ),
    ).toBe(2_000_000);
  });

  it("pans in world XZ and clamps target and zoom distance", () => {
    const initial = createWorldNavigationState({
      target: [3, 7, -2],
      distance: 20,
    });
    const panned = applyWorldNavigationCommand(initial, {
      type: "pan",
      delta: [4, -6],
    });
    expect(panned.target).toEqual([7, 7, -8]);
    expect(initial.target).toEqual([3, 7, -2]);

    const zoomedIn = applyWorldNavigationCommand(panned, {
      type: "zoom",
      factor: 0.5,
    });
    expect(zoomedIn.distance).toBe(10);
    expect(
      applyWorldNavigationCommand(zoomedIn, {
        type: "zoom",
        factor: 0.001,
      }).distance,
    ).toBe(WORLD_NAVIGATION_LIMITS.minDistance);
    expect(
      applyWorldNavigationCommand(panned, {
        type: "zoom",
        factor: 2_000_000,
      }).distance,
    ).toBe(WORLD_NAVIGATION_LIMITS.maxDistance);

    const edge = createWorldNavigationState({
      target: [WORLD_NAVIGATION_LIMITS.maxTargetCoordinate - 2, 0, 0],
    });
    expect(
      applyWorldNavigationCommand(edge, {
        type: "pan",
        delta: [50, -50],
      }).target,
    ).toEqual([WORLD_NAVIGATION_LIMITS.maxTargetCoordinate, 0, -50]);
  });

  it("resets north while preserving world target and zoom", () => {
    const initial = createWorldNavigationState({
      target: [1500, 12, -450],
      heading: 4.2,
      distance: 77,
    });
    const reset = applyWorldNavigationCommand(initial, {
      type: "north_reset",
    });

    expect(reset).toEqual({
      target: [1500, 12, -450],
      heading: 0,
      distance: 77,
    });
    expect(initial.heading).toBeCloseTo(4.2);
  });

  it("frames committed far content after a long pan without mutating project data", () => {
    const farBoundsA: WorldNavigationBounds = Object.freeze({
      min: Object.freeze([25_000, -2, -14] as const),
      max: Object.freeze([25_002, 2, -10] as const),
    });
    const group = Object.freeze({
      id: "distant-parent",
      position: Object.freeze([27_000, 0, -18] as const),
      rotation: Object.freeze([0, 0, 0] as const),
      scale: Object.freeze([1, 1, 1] as const),
    });
    const groupedEntity = Object.freeze({
      id: "grouped-leaf",
      parentId: group.id,
      position: Object.freeze([200, 0, 0] as const),
      scale: Object.freeze([1, 1, 1] as const),
    });
    const resolved = resolveSceneTransforms({
      groups: [group],
      entities: [groupedEntity],
    });
    const farBoundsB = transformBounds(
      resolved.entities.get(groupedEntity.id)!.worldMatrix,
      { min: [-1, -4, -2], max: [1, 4, 2] },
    );
    const farEntity = Object.freeze({
      id: "far-tree",
      stage: "ready",
      position: Object.freeze([25_001, 0, -12]),
      bounds: farBoundsA,
    });
    const pendingEntity = Object.freeze({
      id: "pending-tree",
      stage: "seed",
      position: Object.freeze([0, 0, 0]),
      bounds: Object.freeze({
        min: Object.freeze([-100, 0, -100]),
        max: Object.freeze([100, 10, 100]),
      }),
    });
    const project = Object.freeze({
      revision: 12,
      groups: Object.freeze([group]),
      entities: Object.freeze([
        farEntity,
        Object.freeze({
          ...groupedEntity,
          stage: "ready",
          bounds: farBoundsB,
        }),
        pendingEntity,
      ]),
    });
    const snapshot = JSON.stringify(project);
    const committedEntityBounds = project.entities
      .filter((entity) => entity.stage === "ready")
      .map((entity) => entity.bounds);
    const panned = applyWorldNavigationCommand(
      createWorldNavigationState({
        target: [900_000, 0, 900_000],
        heading: 1.2,
      }),
      { type: "pan", delta: [-50_000, -40_000] },
    );
    const framed = applyWorldNavigationCommand(panned, {
      type: "frame_content",
      committedEntityBounds,
      ...portraitProjection,
    });

    expect(framed.target).toEqual([26_100.5, 0, -15]);
    expect(framed.heading).toBeCloseTo(1.2);
    expect(framed.distance).toBeGreaterThan(
      WORLD_NAVIGATION_LIMITS.minDistance,
    );
    expect(framed.distance).toBeLessThanOrEqual(
      WORLD_NAVIGATION_LIMITS.maxDistance,
    );
    expect(JSON.stringify(project)).toBe(snapshot);
    expect(project.revision).toBe(12);
    expect(project.entities[0].id).toBe("far-tree");
  });

  it("derives ready custom-geometry bounds through nested far-away groups", () => {
    const project: Project = {
      version: 1,
      id: "far-groups",
      title: "Far groups",
      seed: 1,
      revision: 3,
      groups: [
        {
          id: "outer",
          label: "Outer",
          position: [25_000, 0, -30_000],
          rotation: [0, 0, 0],
          scale: [2, 1, 1],
        },
        {
          id: "inner",
          label: "Inner",
          parentId: "outer",
          position: [1_000, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
      entities: [
        {
          id: "distant-cube",
          label: "Distant cube",
          parentId: "inner",
          position: [100, 0, 0],
          scale: [2, 1, 1],
          rotation: [0, 0, 0],
          color: "#6ead60",
          geometry: {
            kind: "custom",
            detail: "refined",
            parts: [
              {
                shape: "box",
                position: [0, 0, 0],
                scale: [1, 1, 1],
                rotation: [0, 0, 0],
                color: "#6ead60",
              },
            ],
          },
          stage: "ready",
        },
        {
          id: "unfinished",
          label: "Unfinished object",
          position: [800_000, 0, 800_000],
          scale: [1, 1, 1],
          color: "#6ead60",
          stage: "seed",
        },
      ],
      environment: {
        sky: "#ffffff",
        ground: "#ffffff",
        water: "#ffffff",
      },
      messages: [],
    };
    const snapshot = JSON.stringify(project);
    const bounds = committedWorldNavigationBounds(project);

    expect(bounds).toHaveLength(1);
    expect(bounds[0].min).toEqual([27_198, -0.5, -30_000.5]);
    expect(bounds[0].max).toEqual([27_202, 0.5, -29_999.5]);
    const framed = applyWorldNavigationCommand(
      createWorldNavigationState({ target: [500_000, 0, 500_000] }),
      {
        type: "frame_content",
        committedEntityBounds: bounds,
        viewportAspect: 1.6,
        verticalFovRadians: (43 * Math.PI) / 180,
      },
    );
    expect(framed.target).toEqual([27_200, 0, -30_000]);
    expect(framed.distance).toBeGreaterThan(
      WORLD_NAVIGATION_LIMITS.minDistance,
    );
    expect(JSON.stringify(project)).toBe(snapshot);
    expect(project.revision).toBe(3);
  });

  it("uses checked-in catalog asset bounds at a far transformed position", () => {
    const project = navigationTestProject("far-catalog-asset", [
      {
        id: "far-tree",
        label: "Far catalog tree",
        position: [65_000, 3, -70_000],
        scale: [2, 1.5, 3],
        rotation: [0, 0, 0],
        color: "#6ead60",
        geometry: {
          kind: "asset",
          assetId: "kenney.nature.tree-default",
          detail: "refined",
        },
        stage: "ready",
      },
    ]);
    const catalogBounds = requireCatalogAsset(
      "kenney.nature.tree-default",
    ).bounds;
    const worldMatrix = resolveSceneTransforms({
      groups: project.groups,
      entities: project.entities,
    }).entities.get("far-tree")!.worldMatrix;
    const bounds = committedWorldNavigationBounds(project);

    expect(bounds).toEqual([
      transformBounds(worldMatrix, {
        min: [catalogBounds.min[0], catalogBounds.min[1], catalogBounds.min[2]],
        max: [catalogBounds.max[0], catalogBounds.max[1], catalogBounds.max[2]],
      }),
    ]);
    expect(bounds[0].min[0]).toBeCloseTo(64_999.245);
    expect(bounds[0].max[1]).toBeCloseTo(5.4868311165);
    expect(bounds[0].min[2]).toBeCloseTo(-70_000.9807735);
  });

  it("uses generated model metadata bounds through a far parent transform", () => {
    const project = navigationTestProject(
      "far-generated-metadata",
      [
        {
          id: "generated-leaf",
          label: "Generated model",
          parentId: "far-parent",
          position: [10_000, -5, 0],
          scale: [2, 1, 3],
          rotation: [0, 0, 0],
          color: "#6ead60",
          geometry: {
            kind: "generated",
            collision: "none",
            detail: "refined",
            job: {
              backend: "browser-manifold",
              recipe: {
                version: 1,
                revision: 0,
                output: "body",
                nodes: [{ id: "body", kind: "box", size: [1, 1, 1] }],
              },
            },
            model: {
              version: 1,
              sha256: "a".repeat(64),
              bytes: 100,
              source: "browser-manifold",
              kernelVersion: "3.3.2",
              bounds: { min: [-2, -1, -4], max: [4, 3, 2] },
              createdAt: "2026-09-12T00:00:00.000Z",
            },
          },
          stage: "ready",
        },
      ],
      [
        {
          id: "far-parent",
          label: "Far parent",
          position: [120_000, 0, -230_000],
          rotation: [0, 0, 0],
          scale: [2, 1, 1],
        },
      ],
    );
    const bounds = committedWorldNavigationBounds(project);

    expect(bounds).toHaveLength(1);
    expect(bounds[0].min).toEqual([139_992, -6, -230_012]);
    expect(bounds[0].max).toEqual([140_016, -2, -229_994]);
  });

  it("frames the initial workspace when content is empty or invalid", () => {
    const initial = createWorldNavigationState();
    const emptyFrame = applyWorldNavigationCommand(initial, {
      type: "frame_content",
      committedEntityBounds: [],
      ...portraitProjection,
    });
    expect(emptyFrame.target).toEqual([0, 0, 0]);
    expect(emptyFrame.distance).toBe(24);

    const invalidBounds = [
      {
        min: [Number.NaN, 0, 0],
        max: [Number.POSITIVE_INFINITY, 1, 1],
      },
    ] as unknown as WorldNavigationBounds[];
    const invalidFrame = applyWorldNavigationCommand(initial, {
      type: "frame_content",
      committedEntityBounds: invalidBounds,
      ...portraitProjection,
    });
    expect(invalidFrame).toEqual(emptyFrame);
  });

  it("keeps a degenerate point frame finite and zoomable", () => {
    const framed = applyWorldNavigationCommand(createWorldNavigationState(), {
      type: "frame_content",
      committedEntityBounds: [{ min: [17, 4, -5], max: [17, 4, -5] }],
      ...portraitProjection,
    });
    expect(framed.target).toEqual([17, 4, -5]);
    expect(framed.distance).toBe(WORLD_NAVIGATION_LIMITS.minDistance);
    expect(
      [...framed.target, framed.heading, framed.distance].every(
        Number.isFinite,
      ),
    ).toBe(true);
  });

  it("frames a sphere in portrait and landscape using the narrower FOV", () => {
    const bounds: WorldNavigationBounds = {
      min: [-150, -50, -250],
      max: [150, 50, 250],
    };
    const initial = createWorldNavigationState({ heading: 1.4 });
    const portrait = applyWorldNavigationCommand(initial, {
      type: "frame_content",
      committedEntityBounds: [bounds],
      ...portraitProjection,
    });
    const landscape = applyWorldNavigationCommand(initial, {
      type: "frame_content",
      committedEntityBounds: [bounds],
      ...landscapeProjection,
    });
    const radius = Math.hypot(150, 50, 250);
    const fitsProjection = (distance: number, aspect: number) => {
      const verticalHalf = portraitProjection.verticalFovRadians / 2;
      const horizontalHalf = Math.atan(Math.tan(verticalHalf) * aspect);
      const narrowHalf = Math.min(verticalHalf, horizontalHalf);
      return distance * Math.sin(narrowHalf);
    };

    expect(portrait.distance).toBeGreaterThan(landscape.distance);
    expect(
      fitsProjection(portrait.distance, portraitProjection.viewportAspect),
    ).toBeGreaterThanOrEqual(radius * 1.1 - 1e-8);
    expect(
      fitsProjection(landscape.distance, landscapeProjection.viewportAspect),
    ).toBeGreaterThanOrEqual(radius * 1.1 - 1e-8);
    expect(portrait.heading).toBeCloseTo(initial.heading);
    expect(landscape.heading).toBeCloseTo(initial.heading);
  });

  it("rejects invalid viewport aspect and vertical FOV for frame content", () => {
    const initial = createWorldNavigationState();
    const command = {
      type: "frame_content" as const,
      committedEntityBounds: [{ min: [-1, -1, -1], max: [1, 1, 1] }],
      ...portraitProjection,
    } as const;
    expect(() =>
      applyWorldNavigationCommand(initial, {
        ...command,
        viewportAspect: 0,
      }),
    ).toThrow(/aspect/i);
    expect(() =>
      applyWorldNavigationCommand(initial, {
        ...command,
        viewportAspect: Number.NaN,
      }),
    ).toThrow(/aspect/i);
    expect(() =>
      applyWorldNavigationCommand(initial, {
        ...command,
        verticalFovRadians: Math.PI,
      }),
    ).toThrow(/field of view/i);
  });
});
