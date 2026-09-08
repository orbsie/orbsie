import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { entityGeometry } from "../src/lib/geometry";
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
