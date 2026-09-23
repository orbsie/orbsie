import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MAX_SCENE_POSITION } from "../src/lib/protocol";
import {
  createWorldNavigationState,
  worldNavigationCameraPose,
} from "../src/lib/world-navigation";
import {
  selectRenderOrigin,
  worldCameraPoseToRenderLocal,
  worldToRenderLocal,
} from "../src/lib/render-origin";
import { WEBGL_LOCAL_KEY_LIGHT_POSITION } from "../src/components/world";

const relativeObjectOffset = [0.2, 0.1, -0.15] as const;

function projectRelativeObject(
  focus: readonly [number, number, number],
  origin: readonly [number, number, number],
) {
  const navigation = createWorldNavigationState({
    target: focus,
    heading: 0.7,
    distance: 24,
  });
  const worldPose = worldNavigationCameraPose(navigation);
  const pose = worldCameraPoseToRenderLocal(worldPose, origin);
  const objectWorld = focus.map(
    (component, axis) => component + relativeObjectOffset[axis],
  ) as [number, number, number];
  const object = worldToRenderLocal(objectWorld, origin);
  if (!pose || !object) throw new Error("Expected finite local render inputs.");

  const float32 = (
    vector: readonly [number, number, number],
  ): [number, number, number] =>
    vector.map(Math.fround) as [number, number, number];
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 500);
  camera.position.set(...float32(pose.position));
  camera.lookAt(...float32(pose.target));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const projected = new THREE.Vector3(...float32(object)).project(camera);
  return [projected.x, projected.y] as const;
}

function distance2d(a: readonly number[], b: readonly number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

describe("WebGL render-origin projection", () => {
  it("preserves nearby projected detail at the origin, 10km, and both world limits", () => {
    const focusPoints = [
      [0, 5, 0],
      [10_000, 5, -10_000],
      [MAX_SCENE_POSITION - 0.5, 5, -MAX_SCENE_POSITION + 0.5],
      [-MAX_SCENE_POSITION + 0.5, 5, MAX_SCENE_POSITION - 0.5],
    ] as const;
    const baseline = projectRelativeObject(focusPoints[0], [0, 0, 0]);

    for (const focus of focusPoints) {
      const origin = selectRenderOrigin(focus);
      const projected = projectRelativeObject(focus, origin);
      expect(distance2d(projected, baseline)).toBeLessThan(1e-5);
    }

    const farWorldProjection = projectRelativeObject(focusPoints[2], [0, 0, 0]);
    expect(distance2d(farWorldProjection, baseline)).toBeGreaterThan(1e-4);
  });

  it("keeps transformed mesh matrices and the camera near local zero at both limits", () => {
    const focusPoints = [
      [MAX_SCENE_POSITION - 0.5, 5, -MAX_SCENE_POSITION + 0.5],
      [-MAX_SCENE_POSITION + 0.5, 5, MAX_SCENE_POSITION - 0.5],
    ] as const;

    for (const focus of focusPoints) {
      const origin = selectRenderOrigin(focus);
      const worldPosition = focus.map(
        (component, axis) => component + relativeObjectOffset[axis],
      ) as [number, number, number];
      const frame = new THREE.Group();
      frame.position.set(-origin[0], -origin[1], -origin[2]);
      const mesh = new THREE.Object3D();
      mesh.position.set(...worldPosition);
      frame.add(mesh);
      frame.updateMatrixWorld(true);
      const matrixPosition = mesh.getWorldPosition(new THREE.Vector3());
      const expectedLocalPosition = worldToRenderLocal(worldPosition, origin);
      const localCamera = worldCameraPoseToRenderLocal(
        worldNavigationCameraPose(
          createWorldNavigationState({ target: focus, distance: 24 }),
        ),
        origin,
      );

      expect(expectedLocalPosition).toBeDefined();
      expect(matrixPosition.toArray()).toEqual(expectedLocalPosition);
      expect(
        matrixPosition
          .toArray()
          .every((component) => Math.abs(component) < 513),
      ).toBe(true);
      expect(localCamera).toBeDefined();
      expect(
        localCamera!.position.every((component) => Math.abs(component) < 550),
      ).toBe(true);
    }
  });

  it("keeps the key light and its target in the renderer-local content frame", () => {
    const focus: [number, number, number] = [MAX_SCENE_POSITION - 0.5, 5, 0];
    const origin = selectRenderOrigin(focus);
    const scene = new THREE.Scene();
    const frame = new THREE.Group();
    frame.position.set(-origin[0], -origin[1], -origin[2]);
    const mesh = new THREE.Object3D();
    mesh.position.set(...focus);
    frame.add(mesh);

    const light = new THREE.DirectionalLight();
    light.position.set(...WEBGL_LOCAL_KEY_LIGHT_POSITION);
    light.target.position.set(0, 0, 0);
    scene.add(frame, light, light.target);
    scene.updateMatrixWorld(true);

    const visibleContent = mesh.getWorldPosition(new THREE.Vector3());
    const localLight = light.getWorldPosition(new THREE.Vector3());
    const localTarget = light.target.getWorldPosition(new THREE.Vector3());
    expect(visibleContent.length()).toBeLessThan(513);
    expect(localLight.toArray()).toEqual([...WEBGL_LOCAL_KEY_LIGHT_POSITION]);
    expect(localTarget.toArray()).toEqual([0, 0, 0]);
    expect(localLight.distanceTo(localTarget)).toBeLessThan(20);
  });

  it("keeps camera-relative projection continuous across a rebase in either direction", () => {
    const start = [760, 0, 0] as const;
    const afterCrossing = [769, 0, 0] as const;
    const originBefore = selectRenderOrigin(start, [0, 0, 0]);
    const originAfter = selectRenderOrigin(afterCrossing, originBefore);
    expect(originBefore).toEqual([0, 0, 0]);
    expect(originAfter).toEqual([1024, 0, 0]);
    expect(
      distance2d(
        projectRelativeObject(start, originBefore),
        projectRelativeObject(afterCrossing, originAfter),
      ),
    ).toBeLessThan(1e-5);

    const returnAcross = [255, 0, 0] as const;
    const originReturned = selectRenderOrigin(returnAcross, originAfter);
    expect(originReturned).toEqual([0, 0, 0]);
    expect(
      distance2d(
        projectRelativeObject(returnAcross, originReturned),
        projectRelativeObject(returnAcross, originAfter),
      ),
    ).toBeLessThan(1e-5);
  });
});
