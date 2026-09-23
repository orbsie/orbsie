import { describe, expect, it } from "vitest";
import {
  WORLD_TERRAIN_BASE_CHUNK_SIZE,
  WORLD_TERRAIN_COLLISION_HEIGHT,
  WORLD_TERRAIN_MAX_ACTIVE_CHUNKS,
  WORLD_TERRAIN_NEIGHBORHOOD_RADIUS,
  WORLD_TERRAIN_VERTICAL_FOV_RADIANS,
  sampleWorldTerrainAppearance,
  sampleWorldTerrainChunk,
  selectWorldTerrainChunks,
  worldTerrainChunkKeyAt,
  worldTerrainChunkSize,
  worldTerrainGroundViewRadius,
} from "../src/lib/world-terrain";
import { WORLD_NAVIGATION_LIMITS } from "../src/lib/world-navigation";

describe("world terrain chunk selection", () => {
  it("uses signed floor-based keys at negative and exact chunk boundaries", () => {
    expect(worldTerrainChunkKeyAt(-64, 64).x).toBe(-1);
    expect(worldTerrainChunkKeyAt(-64.001, 0).x).toBe(-2);
    expect(worldTerrainChunkKeyAt(0, -0.001).z).toBe(-1);
    expect(worldTerrainChunkKeyAt(64, -128, 1)).toEqual({
      lod: 1,
      x: 0,
      z: -1,
    });
    expect(worldTerrainChunkSize(3)).toBe(WORLD_TERRAIN_BASE_CHUNK_SIZE * 8);
  });

  it("samples both sides of signed chunk edges at identical world positions", () => {
    const left = worldTerrainChunkKeyAt(-0.1, -0.1);
    const right = { ...left, x: left.x + 1 };
    const south = { ...left, z: left.z + 1 };
    const leftEdge = sampleWorldTerrainChunk(left, 1, 0.5);
    const rightEdge = sampleWorldTerrainChunk(right, 0, 0.5);
    const southEdge = sampleWorldTerrainChunk(south, 0.5, 0);
    const northEdge = sampleWorldTerrainChunk(left, 0.5, 1);

    expect(leftEdge.position).toEqual(rightEdge.position);
    expect(leftEdge.appearance).toBe(rightEdge.appearance);
    expect(southEdge.position).toEqual(northEdge.position);
    expect(southEdge.appearance).toBe(northEdge.appearance);
    expect(leftEdge.position[1]).toBe(WORLD_TERRAIN_COLLISION_HEIGHT);
  });

  it("keeps appearance deterministic when revisiting a location at another LOD", () => {
    const base = sampleWorldTerrainChunk(
      worldTerrainChunkKeyAt(192, -128, 0),
      0,
      0,
    );
    const coarse = sampleWorldTerrainChunk(
      worldTerrainChunkKeyAt(192, -128, 2),
      0.75,
      0.5,
    );
    expect(coarse.position).toEqual(base.position);
    expect(coarse.appearance).toBe(base.appearance);
    expect(sampleWorldTerrainAppearance(192, -128)).toBe(base.appearance);
    expect(sampleWorldTerrainAppearance(192, -128)).toBe(base.appearance);
  });

  it("keeps a bounded 7x7 neighborhood covering portrait and landscape views at max zoom", () => {
    const focus = [
      WORLD_NAVIGATION_LIMITS.maxTargetCoordinate,
      0,
      -WORLD_NAVIGATION_LIMITS.maxTargetCoordinate,
    ] as const;
    for (const aspect of [390 / 844, 2]) {
      const distance = WORLD_NAVIGATION_LIMITS.maxDistance;
      const chunks = selectWorldTerrainChunks({ focus, distance, aspect });
      const lod = chunks[0].lod;
      const size = worldTerrainChunkSize(lod);
      const visibleRadius = worldTerrainGroundViewRadius(
        distance,
        aspect,
        focus[1],
      );
      const minX = Math.min(...chunks.map((chunk) => chunk.x)) * size;
      const maxX = (Math.max(...chunks.map((chunk) => chunk.x)) + 1) * size;
      const minZ = Math.min(...chunks.map((chunk) => chunk.z)) * size;
      const maxZ = (Math.max(...chunks.map((chunk) => chunk.z)) + 1) * size;

      expect(chunks).toHaveLength(WORLD_TERRAIN_MAX_ACTIVE_CHUNKS);
      expect(
        new Set(chunks.map((chunk) => `${chunk.lod}:${chunk.x}:${chunk.z}`))
          .size,
      ).toBe(WORLD_TERRAIN_MAX_ACTIVE_CHUNKS);
      expect(chunks.every((chunk) => chunk.lod === lod)).toBe(true);
      expect(Math.min(focus[0] - minX, maxX - focus[0])).toBeGreaterThanOrEqual(
        visibleRadius - 1e-6,
      );
      expect(Math.min(focus[2] - minZ, maxZ - focus[2])).toBeGreaterThanOrEqual(
        visibleRadius - 1e-6,
      );
      expect(WORLD_TERRAIN_NEIGHBORHOOD_RADIUS * size).toBeGreaterThanOrEqual(
        visibleRadius - 1e-6,
      );
    }
    expect(WORLD_TERRAIN_VERTICAL_FOV_RADIANS).toBeCloseTo(
      (43 * Math.PI) / 180,
    );
  });

  it("raises LOD as distance and viewport width increase", () => {
    const focus = [0, 0, 0] as const;
    const portrait = selectWorldTerrainChunks({
      focus,
      distance: 128,
      aspect: 390 / 844,
    });
    const ultraWide = selectWorldTerrainChunks({
      focus,
      distance: 128,
      aspect: 10,
    });
    const zoomedOut = selectWorldTerrainChunks({
      focus,
      distance: 2_400,
      aspect: 390 / 844,
    });

    expect(worldTerrainGroundViewRadius(128, 10)).toBeGreaterThan(
      worldTerrainGroundViewRadius(128, 390 / 844),
    );
    expect(ultraWide[0].lod).toBeGreaterThan(portrait[0].lod);
    expect(zoomedOut[0].lod).toBeGreaterThan(portrait[0].lod);
  });

  it("accounts for focus height above the y=0 collision plane", () => {
    expect(worldTerrainGroundViewRadius(24, 390 / 844, 100)).toBeGreaterThan(
      worldTerrainGroundViewRadius(24, 390 / 844, 0),
    );
    expect(
      selectWorldTerrainChunks({
        focus: [0, 100, 0],
        distance: 24,
        aspect: 390 / 844,
      })[0].lod,
    ).toBeGreaterThan(
      selectWorldTerrainChunks({
        focus: [0, 0, 0],
        distance: 24,
        aspect: 390 / 844,
      })[0].lod,
    );
  });

  it("keeps navigation below the ground plane from failing terrain selection", () => {
    expect(worldTerrainGroundViewRadius(24, 1, -20)).toBe(0);
    const chunks = selectWorldTerrainChunks({
      focus: [0, -20, 0],
      distance: 24,
      aspect: 1,
    });
    expect(chunks).toHaveLength(WORLD_TERRAIN_MAX_ACTIVE_CHUNKS);
    expect(chunks[0].lod).toBe(0);
  });

  it("selects deterministic keys after 10km travel and at the supported coordinate edge", () => {
    const view = {
      focus: [10_000, 0, -10_000] as const,
      distance: 240,
      aspect: 1.6,
    };
    const first = selectWorldTerrainChunks(view);
    expect(selectWorldTerrainChunks(view)).toEqual(first);
    for (const focus of [
      [WORLD_NAVIGATION_LIMITS.maxTargetCoordinate, 0, 0],
      [-WORLD_NAVIGATION_LIMITS.maxTargetCoordinate, 0, 0],
    ] as const) {
      const chunks = selectWorldTerrainChunks({ ...view, focus });
      expect(chunks).toHaveLength(WORLD_TERRAIN_MAX_ACTIVE_CHUNKS);
      expect(
        chunks.every(
          (chunk) =>
            Number.isSafeInteger(chunk.x) && Number.isSafeInteger(chunk.z),
        ),
      ).toBe(true);
    }
  });

  it("rejects nonfinite, degenerate, or out-of-range view and sample inputs", () => {
    expect(() => worldTerrainChunkKeyAt(Number.NaN, 0)).toThrow(RangeError);
    expect(() => worldTerrainChunkSize(-1)).toThrow(RangeError);
    expect(() =>
      selectWorldTerrainChunks({
        focus: [0, 0, 0],
        distance: Infinity,
        aspect: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      selectWorldTerrainChunks({ focus: [0, 0, 0], distance: 24, aspect: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      selectWorldTerrainChunks({
        focus: [WORLD_NAVIGATION_LIMITS.maxTargetCoordinate + 1, 0, 0],
        distance: 24,
        aspect: 1,
      }),
    ).toThrow(RangeError);
    expect(() => sampleWorldTerrainAppearance(Number.NaN, 0)).toThrow(
      RangeError,
    );
    expect(() =>
      sampleWorldTerrainChunk(worldTerrainChunkKeyAt(0, 0), 1.01, 0),
    ).toThrow(RangeError);
  });
});
