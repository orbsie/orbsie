import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { formationParticles } from "../src/lib/formation-particles";

function triangleGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 0, 2], 3),
  );
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3),
  );
  geometry.setAttribute(
    "aFrom",
    new THREE.Float32BufferAttribute([10, 1, 2, 14, 1, 2, 10, 1, 6], 3),
  );
  geometry.setAttribute(
    "aFromColor",
    new THREE.Float32BufferAttribute([0, 0, 1, 1, 0, 1, 0, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

function attributeValues(
  geometry: THREE.BufferGeometry,
  name: string,
): number[] {
  const attribute = geometry.getAttribute(name);
  return Array.from(attribute.array as ArrayLike<number>);
}

describe("formationParticles", () => {
  it("samples deterministically and leaves the source geometry unchanged", () => {
    const source = triangleGeometry();
    const before = Object.fromEntries(
      ["position", "color", "aFrom", "aFromColor"].map((name) => [
        name,
        attributeValues(source, name),
      ]),
    );

    const first = formationParticles(source, 32);
    const second = formationParticles(source, 32);
    for (const name of ["position", "color", "aFrom", "aFromColor"])
      expect(attributeValues(first, name)).toEqual(
        attributeValues(second, name),
      );
    expect(source.index?.count).toBe(3);
    expect(
      Object.fromEntries(
        ["position", "color", "aFrom", "aFromColor"].map((name) => [
          name,
          attributeValues(source, name),
        ]),
      ),
    ).toEqual(before);
    first.dispose();
    second.dispose();
    source.dispose();
  });

  it("honors the requested count and the hard 4096 point cap", () => {
    const source = triangleGeometry();
    const capped = formationParticles(source, 100_000);
    const bounded = formationParticles(source, 7);
    expect(capped.getAttribute("position").count).toBe(4096);
    expect(bounded.getAttribute("position").count).toBe(7);
    capped.dispose();
    bounded.dispose();
    source.dispose();
  });

  it("keeps area selection independent from each triangle's barycentric coverage", () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 2, 0, 0, 0, 0, 2, 10, 0, 0, 12, 0, 0, 10, 0, 2],
        3,
      ),
    );
    const sampled = formationParticles(source, 256);
    const position = sampled.getAttribute("position");
    const leftZ: number[] = [];
    const rightZ: number[] = [];
    for (let index = 0; index < position.count; index++)
      (position.getX(index) < 5 ? leftZ : rightZ).push(position.getZ(index));
    expect(leftZ.length).toBeGreaterThan(0);
    expect(rightZ.length).toBeGreaterThan(0);
    expect(Math.min(...leftZ)).toBeLessThan(0.25);
    expect(Math.max(...leftZ)).toBeGreaterThan(0.75);
    expect(Math.min(...rightZ)).toBeLessThan(0.25);
    expect(Math.max(...rightZ)).toBeGreaterThan(0.75);
    sampled.dispose();
    source.dispose();
  });

  it("keeps sampled points on the target plane and computes bounds", () => {
    const source = triangleGeometry();
    const sampled = formationParticles(source, 128);
    const position = sampled.getAttribute("position");
    for (let index = 0; index < position.count; index++) {
      expect(position.getY(index)).toBeCloseTo(0);
      expect(position.getX(index)).toBeGreaterThanOrEqual(0);
      expect(position.getZ(index)).toBeGreaterThanOrEqual(0);
      expect(position.getX(index) + position.getZ(index)).toBeLessThanOrEqual(
        2.000001,
      );
    }
    expect(sampled.boundingBox).not.toBeNull();
    expect(sampled.boundingSphere).not.toBeNull();
    expect(sampled.boundingBox!.min.y).toBeCloseTo(0);
    expect(sampled.boundingBox!.max.y).toBeCloseTo(0);
    expect(sampled.boundingBox!.min.x).toBeGreaterThanOrEqual(0);
    expect(sampled.boundingBox!.max.x).toBeLessThanOrEqual(2);
    expect(sampled.boundingBox!.min.z).toBeGreaterThanOrEqual(0);
    expect(sampled.boundingBox!.max.z).toBeLessThanOrEqual(2);
    sampled.dispose();
    source.dispose();
  });

  it("uses the same triangle and barycentric sample for all attributes", () => {
    const source = triangleGeometry();
    const sampled = formationParticles(source, 64);
    const position = sampled.getAttribute("position");
    const from = sampled.getAttribute("aFrom");
    const color = sampled.getAttribute("color");
    const fromColor = sampled.getAttribute("aFromColor");
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index);
      const z = position.getZ(index);
      expect(from.getX(index)).toBeCloseTo(10 + 2 * x);
      expect(from.getY(index)).toBeCloseTo(1);
      expect(from.getZ(index)).toBeCloseTo(2 + 2 * z);
      expect(color.getX(index)).toBeCloseTo(1 - x / 2 - z / 2);
      expect(color.getY(index)).toBeCloseTo(x / 2);
      expect(color.getZ(index)).toBeCloseTo(z / 2);
      expect(fromColor.getX(index)).toBeCloseTo(x / 2);
      expect(fromColor.getY(index)).toBeCloseTo(z / 2);
      expect(fromColor.getZ(index)).toBeCloseTo(1 - z / 2);
    }
    sampled.dispose();
    source.dispose();
  });

  it("supports normalized interleaved attributes and fallback source attributes", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.InterleavedBufferAttribute(
        new THREE.InterleavedBuffer(
          new Float32Array([99, 0, 0, 0, 98, 2, 0, 0, 97, 0, 0, 2]),
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
          new Uint8Array([9, 255, 0, 0, 8, 0, 255, 0, 7, 0, 0, 255]),
          4,
        ),
        3,
        1,
        true,
      ),
    );
    geometry.setIndex([0, 1, 2]);
    const sampled = formationParticles(geometry, 8);
    for (
      let index = 0;
      index < sampled.getAttribute("position").count;
      index++
    ) {
      expect(sampled.getAttribute("aFrom").getX(index)).toBeCloseTo(
        sampled.getAttribute("position").getX(index),
      );
      expect(sampled.getAttribute("aFromColor").getX(index)).toBeCloseTo(
        sampled.getAttribute("color").getX(index),
      );
    }
    expect(sampled.getAttribute("color").getX(0)).toBeGreaterThanOrEqual(0);
    expect(sampled.getAttribute("color").getX(0)).toBeLessThanOrEqual(1);
    sampled.dispose();
    geometry.dispose();
  });

  it("skips degenerate and nonfinite triangles and returns safe empty output", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, NaN, 0, 0],
        3,
      ),
    );
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(
        [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        3,
      ),
    );
    geometry.setIndex([0, 1, 2, 0, 3, 4, 0, 1, 5]);
    const sampled = formationParticles(geometry, 16);
    expect(sampled.getAttribute("position").count).toBe(16);
    for (const name of ["position", "color", "aFrom", "aFromColor"])
      expect(
        Array.from(sampled.getAttribute(name).array as ArrayLike<number>).every(
          Number.isFinite,
        ),
      ).toBe(true);

    const empty = formationParticles(new THREE.BufferGeometry(), 16);
    expect(empty.getAttribute("position").count).toBe(0);
    expect(empty.getAttribute("color").count).toBe(0);
    sampled.dispose();
    empty.dispose();
    geometry.dispose();
  });
});
