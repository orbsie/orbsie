import { describe, expect, it } from "vitest";
import {
  resolveSceneTransforms,
  transformBounds,
} from "../src/lib/scene-transform";
import {
  applyWorldNavigationCommand,
  createWorldNavigationState,
  worldDirectionForHeading,
  WORLD_NAVIGATION_LIMITS,
  type WorldNavigationBounds,
} from "../src/lib/world-navigation";

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

  it("frames the initial workspace when content is empty or invalid", () => {
    const initial = createWorldNavigationState();
    const emptyFrame = applyWorldNavigationCommand(initial, {
      type: "frame_content",
      committedEntityBounds: [],
      ...portraitProjection,
    });
    expect(emptyFrame.target).toEqual([0, 1.5, 0]);
    expect(Number.isFinite(emptyFrame.distance)).toBe(true);

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
