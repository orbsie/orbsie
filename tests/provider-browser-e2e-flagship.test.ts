import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { chromium, type BrowserContext } from "@playwright/test";
import {
  assertPublishedGameplayBinding,
  assertFlagshipStoryCreation,
  assertFlagshipStoryAssetReferences,
  assertFlagshipStoryGoalSeven,
  assertFlagshipStoryMushroom,
  assertFlagshipStoryPlatform,
  assertPublicationPlaybackOrigins,
  assertPublicationProjectMatches,
  assertPublicationWorldContentMatches,
  buildGeneratedModelEvidence,
  captureCurrentTargetArtifacts,
  createPublishedGameplayPageAdapter,
  publishedPlaybackReport,
  extractZip,
  installTrafficGuard,
  persistFlagshipStoryPhase,
  readConfiguration,
  readFlagshipResumeCheckpoint,
  recordFreshFlagshipGameplayFailure,
  flagshipResumeExecutionMode,
  runProjectFollowOnPhases,
  runFreshFlagshipGameplay,
  verifyFreshPublicationArtifacts,
  verifyStandalone,
} from "../scripts/provider-browser-e2e.mjs";
import {
  summarizePublication,
  prepareCASContinuationProject,
  prepareExistingCASContinuationProject,
  validateRetainedLiveReport,
} from "../scripts/replay-retained-publication.mjs";
import { detectDescendingPlatformSurfaceCrossing } from "../scripts/lib/fresh-flagship-gameplay.mjs";

type ResumeConfig = ReturnType<typeof readConfiguration> & {
  resumeCheckpoint: {
    project: { revision: number };
    models: unknown[];
    sourceSnapshotSha256?: string;
    artifactMode?: string;
  };
  flagshipResumeOffline?: boolean;
  resumeOffline?: {
    baseline: { revision: number };
    edited: { revision: number };
    models: unknown[];
    editedSnapshotSha256?: string;
    artifactMode?: string;
  };
};

const ENV_NAMES = [
  "ORBSIE_LIVE_E2E",
  "ORBSIE_APP_SOURCE_COMMIT",
  "ORBSIE_TEST_URL",
  "ORBSIE_EXPECTED_MODEL",
  "ORBSIE_OUTPUT_CAP_TOKENS",
  "ORBSIE_OPENROUTER_RAISED_CAP",
  "ORBSIE_KEY_SCOPE",
  "ORBSIE_FLAGSHIP_STORY",
  "ORBSIE_FLAGSHIP_RESUME",
  "ORBSIE_FLAGSHIP_RESUME_STAGE",
  "ORBSIE_FLAGSHIP_RESUME_ARTIFACT_MODE",
  "ORBSIE_FLAGSHIP_RESUME_CHECKPOINT",
  "ORBSIE_FLAGSHIP_RESUME_MODELS",
  "ORBSIE_FLAGSHIP_RESUME_OFFLINE",
  "ORBSIE_FLAGSHIP_RESUME_EDITED",
  "ORBSIE_FLAGSHIP_RESUME_EDITED_MODELS",
  "ORBSIE_CREATION_PROMPT",
  "ORBSIE_EDIT_PROMPT",
  "ORBSIE_CHATGPT_TEST_LIMITS",
  "ORBSIE_ACCOUNT_STORAGE_STATE",
  "ORBSIE_REAL_PUBLICATION",
  "ORBSIE_CLOUD_TEST_STATE",
  "ORBSIE_REQUIRE_INPUT_GAME",
  "ORBSIE_VERIFY_CLOUD_RECOVERY",
  "ORBSIE_VERIFY_INTERRUPTED_RECOVERY",
  "AI_GATEWAY_TEST_KEY",
  "AI_GATEWAY_API_KEY",
  "OPENROUTER_API_KEY",
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
    ORBSIE_EXPECTED_MODEL: "openai/gpt-6-luna",
    ORBSIE_OUTPUT_CAP_TOKENS: "4096",
    ORBSIE_KEY_SCOPE: "local-only",
    ORBSIE_FLAGSHIP_STORY: "1",
    AI_GATEWAY_TEST_KEY: "test-gateway-key",
    ...overrides,
  });
}

function openRouterStoryEnvironment(overrides: Record<string, string> = {}) {
  for (const name of ENV_NAMES) delete process.env[name];
  Object.assign(process.env, {
    ORBSIE_LIVE_E2E: "1",
    ORBSIE_APP_SOURCE_COMMIT: "a".repeat(40),
    ORBSIE_TEST_URL: "http://127.0.0.1:3018",
    ORBSIE_EXPECTED_MODEL: "openai/gpt-6-luna",
    ORBSIE_OUTPUT_CAP_TOKENS: "4096",
    ORBSIE_OPENROUTER_RAISED_CAP: "1",
    ORBSIE_KEY_SCOPE: "local-only",
    ORBSIE_FLAGSHIP_STORY: "1",
    OPENROUTER_API_KEY: "test-openrouter-key",
    ...overrides,
  });
}

function hostedStoryEnvironment(overrides: Record<string, string> = {}) {
  for (const name of ENV_NAMES) delete process.env[name];
  Object.assign(process.env, {
    ORBSIE_LIVE_E2E: "1",
    ORBSIE_APP_SOURCE_COMMIT: "a".repeat(40),
    ORBSIE_TEST_URL: "https://orbsie.example.test",
    ORBSIE_EXPECTED_MODEL: "gpt-6-luna",
    ORBSIE_FLAGSHIP_STORY: "1",
    ORBSIE_CHATGPT_TEST_LIMITS: "3-calls-180s-512kib",
    ORBSIE_ACCOUNT_STORAGE_STATE: "/private/orbsie-state.json",
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
const CURRENT_GATEWAY_STORY = resolve(
  "docs/evidence/provider-e2e/gateway-current-full-story/gateway/story-created-project.json",
);
const CURRENT_GATEWAY_STORY_MODELS = resolve(
  "docs/evidence/provider-e2e/gateway-current-full-story/gateway",
);
const CAPTURED_GATEWAY_STORY = resolve(
  "docs/evidence/provider-e2e/gateway-creation-continuation-opened/gateway/story-mushroom-project.json",
);
const CAPTURED_GATEWAY_STORY_MODELS = resolve(
  "docs/evidence/provider-e2e/gateway-creation-continuation-opened/gateway",
);
const CAPTURED_GATEWAY_GOAL7 = resolve(
  "docs/evidence/provider-e2e/gateway-creation-continuation-opened/gateway/story-goal7-project.json",
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

function gatewayCreationResumeEnvironment(
  overrides: Record<string, string> = {},
) {
  gatewayResumeEnvironment({
    ORBSIE_FLAGSHIP_RESUME_STAGE: "creation",
    ORBSIE_FLAGSHIP_RESUME_CHECKPOINT: CURRENT_GATEWAY_STORY,
    ORBSIE_FLAGSHIP_RESUME_MODELS: CURRENT_GATEWAY_STORY_MODELS,
    ...overrides,
  });
}

function gatewayCapturedResumeEnvironment(
  overrides: Record<string, string> = {},
) {
  gatewayResumeEnvironment({
    ORBSIE_FLAGSHIP_RESUME_OFFLINE: "1",
    ORBSIE_FLAGSHIP_RESUME_ARTIFACT_MODE: "captured",
    ORBSIE_FLAGSHIP_RESUME_CHECKPOINT: CAPTURED_GATEWAY_STORY,
    ORBSIE_FLAGSHIP_RESUME_MODELS: CAPTURED_GATEWAY_STORY_MODELS,
    ORBSIE_FLAGSHIP_RESUME_EDITED: CAPTURED_GATEWAY_GOAL7,
    ORBSIE_FLAGSHIP_RESUME_EDITED_MODELS: CAPTURED_GATEWAY_STORY_MODELS,
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

function validRetainedLiveReport(project: any) {
  const ids = project.entities
    .filter((item: any) => item.behavior?.type === "collect")
    .map((item: any) => item.id)
    .sort();
  const platformIds = project.entities
    .filter((item: any) => item.geometry?.kind === "platform")
    .map((item: any) => item.id)
    .sort();
  const projectId = project.id;
  const gameplay = (revision: number, expectedIds = ids) => ({
    status: "passed",
    projectId,
    revision,
    expectedCollectibleIds: expectedIds,
    collectedIds: [...expectedIds].reverse(),
    won: true,
    score: expectedIds.length,
    win: {
      projectId,
      revision,
      status: "won",
      score: expectedIds.length,
      portalId: "portal",
    },
    reset: {
      projectId,
      revision,
      status: "playing",
      score: 0,
      lifecycleAdvanced: true,
    },
    contacts: ["portal"],
    platformEvidence: platformIds.map((id: string) => ({
      id,
      behavior: "bounce",
      groundedFrames: 1,
      bounceFrames: 1,
      maximumDisplacement: 0.5,
    })),
    movement: {
      distance: 0.5,
      before: { projectId, revision, player: { position: [0, 0, 0] } },
      after: { projectId, revision, player: { position: [0.5, 0, 0] } },
    },
  });
  const goalSevenIds = [...ids, "crystal-6", "crystal-7"];
  const phases = {
    creation: { revision: 30, gameplay: gameplay(30) },
    mushroom: { status: "passed", revision: 35, targetId: "tree-a" },
    goal7: { status: "passed", revision: 41, gameplay: gameplay(41, goalSevenIds) },
    undo: { status: "passed", revision: 42, gameplay: gameplay(42) },
  };
  return {
    provider: "openrouter",
    model: "openai/gpt-6-luna",
    reasoning: "low",
    serviceTier: "default",
    outputCapTokens: 4096,
    generationBudget: 3,
    traffic: {
      generationRequests: 3,
      generationStatuses: [200, 200, 200],
      interceptedGeneration: false,
    },
    fallbackUsed: false,
    creation: {
      status: "passed",
      gameplayDuringGeneration: {
        status: "passed",
        generationRequestsAtMovement: 1,
        generationResponsesAtMovement: 1,
        generationStreamOpenAtMovement: true,
        generationStreamOpenAfterMovement: true,
        movementDistance: 0.5,
        projectId: project.id,
        revisionBefore: 2,
        revisionAfter: 3,
        before: {
          projectId: project.id,
          revision: 2,
          player: { position: [0, 0, 0] },
        },
        after: {
          projectId: project.id,
          revision: 3,
          player: { position: [0.5, 0, 0] },
        },
      },
    },
    edit: { status: "passed", type: "flagship-story", selectedIdPreserved: true },
    flagshipStory: {
      status: "passed",
      scope: "fresh-gameplay-and-persistence",
      generationBudget: 3,
      phases,
    },
    export: "blocked",
    error: "Exported project changed the published world content.",
  };
}

function currentGatewayStory() {
  return JSON.parse(readFileSync(CURRENT_GATEWAY_STORY, "utf8"));
}

function addGatewayGoalSevenEdit(project: any, durationChange?: number) {
  const edited = structuredClone(project);
  const collectibleScoreAmount = project.game.rules
    .find((rule: any) => rule.trigger?.type === "collect")
    .actions.find((action: any) => action.type === "add_score").amount;
  const pathRule = edited.game.rules.find(
    (rule: any) => rule.id === "move-platform-2",
  );
  const pathAction = pathRule.actions.find(
    (action: any) => action.type === "move_path",
  );
  if (durationChange !== undefined) pathAction.duration += durationChange;
  edited.entities.push(
    entity(
      "crystal-6",
      "Glow Crystal 6",
      { kind: "crystal", detail: "refined" },
      { behavior: { type: "collect" } },
    ),
    entity(
      "crystal-7",
      "Glow Crystal 7",
      { kind: "crystal", detail: "refined" },
      { behavior: { type: "collect" } },
    ),
  );
  for (const index of [6, 7])
    edited.game.rules.push({
      id: `collect-${index}`,
      trigger: { type: "collect", entityId: `crystal-${index}` },
      conditions: [],
      actions: [
        { type: "add_variable", name: "crystals", amount: 1 },
        { type: "add_score", amount: collectibleScoreAmount },
      ],
    });
  const portalRule = edited.game.rules.find(
    (rule: any) => rule.id === "portal-win",
  );
  const portalCondition = portalRule.conditions.find(
    (condition: any) =>
      condition.operand?.type === "variable" &&
      condition.operand.name === "crystals" &&
      condition.comparison === "gte",
  );
  portalCondition.value = 7;
  return edited;
}

const PUBLICATION_ORIGIN = "https://published.example.test/";
const PUBLICATION_ARTIFACTS = [
  "runtime.js",
  "runtime.css",
  "generated-geometry-worker.js",
  "asset-geometry-worker.js",
];
const RETAINED_FLAGSHIP_ZIP =
  "docs/evidence/provider-e2e/openrouter-flagship-set-label-live-20260925/openrouter/world.zip";

async function serveRetainedFlagshipZipInIframe() {
  const source = resolve(RETAINED_FLAGSHIP_ZIP);
  const archive = unzipSync(new Uint8Array(readFileSync(source)));
  const project = JSON.parse(strFromU8(archive["project.json"]));
  const story = {
    platforms: ["bounce-1", "bounce-2", "bounce-3"].map((id) => {
      const platform = project.entities.find((entity: any) => entity.id === id);
      if (!platform) throw new Error(`Retained flagship ZIP is missing ${id}.`);
      return platform;
    }),
    collectibles: project.entities.filter(
      (entity: any) =>
        entity.stage === "ready" && entity.behavior?.type === "collect",
    ),
    portal: project.entities.find(
      (entity: any) =>
        entity.stage === "ready" && entity.behavior?.type === "portal",
    ),
  };
  const playerServer = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const relativePath = pathname.slice(1);
    if (relativePath.split("/").includes("..")) {
      response.writeHead(403).end();
      return;
    }
    const bytes = archive[relativePath];
    if (!bytes) {
      response.writeHead(404).end();
      return;
    }
    const contentType = relativePath.endsWith(".js")
      ? "text/javascript"
      : relativePath.endsWith(".css")
        ? "text/css"
        : relativePath.endsWith(".json")
          ? "application/json"
          : relativePath.endsWith(".html")
            ? "text/html"
            : "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(bytes);
  });
  const listenLoopback = (server: ReturnType<typeof createServer>) =>
    new Promise<string>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Could not start the retained ZIP fixture server."));
          return;
        }
        resolveListen(`http://127.0.0.1:${address.port}`);
      });
    });
  const closeServer = (server: ReturnType<typeof createServer>) =>
    new Promise<void>((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose())),
    );
  let playerOrigin: string;
  let wrapperServer: ReturnType<typeof createServer> | undefined;
  let wrapperOrigin: string;
  try {
    playerOrigin = await listenLoopback(playerServer);
    wrapperServer = createServer((request, response) => {
      const pathname = new URL(
        request.url ?? "/",
        "http://127.0.0.1",
      ).pathname;
      if (pathname !== "/wrapper.html") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html><html><body style="margin:0"><iframe title="Published player" src="${playerOrigin}/index.html" style="width:1280px;height:800px;border:0"></iframe></body></html>`,
      );
    });
    wrapperOrigin = await listenLoopback(wrapperServer);
  } catch (error) {
    if (wrapperServer?.listening) await closeServer(wrapperServer);
    if (playerServer.listening) await closeServer(playerServer);
    throw error;
  }
  if (!wrapperServer || !wrapperOrigin)
    throw new Error("Could not start the retained wrapper fixture server.");
  const retainedWrapperServer = wrapperServer;
  return {
    wrapperOrigin,
    playerOrigin,
    project,
    story,
    close: async () => {
      await Promise.all([
        closeServer(retainedWrapperServer),
        closeServer(playerServer),
      ]);
    },
  };
}

function publicationFixture({
  project = initialProject(),
  runtime = "fresh runtime",
  manifestRuntime = runtime,
  missing = [],
  oversized = undefined,
  streamOversized = undefined,
  redirect = undefined,
  malformedManifest = false,
}: {
  project?: any;
  runtime?: string;
  manifestRuntime?: string;
  missing?: string[];
  oversized?: string;
  streamOversized?: string;
  redirect?: string;
  malformedManifest?: boolean;
} = {}) {
  const content: Record<string, Uint8Array> = {
    "runtime.js": new TextEncoder().encode(runtime),
    "runtime.css": new TextEncoder().encode("fresh css"),
    "generated-geometry-worker.js": new TextEncoder().encode("fresh geometry"),
    "asset-geometry-worker.js": new TextEncoder().encode("fresh assets"),
  };
  const expectedContent: Record<string, Uint8Array> = {
    ...content,
    "runtime.js": new TextEncoder().encode(manifestRuntime),
  };
  const expectedArtifacts: Record<string, { bytes: number; sha256: string }> =
    Object.fromEntries(
      PUBLICATION_ARTIFACTS.map((path) => {
        const bytes = expectedContent[path];
        return [
          path,
          {
            bytes: bytes.byteLength,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        ];
      }),
    );
  const manifest = {
    version: 4,
    projectId: project.id,
    revision: project.revision,
    files: PUBLICATION_ARTIFACTS.map((path) => ({
      file: path,
      ...expectedArtifacts[path],
    })),
  };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const path = new URL(url).pathname.slice(1).replace(/^player\//, "");
    if (path === "publication-manifest.json") {
      if (malformedManifest) return new Response("{", { status: 200 });
      return new Response(JSON.stringify(manifest), { status: 200 });
    }
    if (path === redirect)
      return new Response("redirect", {
        status: 302,
        headers: { location: "https://outside.example.test/" },
      });
    if (missing.includes(path)) return new Response("missing", { status: 404 });
    const bytes = content[path];
    if (!bytes) return new Response("missing", { status: 404 });
    if (path === oversized)
      return new Response(Buffer.from(bytes), {
        status: 200,
        headers: { "content-length": String(2 * 1024 * 1024 + 1) },
      });
    if (path === streamOversized) {
      const chunk = new Uint8Array(2 * 1024 * 1024 + 1);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(chunk);
            controller.close();
          },
        }),
        { status: 200 },
      );
    }
    return new Response(Buffer.from(bytes), { status: 200 });
  };
  return {
    calls,
    content,
    expectedArtifacts,
    targetArtifacts: structuredClone(expectedArtifacts),
    fetchImpl,
  };
}

describe("flagship provider story contract", () => {
  it("orders platforms from the spawn and preserves the middle identity", () => {
    const savedProject = JSON.parse(
      readFileSync(
        resolve(
          "docs/evidence/provider-e2e/openrouter-flagship-gpt6-luna-live-20260925-recheck/openrouter/story-created-project.json",
        ),
        "utf8",
      ),
    );
    const createdStory = assertFlagshipStoryCreation(savedProject);
    expect(createdStory.platforms.map((platform) => platform.id)).toEqual([
      "bounce-1",
      "bounce-2",
      "bounce-3",
    ]);
    expect(createdStory.middlePlatform.id).toBe("bounce-2");

    const editedProject = structuredClone(savedProject);
    editedProject.revision += 1;
    const editedMiddlePath = editedProject.game.rules
      .flatMap((rule: any) => rule.actions ?? [])
      .find(
        (action: any) =>
          action.type === "move_path" && action.entityId === "bounce-2",
      );
    editedMiddlePath.duration += 0.5;
    expect(assertFlagshipStoryCreation(editedProject).middlePlatform.id).toBe(
      createdStory.middlePlatform.id,
    );

    const undoneProject = structuredClone(savedProject);
    undoneProject.revision += 2;
    expect(assertFlagshipStoryCreation(undoneProject).middlePlatform.id).toBe(
      createdStory.middlePlatform.id,
    );

    const tiedProject = structuredClone(savedProject);
    const setPlatformPosition = (id: string, position: number[]) => {
      const entity = tiedProject.entities.find((item: any) => item.id === id);
      const path = tiedProject.game.rules
        .flatMap((rule: any) => rule.actions ?? [])
        .find((action: any) => action.type === "move_path" && action.entityId === id);
      const delta = position.map(
        (component, axis) => component - entity.position[axis],
      );
      entity.position = position;
      path.points = path.points.map((point: number[]) =>
        point.map((component, axis) => component + delta[axis]),
      );
    };
    setPlatformPosition("bounce-2", [1, 1.5, 0]);
    setPlatformPosition("bounce-3", [-1, 1.5, 0]);
    expect(
      assertFlagshipStoryCreation(tiedProject).platforms.map(
        (platform) => platform.id,
      ),
    ).toEqual(["bounce-1", "bounce-2", "bounce-3"]);

    const reversedIdMap = new Map([
      ["bounce-1", "bounce-z"],
      ["bounce-2", "bounce-y"],
      ["bounce-3", "bounce-x"],
    ]);
    const remapIds = (value: any): any => {
      if (typeof value === "string") return reversedIdMap.get(value) ?? value;
      if (Array.isArray(value)) return value.map(remapIds);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, remapIds(item)]),
        );
      return value;
    };
    const rotatedProject = remapIds(structuredClone(savedProject));
    const rotatePosition = ([x, y, z]: number[]) => [z, y, -x];
    rotatedProject.game.spawn = rotatePosition(rotatedProject.game.spawn);
    for (const entity of rotatedProject.entities)
      entity.position = rotatePosition(entity.position);
    for (const rule of rotatedProject.game.rules) {
      for (const action of rule.actions ?? []) {
        if (action.type === "move_path")
          action.points = action.points.map(rotatePosition);
      }
    }
    const rotatedStory = assertFlagshipStoryCreation(rotatedProject);
    expect(rotatedStory.platforms.map((platform) => platform.id)).toEqual([
      "bounce-z",
      "bounce-y",
      "bounce-x",
    ]);
    expect(rotatedStory.middlePlatform.id).toBe("bounce-y");
  });

  it("records thrown traversal evidence as a bounded phase failure", () => {
    const project = {
      id: "story-project-1",
      revision: 42,
      entities: Array.from({ length: 40 }, (_, index) => ({
        id: `entity-${index}`,
      })),
    };
    const observation = {
      projectId: project.id,
      revision: project.revision,
      atMs: 1250,
      renderer: "software",
      player: { position: [1, 2, 3], velocityY: 0.5, groundedOn: "entity-1" },
      entities: project.entities.map((entity, index) => ({
        ...entity,
        position: [index, 0, index + 1],
        scale: [1, 1, 1],
        label: "private provider response",
      })),
      contacts: ["entity-1"],
      collected: [],
      scoreIds: [],
      gameScore: 0,
      status: "playing",
      won: false,
      lost: false,
      reset: 0,
      sessionGeneration: 1,
    };
    const initialReport: any = {
      error: "Fresh gameplay did not contact platform bounce-three.",
      flagshipStory: {
        status: "running",
        phases: { creation: { revision: 42 } },
      },
    };
    const compactAttemptObservation = (id: string, atMs: number) => ({
      atMs,
      player: {
        position: [1, 2, 3],
        velocityY: 0.5,
        groundedOn: id,
      },
      platform: { position: [4, 5, 6], scale: [1, 1, 1] },
      platformContactId: id,
      bounceContactId: "provider raw response",
      platformContactCount: 12,
      bounceContactCount: -1,
      rawProviderText: "must not be copied",
    });
    const crossingTarget = {
      id: "entity-0",
      position: [0, 0.5, 0],
      scale: [1, 0.25, 1],
      geometry: { kind: "platform" },
    };
    const crossing = detectDescendingPlatformSurfaceCrossing(
      {
        ...compactAttemptObservation("entity-0", 100),
        player: { position: [0, 1.2, 0], velocityY: 0.2, groundedOn: null },
        platform: { position: [0, 0.5, 0], scale: [1, 0.25, 1] },
        platformContactCount: 0,
        bounceContactCount: 0,
      },
      {
        ...compactAttemptObservation("entity-0", 150),
        player: { position: [0.6, 0.9, 0], velocityY: -0.2, groundedOn: null },
        platform: { position: [0, 0.5, 0], scale: [1, 0.25, 1] },
        platformContactCount: 1,
        bounceContactCount: 0,
      },
      crossingTarget,
    );
    expect(crossing).not.toBeNull();
    if (!crossing) throw new Error("Expected crossing evidence in fixture.");
    const unsafeCrossing = structuredClone(crossing) as Record<string, any>;
    unsafeCrossing.rawProviderText = "private crossing provider output";
    unsafeCrossing.previous.observation.rawProviderText = "private previous text";
    const thrown = new Error(initialReport.error) as Error & {
      freshGameplayEvidence: Record<string, any>;
    };
    thrown.freshGameplayEvidence = {
      observationCount: 6100,
      lastObservation: observation,
      inputTrace: Array.from({ length: 30 }, (_, index) => ({
        atMs: index * 10,
        keys: ["d", "secret-provider-token"],
        reason: index === 0 ? "provider raw response" : "platform-jump-start",
      })),
      movement: { distance: 0.5, before: observation, after: observation },
      collectibleTraversalOrder: [
        "entity-4",
        "entity-2",
        "private provider text",
        "entity-4",
      ],
      contacts: ["entity-1", "provider raw response"],
      collections: [],
      scoreIds: [],
      score: 0,
      portalWin: null,
      restart: { attempted: false, control: "provider raw response" },
      platformEvidence: Array.from({ length: 40 }, (_, index) => ({
        id: `entity-${index}`,
        behavior: "bounce",
        groundedFrames: 1,
        bounceFrames: 0,
        startPosition: [index, 0, 0],
        maximumDisplacement: 0.2,
        jumpEvidence: [
          0,
          1,
          2,
          "recovery-0",
          "recovery-1",
        ].map((attempt) => ({
          id: `entity-${index}`,
          attempt,
          before: compactAttemptObservation(`entity-${index}`, 10),
          inputKeys: Array.from({ length: 12 }, () => [
            "d",
            "secret-provider-token",
          ]),
          samples: Array.from({ length: 20 }, (_, sampleIndex) => ({
            ...compactAttemptObservation(
              `entity-${index}`,
              sampleIndex === 19 ? -1 : sampleIndex + 20,
            ),
            rawProviderText: "private sample provider output",
          })),
          apex: compactAttemptObservation(`entity-${index}`, 30),
          landing: compactAttemptObservation(`entity-${index}`, 40),
          contact: compactAttemptObservation(`entity-${index}`, 50),
          recovery: compactAttemptObservation(`entity-${index}`, 60),
          surfaceCrossing: attempt === 2 ? unsafeCrossing : null,
          rawProviderText: "must be omitted",
        })),
      })),
      rawProviderText: "must not be copied",
      apiKey: "must not be copied",
    };

    for (const [phase, revision] of [
      ["creation", 42],
      ["goal7", 43],
      ["undo", 44],
    ] as const) {
      const report: any = structuredClone(initialReport);
      const phaseObservation = { ...observation, revision };
      const phaseError = new Error(thrown.message) as Error & {
        freshGameplayEvidence: Record<string, any>;
      };
      phaseError.freshGameplayEvidence = {
        ...thrown.freshGameplayEvidence,
        lastObservation: phaseObservation,
        movement: {
          distance: 0.5,
          before: phaseObservation,
          after: phaseObservation,
        },
      };
      recordFreshFlagshipGameplayFailure(
        report,
        phase,
        { ...project, revision },
        phaseError,
      );

      expect(report.error).toBe(initialReport.error);
      expect(report.flagshipStory.status).toBe("failed");
      expect(report.flagshipStory.phases[phase]).toMatchObject({
        status: "failed",
        revision,
        gameplay: {
          status: "failed",
          projectId: project.id,
          revision,
          failureEvidence: {
            phase,
            projectId: project.id,
            revision,
            observationCount: 6000,
            lastObservation: { revision, entities: expect.any(Array) },
            collectibleTraversalOrder: ["entity-4", "entity-2"],
          },
        },
      });
      const evidence =
        report.flagshipStory.phases[phase].gameplay.failureEvidence;
      expect(evidence.lastObservation.entities).toHaveLength(32);
      expect(evidence.inputTrace).toHaveLength(20);
      expect(evidence.platformEvidence).toHaveLength(32);
      expect(evidence.platformEvidence[0].jumpEvidence).toHaveLength(3);
      expect(
        evidence.platformEvidence[0].jumpEvidence.map(
          (attempt: any) => attempt.attempt,
        ),
      ).toEqual([2, "recovery-0", "recovery-1"]);
      expect(
        evidence.platformEvidence[0].jumpEvidence.every(
          (attempt: any) =>
            attempt.samples.length === 12 && attempt.inputKeys.length === 8,
        ),
      ).toBe(true);
      expect(
        evidence.platformEvidence[0].jumpEvidence[0].samples.map(
          (sample: any) => sample.atMs,
        ),
      ).toEqual([28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, null]);
      expect(JSON.stringify(report)).not.toContain(
        "private sample provider output",
      );
      expect(
        evidence.platformEvidence[0].jumpEvidence[0].samples.at(-1),
      ).toMatchObject({
        atMs: null,
        platformContactId: "entity-0",
        bounceContactId: null,
        platformContactCount: 12,
        bounceContactCount: null,
      });
      expect(
        evidence.platformEvidence[0].jumpEvidence[0].surfaceCrossing,
      ).toMatchObject({
        kind: "descending-estimated-platform-top-crossing",
        estimateOnly: true,
        footprint: {
          model: "procedural-xz-half-extents-0.55-times-scale",
          authoritativeContact: false,
        },
        previous: {
          estimatedTopY: 1.05,
          insideEstimatedFootprint: true,
        },
        current: {
          estimatedTopY: 1.05,
          insideEstimatedFootprint: false,
        },
        contactCountersChanged: { platform: true, bounce: false },
      });
      expect(
        evidence.platformEvidence[0].jumpEvidence[0].inputKeys.every(
          (keys: string[]) => keys.join("") === "d",
        ),
      ).toBe(true);
      expect(
        evidence.inputTrace.every(
          (entry: any) =>
            entry.reason === "platform-jump-start" &&
            entry.keys.every((key: string) =>
              ["a", "d", "s", "w", " "].includes(key),
            ),
        ),
      ).toBe(true);
      expect(JSON.stringify(report)).not.toContain(
        "private provider response",
      );
      expect(JSON.stringify(report)).not.toContain("secret-provider-token");
      expect(JSON.stringify(report)).not.toContain("must not be copied");
      expect(JSON.stringify(report)).not.toContain(
        "private crossing provider output",
      );
      expect(JSON.stringify(report)).not.toContain("private previous text");
    }
  });

  it("keeps an unreachable current-runtime ZIP route incomplete", async () => {
    const sourceArchiveRelative =
      "docs/evidence/provider-e2e/gateway-flagship-offline-continuation/gateway/world.zip";
    const sourceArchivePath = resolve(sourceArchiveRelative);
    const sourceArchiveBytes = readFileSync(sourceArchivePath);
    const sourceFiles = unzipSync(new Uint8Array(sourceArchiveBytes));
    const currentRuntimePaths = [
      "runtime.js",
      "runtime.css",
      "generated-geometry-worker.js",
      "asset-geometry-worker.js",
    ];
    const originalRuntimeHash = createHash("sha256")
      .update(sourceFiles["runtime.js"])
      .digest("hex");
    const currentFiles = { ...sourceFiles };
    for (const path of currentRuntimePaths)
      currentFiles[path] = readFileSync(resolve("public/player", path));
    expect(strFromU8(currentFiles["runtime.js"])).toContain(
      "__ORBSIE_GAMEPLAY_READ_REQUESTED__",
    );
    expect(
      createHash("sha256").update(currentFiles["runtime.js"]).digest("hex"),
    ).not.toBe(originalRuntimeHash);
    expect(currentFiles["project.json"]).toEqual(sourceFiles["project.json"]);

    const archive = zipSync(currentFiles, {
      level: 6,
      mtime: new Date("2000-01-01T12:00:00Z"),
    });
    const temporary = await mkdtemp(
      join(tmpdir(), "orbsie-standalone-gameplay-fixture-"),
    );
    const evidenceDir = resolve(
      "docs/evidence/provider-e2e/standalone-current-runtime-gameplay-fixture",
    );
    await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
    await writeFile(join(temporary, "world.zip"), archive);
    const project = JSON.parse(strFromU8(currentFiles["project.json"]));
    const gameplayPhase = (revision: number) => ({
      status: "passed",
      projectId: project.id,
      revision,
    });
    const report: any = {
      evidence: [],
      flagshipStory: {
        status: "passed",
        scope: "fresh-gameplay-and-persistence",
        phases: {
          creation: {
            revision: project.revision - 2,
            gameplay: gameplayPhase(project.revision - 2),
          },
          goal7: {
            revision: project.revision - 1,
            gameplay: gameplayPhase(project.revision - 1),
          },
          undo: {
            revision: project.revision,
            gameplay: gameplayPhase(project.revision),
          },
        },
      },
    };
    const runtimeSha256 = createHash("sha256")
      .update(currentFiles["runtime.js"])
      .digest("hex");
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    });
    let failure: unknown;
    try {
      await verifyStandalone(
        browser,
        { tempDir: temporary, project },
        {
          baseOrigin: "https://editor.example.test",
          provider: "gateway",
          generationBudget: 3,
          flagshipStory: true,
          flagshipInputMode: "keyboard",
          requireInputGame: false,
        } as any,
        report,
        evidenceDir,
      );
    } catch (error) {
      failure = error;
    } finally {
      await browser.close();
      await writeFile(
        join(evidenceDir, "report.json"),
        `${JSON.stringify(
          {
            mode: "deterministic-current-runtime-static-zip-fixture",
            sourceProjectZip: sourceArchiveRelative,
            sourceProjectZipSha256: createHash("sha256")
              .update(sourceArchiveBytes)
              .digest("hex"),
            sourceRuntimeSha256: originalRuntimeHash,
            currentRuntimeSha256: runtimeSha256,
            fixtureZipSha256: createHash("sha256")
              .update(archive)
              .digest("hex"),
            projectId: project.id,
            revision: project.revision,
            status: report.standaloneGameplay?.status ?? "not-run",
            standaloneGameplay: report.standaloneGameplay ?? null,
            standalone: report.standalone ?? null,
            evidence: report.evidence,
            error:
              failure instanceof Error ? failure.message : (failure ?? null),
          },
          null,
          2,
        )}\n`,
      );
      await rm(temporary, { recursive: true, force: true });
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      "Fresh gameplay did not contact platform",
    );
    expect(report.standaloneGameplay).toMatchObject({
      status: "failed",
      projectId: project.id,
      revision: project.revision,
      expectedCollectibleCount: 5,
      runtime: { sha256: runtimeSha256 },
      editorProviderRequests: 0,
      blockedExternalRequests: 0,
      failureEvidence: {
        movement: { distance: expect.any(Number) },
        lastObservation: {
          projectId: project.id,
          revision: project.revision,
          renderer: expect.stringMatching(/^(webgl|software)$/),
        },
        portalWin: null,
        restart: { attempted: false },
      },
    });
    expect(
      report.standaloneGameplay.failureEvidence.movement.distance,
    ).toBeGreaterThan(0.12);
    expect(report.standaloneGameplay.won).not.toBe(true);
    expect(report.standaloneGameplay.win).toBeUndefined();
    expect(report.standaloneGameplay.reset).toBeUndefined();
    expect(report.standaloneGameplay.failureEvidence.collections).toEqual([]);
    expect(
      report.standaloneGameplay.failureEvidence.inputTrace,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "platform-jump-start",
          keys: [" "],
        }),
      ]),
    );
    expect(report.standalone?.pageErrors).toEqual([]);
    expect(report.standalone?.blockedExternalRequests).toBe(0);
  }, 180_000);

  it("binds portal contact evidence to its transformed render group", () => {
    const traversal = readFileSync(
      resolve("scripts/verify-winning-traversal.mjs"),
      "utf8",
    );
    expect(traversal).toContain("object.isGroup");
    expect(traversal).toContain("target.entityId");
    expect(traversal).toContain('child.geometry?.type !== "CircleGeometry"');
    expect(traversal).toContain(
      'matchedBy: "portal-entity-render-group-transform"',
    );
    expect(traversal).toContain(
      "observations: [firstObservation, secondObservation]",
    );
    expect(traversal).not.toContain("distanceXZ > 0.8");
  });

  it("keeps the edited goal-7 ZIP separate from the baseline export", async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), "orbsie-goal7-export-test-"),
    );
    try {
      const requiredNames = [
        "index.html",
        "project.json",
        "runtime.js",
        "runtime.css",
        "generated-geometry-worker.js",
        "asset-geometry-worker.js",
        "package.json",
        "README.md",
        "build.mjs",
        "src/runtime.ts",
      ];
      const archive = zipSync(
        Object.fromEntries(
          requiredNames.map((name) => [
            name,
            new TextEncoder().encode(
              name === "project.json"
                ? JSON.stringify({ revision: 40 })
                : "fixture",
            ),
          ]),
        ),
      );
      const download = {
        saveAs: async (target: string) => writeFile(target, archive),
      };
      const goal7 = await extractZip(
        download,
        {},
        40,
        temporary,
        "world-goal-7.zip",
      );
      expect(goal7.project.revision).toBe(40);
      expect(readFileSync(join(temporary, "world-goal-7.zip"))).toEqual(
        Buffer.from(archive),
      );
      await expect(
        extractZip(download, {}, 40, temporary, "../world-goal-7.zip"),
      ).rejects.toThrow(/simple ZIP filename/);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it("enables exactly three Gateway generations with the fixed story prompt", () => {
    gatewayStoryEnvironment();
    const config = readConfiguration(["--provider", "gateway"]) as ResumeConfig;
    expect(config).toMatchObject({
      provider: "gateway",
      expectedModel: "openai/gpt-6-luna",
      outputCap: 4096,
      generationBudget: 3,
      flagshipStory: true,
      prompt:
        "Make a sunny little island game where I collect five glowing crystals, bounce across three moving platforms, and reach a portal. Add friendly trees and a pond.",
    });
  });

  it("enables the same three-call story for OpenRouter with its 4096 cap", () => {
    openRouterStoryEnvironment();
    const config = readConfiguration(["--provider", "openrouter"]);
    expect(config).toMatchObject({
      provider: "openrouter",
      expectedModel: "openai/gpt-6-luna",
      outputCap: 4096,
      generationBudget: 3,
      flagshipStory: true,
      prompt:
        "Make a sunny little island game where I collect five glowing crystals, bounce across three moving platforms, and reach a portal. Add friendly trees and a pond.",
    });
  });

  it("enables a separate three-call hosted story contract without a token cap", () => {
    hostedStoryEnvironment();
    const config = readConfiguration(["--provider", "chatgpt-hosted"]);
    expect(config).toMatchObject({
      provider: "chatgpt-hosted",
      expectedModel: "gpt-6-luna",
      outputCap: null,
      generationBudget: 3,
      flagshipStory: true,
      hostedTestLimits: "3-calls-180s-512kib",
      hostedActualBounds: {
        generationCalls: 3,
        durationSeconds: 180,
        responseBytes: 512 * 1024,
        outputTokenCap: null,
        providerTokenOrCostGuarantee: false,
      },
    });
  });

  it("enables only the explicit one-call Gateway checkpoint resume", () => {
    gatewayResumeEnvironment();
    const config = readConfiguration(["--provider", "gateway"]) as ResumeConfig;
    expect(config).toMatchObject({
      provider: "gateway",
      expectedModel: "openai/gpt-6-luna",
      outputCap: 4096,
      generationBudget: 1,
      flagshipStory: false,
      flagshipResume: true,
      editPrompt: "Make the middle platform slower and add two more crystals",
    });
    expect(config.resumeCheckpoint.project.revision).toBeGreaterThan(0);
    expect(config.resumeCheckpoint.models).toHaveLength(5);
    expect(flagshipResumeExecutionMode(config)).toBe("checkpoint");
  });

  it("enables the explicit two-call creation-stage continuation from the saved scene", () => {
    gatewayCreationResumeEnvironment();
    const config = readConfiguration(["--provider", "gateway"]) as ResumeConfig;
    expect(config).toMatchObject({
      provider: "gateway",
      expectedModel: "openai/gpt-6-luna",
      outputCap: 4096,
      generationBudget: 2,
      flagshipStory: false,
      flagshipResume: true,
      flagshipResumeStage: "creation",
      editPrompt: "Make the middle platform slower and add two more crystals",
      resumeCheckpoint: {
        project: { revision: 26 },
        models: [],
      },
    });
    expect(flagshipResumeExecutionMode(config)).toBe("creation");
    expect(
      assertFlagshipStoryAssetReferences(config.resumeCheckpoint.project),
    ).toEqual(
      expect.arrayContaining([
        "kenney.nature.platform-grass",
        "kenney.nature.tree-default",
        "kenney.nature.tree-pine-tall-a",
      ]),
    );
  });

  it("rejects an invalid creation-stage source hash before opening a browser", async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), "orbsie-creation-stage-hash-test-"),
    );
    try {
      const manifest = JSON.parse(
        readFileSync(
          join(CURRENT_GATEWAY_STORY_MODELS, "story-created-generated.json"),
          "utf8",
        ),
      );
      manifest.sourceSnapshotSha256 = "0".repeat(64);
      await writeFile(
        join(temporary, "story-created-generated.json"),
        JSON.stringify(manifest),
      );
      gatewayCreationResumeEnvironment({
        ORBSIE_FLAGSHIP_RESUME_MODELS: temporary,
      });
      expect(() => readConfiguration(["--provider", "gateway"])).toThrow(
        /invalid source snapshot hash/,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it("rejects an invalid mode and an unknown saved catalog asset", async () => {
    gatewayResumeEnvironment({ ORBSIE_FLAGSHIP_RESUME_STAGE: "seed" });
    expect(() => readConfiguration(["--provider", "gateway"])).toThrow(
      /creation or mushroom/,
    );

    const temporary = await mkdtemp(
      join(tmpdir(), "orbsie-creation-stage-asset-test-"),
    );
    try {
      const project = currentGatewayStory();
      project.entities.find((candidate: any) => candidate.id === "tree-1").geometry.assetId =
        "unknown.tree";
      const checkpointBytes = Buffer.from(`${JSON.stringify(project)}\n`);
      const checkpointPath = join(temporary, "story-created-project.json");
      await writeFile(checkpointPath, checkpointBytes);
      const manifest = JSON.parse(
        readFileSync(
          join(CURRENT_GATEWAY_STORY_MODELS, "story-created-generated.json"),
          "utf8",
        ),
      );
      manifest.sourceSnapshot = checkpointPath;
      manifest.sourceSnapshotSha256 = createHash("sha256")
        .update(checkpointBytes)
        .digest("hex");
      await writeFile(
        join(temporary, "story-created-generated.json"),
        JSON.stringify(manifest),
      );
      gatewayCreationResumeEnvironment({
        ORBSIE_FLAGSHIP_RESUME_CHECKPOINT: checkpointPath,
        ORBSIE_FLAGSHIP_RESUME_MODELS: temporary,
      });
      expect(() => readConfiguration(["--provider", "gateway"])).toThrow(
        /unknown catalog asset reference/,
      );
      expect(() => assertFlagshipStoryAssetReferences(project)).toThrow(
        /unknown catalog asset reference/,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it("fails closed when a generated creation reference has no captured bytes", async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), "orbsie-creation-stage-generated-test-"),
    );
    try {
      const project = currentGatewayStory();
      const crystal = project.entities.find(
        (candidate: any) => candidate.id === "crystal-1",
      );
      const bytes = Buffer.from("captured-model");
      const modelHash = createHash("sha256").update(bytes).digest("hex");
      crystal.geometry = {
        kind: "generated",
        detail: "refined",
        job: { backend: "test" },
        model: { sha256: modelHash, bytes: bytes.byteLength },
      };
      const checkpointBytes = Buffer.from(`${JSON.stringify(project)}\n`);
      const checkpointPath = join(temporary, "story-created-project.json");
      await writeFile(checkpointPath, checkpointBytes);
      const manifest = JSON.parse(
        readFileSync(
          join(CURRENT_GATEWAY_STORY_MODELS, "story-created-generated.json"),
          "utf8",
        ),
      );
      manifest.sourceSnapshot = checkpointPath;
      manifest.sourceSnapshotSha256 = createHash("sha256")
        .update(checkpointBytes)
        .digest("hex");
      manifest.models = [
        {
          entityIds: ["crystal-1"],
          sha256: modelHash,
          bytes: bytes.byteLength,
          path: `generated/${modelHash}.glb`,
          status: "complete",
        },
      ];
      manifest.totalBytes = bytes.byteLength;
      await writeFile(
        join(temporary, "story-created-generated.json"),
        JSON.stringify(manifest),
      );
      gatewayCreationResumeEnvironment({
        ORBSIE_FLAGSHIP_RESUME_CHECKPOINT: checkpointPath,
        ORBSIE_FLAGSHIP_RESUME_MODELS: temporary,
      });
      expect(() => readFlagshipResumeCheckpoint(
        checkpointPath,
        temporary,
        "creation",
      )).toThrow(/cannot be reconstructed/);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
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
    expect(flagshipResumeExecutionMode(config)).toBe("offline");
    expect(offline.models).toHaveLength(7);
  });

  it("loads the explicit captured mushroom and goal-7 manifests", () => {
    gatewayCapturedResumeEnvironment();
    delete process.env.AI_GATEWAY_TEST_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    const config = readConfiguration(["--provider", "gateway"]) as ResumeConfig;
    expect(config).toMatchObject({
      flagshipResume: true,
      flagshipResumeOffline: true,
      flagshipResumeStage: "mushroom",
      flagshipResumeArtifactMode: "captured",
      generationBudget: 0,
      resumeCheckpoint: {
        project: {
          id: "d8d48be6-dae2-4531-a7cb-77e8906b4c75",
          revision: 30,
        },
        models: [],
      },
      resumeOffline: {
        edited: {
          id: "d8d48be6-dae2-4531-a7cb-77e8906b4c75",
          revision: 37,
        },
        models: [
          { id: "crystal-6" },
          { id: "crystal-7" },
        ],
      },
    });
    expect(flagshipResumeExecutionMode(config)).toBe("offline");
    expect(config.resumeCheckpoint.sourceSnapshotSha256).toBe(
      "025e2d5d40a486dcd9944e0ff08cb921de0f826184f7cc3d6fbef06aa39a9def",
    );
    expect(config.resumeOffline?.editedSnapshotSha256).toBe(
      "38606a52068206da403dd22f85fe7a97dca2eafc51e600249d3445d34b7e2dac",
    );
  });

  it("fails closed when a captured goal-7 GLB is corrupt", async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), "orbsie-captured-offline-model-test-"),
    );
    try {
      await mkdir(join(temporary, "generated"), { recursive: true });
      for (const filename of [
        "story-mushroom-generated.json",
        "story-goal7-generated.json",
      ]) {
        await writeFile(
          join(temporary, filename),
          readFileSync(join(CAPTURED_GATEWAY_STORY_MODELS, filename)),
        );
      }
      const goal7Manifest = JSON.parse(
        readFileSync(
          join(CAPTURED_GATEWAY_STORY_MODELS, "story-goal7-generated.json"),
          "utf8",
        ),
      );
      for (const [index, record] of goal7Manifest.models.entries()) {
        const bytes = Buffer.from(
          readFileSync(join(CAPTURED_GATEWAY_STORY_MODELS, record.path)),
        );
        if (index === 0) bytes[0] ^= 0xff;
        await writeFile(join(temporary, record.path), bytes);
      }
      gatewayCapturedResumeEnvironment({
        ORBSIE_FLAGSHIP_RESUME_MODELS: temporary,
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

  it("aborts both generation routes and records offline replay attempts", async () => {
    const blockedGenerationRequests: Array<{ method: string; path: string }> = [];
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
        provider: "openrouter",
        baseOrigin: "http://127.0.0.1:3018",
        generationBudget: 0,
      } as any,
      new Set(["http://127.0.0.1:3018"]),
      { blockGenerationRequests: true, blockedGenerationRequests },
    );
    for (const [path, method] of [
      ["/api/generate", "POST"],
      ["/api/chatgpt/generate", "POST"],
    ]) {
      let continued = false;
      let aborted: string | undefined;
      await handlers[0]({
        request: () => ({
          url: () => `http://127.0.0.1:3018${path}`,
          method: () => method,
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
    }
    expect(blockedGenerationRequests).toEqual([
      { method: "POST", path: "/api/generate" },
      { method: "POST", path: "/api/chatgpt/generate" },
    ]);
  });

  it("binds offline publication replay to the retained OpenRouter phases and ZIP revision", () => {
    const project = initialProject();
    project.revision = 42;
    const report = validRetainedLiveReport(project);
    const hash = "a".repeat(64);
    expect(validateRetainedLiveReport(report, project, hash, hash)).toMatchObject({
      provider: "openrouter",
      model: "openai/gpt-6-luna",
      calls: 3,
      projectRevision: 42,
      phases: { creation: 30, mushroom: 35, goal7: 41, undo: 42 },
    });

    expect(() =>
      validateRetainedLiveReport(report, project, "b".repeat(64), hash),
    ).toThrow(/ZIP hash mismatch/);
    const staleUndo = structuredClone(report);
    staleUndo.flagshipStory.phases.undo.gameplay.revision = 41;
    expect(() =>
      validateRetainedLiveReport(staleUndo, project, hash, hash),
    ).toThrow(/gameplay revision mismatch/);
    const missingGameplay = structuredClone(report);
    missingGameplay.flagshipStory.phases.goal7.gameplay.status = "not-run";
    expect(() =>
      validateRetainedLiveReport(missingGameplay, project, hash, hash),
    ).toThrow(/Source goal7 gameplay did not pass/);
  });

  it("keeps unpublished signed-out traffic marked not-run after a cloud conflict", () => {
    const summary = summarizePublication(
      {
        cloudSave: { mode: "real", status: "failed", httpStatus: 409 },
        publicationDeployment: { mode: "real", status: "not-started" },
        publication: { mode: "blocked", status: "cloud-save-conflict" },
        signedInGenerationRequests: [],
        signedInBlockedGenerationRequests: [],
      },
      { projectRevision: 42 },
    );
    expect(summary.status).toBe("incomplete");
    expect(summary.signedInTraffic).toEqual({
      generationAttempts: 0,
      blockedGenerationAttempts: 0,
    });
    expect(summary.signedOutPlayback.trafficStatus).toBe("not-run");
    expect(summary.signedOutPlayback.generationAttempts).toBeNull();
    expect(summary.signedOutPlayback.blockedExternalRequests).toBeNull();
  });

  it("builds a revision-42 CAS candidate while preserving the full cloud transcript", () => {
    const ancestor: any = initialProject();
    ancestor.revision = 35;
    ancestor.messages = Array.from({ length: 4 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: `ancestor-${index}`,
    }));
    const cloudSnapshot = structuredClone(ancestor);
    cloudSnapshot.messages.push({ role: "assistant", content: "cloud-tail" });
    const retainedProject = structuredClone(ancestor);
    retainedProject.revision = 42;
    retainedProject.messages = [];

    const result = prepareCASContinuationProject({
      ancestor,
      cloudRecord: {
        id: ancestor.id,
        revision: 35,
        snapshot: cloudSnapshot,
        snapshotToken: "a".repeat(64),
      },
      retainedProject,
    });
    expect(result).toMatchObject({
      baseRevision: 35,
      ancestorRevision: 35,
      ancestorMessageCount: 4,
      cloudMessageCount: 5,
      project: { id: ancestor.id, revision: 42 },
    });
    expect(result.project.messages).toEqual(cloudSnapshot.messages);
  });

  it("rejects CAS preparation when cloud revision or transcript ancestry changed", () => {
    const ancestor: any = initialProject();
    ancestor.revision = 35;
    ancestor.messages = Array.from({ length: 4 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: `ancestor-${index}`,
    }));
    const retainedProject = structuredClone(ancestor);
    retainedProject.revision = 42;
    retainedProject.messages = [];
    const cloudRecord = {
      id: ancestor.id,
      revision: 35,
      snapshot: structuredClone(ancestor),
      snapshotToken: "b".repeat(64),
    };
    cloudRecord.snapshot.messages.push({ role: "assistant", content: "tail" });

    expect(() =>
      prepareCASContinuationProject({
        ancestor,
        cloudRecord: { ...cloudRecord, revision: 36 },
        retainedProject,
      }),
    ).toThrow(/Cloud project revision differs/);
    cloudRecord.snapshot.messages[0].content = "replaced-prefix";
    expect(() =>
      prepareCASContinuationProject({ ancestor, cloudRecord, retainedProject }),
    ).toThrow(/does not preserve the captured ancestor prefix/);
  });

  it("verifies a previously CAS-saved revision 42 without preparing another write", () => {
    const ancestor: any = initialProject();
    ancestor.revision = 35;
    ancestor.messages = Array.from({ length: 4 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: `ancestor-${index}`,
    }));
    const retainedProject: any = structuredClone(ancestor);
    retainedProject.revision = 42;
    retainedProject.messages = [];
    const snapshot = structuredClone(retainedProject);
    snapshot.messages = [
      ...structuredClone(ancestor.messages),
      { role: "assistant", content: "preserved-cloud-tail" },
    ];
    const result = prepareExistingCASContinuationProject({
      ancestor,
      cloudRecord: {
        id: retainedProject.id,
        revision: 42,
        snapshot,
        snapshotToken: "c".repeat(64),
      },
      retainedProject,
    });
    expect(result).toMatchObject({
      baseRevision: 42,
      cloudMessageCount: 5,
      project: { id: retainedProject.id, revision: 42 },
    });
    expect(result.project.messages).toEqual(snapshot.messages);
    expect(() =>
      prepareExistingCASContinuationProject({
        ancestor,
        cloudRecord: {
          id: retainedProject.id,
          revision: 43,
          snapshot: { ...snapshot, revision: 43 },
          snapshotToken: "d".repeat(64),
        },
        retainedProject,
      }),
    ).toThrow(/Existing CAS cloud revision mismatch/);
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
      await writeFile(join(temporary, "report.json"), JSON.stringify(report));
      gatewayResumeEnvironment({ ORBSIE_FLAGSHIP_RESUME_MODELS: temporary });
      expect(() => readConfiguration(["--provider", "gateway"])).toThrow(
        /bound to the supplied checkpoint/,
      );

      const safeReport = JSON.parse(
        readFileSync(join(RESUME_MODELS, "report.json"), "utf8"),
      );
      safeReport.models[0].path = "generated/../outside.glb";
      await writeFile(
        join(temporary, "report.json"),
        JSON.stringify(safeReport),
      );
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
      await writeFile(
        join(temporary, "report.json"),
        JSON.stringify(goodReport),
      );
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

  it("rejects unsupported story combinations while allowing follow-on cloud phases", () => {
    openRouterStoryEnvironment({ ORBSIE_REQUIRE_INPUT_GAME: "1" });
    expect(() => readConfiguration(["--provider", "openrouter"])).toThrow(
      /input-game/,
    );
    gatewayStoryEnvironment({ ORBSIE_REQUIRE_INPUT_GAME: "1" });
    expect(() => readConfiguration(["--provider", "gateway"])).toThrow(
      /input-game/,
    );
    gatewayStoryEnvironment({ ORBSIE_OUTPUT_CAP_TOKENS: "512" });
    expect(() => readConfiguration(["--provider", "gateway"])).toThrow(/4096/);

    hostedStoryEnvironment({ ORBSIE_CHATGPT_TEST_LIMITS: "2-calls-180s-512kib" });
    expect(() => readConfiguration(["--provider", "chatgpt-hosted"])).toThrow(
      /3-calls-180s-512kib/,
    );

    hostedStoryEnvironment({ ORBSIE_REAL_PUBLICATION: "1" });
    expect(readConfiguration(["--provider", "chatgpt-hosted"]).publication).toBe(
      true,
    );
    hostedStoryEnvironment({ ORBSIE_VERIFY_CLOUD_RECOVERY: "1" });
    expect(
      readConfiguration(["--provider", "chatgpt-hosted"]).cloudRecovery,
    ).toBe(true);

    gatewayStoryEnvironment({
      ORBSIE_REAL_PUBLICATION: "1",
      ORBSIE_CLOUD_TEST_STATE: "/private/cloud-state.json",
    });
    expect(readConfiguration(["--provider", "gateway"])).toMatchObject({
      publication: true,
      cloudRecovery: false,
      generationBudget: 3,
    });
  });

  it("passes the undone project identity and revision through follow-on phases", async () => {
    const project = { id: "story-project", revision: 42 };
    const calls: Array<{
      phase: string;
      id: string;
      revision: number;
    }> = [];
    const record = (phase: string, value: any, expected: any) => {
      expect(value).toMatchObject({
        id: expected.projectId,
        revision: expected.revision,
      });
      calls.push({ phase, id: value.id, revision: value.revision });
    };
    const result = await runProjectFollowOnPhases({
      project,
      refresh: async (expected: any) => {
        record("refresh", project, expected);
        return structuredClone(project);
      },
      exportProject: async (refreshed: any, expected: any) => {
        record("export", refreshed, expected);
        return { project: structuredClone(refreshed) };
      },
      standalonePlayback: async (exported: any, expected: any) => {
        record("standalone", exported.project, expected);
      },
      cloudRecovery: async (current: any, expected: any) => {
        record("cloud", current, expected);
      },
      publication: async (current: any, expected: any) => {
        record("publication", current, expected);
      },
    });
    expect(result).toEqual({ projectId: project.id, revision: project.revision });
    expect(calls).toEqual([
      { phase: "refresh", id: project.id, revision: project.revision },
      { phase: "export", id: project.id, revision: project.revision },
      { phase: "standalone", id: project.id, revision: project.revision },
      { phase: "cloud", id: project.id, revision: project.revision },
      { phase: "publication", id: project.id, revision: project.revision },
    ]);

    const failedCalls: string[] = [];
    await expect(
      runProjectFollowOnPhases({
        project,
        refresh: async () => structuredClone(project),
        exportProject: async () => {
          failedCalls.push("export");
          return { project: { ...project, revision: project.revision + 1 } };
        },
        standalonePlayback: async () => failedCalls.push("standalone"),
        publication: async () => failedCalls.push("publication"),
      }),
    ).rejects.toThrow(/Export changed the project revision/);
    expect(failedCalls).toEqual(["export"]);

    await expect(
      runProjectFollowOnPhases({
        project,
        refresh: async () => structuredClone(project),
        exportProject: async () => ({
          project: { ...project, id: "different-project" },
        }),
        standalonePlayback: async () => undefined,
      }),
    ).rejects.toThrow(/Export changed the project identity/);
  });

  it("rejects a same-revision publication from a different project", () => {
    const expected: any = initialProject();
    const published = structuredClone(expected);
    published.messages = [{ role: "assistant", content: "stripped" }];
    expect(assertPublicationProjectMatches(published, expected)).toBe(published);

    const wrongProject = structuredClone(published);
    wrongProject.id = "another-project";
    expect(() =>
      assertPublicationProjectMatches(wrongProject, expected),
    ).toThrow(/changed the project identity/);

    const wrongRevision = structuredClone(published);
    wrongRevision.revision += 1;
    expect(() =>
      assertPublicationProjectMatches(wrongRevision, expected),
    ).toThrow(/changed the project revision/);
  });

  it("matches cloud and retained world content across revisions but rejects edits", () => {
    const ancestor: any = initialProject();
    ancestor.id = "same-project";
    ancestor.revision = 35;
    ancestor.messages = [
      { role: "user", content: "ancestor" },
      { role: "assistant", content: "assistant" },
    ];
    const retained = structuredClone(ancestor);
    retained.revision = 42;
    retained.messages = [];
    expect(assertPublicationWorldContentMatches(retained, ancestor)).toBe(
      retained,
    );

    const changedWorld = structuredClone(retained);
    changedWorld.entities[0].color = "#000000";
    expect(() =>
      assertPublicationWorldContentMatches(changedWorld, ancestor),
    ).toThrow(/changed the world content/);
  });

  it("matches the exported JSON shape when undefined entity fields are omitted", () => {
    const expected: any = initialProject();
    expected.entities[0].assetPolicy = "new-only";
    expected.entities[1].assetPolicy = undefined;
    expected.entities[2].assetPolicy = undefined;

    const exported = JSON.parse(JSON.stringify(expected));

    expect(exported.entities[0].assetPolicy).toBe("new-only");
    expect(Object.hasOwn(exported.entities[1], "assetPolicy")).toBe(false);
    expect(Object.hasOwn(exported.entities[2], "assetPolicy")).toBe(false);
    expect(assertPublicationProjectMatches(exported, expected)).toBe(exported);
  });

  it("still rejects explicit asset policy content changes after JSON normalization", () => {
    const expected: any = initialProject();
    expected.entities[0].assetPolicy = "new-only";
    expected.entities[1].assetPolicy = undefined;
    const exported = JSON.parse(JSON.stringify(expected));
    exported.entities[0].assetPolicy = "existing-only";

    expect(() => assertPublicationProjectMatches(exported, expected)).toThrow(
      /changed the published world content/,
    );
  });

  it("keeps the signed-in app wrapper separate from the published deployment iframe", () => {
    const appOrigin = "https://orbsie.example.test";
    const deploymentOrigin = PUBLICATION_ORIGIN.slice(0, -1);
    const approvedOrigins = new Set([appOrigin, deploymentOrigin]);
    const origins = assertPublicationPlaybackOrigins({
      wrapperUrl: `${appOrigin}/o/story-publication`,
      appOrigin,
      deploymentUrl: PUBLICATION_ORIGIN,
      iframeUrl: `${deploymentOrigin}/player/index.html`,
      approvedOrigins,
    });
    expect(origins.wrapper.origin).toBe(appOrigin);
    expect(origins.iframe.origin).toBe(deploymentOrigin);
    expect(() =>
      assertPublicationPlaybackOrigins({
        wrapperUrl: `${deploymentOrigin}/o/story-publication`,
        appOrigin,
        deploymentUrl: PUBLICATION_ORIGIN,
        iframeUrl: `${deploymentOrigin}/player/index.html`,
        approvedOrigins,
      }),
    ).toThrow(/wrapper changed the approved app origin/);
  });

  it("requires published gameplay to be present and bound to the current revision", () => {
    const project = { id: "published-world", revision: 42 };
    const targets = {
      platforms: ["platform-1", "platform-2", "platform-3"].map((id) => ({
        id,
      })),
      collectibles: [
        "crystal-1",
        "crystal-2",
        "crystal-3",
        "crystal-4",
        "crystal-5",
      ].map((id) => ({ id })),
      portal: { id: "portal" },
    };
    const gameplay: any = {
      status: "passed",
      projectId: project.id,
      revision: project.revision,
      expectedCollectibleIds: targets.collectibles.map(({ id }) => id),
      collectedIds: targets.collectibles.map(({ id }) => id),
      won: true,
      score: 5,
      contacts: [targets.portal.id],
      platformEvidence: targets.platforms.map(({ id }) => ({
        id,
        behavior: "bounce",
        groundedFrames: 0,
        bounceFrames: 1,
        maximumDisplacement: 0.1,
      })),
      win: {
        projectId: project.id,
        revision: project.revision,
        status: "won",
        score: 5,
      },
      reset: {
        projectId: project.id,
        revision: project.revision,
        status: "playing",
        score: 0,
        lifecycleAdvanced: true,
      },
    };
    expect(assertPublishedGameplayBinding(gameplay, project, targets)).toBe(
      gameplay,
    );
    expect(() =>
      assertPublishedGameplayBinding(undefined, project, targets),
    ).toThrow(/missing or did not pass/);
    expect(() =>
      assertPublishedGameplayBinding(
        { ...gameplay, revision: project.revision - 1 },
        project,
        targets,
      ),
    ).toThrow(/stale project revision/);
    expect(() =>
      assertPublishedGameplayBinding(
        {
          ...gameplay,
          reset: { ...gameplay.reset, revision: project.revision - 1 },
        },
        project,
        targets,
      ),
    ).toThrow(/reset observed a stale project revision/);
  });

  it("keeps ordinary publication READY without flagship gameplay", () => {
    const project = { id: "ordinary-world", revision: 12 };
    const report = publishedPlaybackReport({
      flagshipStory: false,
      project,
      revision: project.revision,
      artifactEvidence: { manifest: { projectId: project.id, revision: 12 } },
    });
    expect(report).toMatchObject({
      mode: "real",
      status: "READY",
      projectId: project.id,
      revision: project.revision,
      editorProviderRequests: 0,
      signedOut: true,
    });
    expect(report).not.toHaveProperty("gameplay");
    expect(() =>
      publishedPlaybackReport({
        flagshipStory: false,
        project,
        revision: project.revision,
        artifactEvidence: {},
        apiRequests: ["/api/generate"],
      }),
    ).toThrow(/editor\/provider request/);
  });

  it("blocks a failed flagship traversal while retaining deployment readiness", () => {
    const project = { id: "flagship-world", revision: 42 };
    const gameplay = {
      status: "failed",
      projectId: project.id,
      revision: project.revision,
      failureEvidence: { collections: ["crystal-1"] },
    };
    expect(
      publishedPlaybackReport({
        flagshipStory: true,
        project,
        revision: project.revision,
        artifactEvidence: { manifest: { projectId: project.id, revision: 42 } },
        gameplay,
      }),
    ).toMatchObject({
      mode: "blocked",
      status: "published-gameplay-failed",
      deploymentStatus: "READY",
      projectId: project.id,
      revision: project.revision,
      gameplay,
    });
  });

  it(
    "plays the retained five-crystal flagship world through a keyboard-focused iframe",
    async () => {
      const fixture = await serveRetainedFlagshipZipInIframe();
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      let context: BrowserContext | undefined;
      try {
        browser = await chromium.launch({
          headless: true,
          args: [
            "--no-sandbox",
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ],
        });
        context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
        });
        await context.addInitScript(() => {
          const testWindow = window as Window & {
            __ORBSIE_GAMEPLAY_READ_REQUESTED__?: boolean;
          };
          testWindow.__ORBSIE_GAMEPLAY_READ_REQUESTED__ = true;
        });
        const page = await context.newPage();
        const requests: string[] = [];
        page.on("request", (request) => requests.push(request.url()));
        await page.goto(`${fixture.wrapperOrigin}/wrapper.html`, {
          waitUntil: "domcontentloaded",
        });
        const iframe = page.locator("iframe");
        await iframe.waitFor({ state: "visible", timeout: 30000 });
        const iframeElement = await iframe.elementHandle();
        if (!iframeElement)
          throw new Error("Published fixture iframe is missing.");
        const frame = await iframeElement.contentFrame();
        if (!frame) throw new Error("Published fixture iframe has no document.");
        expect(frame.url()).toBe(`${fixture.playerOrigin}/index.html`);
        expect(new URL(frame.url()).origin).toBe(fixture.playerOrigin);
        expect(new URL(page.url()).origin).toBe(fixture.wrapperOrigin);
        expect(fixture.playerOrigin).not.toBe(fixture.wrapperOrigin);
        await frame
          .locator("main[data-ready=true]")
          .waitFor({ state: "visible", timeout: 30000 });

        const gameplayPage = createPublishedGameplayPageAdapter(frame, page);
        const gameplay = await runFreshFlagshipGameplay(
          gameplayPage,
          fixture.project,
          fixture.story,
          {
            surface: "standalone",
            inputMode: "keyboard",
            expectedCollectibleCount: 5,
            expectedRevision: fixture.project.revision,
          },
        );
        const bound = assertPublishedGameplayBinding(
          gameplay,
          fixture.project,
          fixture.story,
        );
        expect(bound.movement.distance).toBeGreaterThan(0.12);
        expect(bound.collectedIds).toHaveLength(5);
        expect(bound.contacts).toContain(fixture.story.portal.id);
        expect(bound.win.score).toBe(5);
        expect(bound.reset).toMatchObject({
          score: 0,
          status: "playing",
          lifecycleAdvanced: true,
        });
        expect(
          bound.platformEvidence.filter(
            (platform: any) => platform.behavior === "bounce",
          ),
        ).toHaveLength(3);
        expect(
          bound.platformEvidence.every(
            (platform: any) =>
              platform.bounceFrames > 0 && platform.maximumDisplacement >= 0.05,
          ),
        ).toBe(true);
        const allowedOrigins = new Set([
          fixture.wrapperOrigin,
          fixture.playerOrigin,
        ]);
        expect(
          requests.filter((url) => !allowedOrigins.has(new URL(url).origin)),
        ).toEqual([]);
        expect(
          requests.filter((url) =>
            ["/api/", "/generate", "/health"].some((path) =>
              new URL(url).pathname.startsWith(path),
            ),
          ),
        ).toEqual([]);
      } finally {
        await context?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
        await fixture.close();
      }
    },
    180_000,
  );

  it("accepts fresh runtime and geometry worker bytes independently of the manifest", async () => {
    const expected = initialProject();
    const fixture = publicationFixture({ project: expected });
    const evidence = await verifyFreshPublicationArtifacts({
      deploymentUrl: PUBLICATION_ORIGIN,
      approvedOrigins: new Set([PUBLICATION_ORIGIN.slice(0, -1)]),
      projectId: expected.id,
      revision: expected.revision,
      expectedArtifacts: fixture.expectedArtifacts,
      targetArtifacts: fixture.targetArtifacts,
      fetchImpl: fixture.fetchImpl,
    });
    const evidenceFiles = evidence.files as Record<string, unknown>;
    expect(evidenceFiles["runtime.js"]).toEqual({
      target: fixture.targetArtifacts["runtime.js"],
      expected: fixture.expectedArtifacts["runtime.js"],
      observed: fixture.expectedArtifacts["runtime.js"],
    });
    expect(evidenceFiles["generated-geometry-worker.js"]).toEqual({
      target: fixture.targetArtifacts["generated-geometry-worker.js"],
      expected: fixture.expectedArtifacts["generated-geometry-worker.js"],
      observed: fixture.expectedArtifacts["generated-geometry-worker.js"],
    });
    expect(fixture.calls.every(({ init }) => init.credentials === "omit")).toBe(
      true,
    );
    expect(fixture.calls.every(({ init }) => init.redirect === "manual")).toBe(
      true,
    );
    expect(fixture.calls.every(({ init }) => init.headers === undefined)).toBe(
      true,
    );
  });

  it("binds the export to independently captured current player bytes", async () => {
    const fixture = publicationFixture();
    const targetArtifacts = await captureCurrentTargetArtifacts({
      appOrigin: PUBLICATION_ORIGIN,
      approvedOrigins: new Set([PUBLICATION_ORIGIN.slice(0, -1)]),
      fetchImpl: fixture.fetchImpl,
    });
    expect(targetArtifacts).toEqual(fixture.expectedArtifacts);

    const staleExport = structuredClone(fixture.expectedArtifacts);
    staleExport["runtime.js"] = {
      bytes: 5,
      sha256: "0".repeat(64),
    };
    await expect(
      verifyFreshPublicationArtifacts({
        deploymentUrl: PUBLICATION_ORIGIN,
        approvedOrigins: new Set([PUBLICATION_ORIGIN.slice(0, -1)]),
        projectId: "project",
        revision: 1,
        expectedArtifacts: staleExport,
        targetArtifacts,
        fetchImpl: fixture.fetchImpl,
      }),
    ).rejects.toThrow(/fresh-export-target-mismatch:runtime\.js/);
  });

  it("rejects a stale runtime even when the manifest reports fresh hashes", async () => {
    const fixture = publicationFixture({
      runtime: "stale runtime",
      manifestRuntime: "fresh runtime",
    });
    await expect(
      verifyFreshPublicationArtifacts({
        deploymentUrl: PUBLICATION_ORIGIN,
        approvedOrigins: new Set([PUBLICATION_ORIGIN.slice(0, -1)]),
        projectId: "project",
        revision: 1,
        expectedArtifacts: fixture.expectedArtifacts,
        targetArtifacts: fixture.targetArtifacts,
        fetchImpl: fixture.fetchImpl,
      }),
    ).rejects.toThrow(/published-artifact-mismatch:runtime\.js/);
  });

  it("rejects a missing geometry worker before publication can pass", async () => {
    const fixture = publicationFixture({
      missing: ["asset-geometry-worker.js"],
    });
    await expect(
      verifyFreshPublicationArtifacts({
        deploymentUrl: PUBLICATION_ORIGIN,
        approvedOrigins: new Set([PUBLICATION_ORIGIN.slice(0, -1)]),
        projectId: "project",
        revision: 1,
        expectedArtifacts: fixture.expectedArtifacts,
        targetArtifacts: fixture.targetArtifacts,
        fetchImpl: fixture.fetchImpl,
      }),
    ).rejects.toThrow(/published-artifact-missing:asset-geometry-worker\.js/);
  });

  it.each([
    ["malformed manifest", { malformedManifest: true }, /manifest-malformed/],
    [
      "oversized runtime",
      { oversized: "runtime.js" },
      /response-oversized:runtime\.js/,
    ],
    [
      "oversized streaming runtime without a content length",
      { streamOversized: "runtime.js" },
      /response-oversized:runtime\.js/,
    ],
  ])("rejects a %s response", async (_label, options, expectedError) => {
    const fixture = publicationFixture(
      options as {
        malformedManifest?: boolean;
        oversized?: string;
        streamOversized?: string;
      },
    );
    await expect(
      verifyFreshPublicationArtifacts({
        deploymentUrl: PUBLICATION_ORIGIN,
        approvedOrigins: new Set([PUBLICATION_ORIGIN.slice(0, -1)]),
        projectId: "project",
        revision: 1,
        expectedArtifacts: fixture.expectedArtifacts,
        targetArtifacts: fixture.targetArtifacts,
        fetchImpl: fixture.fetchImpl,
      }),
    ).rejects.toThrow(expectedError);
  });

  it("rejects redirects and deployment origins outside the approved set", async () => {
    const fixture = publicationFixture({ redirect: "runtime.js" });
    const approvedOrigins = new Set([PUBLICATION_ORIGIN.slice(0, -1)]);
    await expect(
      verifyFreshPublicationArtifacts({
        deploymentUrl: PUBLICATION_ORIGIN,
        approvedOrigins,
        projectId: "project",
        revision: 1,
        expectedArtifacts: fixture.expectedArtifacts,
        targetArtifacts: fixture.targetArtifacts,
        fetchImpl: fixture.fetchImpl,
      }),
    ).rejects.toThrow(/published-artifact-redirect:runtime\.js/);
    await expect(
      verifyFreshPublicationArtifacts({
        deploymentUrl: "https://outside.example.test/",
        approvedOrigins,
        projectId: "project",
        revision: 1,
        expectedArtifacts: fixture.expectedArtifacts,
        targetArtifacts: fixture.targetArtifacts,
        fetchImpl: fixture.fetchImpl,
      }),
    ).rejects.toThrow(/origin-not-approved/);
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
    expect(mushroomCheck.rawBoundsExpanded).toBe(true);
    expect(mushroomCheck.transformedBoundsExpanded).toBe(true);
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

  it("accepts the saved moving-bounce story and rejects inert path variants", () => {
    const project = currentGatewayStory();
    const initial = assertFlagshipStoryCreation(project);
    expect(initial.platforms.map((candidate: any) => candidate.id)).toEqual([
      "platform-1",
      "platform-2",
      "platform-3",
    ]);

    const variants = [
      (candidate: any) => {
        const rule = candidate.game.rules.find(
          (entry: any) => entry.id === "move-platform-1",
        );
        rule.actions = [];
      },
      (candidate: any) => {
        const action = candidate.game.rules
          .find((entry: any) => entry.id === "move-platform-1")
          .actions.find((entry: any) => entry.type === "move_path");
        action.entityId = "tree-1";
      },
      (candidate: any) => {
        const action = candidate.game.rules
          .find((entry: any) => entry.id === "move-platform-1")
          .actions.find((entry: any) => entry.type === "move_path");
        action.points = [action.points[0], action.points[0]];
      },
    ];
    for (const mutate of variants) {
      const invalid = structuredClone(project);
      mutate(invalid);
      expect(() => assertFlagshipStoryCreation(invalid)).toThrow(
        /three moving platforms/,
      );
    }
  });

  it("accepts bounded timer paths in the saved OpenRouter rev28 story", () => {
    const sourceBytes = readFileSync(
      resolve(
        "docs/evidence/provider-e2e/openrouter-flagship-live-33b7289-20260925/openrouter/story-created-project.json",
      ),
    );
    expect(createHash("sha256").update(sourceBytes).digest("hex")).toBe(
      "c2e7a48265891b59246663f79f208d309ee9dbc1fffd93e2f122140bcd005dd7",
    );
    const project = JSON.parse(sourceBytes.toString("utf8"));
    const story = assertFlagshipStoryCreation(project);
    expect(story.platforms.map((platform: any) => platform.id)).toEqual([
      "platform-a",
      "platform-b",
      "platform-c",
    ]);

    const findMotionRule = (candidate: any, entityId = "platform-a") =>
      candidate.game.rules.find((rule: any) =>
        rule.actions.some(
          (action: any) =>
            action.type === "move_path" && action.entityId === entityId,
        ),
      );
    const findMotionPath = (candidate: any, entityId = "platform-a") =>
      findMotionRule(candidate, entityId).actions.find(
        (action: any) =>
          action.type === "move_path" && action.entityId === entityId,
      );
    const originalMotionRule = findMotionRule(project);
    expect(originalMotionRule.trigger).toEqual({
      type: "timer",
      seconds: 4,
      repeat: true,
    });
    expect(originalMotionRule.conditions).toEqual([]);

    const acceptedOneShotTimer = structuredClone(project);
    findMotionRule(acceptedOneShotTimer).trigger.repeat = false;
    expect(
      assertFlagshipStoryCreation(acceptedOneShotTimer).platforms,
    ).toHaveLength(3);

    const acceptedTimerBoundary = structuredClone(project);
    findMotionRule(acceptedTimerBoundary).trigger.seconds = 5;
    expect(
      assertFlagshipStoryCreation(acceptedTimerBoundary).platforms,
    ).toHaveLength(3);

    const acceptedStartTrigger = structuredClone(project);
    findMotionRule(acceptedStartTrigger).trigger = { type: "start" };
    expect(
      assertFlagshipStoryCreation(acceptedStartTrigger).platforms,
    ).toHaveLength(3);

    const slowedTimerPath = structuredClone(project);
    const middleRule = findMotionRule(slowedTimerPath, "platform-b");
    middleRule.actions.find(
      (action: any) =>
        action.type === "move_path" && action.entityId === "platform-b",
    ).duration += 0.5;
    const originalCollectRule = slowedTimerPath.game.rules.find(
      (rule: any) =>
        rule.trigger?.type === "collect" &&
        rule.trigger.entityId === "crystal-1",
    );
    for (const index of [6, 7]) {
      const crystal = structuredClone(
        slowedTimerPath.entities.find((item: any) => item.id === "crystal-1"),
      );
      crystal.id = `crystal-${index}`;
      crystal.label = `Glowing crystal ${index}`;
      slowedTimerPath.entities.push(crystal);
      const collectRule = structuredClone(originalCollectRule);
      collectRule.id = `crystal${index}`;
      collectRule.trigger.entityId = crystal.id;
      slowedTimerPath.game.rules.push(collectRule);
    }
    const portalRule = slowedTimerPath.game.rules.find((rule: any) =>
      rule.actions.some((action: any) => action.type === "win"),
    );
    portalRule.conditions.find(
      (condition: any) =>
        condition.operand?.type === "variable" &&
        condition.operand.name === "crystals",
    ).value = 7;
    const slowdownEvidence = assertFlagshipStoryPlatform(
      project,
      slowedTimerPath,
      "platform-b",
    );
    if (!("previousPathDuration" in slowdownEvidence))
      throw Error("Expected timer path slowdown evidence");
    expect(slowdownEvidence.previousPathDuration).toBe(4);
    expect(slowdownEvidence.revisedPathDuration).toBe(4.5);

    const rejectedVariants = [
      (candidate: any) => {
        findMotionRule(candidate).trigger.seconds = 0;
      },
      (candidate: any) => {
        findMotionRule(candidate).trigger.seconds = 5.01;
      },
      (candidate: any) => {
        findMotionRule(candidate).trigger.repeat = "often";
      },
      (candidate: any) => {
        findMotionRule(candidate).conditions = [
          {
            operand: { type: "score" },
            comparison: "gte",
            value: 0,
          },
        ];
      },
      (candidate: any) => {
        findMotionRule(candidate).trigger = {
          type: "collision",
          entityId: "portal",
        };
      },
      (candidate: any) => {
        const path = findMotionPath(candidate);
        path.points = [path.points[0], path.points[0]];
      },
      (candidate: any) => {
        findMotionPath(candidate).duration = 3601;
      },
      (candidate: any) => {
        const path = findMotionPath(candidate);
        findMotionRule(candidate).actions.push(structuredClone(path));
      },
    ];
    for (const mutate of rejectedVariants) {
      const invalid = structuredClone(project);
      mutate(invalid);
      expect(() => assertFlagshipStoryCreation(invalid)).toThrow(
        /three moving platforms|conflicting motion writers/,
      );
    }
  });

  it("requires a slower path duration and preserves the moving-bounce story rules", () => {
    const before = currentGatewayStory();
    const slowed = addGatewayGoalSevenEdit(before, 1.1);
    const check = assertFlagshipStoryPlatform(before, slowed, "platform-2");
    if (!("previousPathDuration" in check)) throw Error("Expected path slowdown evidence");
    expect(check.previousPathDuration).toBe(2.2);
    expect(check.revisedPathDuration).toBeCloseTo(3.3);
    expect(check.collectibles).toBe(7);

    const speedOnly = addGatewayGoalSevenEdit(before);
    speedOnly.entities.find(
      (candidate: any) => candidate.id === "platform-2",
    ).behavior.speed = 0.5;
    expect(() =>
      assertFlagshipStoryPlatform(before, speedOnly, "platform-2"),
    ).toThrow(/path duration did not increase/);

    const movePathBefore = currentGatewayStory();
    movePathBefore.entities.find(
      (candidate: any) => candidate.id === "platform-2",
    ).behavior.type = "move";
    const movePathSlowed = addGatewayGoalSevenEdit(movePathBefore, 1.1);
    const movePathCheck = assertFlagshipStoryPlatform(
      movePathBefore,
      movePathSlowed,
      "platform-2",
    );
    if (!("revisedPathDuration" in movePathCheck)) throw Error("Expected path slowdown evidence");
    expect(movePathCheck.revisedPathDuration).toBeCloseTo(3.3);
    const movePathSpeedOnly = addGatewayGoalSevenEdit(movePathBefore);
    movePathSpeedOnly.entities.find(
      (candidate: any) => candidate.id === "platform-2",
    ).behavior.speed = 0.5;
    expect(() =>
      assertFlagshipStoryPlatform(
        movePathBefore,
        movePathSpeedOnly,
        "platform-2",
      ),
    ).toThrow(/path duration did not increase/);

    const tenPointBefore = currentGatewayStory();
    for (const rule of tenPointBefore.game.rules) {
      if (rule.trigger?.type !== "collect") continue;
      rule.actions.find((action: any) => action.type === "add_score").amount = 10;
    }
    const tenPointSlowed = addGatewayGoalSevenEdit(tenPointBefore, 1.1);
    expect(() =>
      assertFlagshipStoryPlatform(tenPointBefore, tenPointSlowed, "platform-2"),
    ).not.toThrow();
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
    expect(check.dimensions).toMatchObject({
      status: "inconclusive",
      source: { before: "catalog", after: "missing" },
    });
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
    expect(check.transformedBoundsExpanded).toBe(true);
    expect(check.dimensions).toMatchObject({
      status: "observed",
      source: { before: "catalog", after: "catalog" },
    });
    expect(check.sizeVisualReview).toBe("pending");
  });

  it("uses catalog bounds for the captured giant mushroom dimensions", () => {
    const before = JSON.parse(
      readFileSync(
        "docs/evidence/provider-e2e/gateway-current-full-story/gateway/story-created-project.json",
        "utf8",
      ),
    );
    const after = JSON.parse(
      readFileSync(CAPTURED_GATEWAY_STORY, "utf8"),
    );
    const check = assertFlagshipStoryMushroom(before, after, "tree-1");
    expect(check.transformedBoundsExpanded).toBe(true);
    expect(check.dimensions).toMatchObject({
      status: "observed",
      source: { before: "catalog", after: "catalog" },
    });
    expect(check.dimensions.before).toEqual([
      expect.closeTo(1.0570000756, 6),
      expect.closeTo(2.391042374, 6),
      expect.closeTo(0.9153886, 6),
    ]);
    expect(check.dimensions.after).toEqual([
      2.4355410114000002,
      2.8392,
      2.812319972,
    ]);
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
        entity("generated-a", "Generated A", {
          kind: "generated",
          detail: "refined",
          model: { sha256, bytes: glb.byteLength },
        }),
        entity("generated-b", "Generated B", {
          kind: "generated",
          detail: "refined",
          model: { sha256, bytes: glb.byteLength },
        }),
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
