import { describe, expect, it } from "vitest";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import {
  MAX_SCENE_ENTITIES,
  MAX_SCENE_GROUP_DEPTH,
  MAX_SCENE_GROUPS,
  SCENE_TRANSFORM_TOLERANCE,
  applyRootPositionOverride,
  computeKeepWorldLocalTRS,
  resolveSceneTransforms,
  transformBounds,
  type SceneEntity,
  type SceneGroup,
} from "../src/lib/scene-transform";

const group = (
  id: string,
  position: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
  rotation?: [number, number, number],
  parentId?: string,
): SceneGroup => ({ id, position, scale, rotation, parentId });

const entity = (
  id: string,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
  rotation?: [number, number, number],
  parentId?: string,
): SceneEntity => ({ id, position, scale, rotation, parentId });

function point(
  matrix: Matrix4,
  value: [number, number, number],
): [number, number, number] {
  const result = new Vector3(...value).applyMatrix4(matrix);
  return [result.x, result.y, result.z];
}

function expectMatrixClose(actual: Matrix4, expected: Matrix4) {
  expect(actual.elements).toHaveLength(16);
  actual.elements.forEach((value, index) =>
    expect(value).toBeCloseTo(expected.elements[index], 8),
  );
}

describe("scene transform foundation", () => {
  it("resolves the deterministic translation, scale, and Y-rotation cases", () => {
    const translated = resolveSceneTransforms({
      groups: [group("g", [1, 0, 3])],
      entities: [entity("e", [2, 0, 0], [1, 1, 1], undefined, "g")],
    });
    expect(translated.entities.get("e")?.worldPosition).toEqual([3, 0, 3]);

    const scaled = resolveSceneTransforms({
      groups: [group("g", [1, 0, 3], [2, 2, 2])],
      entities: [entity("e", [2, 0, 0], [1, 1, 1], undefined, "g")],
    });
    expect(scaled.entities.get("e")?.worldPosition).toEqual([5, 0, 3]);

    const rotated = resolveSceneTransforms({
      groups: [group("g", [1, 0, 3], [2, 2, 2], [0, Math.PI / 2, 0])],
      entities: [entity("e", [2, 0, 0], [1, 1, 1], undefined, "g")],
    });
    expect(rotated.entities.get("e")?.worldPosition[0]).toBeCloseTo(1);
    expect(rotated.entities.get("e")?.worldPosition.slice(1)).toEqual([0, -1]);
  });

  it("keeps exact nested matrices when nonuniform rotation introduces shear", () => {
    const groups = [
      group("outer", [2, 1, -3], [2, 1, 3], [0, Math.PI / 3, 0]),
      group("inner", [1, 0, 2], [1, 2, 1], [Math.PI / 5, 0, 0], "outer"),
    ];
    const scene = resolveSceneTransforms({
      groups,
      entities: [entity("e", [0.5, 1, -0.25], [1, 3, 2], [0, 0.2, 0], "inner")],
    });
    const outer = scene.groups.get("outer")!;
    const inner = scene.groups.get("inner")!;
    const expected = outer.worldMatrix.clone().multiply(inner.localMatrix);
    expectMatrixClose(inner.worldMatrix, expected);
    expectMatrixClose(
      scene.entities.get("e")!.worldMatrix,
      inner.worldMatrix.clone().multiply(scene.entities.get("e")!.localMatrix),
    );
    expect(
      scene.entities.get("e")!.worldMatrix.elements.every(Number.isFinite),
    ).toBe(true);
  });

  it("preserves legacy zero and negative entity scales in forward resolution", () => {
    const scene = resolveSceneTransforms({
      entities: [
        entity("negative", [1, 2, 3], [-2, 1, 1]),
        entity("zero", [0, 0, 0], [0, 2, -1]),
      ],
    });
    expect(scene.entities.get("negative")!.worldMatrix.elements[0]).toBe(-2);
    expect(
      scene.entities.get("zero")!.worldMatrix.elements.every(Number.isFinite),
    ).toBe(true);
  });

  it("transforms all eight bounds corners", () => {
    const matrix = new Matrix4().compose(
      new Vector3(5, -2, 1),
      new Quaternion().setFromEuler(new Euler(0, Math.PI / 4, 0)),
      new Vector3(2, 1, 3),
    );
    const bounds = transformBounds(matrix, {
      min: [-1, -1, -1],
      max: [1, 1, 1],
    });
    const corners = [-1, 1].flatMap((x) =>
      [-1, 1].flatMap((y) => [-1, 1].map((z) => point(matrix, [x, y, z]))),
    );
    expect(bounds.min[0]).toBeCloseTo(Math.min(...corners.map((v) => v[0])));
    expect(bounds.min[1]).toBeCloseTo(Math.min(...corners.map((v) => v[1])));
    expect(bounds.min[2]).toBeCloseTo(Math.min(...corners.map((v) => v[2])));
    expect(bounds.max[0]).toBeCloseTo(Math.max(...corners.map((v) => v[0])));
    expect(bounds.max[1]).toBeCloseTo(Math.max(...corners.map((v) => v[1])));
    expect(bounds.max[2]).toBeCloseTo(Math.max(...corners.map((v) => v[2])));
  });

  it("computes representable keep-world local TRS", () => {
    const parent = new Matrix4().compose(
      new Vector3(4, 1, -2),
      new Quaternion().setFromEuler(new Euler(0, 0.3, 0)),
      new Vector3(2, 2, 2),
    );
    const local = new Matrix4().compose(
      new Vector3(1, 2, 3),
      new Quaternion().setFromEuler(new Euler(0.2, -0.4, 0.1)),
      new Vector3(-1, 2, 0.5),
    );
    const world = parent.clone().multiply(local);
    const recovered = computeKeepWorldLocalTRS(world, parent);
    const recoveredMatrix = new Matrix4().compose(
      new Vector3(...recovered.position),
      new Quaternion().setFromEuler(new Euler(...recovered.rotation, "XYZ")),
      new Vector3(...recovered.scale),
    );
    expectMatrixClose(recoveredMatrix, local);
    expectMatrixClose(parent.clone().multiply(recoveredMatrix), world);
  });

  it("keeps valid millimeter-scale transforms representable", () => {
    const millimeterWorld = new Matrix4().makeScale(0.001, 0.001, 0.001);
    const recovered = computeKeepWorldLocalTRS(millimeterWorld);
    expect(recovered.scale[0]).toBeCloseTo(0.001);
    expect(recovered.scale[1]).toBeCloseTo(0.001);
    expect(recovered.scale[2]).toBeCloseTo(0.001);
    const reconstructed = new Matrix4().compose(
      new Vector3(...recovered.position),
      new Quaternion().setFromEuler(new Euler(...recovered.rotation, "XYZ")),
      new Vector3(...recovered.scale),
    );
    expectMatrixClose(reconstructed, millimeterWorld);
  });

  it("rejects singular or sheared keep-world local transforms", () => {
    expect(() =>
      computeKeepWorldLocalTRS(new Matrix4(), new Matrix4().makeScale(0, 1, 1)),
    ).toThrow(/singular/i);
    const rotatedNonuniformParent = new Matrix4().compose(
      new Vector3(),
      new Quaternion().setFromEuler(new Euler(0, Math.PI / 4, 0)),
      new Vector3(2, 1, 3),
    );
    expect(() =>
      computeKeepWorldLocalTRS(new Matrix4(), rotatedNonuniformParent),
    ).toThrow(/shear|represent/i);
    const perspective = new Matrix4();
    perspective.elements[3] = 1e-10;
    expect(() => computeKeepWorldLocalTRS(perspective)).toThrow(/affine/i);
  });

  it("overrides root position without touching the linear matrix", () => {
    const matrix = new Matrix4().compose(
      new Vector3(1, 2, 3),
      new Quaternion().setFromEuler(new Euler(0.2, 0.4, -0.1)),
      new Vector3(2, -1, 3),
    );
    const before = matrix.elements.slice(0, 12);
    const moved = applyRootPositionOverride(matrix, [9, 8, 7]);
    expect(moved.elements.slice(0, 12)).toEqual(before);
    expect(moved.elements.slice(12, 15)).toEqual([9, 8, 7]);
  });

  it("rejects duplicate IDs, invalid parents, cycles, and resource limits", () => {
    expect(() =>
      resolveSceneTransforms({
        groups: [group("same")],
        entities: [entity("same", [0, 0, 0])],
      }),
    ).toThrow(/duplicate/i);
    expect(() =>
      resolveSceneTransforms({
        groups: [group("a")],
        entities: [entity("e", [0, 0, 0], [1, 1, 1], undefined, "missing")],
      }),
    ).toThrow(/group/i);
    expect(() =>
      resolveSceneTransforms({
        groups: [
          group("a", [0, 0, 0], [1, 1, 1], undefined, "b"),
          group("b", [0, 0, 0], [1, 1, 1], undefined, "a"),
        ],
        entities: [],
      }),
    ).toThrow(/cycle/i);
    expect(() =>
      resolveSceneTransforms({
        groups: [group("self", [0, 0, 0], [1, 1, 1], undefined, "self")],
        entities: [],
      }),
    ).toThrow(/self|cycle/i);
    expect(() =>
      resolveSceneTransforms({
        groups: [group("bad-scale", [0, 0, 0], [1, 0, 1])],
        entities: [],
      }),
    ).toThrow(/positive/i);
    expect(() =>
      resolveSceneTransforms({
        entities: [entity("bad-position", [Number.NaN, 0, 0])],
      }),
    ).toThrow(/finite/i);
    expect(() =>
      resolveSceneTransforms({
        groups: [group("overflow", [0, 0, 0], [Number.MAX_VALUE, 1, 1])],
        entities: [
          entity("overflow-child", [0, 0, 0], [2, 1, 1], undefined, "overflow"),
        ],
      }),
    ).toThrow(/nonfinite/i);
    const tooDeep = Array.from(
      { length: MAX_SCENE_GROUP_DEPTH + 1 },
      (_, index) =>
        group(
          `g${index}`,
          [0, 0, 0],
          [1, 1, 1],
          undefined,
          index === 0 ? undefined : `g${index - 1}`,
        ),
    );
    expect(() =>
      resolveSceneTransforms({ groups: tooDeep, entities: [] }),
    ).toThrow(/depth/i);
    expect(() =>
      resolveSceneTransforms({
        groups: Array.from({ length: MAX_SCENE_GROUPS + 1 }, (_, index) =>
          group(`g${index}`),
        ),
        entities: [],
      }),
    ).toThrow(/group/i);
    expect(() =>
      resolveSceneTransforms({
        entities: Array.from({ length: MAX_SCENE_ENTITIES + 1 }, (_, index) =>
          entity(`e${index}`, [0, 0, 0]),
        ),
      }),
    ).toThrow(/entity/i);
  });

  it("accepts exactly the group-depth boundary", () => {
    const groups = Array.from({ length: MAX_SCENE_GROUP_DEPTH }, (_, index) =>
      group(
        `g${index}`,
        [0, 0, 0],
        [1, 1, 1],
        undefined,
        index === 0 ? undefined : `g${index - 1}`,
      ),
    );
    expect(resolveSceneTransforms({ groups, entities: [] }).groups.size).toBe(
      MAX_SCENE_GROUP_DEPTH,
    );
    expect(SCENE_TRANSFORM_TOLERANCE).toBe(1e-8);
  });
});
