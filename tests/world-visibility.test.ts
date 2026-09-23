import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import {
  createWorldNavigationState,
  worldNavigationCameraPose,
  type WorldNavigationBounds,
} from "../src/lib/world-navigation";
import { selectVisibleWorldEntityIds } from "../src/lib/world-visibility";

function cameraFor(heading: number) {
  const navigation = createWorldNavigationState({
    target: [1_000_000, 0, -1_000_000],
    heading,
    distance: 24,
  });
  const pose = worldNavigationCameraPose(navigation);
  const camera = new PerspectiveCamera(43, 390 / 844, 0.1, 250);
  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

const bounds = (
  min: [number, number, number],
  max: [number, number, number],
): WorldNavigationBounds => ({ min, max });

describe("world visibility selector", () => {
  it("culls distant offscreen and behind-camera AABBs at far coordinates", () => {
    const entities = [{ id: "north" }, { id: "east" }, { id: "behind" }];
    const boundsByEntity = new Map<string, WorldNavigationBounds>([
      ["north", bounds([999_999, -1, -1_000_031], [1_000_001, 1, -1_000_029])],
      ["east", bounds([1_000_079, -1, -1_000_001], [1_000_081, 1, -999_999])],
      ["behind", bounds([999_999, -1, -999_921], [1_000_001, 1, -999_919])],
    ]);

    expect([
      ...selectVisibleWorldEntityIds(entities, boundsByEntity, cameraFor(0)),
    ]).toEqual(["north"]);
  });

  it("updates visible bounds when the camera heading rotates", () => {
    const entities = [{ id: "north" }, { id: "west" }];
    const boundsByEntity = new Map<string, WorldNavigationBounds>([
      ["north", bounds([999_999, -1, -1_000_031], [1_000_001, 1, -1_000_029])],
      ["west", bounds([999_919, -1, -1_000_001], [999_921, 1, -999_999])],
    ]);

    expect([
      ...selectVisibleWorldEntityIds(entities, boundsByEntity, cameraFor(0)),
    ]).toEqual(["north"]);
    expect([
      ...selectVisibleWorldEntityIds(
        entities,
        boundsByEntity,
        cameraFor(Math.PI / 2),
      ),
    ]).toEqual(["west"]);
  });

  it("keeps pending and invalid-bound entities visible conservatively", () => {
    const entities = [
      { id: "pending" },
      { id: "invalid" },
      { id: "visible" },
      { id: "far" },
    ];
    const boundsByEntity = new Map([
      ["pending", undefined],
      ["invalid", bounds([10, 0, 0], [-10, 1, 1]) as WorldNavigationBounds],
      ["visible", bounds([999_999, -1, -1_000_001], [1_000_001, 1, -999_999])],
      ["far", bounds([1_000_000, 0, -1_002_000], [1_000_001, 1, -1_001_999])],
    ]) as ReadonlyMap<string, WorldNavigationBounds | undefined>;

    expect([
      ...selectVisibleWorldEntityIds(entities, boundsByEntity, cameraFor(0)),
    ]).toEqual(["pending", "invalid", "visible"]);
  });

  it("keeps all entities visible if the supplied camera cannot form a frustum", () => {
    const camera = new PerspectiveCamera(Number.NaN, 1, 0.1, 250);
    expect([
      ...selectVisibleWorldEntityIds(
        [{ id: "a" }, { id: "b" }],
        new Map(),
        camera,
      ),
    ]).toEqual(["a", "b"]);
  });
});
