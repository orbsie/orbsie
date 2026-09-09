import { describe, expect, it } from "vitest";
import { Matrix4 } from "three";
import { stepGameplay, touchesEntity } from "../src/lib/gameplay";
import { entitySchema } from "../src/lib/protocol";

const platform = entitySchema.parse({
  id: "platform",
  label: "Platform",
  position: [0, 1, 0],
  scale: [1, 1, 1],
  stage: "ready",
  geometry: { kind: "platform", detail: "refined" },
});
const idle = { x: 0, z: 0, jump: false };
describe("gameplay with resolved world matrices", () => {
  it("lands only inside a rotated platform's actual footprint", () => {
    const pose = new Matrix4()
      .makeTranslation(0, 1, 0)
      .multiply(new Matrix4().makeRotationY(Math.PI / 4));
    const matrices = new Map([[platform.id, pose]]);
    const outside = stepGameplay(
      { position: [0.7, 1.96, 0.7], velocityY: -1 },
      idle,
      [platform],
      [],
      0,
      0.04,
      undefined,
      matrices,
    );
    expect(outside.groundedOn).toBeUndefined();
    const inside = stepGameplay(
      { position: [0.5, 1.96, 0], velocityY: -1 },
      idle,
      [platform],
      [],
      0,
      0.04,
      undefined,
      matrices,
    );
    expect(inside.groundedOn).toBe(platform.id);
  });
  it("carries an off-center grounded player through parent rotation", () => {
    const old = new Matrix4().makeTranslation(0, 1, 0);
    const next = old.clone().multiply(new Matrix4().makeRotationY(Math.PI / 2));
    const result = stepGameplay(
      {
        position: [0.4, 1.94, 0],
        velocityY: 0,
        groundedOn: platform.id,
        supportPosition: [0, 1, 0],
        supportTop: 1.94,
        supportMatrix: old.toArray(),
      },
      idle,
      [platform],
      [],
      0,
      0.02,
      undefined,
      new Map([[platform.id, next]]),
    );
    expect(result.position[0]).toBeCloseTo(0);
    expect(result.position[2]).toBeCloseTo(-0.4);
    expect(result.position[1]).toBeCloseTo(1.94);
    expect(result.groundedOn).toBe(platform.id);
    expect(result.supportMatrix).toEqual(next.toArray());
  });
  it("drops support when a transformed platform becomes singular", () => {
    const result = stepGameplay(
      {
        position: [0, 1.94, 0],
        velocityY: 0,
        groundedOn: platform.id,
        supportPosition: [0, 1, 0],
        supportMatrix: new Matrix4().makeTranslation(0, 1, 0).toArray(),
      },
      idle,
      [platform],
      [],
      0,
      0.02,
      undefined,
      new Map([[platform.id, new Matrix4().makeScale(1, 0, 1)]]),
    );
    expect(result.groundedOn).toBeUndefined();
    expect(result.supportMatrix).toBeUndefined();
    expect(result.position[1]).toBeLessThan(1.94);
  });
  it("collects using resolved geometry bounds instead of local origin", () => {
    const crystal = entitySchema.parse({
      ...platform,
      id: "crystal",
      geometry: { kind: "crystal", detail: "refined" },
      behavior: { type: "collect" },
    });
    const matrix = new Matrix4().makeTranslation(4, 1, 0);
    expect(touchesEntity(crystal, [0, 1, 0], 0, matrix)).toBe(false);
    const result = stepGameplay(
      { position: [4, 1, 0], velocityY: 0 },
      idle,
      [crystal],
      [],
      0,
      0,
      undefined,
      new Map([[crystal.id, matrix]]),
    );
    expect(result.collected).toEqual([crystal.id]);
  });
});
