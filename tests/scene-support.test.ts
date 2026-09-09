import { describe, expect, it } from "vitest";
import { Matrix4 } from "three";
import {
  carrySupportContact,
  supportSurfaceHeight,
} from "../src/lib/scene-support";

const bounds = { min: [-1, -0.25, -1] as const, max: [1, 0.25, 1] as const };
describe("transformed platform support", () => {
  it("retains flat support and rejects points outside its footprint", () => {
    const pose = new Matrix4().makeTranslation(2, 3, 4);
    expect(supportSurfaceHeight(pose, bounds, 2, 4)).toBeCloseTo(3.25);
    expect(supportSurfaceHeight(pose, bounds, 4, 4)).toBeUndefined();
  });
  it("uses a rotated footprint rather than its enclosing AABB", () => {
    const pose = new Matrix4().makeRotationY(Math.PI / 4);
    expect(supportSurfaceHeight(pose, bounds, 1.3, 1.3)).toBeUndefined();
    expect(supportSurfaceHeight(pose, bounds, 1.3, 0)).toBeCloseTo(0.25);
  });
  it("finds the actual sloped top at the queried position", () => {
    const pose = new Matrix4().makeRotationZ(Math.PI / 4);
    expect(supportSurfaceHeight(pose, bounds, 0, 0)).toBeCloseTo(
      Math.SQRT1_2 / 2,
    );
    expect(supportSurfaceHeight(pose, bounds, 0.2, 0)).toBeCloseTo(
      0.2 + Math.SQRT1_2 / 2,
    );
  });
  it("carries an off-center contact through rotation and scale", () => {
    const previous = new Matrix4().makeTranslation(1, 0, 3);
    const next = previous
      .clone()
      .multiply(new Matrix4().makeRotationY(Math.PI / 2))
      .multiply(new Matrix4().makeScale(2, 2, 2));
    const carried = carrySupportContact(previous, next, [2, 0.25, 3])!;
    expect(carried[0]).toBeCloseTo(1);
    expect(carried[1]).toBeCloseTo(0.5);
    expect(carried[2]).toBeCloseTo(1);
  });
  it("supports shear and mirrored legacy scales without decomposition", () => {
    const shear = new Matrix4().set(
      1,
      1,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
    );
    expect(supportSurfaceHeight(shear, bounds, 0, 0)).toBeCloseTo(0.25);
    expect(
      supportSurfaceHeight(new Matrix4().makeScale(-2, -2, 1), bounds, 0, 0),
    ).toBeCloseTo(0.5);
  });
  it("releases invalid or singular support", () => {
    const singular = new Matrix4().makeScale(1, 0, 1);
    expect(supportSurfaceHeight(singular, bounds, 0, 0)).toBeUndefined();
    expect(
      carrySupportContact(new Matrix4(), singular, [0, 0, 0]),
    ).toBeUndefined();
    expect(supportSurfaceHeight(new Matrix4(), bounds, NaN, 0)).toBeUndefined();
  });
});
