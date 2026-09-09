import { describe, expect, it } from "vitest";
import {
  resolveRuntimeScene,
  runtimeEntityMatrix,
} from "../src/lib/scene-runtime";
import {
  carrySupportContact,
  supportSurfaceHeight,
} from "../src/lib/scene-support";

const entity = {
  id: "child",
  parentId: "group",
  position: [2, 0, 0] as const,
  scale: [1, 1, 1] as const,
  stage: "ready" as const,
};
const snapshot = {
  groups: [
    {
      id: "group",
      position: [1, 0, 3] as const,
      rotation: [0, Math.PI / 2, 0] as const,
      scale: [2, 2, 2] as const,
    },
  ],
  entities: [entity],
};

describe("shared runtime scene poses", () => {
  it("caches immutable snapshots and refreshes changed parent poses", () => {
    const scene = resolveRuntimeScene(snapshot);
    expect(resolveRuntimeScene(snapshot)).toBe(scene);
    const changed = {
      ...snapshot,
      groups: snapshot.groups.map((g) => ({
        ...g,
        position: [4, 0, 3] as const,
      })),
    };
    expect(resolveRuntimeScene(changed)).not.toBe(scene);
    expect(
      resolveRuntimeScene(changed).entities.get("child")!.worldPosition[0],
    ).toBeCloseTo(4);
    expect(scene.entities.get("child")!.worldPosition[0]).toBeCloseTo(1);
  });
  it("keeps legacy motion on world axes under a rotated parent", () => {
    const moving = {
      ...entity,
      behavior: { type: "move", axis: "x" as const, amplitude: 1, speed: 1 },
    };
    const matrix = runtimeEntityMatrix(
      resolveRuntimeScene(snapshot),
      moving,
      Math.PI / 2,
    );
    expect(matrix.elements[12]).toBeCloseTo(2);
    expect(matrix.elements[14]).toBeCloseTo(-1);
  });
  it("lets root path overrides suppress motion without mutating the base pose", () => {
    const scene = resolveRuntimeScene(snapshot);
    const base = scene.entities.get("child")!.worldMatrix.elements.slice();
    const matrix = runtimeEntityMatrix(
      scene,
      { ...entity, behavior: { type: "move" } },
      1,
      [6, 2, 5],
    );
    expect(matrix.elements.slice(12, 15)).toEqual([6, 2, 5]);
    expect(matrix.elements.slice(0, 12)).toEqual(base.slice(0, 12));
    matrix.elements[0] = 100;
    expect(scene.entities.get("child")!.worldMatrix.elements).toEqual(base);
  });
  it("uses the same resolved pose for platform height and carried contacts", () => {
    const initial = {
      ...snapshot,
      groups: snapshot.groups.map((g) => ({
        ...g,
        rotation: [0, 0, 0] as const,
        scale: [1, 1, 1] as const,
      })),
    };
    const before = runtimeEntityMatrix(resolveRuntimeScene(initial), entity, 0);
    const after = runtimeEntityMatrix(resolveRuntimeScene(snapshot), entity, 0);
    const carried = carrySupportContact(before, after, [3.5, 0.25, 3])!;
    expect(carried[0]).toBeCloseTo(1);
    expect(carried[2]).toBeCloseTo(-2);
    expect(
      supportSurfaceHeight(
        after,
        { min: [-1, -0.25, -1], max: [1, 0.25, 1] },
        carried[0],
        carried[2],
      ),
    ).toBeCloseTo(carried[1]);
  });
});
