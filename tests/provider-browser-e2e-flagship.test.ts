import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  assertFlagshipStoryCreation,
  assertFlagshipStoryGoalSeven,
  assertFlagshipStoryMushroom,
  assertFlagshipStoryPlatform,
  buildGeneratedModelEvidence,
  installTrafficGuard,
  persistFlagshipStoryPhase,
  readConfiguration,
} from "../scripts/provider-browser-e2e.mjs";

type ResumeConfig = ReturnType<typeof readConfiguration> & {
  resumeCheckpoint: {
    project: { revision: number };
    models: unknown[];
  };
  flagshipResumeOffline?: boolean;
  resumeOffline?: {
    baseline: { revision: number };
    edited: { revision: number };
    models: unknown[];
  };
};

const ENV_NAMES = [
  "ORBSIE_LIVE_E2E",
  "ORBSIE_APP_SOURCE_COMMIT",
  "ORBSIE_TEST_URL",
  "ORBSIE_EXPECTED_MODEL",
  "ORBSIE_OUTPUT_CAP_TOKENS",
  "ORBSIE_KEY_SCOPE",
  "ORBSIE_FLAGSHIP_STORY",
  "ORBSIE_FLAGSHIP_RESUME",
  "ORBSIE_FLAGSHIP_RESUME_CHECKPOINT",
  "ORBSIE_FLAGSHIP_RESUME_MODELS",
  "ORBSIE_FLAGSHIP_RESUME_OFFLINE",
  "ORBSIE_FLAGSHIP_RESUME_EDITED",
  "ORBSIE_FLAGSHIP_RESUME_EDITED_MODELS",
  "ORBSIE_CREATION_PROMPT",
  "ORBSIE_EDIT_PROMPT",
  "ORBSIE_REQUIRE_INPUT_GAME",
  "ORBSIE_VERIFY_CLOUD_RECOVERY",
  "ORBSIE_VERIFY_INTERRUPTED_RECOVERY",
  "AI_GATEWAY_TEST_KEY",
  "AI_GATEWAY_API_KEY",
];

const savedEnvironment = new Map(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = savedEnvironment.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function gatewayStoryEnvironment(overrides: Record<string, string> = {}) {
  for (const name of ENV_NAMES) delete process.env[name];
  Object.assign(process.env, {
    ORBSIE_LIVE_E2E: "1",
    ORBSIE_APP_SOURCE_COMMIT: "a".repeat(40),
    ORBSIE_TEST_URL: "http://127.0.0.1:3018",
    ORBSIE_EXPECTED_MODEL: "openai/gpt-5.6-luna",
    ORBSIE_OUTPUT_CAP_TOKENS: "4096",
    ORBSIE_KEY_SCOPE: "local-only",
    ORBSIE_FLAGSHIP_STORY: "1",
    AI_GATEWAY_TEST_KEY: "test-gateway-key",
    ...overrides,
  });
}

const RESUME_CHECKPOINT = resolve(
  "docs/evidence/provider-e2e/gateway-flagship-story-catalog/gateway/story-mushroom-project.json",
);
const RESUME_MODELS = resolve(
  "docs/evidence/provider-e2e/gateway-flagship-story-catalog/gateway/reconstructed-models",
);
const RESUME_EDITED = resolve(
  "docs/evidence/provider-e2e/gateway-flagship-checkpoint-resume/gateway/story-resumed-project.json",
);
const RESUME_EDITED_MODELS = resolve(
  "docs/evidence/provider-e2e/gateway-flagship-checkpoint-resume/gateway",
);

function gatewayResumeEnvironment(overrides: Record<string, string> = {}) {
  gatewayStoryEnvironment({
    ORBSIE_FLAGSHIP_STORY: "0",
    ORBSIE_FLAGSHIP_RESUME: "1",
    ORBSIE_FLAGSHIP_RESUME_CHECKPOINT: RESUME_CHECKPOINT,
    ORBSIE_FLAGSHIP_RESUME_MODELS: RESUME_MODELS,
    ...overrides,
  });
}

function entity(
  id: string,
  label: string,
  geometry: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): any {
  return {
    id,
    label,
    stage: "ready",
    position: [Number(id.replace(/\D/g, "")) || 0, 0, 0],
    scale: [1, 1, 1],
    color: "#6ead60",
    geometry,
    ...extra,
  };
}

function initialProject() {
  return {
    id: "project",
    revision: 1,
    messages: [],
    environment: { sky: "sunny" },
    entities: [
      entity("tree-a", "Friendly Oak", {
        kind: "asset",
        assetId: "kenney.nature.tree-default",
        detail: "refined",
      }),
      entity("tree-b", "Sunny Pine", {
        kind: "asset",
        assetId: "kenney.nature.tree-pine-tall-a",
        detail: "refined",
      }),
      entity("tree-c", "Little Oak", {
        kind: "asset",
        assetId: "kenney.nature.tree-default",
        detail: "refined",
      }),
      entity(
        "platform-a",
        "Moving platform west",
        { kind: "platform", detail: "refined" },
        {
          position: [0, 0, 0],
          behavior: { type: "move", speed: 1, axis: "x", amplitude: 1 },
        },
      ),
      entity(
        "platform-b",
        "Moving platform middle",
        { kind: "platform", detail: "refined" },
        {
          position: [2, 0, 0],
          behavior: { type: "move", speed: 1, axis: "x", amplitude: 1 },
        },
      ),
      entity(
        "platform-c",
        "Moving platform east",
        { kind: "platform", detail: "refined" },
        {
          position: [4, 0, 0],
          behavior: { type: "move", speed: 1, axis: "x", amplitude: 1 },
        },
      ),
      ...[1, 2, 3, 4, 5].map((index) =>
        entity(
          `crystal-${index}`,
          `Crystal ${index}`,
          { kind: "crystal", detail: "refined" },
          {
            behavior: { type: "collect" },
          },
        ),
      ),
      entity("pond", "Pond", { kind: "pond", detail: "refined" }),
      entity(
        "portal",
        "Portal",
        { kind: "portal", detail: "refined" },
        {
          behavior: { type: "portal" },
        },
      ),
    ],
  };
}

describe("flagship provider story contract", () => {
  it("enables exactly three Gateway generations with the fixed story prompt", () => {
    gatewayStoryEnvironment();
    const config = readConfiguration(["--provider", "gateway"]) as ResumeConfig;
    expect(config).toMatchObject({
      provider: "gateway",
      expectedModel: "openai/gpt-5.6-luna",
      outputCap: 4096,
      generationBudget: 3,
      flagshipStory: true,
      prompt:
        "Make a sunny little island game where I collect five glowing crystals, bounce across three moving platforms, and reach a portal. Add friendly trees and a pond.",
    });
  });

  it("enables only the explicit one-call Gateway checkpoint resume", () => {
    gatewayResumeEnvironment();
    const config = readConfiguration(["--provider", "gateway"]) as ResumeConfig;
    expect(config).toMatchObject({
      provider: "gateway",
      expectedModel: "openai/gpt-5.6-luna",
      outputCap: 4096,
      generationBudget: 1,
      flagshipStory: false,
      flagshipResume: true,
      editPrompt: "Make the middle platform slower and add two more crystals",
    });
    expect(config.resumeCheckpoint.project.revision).toBeGreaterThan(0);
    expect(config.resumeCheckpoint.models).toHaveLength(5);
  });

  it("checks the variable-based seven-crystal portal gate", () => {
    const edited = JSON.parse(readFileSync(RESUME_EDITED, "utf8"));
    expect(assertFlagshipStoryGoalSeven(edited)).toMatchObject({
      variable: "crystals",
      collectibles: 7,
      portal: "crystals >= 7",
      ui: "game-score",
    });
    const invalid = structuredClone(edited);
    invalid.game.rules.find(
      (rule: any) => rule.id === "portal-win",
    ).conditions[0].value = 6;
    expect(() => assertFlagshipStoryGoalSeven(invalid)).toThrow(
      /crystals >= 7/,
    );
  });

  it("enables offline resume without reading a provider key", () => {
    gatewayResumeEnvironment({
      ORBSIE_FLAGSHIP_RESUME_OFFLINE: "1",
      ORBSIE_FLAGSHIP_RESUME_EDITED: RESUME_EDITED,
      ORBSIE_FLAGSHIP_RESUME_EDITED_MODELS: RESUME_EDITED_MODELS,
    });
    delete process.env.AI_GATEWAY_TEST_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    const config = readConfiguration(["--provider", "gateway"]) as ResumeConfig;
    expect(config).toMatchObject({
      provider: "gateway",
      flagshipResume: true,
      flagshipResumeOffline: true,
      generationBudget: 0,
      resumeOffline: {
        baseline: { revision: expect.any(Number) },
        edited: { revision: expect.any(Number) },
      },
    });
    const offline = config.resumeOffline;
    if (!offline) throw new Error("offline resume artifacts were not loaded");
    expect(offline.models).toHaveLength(7);
  });

  it("rejects a corrupt offline model before opening a browser", async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), "orbsie-offline-model-test-"),
    );
    try {
      const manifest = JSON.parse(
        readFileSync(
          join(RESUME_EDITED_MODELS, "story-resumed-generated.json"),
          "utf8",
        ),
      );
      const first = manifest.models[0];
      await mkdir(join(temporary, "generated"), { recursive: true });
      await writeFile(
        join(temporary, "story-resumed-generated.json"),
        JSON.stringify(manifest),
      );
      for (const record of manifest.models) {
        const bytes = readFileSync(join(RESUME_EDITED_MODELS, record.path));
        await writeFile(join(temporary, record.path), bytes);
      }
      await writeFile(join(temporary, first.path), Buffer.from("corrupt"));
      gatewayResumeEnvironment({
        ORBSIE_FLAGSHIP_RESUME_OFFLINE: "1",
        ORBSIE_FLAGSHIP_RESUME_EDITED: RESUME_EDITED,
        ORBSIE_FLAGSHIP_RESUME_EDITED_MODELS: temporary,
      });
      delete process.env.AI_GATEWAY_TEST_KEY;
      delete process.env.AI_GATEWAY_API_KEY;
      expect(() => readConfiguration(["--provider", "gateway"])).toThrow(
        /failed its hash or byte check/,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it("aborts any offline API generation before route continuation", async () => {
    const handlers: Array<(route: any) => Promise<void>> = [];
    await installTrafficGuard(
      {
        route: async (
          _pattern: string,
          handler: (route: any) => Promise<void>,
        ) => {
          handlers.push(handler);
        },
      } as any,
      {
        provider: "gateway",
        baseOrigin: "http://127.0.0.1:3018",
        flagshipResume: true,
        flagshipResumeOffline: true,
        generationBudget: 0,
      } as any,
      new Set(["http://127.0.0.1:3018"]),
      { generationBudgetViolations: [] },
    );
    let continued = false;
    let aborted: string | undefined;
    await handlers[0]({
      request: () => ({
        url: () => "http://127.0.0.1:3018/api/generate",
        method: () => "POST",
      }),
      abort: async (reason: string) => {
        aborted = reason;
      },
      continue: async () => {
        continued = true;
      },
    });
    expect(aborted).toBe("blockedbyclient");
    expect(continued).toBe(false);
  });


  it("keeps the ordinary story budget and rejects resume for another provider", () => {
    gatewayStoryEnvironment();
    expect(readConfiguration(["--provider", "gateway"]).generationBudget).toBe(
      3,
    );
    gatewayResumeEnvironment();
    expect(() => readConfiguration(["--provider", "openrouter"])).toThrow(
      /Gateway provider/,
    );
  });

  it("rejects a checkpoint/report binding mismatch and an unsafe model path", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "orbsie-resume-test-"));
    try {
      const report = JSON.parse(
        readFileSync(join(RESUME_MODELS, "report.json"), "utf8"),
      );
      report.sourceSnapshot =
        "docs/evidence/provider-e2e/gateway-flagship-story-catalog/gateway/story-created-project.json";
      await writeFile(
        join(temporary, "report.json"),
        JSON.stringify(report),
      );
      gatewayResumeEnvironment({ ORBSIE_FLAGSHIP_RESUME_MODELS: temporary });
      expect(() => readConfiguration(["--provider", "gateway"])).toThrow(
        /bound to the supplied checkpoint/,
      );

      const safeReport = JSON.parse(
        readFileSync(join(RESUME_MODELS, "report.json"), "utf8"),
      );
      safeReport.models[0].path = "generated/../outside.glb";
      await writeFile(join(temporary, "report.json"), JSON.stringify(safeReport));
      gatewayResumeEnvironment({ ORBSIE_FLAGSHIP_RESUME_MODELS: temporary });
      expect(() => readConfiguration(["--provider", "gateway"])).toThrow(
        /unsafe model path/,
      );

      const goodReport = JSON.parse(
        readFileSync(join(RESUME_MODELS, "report.json"), "utf8"),
      );
      await mkdir(join(temporary, "generated"), { recursive: true });
      for (const [index, model] of goodReport.models.entries()) {
        const bytes = Buffer.from(
          readFileSync(join(RESUME_MODELS, model.path)),
        );
        if (index === 0) bytes[0] ^= 0xff;
        await writeFile(join(temporary, model.path), bytes);
      }
      await writeFile(join(temporary, "report.json"), JSON.stringify(goodReport));
      gatewayResumeEnvironment({ ORBSIE_FLAGSHIP_RESUME_MODELS: temporary });
      expect(() => readConfiguration(["--provider", "gateway"])).toThrow(
        /hash or byte check/,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it("rejects resume when the output cap is not the authorized 4096", () => {
    gatewayResumeEnvironment({ ORBSIE_OUTPUT_CAP_TOKENS: "512" });
    expect(() => readConfiguration(["--provider", "gateway"])).toThrow(
      /require ORBSIE_OUTPUT_CAP_TOKENS=4096/,
    );
  });

  it("rejects story mode for other providers and incompatible phases", () => {
    gatewayStoryEnvironment({ ORBSIE_KEY_SCOPE: "local-only" });
    expect(() => readConfiguration(["--provider", "openrouter"])).toThrow(
      /Gateway provider/,
    );
    gatewayStoryEnvironment({ ORBSIE_REQUIRE_INPUT_GAME: "1" });
    expect(() => readConfiguration(["--provider", "gateway"])).toThrow(
      /input-game/,
    );
    gatewayStoryEnvironment({ ORBSIE_OUTPUT_CAP_TOKENS: "512" });
    expect(() => readConfiguration(["--provider", "gateway"])).toThrow(/4096/);
  });

  it("validates semantic creation, mushroom scope, and platform goal reconciliation", () => {
    const before = initialProject();
    const initial = assertFlagshipStoryCreation(before);
    expect(initial.middlePlatform.id).toBe("platform-b");
    expect(initial.trees.map((candidate: any) => candidate.label)).toEqual([
      "Friendly Oak",
      "Sunny Pine",
      "Little Oak",
    ]);

    const mushroom = structuredClone(before);
    const tree = mushroom.entities.find(
      (candidate) => candidate.id === "tree-a",
    )!;
    tree.label = "Giant pink mushroom";
    tree.color = "#ed99b5";
    tree.scale = [2, 2, 2];
    tree.geometry = {
      kind: "mushroom",
      detail: "refined",
      model: { bounds: { min: [-1, 0, -1], max: [1, 2, 1] } },
    };
    const mushroomCheck = assertFlagshipStoryMushroom(
      before,
      mushroom,
      "tree-a",
    );
    expect(mushroomCheck.rawBoundsExpanded).toBe(false);
    expect(mushroomCheck.transformedBoundsExpanded).toBe(false);
    expect(mushroomCheck.mushroomEvidence).toBe("supported-geometry-kind");
    expect(mushroomCheck.sizeVisualReview).toBe("pending");

    const goal7 = structuredClone(mushroom);
    const middle = goal7.entities.find(
      (candidate) => candidate.id === "platform-b",
    )!;
    middle.behavior.speed = 0.5;
    goal7.entities.push(
      entity(
        "crystal-6",
        "Crystal 6",
        { kind: "crystal", detail: "refined" },
        {
          behavior: { type: "collect" },
        },
      ),
      entity(
        "crystal-7",
        "Crystal 7",
        { kind: "crystal", detail: "refined" },
        {
          behavior: { type: "collect" },
        },
      ),
    );
    const platformCheck = assertFlagshipStoryPlatform(
      mushroom,
      goal7,
      "platform-b",
    );
    expect(platformCheck.collectibles).toBe(7);
    expect(platformCheck.addedCollectibleIds).toEqual([
      "crystal-6",
      "crystal-7",
    ]);
  });

  it("accepts two trees and keeps size evidence pending without model bounds", () => {
    const before = initialProject();
    before.entities = before.entities.filter(
      (candidate) => candidate.id !== "tree-c",
    );
    const initial = assertFlagshipStoryCreation(before);
    expect(initial.trees).toHaveLength(2);

    const after = structuredClone(before);
    const tree = after.entities.find((candidate) => candidate.id === "tree-b")!;
    tree.label = "Giant pink mushroom";
    tree.color = "#ed99b5";
    tree.geometry = { kind: "mushroom", detail: "refined" };
    const check = assertFlagshipStoryMushroom(before, after, tree.id);
    expect(check.rawBoundsExpanded).toBe(false);
    expect(check.transformedBoundsExpanded).toBe(false);
    expect(check.sizeVisualReview).toBe("pending");
  });

  it("does not treat larger raw bounds as a larger transformed model", () => {
    const before = initialProject();
    const beforeTree = before.entities.find(
      (candidate) => candidate.id === "tree-a",
    )!;
    beforeTree.geometry = {
      kind: "tree",
      detail: "refined",
      model: { bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] } },
    };
    beforeTree.scale = [2, 2, 2];
    const after = structuredClone(before);
    const afterTree = after.entities.find(
      (candidate) => candidate.id === "tree-a",
    )!;
    afterTree.label = "Giant pink mushroom";
    afterTree.color = "#ed99b5";
    afterTree.geometry = {
      kind: "mushroom",
      detail: "refined",
      model: { bounds: { min: [-0.75, 0, -0.75], max: [0.75, 1.5, 0.75] } },
    };
    afterTree.scale = [1, 1, 1];
    const check = assertFlagshipStoryMushroom(before, after, afterTree.id);
    expect(check.rawBoundsExpanded).toBe(true);
    expect(check.transformedBoundsExpanded).toBe(false);
    expect(check.sizeVisualReview).toBe("pending");
  });

  it("rejects missing crystals, unrelated mushroom changes, and broad platform edits", () => {
    const before = initialProject();

    const missingCrystal = structuredClone(before);
    missingCrystal.entities = missingCrystal.entities.filter(
      (candidate) => candidate.id !== "crystal-5",
    );
    expect(() => assertFlagshipStoryCreation(missingCrystal)).toThrow(
      /five collectibles/,
    );

    const unrelatedMushroomChange = structuredClone(before);
    const tree = unrelatedMushroomChange.entities.find(
      (candidate) => candidate.id === "tree-a",
    )!;
    tree.label = "Giant pink mushroom";
    tree.color = "#ed99b5";
    tree.geometry = { kind: "mushroom", detail: "refined" };
    unrelatedMushroomChange.entities.find(
      (candidate) => candidate.id === "tree-b",
    )!.label = "Changed unrelated tree";
    expect(() =>
      assertFlagshipStoryMushroom(before, unrelatedMushroomChange, tree.id),
    ).toThrow(/unrelated entity tree-b/);

    const changedPlatform = structuredClone(before);
    const middle = changedPlatform.entities.find(
      (candidate) => candidate.id === "platform-b",
    )!;
    middle.behavior.speed = 0.5;
    middle.behavior.axis = "z";
    changedPlatform.entities.push(
      entity(
        "crystal-6",
        "Crystal 6",
        { kind: "crystal", detail: "refined" },
        { behavior: { type: "collect" } },
      ),
      entity(
        "crystal-7",
        "Crystal 7",
        { kind: "crystal", detail: "refined" },
        { behavior: { type: "collect" } },
      ),
    );
    expect(() =>
      assertFlagshipStoryPlatform(before, changedPlatform, middle.id),
    ).toThrow(/beyond speed/);

    const extraEntity = structuredClone(before);
    extraEntity.entities.find(
      (candidate) => candidate.id === "platform-b",
    )!.behavior.speed = 0.5;
    extraEntity.entities.push(
      entity(
        "crystal-6",
        "Crystal 6",
        { kind: "crystal", detail: "refined" },
        { behavior: { type: "collect" } },
      ),
      entity(
        "crystal-7",
        "Crystal 7",
        { kind: "crystal", detail: "refined" },
        { behavior: { type: "collect" } },
      ),
    );
    extraEntity.entities.push(entity("decor", "Decor", { kind: "rock" }));
    expect(() =>
      assertFlagshipStoryPlatform(before, extraEntity, middle.id),
    ).toThrow(/exactly two entities/);
  });

  it("rejects an unknown catalog asset even when its label says Oak", () => {
    const project = initialProject();
    const tree = project.entities.find(
      (candidate) => candidate.id === "tree-a",
    )!;
    tree.geometry.assetId = "unknown.tree-oak";
    for (const id of ["tree-b", "tree-c"]) {
      const otherTree = project.entities.find(
        (candidate) => candidate.id === id,
      )!;
      otherTree.geometry = {
        kind: "asset",
        assetId: "kenney.nature.rock-large-a",
        detail: "refined",
      };
    }
    expect(() => assertFlagshipStoryCreation(project)).toThrow(/friendly tree/);
  });

  it("accepts a generated tree when its supported label carries the tree evidence", () => {
    const project = initialProject();
    const tree = project.entities.find(
      (candidate) => candidate.id === "tree-a",
    )!;
    tree.geometry = { kind: "generated", detail: "refined" };
    tree.label = "Generated tree canopy";
    expect(assertFlagshipStoryCreation(project).tree.id).toBe(tree.id);
  });

  it("accepts the saved catalog mushroom edit without relying on its label", () => {
    const before = JSON.parse(
      readFileSync(
        "docs/evidence/provider-e2e/gateway-flagship-story-catalog/gateway/story-created-project.json",
        "utf8",
      ),
    );
    const after = JSON.parse(
      readFileSync(
        "docs/evidence/provider-e2e/gateway-flagship-story-catalog/gateway/story-mushroom-project.json",
        "utf8",
      ),
    );
    const beforeTree = before.entities.find(
      (candidate: any) => candidate.id === "tree-1",
    );
    const afterTree = after.entities.find(
      (candidate: any) => candidate.id === "tree-1",
    );
    expect(beforeTree.geometry).toMatchObject({
      kind: "asset",
      assetId: "kenney.nature.tree-default",
    });
    expect(afterTree).toMatchObject({
      label: beforeTree.label,
      geometry: {
        kind: "asset",
        assetId: "kenney.nature.mushroom-red",
      },
      color: "#ff69b4",
      scale: [10, 10, 10],
    });
    const check = assertFlagshipStoryMushroom(before, after, "tree-1");
    expect(check.mushroomEvidence).toBe("catalog-mushroom-tag");
    expect(check.rawBoundsExpanded).toBe(false);
    expect(check.transformedBoundsExpanded).toBe(false);
    expect(check.sizeVisualReview).toBe("pending");
  });

  it("rejects an unknown mushroom asset even when its label says mushroom", () => {
    const before = initialProject();
    const after = structuredClone(before);
    const tree = after.entities.find((candidate) => candidate.id === "tree-a")!;
    tree.geometry = {
      kind: "asset",
      assetId: "unknown.mushroom",
      detail: "refined",
    };
    tree.label = "Giant pink mushroom";
    tree.color = "#ed99b5";
    expect(() => assertFlagshipStoryMushroom(before, after, tree.id)).toThrow(
      /supported mushroom evidence/,
    );
  });

  it("deduplicates and validates generated GLB evidence by hash", () => {
    const glb = new Uint8Array([0x67, 0x6c, 0x42]);
    const sha256 = createHash("sha256").update(glb).digest("hex");
    const project = {
      entities: [
        entity(
          "generated-a",
          "Generated A",
          {
            kind: "generated",
            detail: "refined",
            model: { sha256, bytes: glb.byteLength },
          },
        ),
        entity(
          "generated-b",
          "Generated B",
          {
            kind: "generated",
            detail: "refined",
            model: { sha256, bytes: glb.byteLength },
          },
        ),
      ],
    };
    const complete = buildGeneratedModelEvidence(
      project,
      new Map([[sha256, { sha256, bytes: glb.byteLength, glb }]]),
    );
    expect(complete.status).toBe("complete");
    expect(complete.models).toHaveLength(1);
    expect(complete.models[0]).toMatchObject({
      entityIds: ["generated-a", "generated-b"],
      sha256,
      bytes: glb.byteLength,
      path: `generated/${sha256}.glb`,
      status: "complete",
    });

    const missing = buildGeneratedModelEvidence(project, new Map());
    expect(missing.status).toBe("incomplete");
    expect(missing.missing).toContainEqual(
      expect.objectContaining({
        sha256,
        status: "incomplete",
        reason: "missing-indexeddb-record",
      }),
    );

    const mismatched = buildGeneratedModelEvidence(
      project,
      new Map([
        [
          sha256,
          {
            sha256: "0".repeat(64),
            bytes: glb.byteLength,
            glb,
          },
        ],
      ]),
    );
    expect(mismatched.status).toBe("incomplete");
    expect(mismatched.missing).toContainEqual(
      expect.objectContaining({ reason: "hash-mismatch" }),
    );

    const missingMetadata = buildGeneratedModelEvidence(
      {
        entities: [
          entity("unfinished", "Unfinished model", {
            kind: "generated",
            detail: "coarse",
          }),
        ],
      },
      new Map(),
    );
    expect(missingMetadata.status).toBe("incomplete");
    expect(missingMetadata.missing).toContainEqual(
      expect.objectContaining({ reason: "missing-model-metadata" }),
    );

    const corrupt = buildGeneratedModelEvidence(
      project,
      new Map([
        [
          sha256,
          {
            sha256,
            bytes: glb.byteLength,
            glb: [-1, 256, 3],
          },
        ],
      ]),
    );
    expect(corrupt.status).toBe("incomplete");
    expect(corrupt.missing).toContainEqual(
      expect.objectContaining({ reason: "hash-mismatch" }),
    );
  });

  it("keeps a snapshot write failure explicitly incomplete", async () => {
    const report: any = {
      evidence: [],
      flagshipStory: {},
    };
    const phase = await persistFlagshipStoryPhase(
      report,
      "/dev/null",
      "created",
      { entities: [] },
      null,
    );

    expect(phase.status).toBe("incomplete");
    expect(phase.missing).toContainEqual(
      expect.objectContaining({ reason: "snapshot-write-failed" }),
    );
    expect(report.flagshipStory.generatedModels.status).toBe("incomplete");
  });
});
