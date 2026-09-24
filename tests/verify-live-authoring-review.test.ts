import { describe, expect, it, vi } from "vitest";
import {
  preflightGenerationOrigin,
  summarizeProjectStructure,
} from "../scripts/verify-live-authoring-review.mjs";

describe("live authoring structural summary", () => {
  it("counts bounded stage, geometry, procedural-part, and coarse color facts without retaining source text", () => {
    const summary = summarizeProjectStructure([
      {
        stage: "ready",
        geometryKind: "custom",
        entityColor: "#2244ff",
        partColors: ["#1555ee", null],
        label: "private entity label",
        prompt: "private prompt",
        messages: ["private model text"],
        id: "private-entity-id",
        position: [99, 99, 99],
      },
      {
        stage: "seed",
        geometryKind: "tree",
        entityColor: "#52aa43",
        partColors: ["#315ede", "#8a4c2c"],
      },
    ]);

    expect(summary).toMatchObject({
      entityCount: 2,
      stageCounts: { seed: 1, coarse: 0, ready: 1, unknown: 0 },
      geometryKindCounts: { custom: 1, tree: 1, absent: 0, other: 0 },
      customProceduralPartCount: 4,
      entityColorFamilyCounts: { blue: 1, green: 1, absent: 0 },
      partColorFamilyCounts: { blue: 2, brown: 1, absent: 1 },
    });
    expect(Object.keys(summary!)).toEqual([
      "entityCount",
      "stageCounts",
      "geometryKindCounts",
      "customProceduralPartCount",
      "entityColorFamilyCounts",
      "partColorFamilyCounts",
    ]);
    const serialized = JSON.stringify(summary);
    for (const privateValue of [
      "#2244ff",
      "#1555ee",
      "private entity label",
      "private prompt",
      "private model text",
      "private-entity-id",
      "99",
    ])
      expect(serialized).not.toContain(privateValue);
  });

  it("caps counted entities and parts at the scene schema bounds", () => {
    const summary = summarizeProjectStructure(
      Array.from({ length: 170 }, () => ({
        stage: "ready",
        geometryKind: "custom",
        entityColor: "#0000ff",
        partColors: Array.from({ length: 40 }, () => "#0000ff"),
      })),
    );

    expect(summary?.entityCount).toBe(160);
    expect(summary?.customProceduralPartCount).toBe(160 * 32);
    expect(summary?.stageCounts.ready).toBe(160);
    expect(summary?.geometryKindCounts.custom).toBe(160);
    expect(summary?.entityColorFamilyCounts.blue).toBe(160);
    expect(summary?.partColorFamilyCounts.blue).toBe(160 * 32);
  });

  it("returns no summary for a missing or malformed snapshot", () => {
    expect(summarizeProjectStructure(null)).toBeNull();
  });
});

describe("live authoring origin preflight", () => {
  it("posts malformed JSON only to the configured loopback origin and accepts the parser 400", async () => {
    const response = new Response(null, { status: 400 });
    const readText = vi.spyOn(response, "text");
    const readJSON = vi.spyOn(response, "json");
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url).toBe("http://127.0.0.1:3100/api/generate");
      expect(options).toMatchObject({
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:3100",
          "Content-Type": "application/json",
        },
        body: "{",
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return response;
    });

    await expect(
      preflightGenerationOrigin("http://127.0.0.1:3100", fetchImpl),
    ).resolves.toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readText).not.toHaveBeenCalled();
    expect(readJSON).not.toHaveBeenCalled();
  });

  it("reports an origin rejection explicitly without reading the response", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }));

    await expect(
      preflightGenerationOrigin("http://localhost:3100", fetchImpl),
    ).rejects.toMatchObject({
      code: "generation-origin-preflight-rejected",
      status: 403,
    });
  });

  it("refuses non-loopback targets before making a request", async () => {
    const fetchImpl = vi.fn();

    await expect(
      preflightGenerationOrigin("https://example.com", fetchImpl),
    ).rejects.toMatchObject({
      code: "loopback-origin-required-for-preflight",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
