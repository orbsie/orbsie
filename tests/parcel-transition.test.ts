import { describe, expect, it } from "vitest";
import {
  createParcelTransition,
  parcelFrame,
  patchBlend,
  planetSpinRate,
  stepParcelTransition,
} from "../src/lib/parcel-transition";

const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, value, index) => sum + value * b[index], 0);
const length = (value: readonly number[]) => Math.hypot(...value);
const cross = (a: readonly number[], b: readonly number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

describe("parcel transition", () => {
  it("maps a project to a deterministic orthonormal tangent frame", () => {
    const first = parcelFrame("project-a");
    const second = parcelFrame("project-a");
    expect(second).toEqual(first);
    expect(parcelFrame("project-b").normal).not.toEqual(first.normal);
    for (const axis of [first.normal, first.east, first.north])
      expect(length(axis)).toBeCloseTo(1, 8);
    expect(dot(first.normal, first.east)).toBeCloseTo(0, 8);
    expect(dot(first.normal, first.north)).toBeCloseTo(0, 8);
    expect(dot(first.east, first.north)).toBeCloseTo(0, 8);
    const tangentNormal = cross(first.east, first.north);
    tangentNormal.forEach((value, index) =>
      expect(value).toBeCloseTo(first.normal[index], 8),
    );
  });

  it("eases the parcel into the flat workspace and slows the globe", () => {
    let state = createParcelTransition();
    const rates = [planetSpinRate(state.progress)];
    for (let i = 0; i < 270; i++) {
      state = stepParcelTransition(state, 1, 1 / 60);
      if (i % 60 === 0) rates.push(planetSpinRate(state.progress));
    }
    expect(state.progress).toBeGreaterThan(0.98);
    expect(patchBlend(state.progress)).toBeCloseTo(1, 3);
    expect(rates[0]).toBeGreaterThan(rates.at(-1)!);
    expect(state.spin).toBeGreaterThan(0);
  });

  it("completes immediately when reduced motion is requested", () => {
    const state = stepParcelTransition(
      createParcelTransition(),
      1,
      1 / 60,
      true,
    );
    expect(state.progress).toBe(1);
    expect(state.spin).toBe(0);
  });
});
