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
