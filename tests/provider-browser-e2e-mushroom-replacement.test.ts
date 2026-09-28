import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertMushroomReplacement,
  readConfiguration,
  persistMushroomReplacementSnapshot,
  sanitizedMushroomReplacementSnapshot,
} from "../scripts/provider-browser-e2e.mjs";
import { blankProject } from "../src/lib/protocol";

const environmentNames = [
  "ORBSIE_LIVE_E2E",
  "ORBSIE_MUSHROOM_REPLACEMENT",
  "ORBSIE_REQUIRE_GEOMETRY_EDIT",
  "ORBSIE_REQUIRE_BROWSER_MODEL",
  "ORBSIE_TEST_URL",
];
const savedEnvironment = new Map(
  environmentNames.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  for (const name of environmentNames) {
    const value = savedEnvironment.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function projectPair(afterGeometry: unknown, afterPatch = {}) {
  const before = blankProject();
  before.id = "mushroom-replacement";
  before.entities = [
    {
      id: "tree-1",
      label: "Friendly tree",
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#6ead60",
      stage: "ready",
      geometry: {
        kind: "asset",
        assetId: "kenney.nature.tree-default",
        detail: "refined",
      },
    },
    {
      id: "pond-1",
      label: "Pond",
      position: [2, 0, 0],
      scale: [1, 1, 1],
      color: "#59bdbb",
      stage: "ready",
      geometry: { kind: "pond", detail: "refined" },
    },
  ] as never;
  before.game = {
    variables: [],
    rules: [
      {
        id: "start",
        trigger: { type: "start" },
        conditions: [],
        actions: [],
      },
    ],
  } as never;
  const after = structuredClone(before) as typeof before;
  after.revision = 2;
  after.entities[0] = {
    ...after.entities[0],
    label: "Giant Pink Mushroom",
    color: "#ff69b4",
    scale: [14, 14, 14],
    geometry: afterGeometry,
  } as never;
  Object.assign(after, afterPatch);
  return { before, after };
}

const catalogMushroom = {
  kind: "asset",
  assetId: "kenney.nature.mushroom-red",
  detail: "refined",
  tint: "#ff69b4",
};

const browserMushroom = {
  kind: "generated",
  detail: "refined",
  job: {
    backend: "browser-manifold",
    recipe: { version: 1, revision: 1, output: "cap", nodes: [] },
  },
  model: {
    version: 1,
    sha256: "a".repeat(64),
    bytes: 100,
    source: "browser-manifold",
    kernelVersion: "3.3.2",
    bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] },
    createdAt: "2026-09-12T00:00:00.000Z",
  },
};

const customMultipartMushroom = {
  kind: "custom",
  detail: "refined",
  parts: [
    {
      shape: "cylinder",
      position: [0, 1, 0],
      scale: [0.55, 2, 0.55],
      rotation: [0, 0, 0],
      color: "#fff1df",
    },
    {
      shape: "lathe",
      position: [0, 2, 0],
      scale: [2.2, 1.4, 2.2],
      rotation: [0, 0, 0],
      profile: [
        [0, 0],
        [1.7, 0],
        [1.6, 0.4],
        [0, 1],
      ],
      color: "#ed79c4",
    },
    {
      shape: "sphere",
      position: [0.4, 3.1, 0.3],
      scale: [0.16, 0.08, 0.16],
      rotation: [0, 0, 0],
      color: "#fff1df",
    },
  ],
};

describe("bounded mushroom replacement acceptance", () => {
  it.each([
    ["catalog", catalogMushroom],
    ["browser-generated", browserMushroom],
  ])("accepts a larger pink %s replacement", (_name, geometry) => {
    const { before, after } = projectPair(geometry);
    const result = assertMushroomReplacement(before, after, "tree-1");
    expect(result.physicalSizeExpansion).toBe(true);
    expect(result.dimensions.status).toBe("observed");
  });

  it("accepts ready pink-part custom geometry and separates structural from visual review", () => {
    const { before, after } = projectPair(customMultipartMushroom);
    after.entities[0].color = "#55b7a9";

    const result = assertMushroomReplacement(before, after, "tree-1");

    expect(result.pinkMaterialEvidence).toBe("custom-part-color");
    expect(result.supportedGeometry).toBe("custom-multipart");
    expect(result.dimensions).toMatchObject({
      status: "observed",
      source: { after: "custom-parts" },
    });
    expect(result.structuralStatus).toBe("passed");
    expect(result.backendEligibility).toBe("passed");
    expect(result.manualVisualQuality).toBe("pending");
  });

  it("honors nonpink global tint and requires multipart backend evidence beyond a label", () => {
    const overridden = projectPair({
      ...customMultipartMushroom,
      tint: "#55b7a9",
    });
    overridden.after.entities[0].color = "#ff69b4";
    expect(() =>
      assertMushroomReplacement(overridden.before, overridden.after, "tree-1"),
    ).toThrow(/pink material/);

    const onePart = projectPair({
      ...customMultipartMushroom,
      parts: [customMultipartMushroom.parts[1]],
    });
    expect(() =>
      assertMushroomReplacement(onePart.before, onePart.after, "tree-1"),
    ).toThrow(/ready labeled custom multipart geometry/);

    const notReady = projectPair(customMultipartMushroom);
    notReady.after.entities[0].stage = "seed";
    expect(() =>
      assertMushroomReplacement(notReady.before, notReady.after, "tree-1"),
    ).toThrow(/ready labeled custom multipart geometry/);
  });

  it("does not treat a mushroom label as pink structural geometry", () => {
    const labelOnly = projectPair({
      ...customMultipartMushroom,
      parts: customMultipartMushroom.parts.map((part) => ({
        ...part,
        color: "#55b7a9",
      })),
    });
    labelOnly.after.entities[0].color = "#55b7a9";
    expect(() =>
      assertMushroomReplacement(labelOnly.before, labelOnly.after, "tree-1"),
    ).toThrow(/pink material/);
  });

  it("rejects nonpink, nonlarger, and unrelated mutations", () => {
    const nonpink = projectPair({ ...catalogMushroom, tint: undefined });
    nonpink.after.entities[0].color = "#6ead60";
    expect(() =>
      assertMushroomReplacement(nonpink.before, nonpink.after, "tree-1"),
    ).toThrow(/pink material/);

    const notLarger = projectPair(catalogMushroom);
    notLarger.after.entities[0].scale = [1, 1, 1];
    expect(() =>
      assertMushroomReplacement(notLarger.before, notLarger.after, "tree-1"),
    ).toThrow(/expand/);

    const unrelated = projectPair(catalogMushroom);
    unrelated.after.entities[1].position = [3, 0, 0];
    expect(() =>
      assertMushroomReplacement(unrelated.before, unrelated.after, "tree-1"),
    ).toThrow(/unrelated entity/);
  });

  it("rejects generic geometry and publication flags before credentials", () => {
    process.env.ORBSIE_LIVE_E2E = "1";
    process.env.ORBSIE_MUSHROOM_REPLACEMENT = "1";
    process.env.ORBSIE_REQUIRE_GEOMETRY_EDIT = "1";
    expect(() => readConfiguration(["--provider", "openrouter"])).toThrow(
      /cannot be combined with ORBSIE_REQUIRE_GEOMETRY_EDIT/,
    );
    delete process.env.ORBSIE_REQUIRE_GEOMETRY_EDIT;
    expect(() =>
      readConfiguration(["--provider", "openrouter", "--publication"]),
    ).toThrow(/cannot be combined with --publication/);
  });

  it("strips credential extensions and retains snapshots before later failure", async () => {
    const { before, after } = projectPair(catalogMushroom);
    (before as typeof before & { apiKey: string }).apiKey = "secret";
    (
      before.entities[0] as (typeof before.entities)[0] & { apiToken: string }
    ).apiToken = "secret";
    (before.entities[0].geometry as Record<string, unknown>).credential =
      "secret";
    const sanitized = sanitizedMushroomReplacementSnapshot(before);
    expect(JSON.stringify(sanitized)).not.toContain("secret");
    expect(sanitized).not.toHaveProperty("apiKey");
    expect(sanitized.entities[0]).not.toHaveProperty("apiToken");

    const evidenceDir = await mkdtemp(join(tmpdir(), "orbsie-mushroom-test-"));
    const report = { evidence: [] as string[] };
    try {
      await persistMushroomReplacementSnapshot(
        report,
        evidenceDir,
        "before",
        before,
      );
      await persistMushroomReplacementSnapshot(
        report,
        evidenceDir,
        "after",
        after,
      );
      const bad = projectPair(catalogMushroom).after;
      bad.entities[0].color = "#6ead60";
      bad.entities[0].geometry = {
        ...catalogMushroom,
        tint: undefined,
      } as never;
      expect(() => assertMushroomReplacement(before, bad, "tree-1")).toThrow();
      await expect(
        readFile(join(evidenceDir, "mushroom-replacement-before.json")),
      ).resolves.toBeTruthy();
      await expect(
        readFile(join(evidenceDir, "mushroom-replacement-after.json")),
      ).resolves.toBeTruthy();
    } finally {
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });
});
