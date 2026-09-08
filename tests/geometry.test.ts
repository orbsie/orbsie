import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  addFormationSource,
  captureFormationSnapshot,
  entityGeometry,
  type FormationSnapshot,
} from "../src/lib/geometry";
import { entitySchema, type Entity } from "../src/lib/protocol";

const multipart = entitySchema.parse({
  id: "multipart",
  label: "Multipart",
  position: [0, 0, 0],
  color: "#00aa00",
  stage: "ready",
  geometry: {
    kind: "custom",
    detail: "refined",
    parts: [
      {
        shape: "box",
        position: [-1, 0, 0],
        scale: [1, 1, 1],
        color: "#123456",
      },
      {
        shape: "sphere",
        position: [1, 0, 0],
        scale: [0.5, 0.5, 0.5],
        color: "#abcdef",
      },
    ],
  },
});

describe("procedural geometry materials", () => {
  it("preserves multipart palette until an explicit tint overrides vertices", () => {
    const original = entityGeometry(multipart);
    const originalPositions = Array.from(
      original.getAttribute("position").array as Float32Array,
    );
    const originalColors = original.getAttribute("color").array as Float32Array;
    const originalPalette = new Set<string>();
    for (let index = 0; index < originalColors.length; index += 3)
      originalPalette.add(
        [
          originalColors[index],
          originalColors[index + 1],
          originalColors[index + 2],
        ]
          .map((value) => value.toFixed(4))
          .join(","),
      );
    expect(originalPalette.size).toBeGreaterThan(1);

    const tinted = entityGeometry({
      ...multipart,
      geometry: { ...multipart.geometry!, tint: "#ed99b5" },
    } as Entity);
    const tintedPositions = Array.from(
      tinted.getAttribute("position").array as Float32Array,
    );
    const tintedColors = tinted.getAttribute("color").array as Float32Array;
    const tint = new THREE.Color("#ed99b5");
    expect(tintedPositions).toEqual(originalPositions);
    for (let index = 0; index < tintedColors.length; index += 3) {
      expect(tintedColors[index]).toBeCloseTo(tint.r);
      expect(tintedColors[index + 1]).toBeCloseTo(tint.g);
      expect(tintedColors[index + 2]).toBeCloseTo(tint.b);
    }
    original.dispose();
    tinted.dispose();
  });
});

function formationGeometry(
  positions: number[],
  colors: number[],
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

describe("formation snapshots", () => {
  it("captures eased visible positions and colors at partial progress", () => {
    const geometry = formationGeometry([2, 4, 6, 4, 6, 8], [1, 0, 0, 0, 1, 0]);
    geometry.setAttribute(
      "aFrom",
      new THREE.Float32BufferAttribute([0, 0, 0, 2, 2, 2], 3),
    );
    geometry.setAttribute(
      "aFromColor",
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1], 3),
    );

    const snapshot = captureFormationSnapshot(geometry, 0.5);

    expect(Array.from(snapshot.positions)).toEqual([1, 2, 3, 3, 4, 5]);
    expect(Array.from(snapshot.colors)).toEqual([0.5, 0, 0, 0, 0.5, 0.5]);
    geometry.dispose();
  });

  it("rebases positions and colors with the same bounded vertex correspondence", () => {
    const previous: FormationSnapshot = {
      positions: new Float32Array([1, 2, 3, 4, 5, 6]),
      colors: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]),
    };
    const geometry = formationGeometry(
      [10, 11, 12, 20, 21, 22, 30, 31, 32],
      [1, 0, 0, 0, 1, 0, 0, 0, 1],
    );

    addFormationSource(geometry, previous);

    expect(Array.from(geometry.getAttribute("aFrom").array)).toEqual([
      1, 2, 3, 4, 5, 6, 1, 2, 3,
    ]);
    expect(Array.from(geometry.getAttribute("aFromColor").array)).toEqual(
      Array.from(
        new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.1, 0.2, 0.3]),
      ),
    );
    expect(captureFormationSnapshot(geometry, 0)).toEqual({
      positions: new Float32Array([1, 2, 3, 4, 5, 6, 1, 2, 3]),
      colors: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.1, 0.2, 0.3]),
    });
    expect(captureFormationSnapshot(geometry, 1)).toEqual({
      positions: new Float32Array([10, 11, 12, 20, 21, 22, 30, 31, 32]),
      colors: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    });
    geometry.dispose();
  });

  it("keeps initial colors at the target and supports legacy positional arrays", () => {
    const geometry = formationGeometry(
      [1, 2, 3, 4, 5, 6],
      [0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
    );

    addFormationSource(geometry);
    expect(Array.from(geometry.getAttribute("aFromColor").array)).toEqual(
      Array.from(new Float32Array([0.2, 0.3, 0.4, 0.5, 0.6, 0.7])),
    );

    addFormationSource(geometry, new Float32Array([9, 8, 7]));
    expect(Array.from(geometry.getAttribute("aFrom").array)).toEqual([
      9, 8, 7, 9, 8, 7,
    ]);
    expect(Array.from(geometry.getAttribute("aFromColor").array)).toEqual(
      Array.from(new Float32Array([0.2, 0.3, 0.4, 0.5, 0.6, 0.7])),
    );
    geometry.dispose();
  });

  it("falls back to finite target attributes for empty or invalid sources", () => {
    const geometry = formationGeometry(
      [1, 2, 3, 4, 5, 6],
      [0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
    );

    addFormationSource(geometry, new Float32Array());
    expect(Array.from(geometry.getAttribute("aFrom").array)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    addFormationSource(
      geometry,
      new Float32Array([Number.NaN, Number.POSITIVE_INFINITY, 2]),
    );
    expect(Array.from(geometry.getAttribute("aFrom").array)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    geometry.deleteAttribute("aFrom");
    geometry.setAttribute(
      "aFromColor",
      new THREE.Float32BufferAttribute([Number.NaN, 0, 0, 0, 0, 0], 3),
    );
    expect(captureFormationSnapshot(geometry, 1)).toEqual({
      positions: new Float32Array([1, 2, 3, 4, 5, 6]),
      colors: new Float32Array([0.2, 0.3, 0.4, 0.5, 0.6, 0.7]),
    });
    geometry.dispose();
  });

  it("reads per-vertex components from interleaved and normalized attributes", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.InterleavedBufferAttribute(
        new THREE.InterleavedBuffer(
          new Float32Array([99, 10, 20, 30, 88, 40, 50, 60]),
          4,
        ),
        3,
        1,
      ),
    );
    geometry.setAttribute(
      "color",
      new THREE.InterleavedBufferAttribute(
        new THREE.InterleavedBuffer(
          new Uint8Array([7, 255, 128, 0, 8, 0, 64, 255]),
          4,
        ),
        3,
        1,
        true,
      ),
    );
    geometry.setAttribute(
      "aFrom",
      new THREE.InterleavedBufferAttribute(
        new THREE.InterleavedBuffer(
          new Float32Array([Number.NaN, 1, 2, 3, Number.NaN, 4, 5, 6]),
          4,
        ),
        3,
        1,
      ),
    );
    geometry.setAttribute(
      "aFromColor",
      new THREE.InterleavedBufferAttribute(
        new THREE.InterleavedBuffer(
          new Uint8Array([9, 0, 128, 255, 10, 255, 64, 0]),
          4,
        ),
        3,
        1,
        true,
      ),
    );

    const initial = captureFormationSnapshot(geometry, 0);
    expect(Array.from(initial.positions)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(initial.colors[0]).toBeCloseTo(0);
    expect(initial.colors[1]).toBeCloseTo(128 / 255);
    expect(initial.colors[2]).toBeCloseTo(1);
    expect(initial.colors[3]).toBeCloseTo(1);
    expect(initial.colors[4]).toBeCloseTo(64 / 255);
    expect(initial.colors[5]).toBeCloseTo(0);

    const settled = captureFormationSnapshot(geometry, 1);
    expect(Array.from(settled.positions)).toEqual([10, 20, 30, 40, 50, 60]);
    expect(settled.colors[0]).toBeCloseTo(1);
    expect(settled.colors[1]).toBeCloseTo(128 / 255);
    expect(settled.colors[2]).toBeCloseTo(0);
    expect(settled.colors[3]).toBeCloseTo(0);
    expect(settled.colors[4]).toBeCloseTo(64 / 255);
    expect(settled.colors[5]).toBeCloseTo(1);
    geometry.dispose();
  });

  it("maps every valid position when snapshot colors are invalid or mismatched", () => {
    const geometry = formationGeometry(
      [10, 11, 12, 20, 21, 22, 30, 31, 32],
      [1, 0, 0, 0, 1, 0, 0, 0, 1],
    );
    const previous: FormationSnapshot = {
      positions: new Float32Array([1, 2, 3, 4, 5, 6]),
      colors: new Float32Array([Number.NaN, 0, 0, 0, 0, 0]),
    };

    addFormationSource(geometry, previous);
    expect(Array.from(geometry.getAttribute("aFrom").array)).toEqual([
      1, 2, 3, 4, 5, 6, 1, 2, 3,
    ]);
    expect(Array.from(geometry.getAttribute("aFromColor").array)).toEqual([
      1, 0, 0, 0, 1, 0, 0, 0, 1,
    ]);

    addFormationSource(geometry, {
      positions: new Float32Array([7, 8, 9, 10, 11, 12]),
      colors: new Float32Array([0, 1, 0]),
    });
    expect(Array.from(geometry.getAttribute("aFrom").array)).toEqual([
      7, 8, 9, 10, 11, 12, 7, 8, 9,
    ]);
    expect(Array.from(geometry.getAttribute("aFromColor").array)).toEqual([
      1, 0, 0, 0, 1, 0, 0, 0, 1,
    ]);
    geometry.dispose();
  });
});
