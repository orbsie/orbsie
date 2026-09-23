import { describe, expect, it } from "vitest";
import {
  createWorldNavigationState,
  worldNavigationCameraPose,
} from "../src/lib/world-navigation";
import { MAX_SCENE_POSITION } from "../src/lib/protocol";
import {
  RENDER_ORIGIN_CELL_SIZE,
  RENDER_ORIGIN_REBASE_THRESHOLD,
  renderLocalToWorld,
  selectRenderOrigin,
  shouldRebaseRenderOrigin,
  worldCameraPoseToRenderLocal,
  worldToRenderLocal,
} from "../src/lib/render-origin";

describe("quantized render origin", () => {
  it("keeps an origin stable within a cell and chooses bounded quantized origins", () => {
    const origin = selectRenderOrigin([100, 10, -200]);
    expect(origin).toEqual([0, 0, 0]);
    expect(selectRenderOrigin([512, 0, -512])).toEqual(origin);
    expect(
      selectRenderOrigin([RENDER_ORIGIN_REBASE_THRESHOLD, -10, -500], origin),
    ).toEqual(origin);
    expect(
      Math.abs(
        worldToRenderLocal([RENDER_ORIGIN_REBASE_THRESHOLD, 0, 0], origin)![0],
      ),
    ).toBe(RENDER_ORIGIN_REBASE_THRESHOLD);

    const tenKilometers = selectRenderOrigin([10_000, 0, 0]);
    expect(tenKilometers).toEqual([10 * RENDER_ORIGIN_CELL_SIZE, 0, 0]);
    expect(Math.abs(10_000 - tenKilometers[0])).toBeLessThanOrEqual(
      RENDER_ORIGIN_REBASE_THRESHOLD,
    );
  });

  it("uses a hysteresis band around quantization midpoints in both directions", () => {
    const origin = [0, 0, 0] as const;
    const threshold = RENDER_ORIGIN_REBASE_THRESHOLD;
    expect(shouldRebaseRenderOrigin([threshold, 0, 0], origin)).toBe(false);
    expect(shouldRebaseRenderOrigin([threshold + 0.01, 0, 0], origin)).toBe(
      true,
    );
    const east = selectRenderOrigin([threshold + 0.01, 0, 0], origin);
    expect(east).toEqual([RENDER_ORIGIN_CELL_SIZE, 0, 0]);
    expect(shouldRebaseRenderOrigin([512.01, 0, 0], east)).toBe(false);
    expect(selectRenderOrigin([511.99, 0, 0], east)).toEqual(east);
    expect(
      selectRenderOrigin(
        [threshold - RENDER_ORIGIN_CELL_SIZE / 2 - 0.01, 0, 0],
        east,
      ),
    ).toEqual(origin);

    expect(shouldRebaseRenderOrigin([-threshold - 0.01, 0, 0], origin)).toBe(
      true,
    );
    const west = selectRenderOrigin([-threshold - 0.01, 0, 0], origin);
    expect(west).toEqual([-RENDER_ORIGIN_CELL_SIZE, 0, 0]);
    expect(selectRenderOrigin([-511.99, 0, 0], west)).toEqual(west);
    expect(
      selectRenderOrigin(
        [-threshold + RENDER_ORIGIN_CELL_SIZE / 2 + 0.01, 0, 0],
        west,
      ),
    ).toEqual(origin);
  });

  it("round-trips sub-meter offsets at ten kilometers and both world limits", () => {
    const positions = [
      [10_000.375, 18.625, -10_000.875],
      [MAX_SCENE_POSITION - 0.25, 0.625, -MAX_SCENE_POSITION + 0.75],
      [-MAX_SCENE_POSITION + 0.5, -0.875, MAX_SCENE_POSITION - 0.375],
    ] as const;

    for (const world of positions) {
      const origin = selectRenderOrigin(world);
      const local = worldToRenderLocal(world, origin);
      expect(local).toBeDefined();
      expect(local!.every(Number.isFinite)).toBe(true);
      expect(local!.every((component) => Math.abs(component) <= 513)).toBe(
        true,
      );
      const restored = renderLocalToWorld(local!, origin);
      expect(restored).toBeDefined();
      expect(restored![0]).toBeCloseTo(world[0], 9);
      expect(restored![1]).toBeCloseTo(world[1], 9);
      expect(restored![2]).toBeCloseTo(world[2], 9);
    }
  });

  it("translates camera position and target into one local frame", () => {
    const savedNavigation = createWorldNavigationState({
      target: [65_000, 7, -70_000],
      heading: 1.2,
      distance: 84,
    });
    const pose = worldNavigationCameraPose(savedNavigation);
    const origin = selectRenderOrigin(savedNavigation.target);
    const localPose = worldCameraPoseToRenderLocal(pose, origin);
    expect(localPose).toBeDefined();
    expect(localPose!.target).toEqual(worldToRenderLocal(pose.target, origin));
    const worldDelta = pose.position.map(
      (component, axis) => component - pose.target[axis],
    );
    const localDelta = localPose!.position.map(
      (component, axis) => component - localPose!.target[axis],
    );
    expect(localDelta[0]).toBeCloseTo(worldDelta[0], 10);
    expect(localDelta[1]).toBeCloseTo(worldDelta[1], 10);
    expect(localDelta[2]).toBeCloseTo(worldDelta[2], 10);
  });

  it("does not mutate world data and rejects invalid conversions safely", () => {
    const world = Object.freeze([999_999.5, 4.25, -999_998.75] as const);
    const snapshot = JSON.stringify(world);
    const origin = selectRenderOrigin(world);
    const local = worldToRenderLocal(world, origin);
    expect(local).toBeDefined();
    expect(JSON.stringify(world)).toBe(snapshot);

    expect(selectRenderOrigin([Number.NaN, 0, 0], origin)).toEqual(origin);
    expect(selectRenderOrigin([Number.NaN, 0, 0])).toEqual([0, 0, 0]);
    expect(shouldRebaseRenderOrigin([Infinity, 0, 0], origin)).toBe(true);
    expect(worldToRenderLocal([Number.NaN, 0, 0], origin)).toBeUndefined();
    expect(renderLocalToWorld([Infinity, 0, 0], origin)).toBeUndefined();
    expect(
      renderLocalToWorld([MAX_SCENE_POSITION * 2, 0, 0], origin),
    ).toBeUndefined();
    expect(
      worldCameraPoseToRenderLocal(
        { position: [0, 0, 0], target: [Number.NaN, 0, 0] },
        origin,
      ),
    ).toBeUndefined();
  });
});
