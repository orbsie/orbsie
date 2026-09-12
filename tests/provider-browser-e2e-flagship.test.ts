import { afterEach, describe, expect, it } from "vitest";
import {
  assertFlagshipStoryCreation,
  assertFlagshipStoryMushroom,
  assertFlagshipStoryPlatform,
  readConfiguration,
} from "../scripts/provider-browser-e2e.mjs";

const ENV_NAMES = [
  "ORBSIE_LIVE_E2E",
  "ORBSIE_APP_SOURCE_COMMIT",
  "ORBSIE_TEST_URL",
  "ORBSIE_EXPECTED_MODEL",
  "ORBSIE_OUTPUT_CAP_TOKENS",
  "ORBSIE_KEY_SCOPE",
  "ORBSIE_FLAGSHIP_STORY",
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
      entity("tree-a", "Friendly tree", {
        kind: "tree",
        detail: "refined",
        model: { bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] } },
      }),
      entity("tree-b", "Friendly tree 2", { kind: "tree", detail: "refined" }),
      entity("tree-c", "Friendly tree 3", { kind: "tree", detail: "refined" }),
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
    const config = readConfiguration(["--provider", "gateway"]);
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
    expect(mushroomCheck.rawBoundsExpanded).toBe(true);
    expect(mushroomCheck.transformedBoundsExpanded).toBe(true);
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
});
