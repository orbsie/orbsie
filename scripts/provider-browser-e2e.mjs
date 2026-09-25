#!/usr/bin/env node
import {
  installGenerationDiagnosticObserver,
  readGenerationDiagnostics,
} from "./lib/generation-diagnostic-observer.mjs";
import {
  HOSTED_EFFORT,
  HOSTED_FLAGSHIP_TEST_LIMITS,
  HOSTED_MODEL,
  HOSTED_PROVIDER,
  HOSTED_TEST_LIMITS,
  HostedAcceptanceBlockedError,
  assertHostedGenerationPayload,
  assertHostedModelCatalog,
  assertHostedPreflight,
  filterHostedStorageState,
  hostedRouteDecision,
  statusFirstHostedGate,
  validateHostedNDJSON,
} from "./lib/hosted-chatgpt-acceptance.mjs";
import { loadHostedProjectValidator } from "./lib/hosted-project-validator.mjs";
import {
  collectProviderBrowserE2EProvenance,
  parseApplicationSourceCommit,
} from "./lib/provider-browser-e2e-provenance.mjs";
import {
  FRESH_GAMEPLAY_LIMITS,
  buildFreshGameplayTargets,
  chooseGameplayKeys,
  chooseGameplayJumpKeys,
  chooseGameplayPlatformAction,
  chooseGameplaySteeringKeys,
  detectDescendingPlatformSurfaceCrossing,
  generationStreamIsOpen,
  gameplaySupportId,
  observePlatformContact,
  orderFreshGameplayCollectiblesFromSupport,
  platformContactProgress,
  portalCompletionIsAuthoritative,
  retainFreshGameplayJumpSample,
  summarizeFreshGameplayRun,
  validateGenerationMovementObservation,
  validateFreshGameplayObservation,
  waitForFreshGameplayObservation,
} from "./lib/fresh-flagship-gameplay.mjs";
import { flagshipJourneyAcceptance } from "./lib/flagship-journey-acceptance.mjs";
import { createTraversalTouchInput } from "./lib/traversal-touch-input.mjs";

/**
 * Opt-in, provider-backed browser acceptance harness.
 *
 * This file deliberately has no fixture transport. In live mode the browser
 * talks to the configured Orbsie origin (or the loopback ChatGPT companion)
 * and every generation response is consumed by the real store/reducer.
 *
 * The safety gates at the top are intentionally strict. Running this script
 * without ORBSIE_LIVE_E2E=1 must fail before Chromium starts and before any
 * credential environment variable is read.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

const PROVIDERS = new Set([
  "openrouter",
  "gateway",
  "free",
  "chatgpt-local",
  HOSTED_PROVIDER,
]);
const PUBLIC_GENERATION_PROVIDERS = new Set(["openrouter", "gateway", "free"]);
const KEY_SCOPES = new Set(["local-only", "cloud-authorized"]);
const DEFAULT_PROMPT =
  "Build a tiny island with one tree and one crystal. Keep it simple and commit the world.";
const DEFAULT_EDIT =
  "Change only the selected entity to bright pink #ff44aa. Preserve its geometry and every unrelated entity and environment. Commit the edit.";
const INPUT_GAME_PROMPT =
  "Create a complete tiny scene with exactly two genuinely original geometry objects: one tree and one mushroom. Use browser-manifold recipes (including custom mesh) or browser procedural/custom geometry only; do not use catalog assets, native Blender jobs, or remote URLs. Finish both entities as ready refined geometry, and preserve a simple playable presentation. Then define exactly three input game rules: right adds score 7, up wins, and left loses. Use no timers, collection triggers, or collection scoring. Commit the world.";
const INPUT_GAME_EDIT =
  "Change only the selected entity's material to bright pink #ff44aa. Preserve its geometry, position, behavior, the complete three-rule input game, the other entity, and the environment. Commit the edit.";
const FLAGSHIP_STORY_PROMPT =
  "Make a sunny little island game where I collect five glowing crystals, bounce across three moving platforms, and reach a portal. Add friendly trees and a pond.";
const FLAGSHIP_STORY_MUSHROOM_PROMPT = "Make this a giant pink mushroom";
const FLAGSHIP_STORY_PLATFORM_PROMPT =
  "Make the middle platform slower and add two more crystals";
const STORY_CATALOG_ASSETS = new Map(
  JSON.parse(readFileSync(resolve("assets/catalog/manifest.json"), "utf8")).assets.map(
    (asset) => [asset.id, asset],
  ),
);
const STORY_TREE_LABEL_KINDS = new Set(["generated", "custom"]);
const STORY_MUSHROOM_LABEL_KINDS = new Set(["generated", "custom"]);
const FLAGSHIP_RESUME_ARTIFACT_MODES = new Set(["reconstructed", "captured"]);
const REPORT_DIR = resolve(
  process.env.ORBSIE_EVIDENCE_DIR ?? "docs/evidence/provider-e2e",
);
const SOURCE_ROOT = resolve(".");
const REPORT_MODE = "live-browser";
const JOURNAL_POLL_TIMEOUT = 120000;
const PUBLICATION_MANIFEST_FILE = "publication-manifest.json";
const PUBLICATION_ARTIFACT_PATHS = [
  "runtime.js",
  "runtime.css",
  "generated-geometry-worker.js",
  "asset-geometry-worker.js",
];
const PUBLICATION_ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;
const PUBLICATION_FETCH_TIMEOUT_MS = 5000;
const INTERRUPTION_METHODS = new Set(["stop", "reload"]);
const INTERRUPTED_RECOVERY_PROVIDERS = new Set([
  "openrouter",
  "gateway",
  "chatgpt-local",
  HOSTED_PROVIDER,
]);
const INTERRUPTED_GENERATION_BUDGET = 3;

class HarnessConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "HarnessConfigurationError";
  }
}

class HarnessBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "HarnessBlockedError";
  }
}

export async function probePublicGenerateOrigin(apiRequest, baseOrigin) {
  let response;
  try {
    response = await apiRequest.post(
      new URL("/api/generate", baseOrigin).href,
      {
        data: {},
        headers: { Origin: baseOrigin },
        maxRedirects: 0,
        timeout: 10000,
      },
    );
  } catch {
    return {
      status: "blocked",
      method: "POST",
      path: "/api/generate",
      expectedStatus: 400,
      httpStatus: null,
      requestCount: 1,
      responseBodyRetained: false,
      error:
        "Generate origin preflight could not reach the local endpoint; check that ORBSIE_TEST_URL matches the server origin. Provider setup was blocked.",
    };
  }

  const httpStatus = response.status();
  try {
    await response.dispose();
  } catch {
    return {
      status: "blocked",
      method: "POST",
      path: "/api/generate",
      expectedStatus: 400,
      httpStatus,
      requestCount: 1,
      responseBodyRetained: false,
      error:
        "Generate origin preflight response could not be discarded safely; provider setup was blocked.",
    };
  }

  if (httpStatus === 400)
    return {
      status: "passed",
      method: "POST",
      path: "/api/generate",
      expectedStatus: 400,
      httpStatus,
      requestCount: 1,
      responseBodyRetained: false,
    };

  return {
    status: "blocked",
    method: "POST",
    path: "/api/generate",
    expectedStatus: 400,
    httpStatus,
    requestCount: 1,
    responseBodyRetained: false,
    error:
      httpStatus === 403
        ? "Generate origin preflight was rejected (HTTP 403). ORBSIE_TEST_URL, the app server origin, and BETTER_AUTH_URL must match exactly, including hostname and port; provider setup was blocked."
        : `Generate origin preflight expected HTTP 400 from schema rejection, received HTTP ${httpStatus}; provider setup was blocked. Check the server origin and API configuration.`,
  };
}

async function requirePublicGenerateOrigin(page, config, report) {
  if (!PUBLIC_GENERATION_PROVIDERS.has(config.provider)) return;
  if (report.originPreflight?.status === "passed") return;
  const result = await probePublicGenerateOrigin(
    page.context().request,
    config.baseOrigin,
  );
  report.originPreflight = result;
  if (result.status !== "passed")
    throw new HarnessBlockedError(result.error);
}

function isBlockedError(error) {
  return (
    error instanceof HarnessBlockedError ||
    error instanceof HostedAcceptanceBlockedError
  );
}

export function flagshipResumeExecutionMode(config) {
  if (!config.flagshipResume) return "fresh";
  if (config.flagshipResumeOffline) return "offline";
  return config.flagshipResumeStage === "creation" ? "creation" : "checkpoint";
}

function parseArgs(argv) {
  const result = { provider: undefined, publication: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--provider") {
      result.provider = argv[++i];
    } else if (arg.startsWith("--provider=")) {
      result.provider = arg.slice("--provider=".length);
    } else if (arg === "--publication") {
      result.publication = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: ORBSIE_LIVE_E2E=1 ORBSIE_TEST_URL=http://127.0.0.1:3001 \\",
          "  ORBSIE_EXPECTED_MODEL=<exact-catalog-id> \\",
          "  ORBSIE_KEY_SCOPE=local-only|cloud-authorized \\",
          "  ORBSIE_OUTPUT_CAP_TOKENS=<bounded-cap> (API-key providers only) \\",
          "  node scripts/provider-browser-e2e.mjs --provider openrouter|gateway|free|chatgpt-local|chatgpt-hosted",
          `Hosted ChatGPT additionally requires ORBSIE_ACCOUNT_STORAGE_STATE=<private-mode-0600-state>, an exact HTTPS ORBSIE_TEST_URL, and ORBSIE_CHATGPT_TEST_LIMITS=${HOSTED_TEST_LIMITS} (or ${HOSTED_FLAGSHIP_TEST_LIMITS} for the fresh flagship story or interrupted recovery) after explicit owner approval of the actual bounds; ORBSIE_OUTPUT_CAP_TOKENS must be unset.`,
          "",
          "Set ORBSIE_REQUIRE_BROWSER_MODEL=1 for browser-manifold creation; add ORBSIE_REQUIRE_REVOLUTION=1 and ORBSIE_REQUIRE_GEOMETRY_EDIT=1 for a trusted revolve edit.",
          "Add --publication or ORBSIE_VERIFY_CLOUD_RECOVERY=1 (and ORBSIE_CLOUD_TEST_STATE) only for an explicitly authorized real cloud check.",
          "Add ORBSIE_VERIFY_INTERRUPTED_RECOVERY=1 only with ORBSIE_VERIFY_CLOUD_RECOVERY=1, ORBSIE_INTERRUPTED_GENERATION_BUDGET=3, and an explicitly supported provider.",
          "Set ORBSIE_INTERRUPTION_METHOD=reload for the page-reload interruption variant; stop is the default.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new HarnessConfigurationError(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function isLoopbackHostname(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function parsePositiveInteger(value, name) {
  if (!/^\d+$/.test(value ?? ""))
    throw new HarnessConfigurationError(`${name} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new HarnessConfigurationError(`${name} must be a positive integer.`);
  return parsed;
}

function validModelId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.:/-]{1,150}$/.test(value);
}

function explicitlyRequestsNew(prompt) {
  const positive =
    /\bfrom\s+scratch\b|\bbrand[- ]new\b|\b(?:original|new)\s+(?:model|mesh|geometry|asset|object|shape|form)\b|\bwithout\b[^.!?;\n]{0,50}\b(?:catalog|library|prepared|stock|existing)\b/i;
  const preserved =
    /\b(?:keep|preserve|retain|leave)\b[^.!?;\n]{0,50}\b(?:original|existing)\s+(?:model|mesh|geometry|asset|object|shape|form)\b/i;
  const forbidden =
    /\b(?:don't|do not|never|avoid)\b[^.!?;\n]{0,50}\b(?:generate|create|build|make|use|reuse|select|choose)\w*\b[^.!?;\n]{0,35}\b(?:brand[- ]new|new|original)\s+(?:model|mesh|geometry|asset|object|shape|form)\b/i;
  return prompt.split(/[.!?;\n]|\b(?:but|however|then)\b/i).some((clause) => {
    if (preserved.test(clause) || forbidden.test(clause)) return false;
    return positive.test(clause);
  });
}

export function readConfiguration(argv) {
  // Keep this check before all key/token reads. A normal syntax check or an
  // accidental invocation cannot inspect provider credentials.
  if (process.env.ORBSIE_LIVE_E2E !== "1")
    throw new HarnessConfigurationError(
      "Refusing live provider E2E: set ORBSIE_LIVE_E2E=1 explicitly.",
    );

  const args = parseArgs(argv);
  const provider = args.provider;
  if (!PROVIDERS.has(provider))
    throw new HarnessConfigurationError(
      "--provider is required and must be openrouter, gateway, free, chatgpt-local, or chatgpt-hosted.",
    );
  const flagshipStoryValue = process.env.ORBSIE_FLAGSHIP_STORY;
  if (
    flagshipStoryValue !== undefined &&
    !["0", "1"].includes(flagshipStoryValue)
  )
    throw new HarnessConfigurationError(
      "ORBSIE_FLAGSHIP_STORY must be 0 or 1.",
    );
  const flagshipStory = flagshipStoryValue === "1";
  const mushroomReplacementValue = process.env.ORBSIE_MUSHROOM_REPLACEMENT;
  if (
    mushroomReplacementValue !== undefined &&
    !["0", "1"].includes(mushroomReplacementValue)
  )
    throw new HarnessConfigurationError(
      "ORBSIE_MUSHROOM_REPLACEMENT must be 0 or 1.",
    );
  const mushroomReplacement = mushroomReplacementValue === "1";
  if (mushroomReplacement) {
    if (args.publication)
      throw new HarnessConfigurationError(
        "ORBSIE_MUSHROOM_REPLACEMENT=1 cannot be combined with --publication; use the bounded replacement contract instead of a publication phase.",
      );
    const incompatible = [
      "ORBSIE_FLAGSHIP_STORY",
      "ORBSIE_FLAGSHIP_RESUME",
      "ORBSIE_REQUIRE_GEOMETRY_EDIT",
      "ORBSIE_REQUIRE_BROWSER_MODEL",
      "ORBSIE_REQUIRE_NEW_ONLY",
      "ORBSIE_REQUIRE_EXTRUSION",
      "ORBSIE_REQUIRE_REVOLUTION",
      "ORBSIE_REQUIRE_PROCEDURAL",
      "ORBSIE_REQUIRE_INPUT_GAME",
      "ORBSIE_REAL_PUBLICATION",
      "ORBSIE_VERIFY_CLOUD_RECOVERY",
      "ORBSIE_VERIFY_INTERRUPTED_RECOVERY",
      "ORBSIE_BUILDER_URL",
      "ORBSIE_BUILDER_TOKEN",
    ].find(
      (name) =>
        process.env[name] === "1" ||
        ((name === "ORBSIE_BUILDER_URL" || name === "ORBSIE_BUILDER_TOKEN") &&
          process.env[name] !== undefined),
    );
    if (incompatible)
      throw new HarnessConfigurationError(
        `ORBSIE_MUSHROOM_REPLACEMENT=1 cannot be combined with ${incompatible}; use the bounded replacement contract instead of a generic recipe or recovery gate.`,
      );
  }
  const flagshipResumeValue = process.env.ORBSIE_FLAGSHIP_RESUME;
  if (
    flagshipResumeValue !== undefined &&
    !["0", "1"].includes(flagshipResumeValue)
  )
    throw new HarnessConfigurationError(
      "ORBSIE_FLAGSHIP_RESUME must be 0 or 1.",
    );
  const flagshipResume = flagshipResumeValue === "1";
  const flagshipResumeStageValue = process.env.ORBSIE_FLAGSHIP_RESUME_STAGE;
  if (
    flagshipResumeStageValue !== undefined &&
    !["creation", "mushroom"].includes(flagshipResumeStageValue)
  )
    throw new HarnessConfigurationError(
      "ORBSIE_FLAGSHIP_RESUME_STAGE must be creation or mushroom.",
    );
  if (flagshipResumeStageValue !== undefined && !flagshipResume)
    throw new HarnessConfigurationError(
      "ORBSIE_FLAGSHIP_RESUME_STAGE requires ORBSIE_FLAGSHIP_RESUME=1.",
    );
  const flagshipResumeStage = flagshipResume
    ? (flagshipResumeStageValue ?? "mushroom")
    : undefined;
  const flagshipResumeArtifactModeValue =
    process.env.ORBSIE_FLAGSHIP_RESUME_ARTIFACT_MODE;
  if (
    flagshipResumeArtifactModeValue !== undefined &&
    !FLAGSHIP_RESUME_ARTIFACT_MODES.has(flagshipResumeArtifactModeValue)
  )
    throw new HarnessConfigurationError(
      "ORBSIE_FLAGSHIP_RESUME_ARTIFACT_MODE must be reconstructed or captured.",
    );
  if (flagshipResumeArtifactModeValue !== undefined && !flagshipResume)
    throw new HarnessConfigurationError(
      "ORBSIE_FLAGSHIP_RESUME_ARTIFACT_MODE requires ORBSIE_FLAGSHIP_RESUME=1.",
    );
  const flagshipResumeArtifactMode = flagshipResume
    ? (flagshipResumeArtifactModeValue ?? "reconstructed")
    : undefined;
  const flagshipResumeOfflineValue = process.env.ORBSIE_FLAGSHIP_RESUME_OFFLINE;
  if (
    flagshipResumeOfflineValue !== undefined &&
    !["0", "1"].includes(flagshipResumeOfflineValue)
  )
    throw new HarnessConfigurationError(
      "ORBSIE_FLAGSHIP_RESUME_OFFLINE must be 0 or 1.",
    );
  const flagshipResumeOffline = flagshipResumeOfflineValue === "1";
  if (flagshipResumeOffline && !flagshipResume)
    throw new HarnessConfigurationError(
      "ORBSIE_FLAGSHIP_RESUME_OFFLINE=1 requires ORBSIE_FLAGSHIP_RESUME=1.",
    );
  if (flagshipStory && flagshipResume)
    throw new HarnessConfigurationError(
      "ORBSIE_FLAGSHIP_STORY and ORBSIE_FLAGSHIP_RESUME cannot be combined.",
    );
  if (flagshipResumeOffline && flagshipResumeStage === "creation")
    throw new HarnessConfigurationError(
      "Creation-stage flagship resume requires live edit calls and cannot use offline resume.",
    );
  if (
    flagshipResumeArtifactMode === "captured" &&
    (!flagshipResumeOffline || flagshipResumeStage !== "mushroom")
  )
    throw new HarnessConfigurationError(
      "Captured flagship artifacts require offline mushroom-stage resume.",
    );
  if (
    flagshipStory &&
    !new Set(["openrouter", "gateway", HOSTED_PROVIDER]).has(provider)
  )
    throw new HarnessConfigurationError(
      "ORBSIE_FLAGSHIP_STORY=1 is authorized only for OpenRouter, Gateway, or hosted ChatGPT.",
    );
  if (flagshipResume && provider !== "gateway")
    throw new HarnessConfigurationError(
      "ORBSIE_FLAGSHIP_RESUME=1 is authorized only for the Gateway provider.",
    );
  if (
    flagshipStory &&
    process.env.ORBSIE_CREATION_PROMPT !== undefined &&
    process.env.ORBSIE_CREATION_PROMPT !== FLAGSHIP_STORY_PROMPT
  )
    throw new HarnessConfigurationError(
      "Flagship story mode requires the exact original island prompt.",
    );
  let applicationSource;
  try {
    applicationSource = parseApplicationSourceCommit(
      process.env.ORBSIE_APP_SOURCE_COMMIT,
    );
  } catch (error) {
    throw new HarnessConfigurationError(error.message);
  }
  const baseValue = process.env.ORBSIE_TEST_URL ?? process.env.TEST_URL;
  if (!baseValue)
    throw new HarnessConfigurationError(
      "Set ORBSIE_TEST_URL (or TEST_URL) to the intended browser origin.",
    );
  let baseURL;
  try {
    baseURL = new URL(baseValue);
  } catch {
    throw new HarnessConfigurationError("ORBSIE_TEST_URL must be a valid URL.");
  }
  if (
    !/^https?:$/.test(baseURL.protocol) ||
    baseURL.username ||
    baseURL.password
  )
    throw new HarnessConfigurationError(
      "ORBSIE_TEST_URL must be an HTTP(S) origin without credentials.",
    );
  if (baseURL.pathname !== "/" || baseURL.search || baseURL.hash)
    throw new HarnessConfigurationError(
      "ORBSIE_TEST_URL must be an origin URL without a path, query, or hash.",
    );

  const hosted = provider === HOSTED_PROVIDER;
  const keyScope = hosted ? "account-session" : process.env.ORBSIE_KEY_SCOPE;
  if (!hosted) {
    if (!KEY_SCOPES.has(keyScope))
      throw new HarnessConfigurationError(
        "Set ORBSIE_KEY_SCOPE to local-only or cloud-authorized; the harness never infers key scope.",
      );
    if (keyScope === "local-only" && !isLoopbackHostname(baseURL.hostname))
      throw new HarnessConfigurationError(
        "A local-only key may only be used against a loopback ORBSIE_TEST_URL.",
      );
    if (provider === "chatgpt-local" && keyScope !== "local-only")
      throw new HarnessConfigurationError(
        "chatgpt-local uses a loopback companion and requires ORBSIE_KEY_SCOPE=local-only.",
      );
  }

  const expectedModel = process.env.ORBSIE_EXPECTED_MODEL;
  if (!validModelId(expectedModel))
    throw new HarnessConfigurationError(
      "Set ORBSIE_EXPECTED_MODEL to the exact authorized model ID; no model fallback is allowed.",
    );
  const authorizedTestModel = hosted
    ? HOSTED_MODEL
    : provider === "chatgpt-local"
      ? "gpt-6-luna"
      : "openai/gpt-6-luna";
  if (expectedModel !== authorizedTestModel)
    throw new HarnessConfigurationError(
      "Live tests are authorized for Luna only; user model selection is unaffected.",
    );
  let hostedPreflight;
  if (hosted) {
    try {
      hostedPreflight = assertHostedPreflight({
        liveE2E: process.env.ORBSIE_LIVE_E2E,
        baseOrigin: baseURL.origin,
        expectedModel,
        serviceTier: process.env.ORBSIE_SERVICE_TIER ?? "default",
        accountStorageStatePath: process.env.ORBSIE_ACCOUNT_STORAGE_STATE,
        interruptedRecovery:
          process.env.ORBSIE_VERIFY_INTERRUPTED_RECOVERY === "1",
        interruptionMethod: process.env.ORBSIE_INTERRUPTION_METHOD,
        companionConfigured:
          process.env.ORBSIE_CHATGPT_COMPANION_URL !== undefined ||
          process.env.ORBSIE_CHATGPT_COMPANION_TOKEN !== undefined,
        testLimits: process.env.ORBSIE_CHATGPT_TEST_LIMITS,
        outputTokenCap: process.env.ORBSIE_OUTPUT_CAP_TOKENS,
        flagshipStory,
      });
    } catch (error) {
      if (error instanceof HostedAcceptanceBlockedError)
        throw new HarnessConfigurationError(error.message);
      throw error;
    }
  }
  const outputCap = hosted
    ? null
    : provider === "chatgpt-local"
      ? process.env.ORBSIE_OUTPUT_CAP_TOKENS
        ? parsePositiveInteger(
            process.env.ORBSIE_OUTPUT_CAP_TOKENS,
            "ORBSIE_OUTPUT_CAP_TOKENS",
          )
        : null
      : parsePositiveInteger(
          process.env.ORBSIE_OUTPUT_CAP_TOKENS,
          "ORBSIE_OUTPUT_CAP_TOKENS",
        );
  if (provider === "openrouter" && keyScope === "local-only") {
    if (expectedModel !== "openai/gpt-6-luna")
      throw new HarnessConfigurationError(
        "The supplied local-only OpenRouter credential is restricted to the explicit Luna test model; set ORBSIE_EXPECTED_MODEL=openai/gpt-6-luna.",
      );
    // Owner authorization on 2026-09-10 permits a bounded cap raise to 4096
    // output tokens for the flagship/procedural live journeys, gated behind
    // this explicit flag so ordinary runs keep the standing 512 cap.
    const raisedCap = process.env.ORBSIE_OPENROUTER_RAISED_CAP === "1";
    if (outputCap > (raisedCap ? 4096 : 512))
      throw new HarnessConfigurationError(
        raisedCap
          ? "The raised OpenRouter cap is bounded at 4096 output tokens."
          : "The supplied local-only OpenRouter run is capped at 512 output tokens or less.",
      );
  }
  if (provider === "free") {
    if (expectedModel !== "openai/gpt-6-luna")
      throw new HarnessConfigurationError(
        "The server-owned free path is restricted to the explicit Luna model; set ORBSIE_EXPECTED_MODEL=openai/gpt-6-luna.",
      );
    if (outputCap !== 4096)
      throw new HarnessConfigurationError(
        "The server-owned free path has a fixed 4096 output-token ceiling; set ORBSIE_OUTPUT_CAP_TOKENS=4096.",
      );
  }
  if (
    process.env.ORBSIE_SERVICE_TIER &&
    process.env.ORBSIE_SERVICE_TIER !== "default"
  )
    throw new HarnessConfigurationError(
      "Only service tier default is permitted by the live browser harness.",
    );

  const config = {
    provider,
    applicationSource,
    baseOrigin: baseURL.origin,
    keyScope,
    expectedModel,
    outputCap,
    prompt: mushroomReplacement
      ? process.env.ORBSIE_CREATION_PROMPT ||
        "Build a tiny island with one friendly tree standing on the ground. Keep it simple and commit the world."
      : flagshipStory || flagshipResume
        ? FLAGSHIP_STORY_PROMPT
        : process.env.ORBSIE_REQUIRE_INPUT_GAME === "1"
          ? INPUT_GAME_PROMPT
          : process.env.ORBSIE_CREATION_PROMPT || DEFAULT_PROMPT,
    editPrompt: mushroomReplacement
      ? process.env.ORBSIE_EDIT_PROMPT || "Make this a giant pink mushroom"
      : flagshipStory
        ? FLAGSHIP_STORY_MUSHROOM_PROMPT
        : flagshipResume
          ? FLAGSHIP_STORY_PLATFORM_PROMPT
          : process.env.ORBSIE_REQUIRE_INPUT_GAME === "1"
            ? INPUT_GAME_EDIT
            : process.env.ORBSIE_EDIT_PROMPT || DEFAULT_EDIT,
    publication:
      args.publication || process.env.ORBSIE_REAL_PUBLICATION === "1",
    cloudRecovery: process.env.ORBSIE_VERIFY_CLOUD_RECOVERY === "1",
    interruptedRecovery: process.env.ORBSIE_VERIFY_INTERRUPTED_RECOVERY === "1",
    interruptionMethod: process.env.ORBSIE_INTERRUPTION_METHOD ?? "stop",
    generationBudget: mushroomReplacement
      ? 2
      : flagshipStory
        ? 3
        : flagshipResumeOffline
          ? 0
          : flagshipResume
            ? flagshipResumeStage === "creation"
              ? 2
              : 1
            : 2,
    flagshipStory,
    mushroomReplacement,
    flagshipResume,
    flagshipResumeStage,
    flagshipResumeArtifactMode,
    flagshipResumeOffline,
    accountStorageStatePath: hosted
      ? resolve(process.env.ORBSIE_ACCOUNT_STORAGE_STATE)
      : undefined,
    hostedTestLimits: hosted ? hostedPreflight.testLimits : undefined,
    hostedActualBounds: hosted ? hostedPreflight.actualBounds : undefined,
    keyEnv:
      provider === "openrouter"
        ? "OPENROUTER_API_KEY"
        : provider === "gateway"
          ? ["AI_GATEWAY_TEST_KEY", "AI_GATEWAY_API_KEY"]
          : undefined,
    requireNewOnly: process.env.ORBSIE_REQUIRE_NEW_ONLY === "1",
    requireBrowserModel: process.env.ORBSIE_REQUIRE_BROWSER_MODEL === "1",
    requireExtrusion: process.env.ORBSIE_REQUIRE_EXTRUSION === "1",
    requireInputGame: process.env.ORBSIE_REQUIRE_INPUT_GAME === "1",
    requireRevolution: process.env.ORBSIE_REQUIRE_REVOLUTION === "1",
    requireGeometryEdit: process.env.ORBSIE_REQUIRE_GEOMETRY_EDIT === "1",
    requireProcedural: process.env.ORBSIE_REQUIRE_PROCEDURAL === "1",
  };

  if (flagshipResume) {
    const checkpointPath = process.env.ORBSIE_FLAGSHIP_RESUME_CHECKPOINT;
    const modelsPath = process.env.ORBSIE_FLAGSHIP_RESUME_MODELS;
    if (!checkpointPath || !modelsPath)
      throw new HarnessConfigurationError(
        "Flagship resume requires ORBSIE_FLAGSHIP_RESUME_CHECKPOINT and ORBSIE_FLAGSHIP_RESUME_MODELS.",
      );
    try {
      config.resumeCheckpoint = readFlagshipResumeCheckpoint(
        checkpointPath,
        modelsPath,
        flagshipResumeStage,
        flagshipResumeArtifactMode,
      );
      if (flagshipResumeOffline) {
        const editedPath = process.env.ORBSIE_FLAGSHIP_RESUME_EDITED;
        const editedModelsPath =
          process.env.ORBSIE_FLAGSHIP_RESUME_EDITED_MODELS;
        if (!editedPath || !editedModelsPath)
          throw new HarnessConfigurationError(
            "Offline flagship resume requires ORBSIE_FLAGSHIP_RESUME_EDITED and ORBSIE_FLAGSHIP_RESUME_EDITED_MODELS.",
          );
        config.resumeOffline = readFlagshipResumeOfflineArtifacts(
          config.resumeCheckpoint,
          editedPath,
          editedModelsPath,
          flagshipResumeArtifactMode,
        );
      }
    } catch (error) {
      throw new HarnessConfigurationError(
        error instanceof Error
          ? error.message
          : "The flagship resume checkpoint could not be validated.",
      );
    }
  }

  if (
    (flagshipStory || flagshipResume) &&
    !(flagshipStory && hosted) &&
    outputCap !== 4096
  )
    throw new HarnessConfigurationError(
      "Flagship story and resume modes require ORBSIE_OUTPUT_CAP_TOKENS=4096.",
    );
  if (
    flagshipStory &&
    process.env.ORBSIE_EDIT_PROMPT !== undefined &&
    process.env.ORBSIE_EDIT_PROMPT !== FLAGSHIP_STORY_MUSHROOM_PROMPT
  )
    throw new HarnessConfigurationError(
      "Flagship story mode requires its fixed mushroom and platform edit prompts.",
    );
  if (
    flagshipResume &&
    process.env.ORBSIE_EDIT_PROMPT !== undefined &&
    process.env.ORBSIE_EDIT_PROMPT !== FLAGSHIP_STORY_PLATFORM_PROMPT
  )
    throw new HarnessConfigurationError(
      "Flagship resume mode requires its fixed platform edit prompt.",
    );
  if (
    flagshipStory &&
    (config.interruptedRecovery ||
      config.requireInputGame ||
      config.requireNewOnly ||
      config.requireBrowserModel ||
      config.requireExtrusion ||
      config.requireRevolution ||
      config.requireGeometryEdit ||
      config.requireProcedural)
  )
    throw new HarnessConfigurationError(
      "Flagship story mode cannot be combined with interrupted recovery, input-game, or other creation/edit gates.",
    );
  if (
    flagshipResume &&
    (config.interruptedRecovery ||
      config.requireInputGame ||
      config.requireNewOnly ||
      config.requireBrowserModel ||
      config.requireExtrusion ||
      config.requireRevolution ||
      config.requireGeometryEdit ||
      config.requireProcedural ||
      config.publication ||
      config.cloudRecovery)
  )
    throw new HarnessConfigurationError(
      "Flagship resume mode cannot be combined with input-game, recovery, publication, or other creation/edit gates.",
    );

  if (
    process.env.ORBSIE_REQUIRE_BROWSER_MODEL !== undefined &&
    !["0", "1"].includes(process.env.ORBSIE_REQUIRE_BROWSER_MODEL)
  )
    throw new HarnessConfigurationError(
      "ORBSIE_REQUIRE_BROWSER_MODEL must be 0 or 1.",
    );

  if (
    process.env.ORBSIE_REQUIRE_NEW_ONLY !== undefined &&
    !["0", "1"].includes(process.env.ORBSIE_REQUIRE_NEW_ONLY)
  )
    throw new HarnessConfigurationError(
      "ORBSIE_REQUIRE_NEW_ONLY must be 0 or 1.",
    );
  if (config.requireNewOnly && !explicitlyRequestsNew(config.prompt))
    throw new HarnessConfigurationError(
      "ORBSIE_REQUIRE_NEW_ONLY=1 requires an explicit original/new creation prompt.",
    );

  for (const name of [
    "ORBSIE_REQUIRE_REVOLUTION",
    "ORBSIE_REQUIRE_GEOMETRY_EDIT",
    "ORBSIE_REQUIRE_PROCEDURAL",
  ]) {
    if (
      process.env[name] !== undefined &&
      !["0", "1"].includes(process.env[name])
    )
      throw new HarnessConfigurationError(`${name} must be 0 or 1.`);
  }
  if (config.requireRevolution && !config.requireBrowserModel)
    throw new HarnessConfigurationError(
      "ORBSIE_REQUIRE_REVOLUTION=1 requires ORBSIE_REQUIRE_BROWSER_MODEL=1.",
    );
  if (config.requireRevolution && !config.requireNewOnly)
    throw new HarnessConfigurationError(
      "ORBSIE_REQUIRE_REVOLUTION=1 requires ORBSIE_REQUIRE_NEW_ONLY=1.",
    );
  if (config.requireGeometryEdit && !config.requireBrowserModel)
    throw new HarnessConfigurationError(
      "ORBSIE_REQUIRE_GEOMETRY_EDIT=1 requires ORBSIE_REQUIRE_BROWSER_MODEL=1.",
    );
  if (
    config.requireProcedural &&
    (!config.requireBrowserModel ||
      !config.requireNewOnly ||
      !config.requireGeometryEdit)
  )
    throw new HarnessConfigurationError(
      "ORBSIE_REQUIRE_PROCEDURAL=1 requires browser modeling, new-only creation, and a geometry edit.",
    );
  if (config.requireGeometryEdit && !process.env.ORBSIE_EDIT_PROMPT?.trim())
    throw new HarnessConfigurationError(
      "ORBSIE_REQUIRE_GEOMETRY_EDIT=1 requires an explicit ORBSIE_EDIT_PROMPT.",
    );
  if (config.requireGeometryEdit && config.requireInputGame)
    throw new HarnessConfigurationError(
      "ORBSIE_REQUIRE_GEOMETRY_EDIT=1 cannot be combined with ORBSIE_REQUIRE_INPUT_GAME=1.",
    );

  if (
    process.env.ORBSIE_REQUIRE_INPUT_GAME !== undefined &&
    !["0", "1"].includes(process.env.ORBSIE_REQUIRE_INPUT_GAME)
  )
    throw new HarnessConfigurationError(
      "ORBSIE_REQUIRE_INPUT_GAME must be 0 or 1.",
    );

  if (
    process.env.ORBSIE_VERIFY_CLOUD_RECOVERY !== undefined &&
    !["0", "1"].includes(process.env.ORBSIE_VERIFY_CLOUD_RECOVERY)
  )
    throw new HarnessConfigurationError(
      "ORBSIE_VERIFY_CLOUD_RECOVERY must be 0 or 1.",
    );

  if (
    process.env.ORBSIE_VERIFY_INTERRUPTED_RECOVERY !== undefined &&
    !["0", "1"].includes(process.env.ORBSIE_VERIFY_INTERRUPTED_RECOVERY)
  )
    throw new HarnessConfigurationError(
      "ORBSIE_VERIFY_INTERRUPTED_RECOVERY must be 0 or 1.",
    );
  if (config.interruptedRecovery && !config.cloudRecovery)
    throw new HarnessConfigurationError(
      "ORBSIE_VERIFY_INTERRUPTED_RECOVERY=1 requires ORBSIE_VERIFY_CLOUD_RECOVERY=1 so the authenticated cloud journal is enabled.",
    );
  if (
    config.interruptedRecovery &&
    !INTERRUPTED_RECOVERY_PROVIDERS.has(provider)
  )
    throw new HarnessConfigurationError(
      "ORBSIE_VERIFY_INTERRUPTED_RECOVERY=1 is supported only with openrouter, gateway, chatgpt-local, or chatgpt-hosted.",
    );
  const configuredGenerationBudget =
    process.env.ORBSIE_INTERRUPTED_GENERATION_BUDGET;
  if (config.interruptedRecovery) {
    if (configuredGenerationBudget === undefined)
      throw new HarnessConfigurationError(
        "ORBSIE_INTERRUPTED_GENERATION_BUDGET=3 is required for interrupted recovery; the harness never infers authorization for the third generation.",
      );
    const generationBudget = parsePositiveInteger(
      configuredGenerationBudget,
      "ORBSIE_INTERRUPTED_GENERATION_BUDGET",
    );
    if (generationBudget !== INTERRUPTED_GENERATION_BUDGET)
      throw new HarnessConfigurationError(
        "ORBSIE_INTERRUPTED_GENERATION_BUDGET must be exactly 3 for interrupted recovery.",
      );
    config.generationBudget = generationBudget;
  } else if (configuredGenerationBudget !== undefined) {
    throw new HarnessConfigurationError(
      "ORBSIE_INTERRUPTED_GENERATION_BUDGET is valid only with ORBSIE_VERIFY_INTERRUPTED_RECOVERY=1.",
    );
  }
  if (
    process.env.ORBSIE_INTERRUPTION_METHOD !== undefined &&
    !config.interruptedRecovery
  )
    throw new HarnessConfigurationError(
      "ORBSIE_INTERRUPTION_METHOD is valid only with ORBSIE_VERIFY_INTERRUPTED_RECOVERY=1.",
    );
  if (!INTERRUPTION_METHODS.has(config.interruptionMethod))
    throw new HarnessConfigurationError(
      "ORBSIE_INTERRUPTION_METHOD must be stop or reload.",
    );

  if (
    (config.publication || config.cloudRecovery) &&
    provider !== HOSTED_PROVIDER &&
    !process.env.ORBSIE_CLOUD_TEST_STATE
  )
    throw new HarnessConfigurationError(
      "A real cloud phase was explicitly requested; set ORBSIE_CLOUD_TEST_STATE to the private mode-0600 state file.",
    );

  if (provider === "chatgpt-local") {
    config.companionURL = process.env.ORBSIE_CHATGPT_COMPANION_URL;
    config.companionToken = process.env.ORBSIE_CHATGPT_COMPANION_TOKEN;
    if (!config.companionURL || !config.companionToken)
      throw new HarnessConfigurationError(
        "chatgpt-local requires ORBSIE_CHATGPT_COMPANION_URL and ORBSIE_CHATGPT_COMPANION_TOKEN; both are read only for an explicit live run.",
      );
    let companion;
    try {
      companion = new URL(config.companionURL);
    } catch {
      throw new HarnessConfigurationError(
        "ORBSIE_CHATGPT_COMPANION_URL must be a valid loopback URL.",
      );
    }
    if (
      companion.protocol !== "http:" ||
      !isLoopbackHostname(companion.hostname) ||
      !companion.port ||
      companion.pathname !== "/" ||
      companion.search ||
      companion.hash ||
      companion.username ||
      companion.password
    )
      throw new HarnessConfigurationError(
        "The ChatGPT companion must be an exact HTTP loopback origin.",
      );
    if (!/^[A-Za-z0-9_-]{43}$/.test(config.companionToken))
      throw new HarnessConfigurationError(
        "ORBSIE_CHATGPT_COMPANION_TOKEN must be the 256-bit capability printed by the companion.",
      );
    config.companionURL = companion.origin;
  } else if (
    provider !== "free" &&
    provider !== HOSTED_PROVIDER &&
    !flagshipResumeOffline
  ) {
    // This is the only point where an API credential is read, and it is
    // unreachable unless the explicit live flag and all safety gates passed.
    const keyEnvironments = Array.isArray(config.keyEnv)
      ? config.keyEnv
      : [config.keyEnv];
    const selectedKeyEnvironment = keyEnvironments.find(
      (name) =>
        typeof name === "string" &&
        typeof process.env[name] === "string" &&
        process.env[name].length > 0,
    );
    if (
      !selectedKeyEnvironment ||
      typeof process.env[selectedKeyEnvironment] !== "string" ||
      process.env[selectedKeyEnvironment].length < 10
    )
      throw new HarnessConfigurationError(
        `Set ${
          provider === "gateway"
            ? "AI_GATEWAY_TEST_KEY (preferred) or AI_GATEWAY_API_KEY"
            : config.keyEnv
        } for the explicitly scoped live run. The value is never printed or written to evidence.`,
      );
    config.keyEnv = selectedKeyEnvironment;
    config.key = process.env[selectedKeyEnvironment];
  }

  if (process.env.ORBSIE_BUILDER_URL || process.env.ORBSIE_BUILDER_TOKEN) {
    const builder = new URL(process.env.ORBSIE_BUILDER_URL);
    if (
      builder.protocol !== "http:" ||
      builder.hostname !== "127.0.0.1" ||
      !builder.port ||
      builder.pathname !== "/" ||
      builder.search ||
      builder.hash ||
      builder.username ||
      builder.password ||
      !/^[A-Za-z0-9_-]{43}$/.test(process.env.ORBSIE_BUILDER_TOKEN ?? "")
    )
      throw new HarnessConfigurationError(
        "A valid local Blender URL and capability are required.",
      );
    config.builderURL = builder.origin;
    config.builderToken = process.env.ORBSIE_BUILDER_TOKEN;
  }
  return config;
}

function sanitizeMessage(message, config) {
  let value = String(message || "");
  for (const secret of [
    config?.key,
    config?.companionToken,
    config?.builderToken,
  ]) {
    if (secret) value = value.split(secret).join("[redacted]");
  }
  value = value.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]");
  value = value.replace(/#[^\s"']{20,}/g, "#[redacted]");
  return value.slice(0, 500);
}

function sanitizedError(error, config) {
  return sanitizeMessage(
    error instanceof Error ? error.message : error,
    config,
  );
}

const FRESH_GAMEPLAY_FAILURE_PHASES = new Set(["creation", "goal7", "undo"]);
const SAFE_GAMEPLAY_KEYS = new Set(["a", "d", "s", "w", " "]);
const SAFE_GAMEPLAY_REASONS = new Set([
  "movement-check",
  "movement-release",
  "collect-settle",
  "collect-steer",
  "collect-jump",
  "collect-jump-release",
  "collect-unreachable",
  "portal-settle",
  "portal-steer",
  "portal-jump",
  "portal-jump-release",
  "portal-unreachable",
  "platform-contact-release",
  "platform-recovery-release",
  "platform-jump-start",
  "platform-jump-no-response-release",
  "platform-jump-release",
  "platform-jumping",
  "platform-airborne",
  "platform-steering",
  "platform-attempt-timeout",
]);

function safeGameplayNumber(value, integer = false) {
  return Number.isFinite(value) &&
    Math.abs(value) <= 10_000_000 &&
    (!integer || Number.isSafeInteger(value))
    ? value
    : null;
}

function safeGameplayCount(value, maximum = 6000) {
  const count = safeGameplayNumber(value, true);
  return count !== null && count >= 0 ? Math.min(count, maximum) : null;
}

function safeGameplayTime(value) {
  const time = safeGameplayNumber(value);
  return time !== null && time >= 0 ? time : null;
}

function safeGameplayId(value, allowedIds) {
  return typeof value === "string" &&
    value.length <= 128 &&
    /^[A-Za-z0-9_.:-]+$/.test(value) &&
    (!allowedIds || allowedIds.has(value))
    ? value
    : null;
}

function safeGameplayVector(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const result = value.map((component) => safeGameplayNumber(component));
  return result.every((component) => component !== null) ? result : null;
}

function safeGameplayIdList(values, allowedIds) {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .slice(0, 64)
        .map((value) => safeGameplayId(value, allowedIds))
        .filter(Boolean),
    ),
  ].slice(0, 32);
}

function safeGameplayObservation(observation, projectId, revision, allowedIds) {
  if (
    !observation ||
    observation.projectId !== projectId ||
    observation.revision !== revision
  )
    return null;
  const entities = Array.isArray(observation.entities)
    ? observation.entities.slice(0, 32).flatMap((entity) => {
        const id = safeGameplayId(entity?.id, allowedIds);
        const position = safeGameplayVector(entity?.position);
        const scale = safeGameplayVector(entity?.scale);
        return id && position && scale ? [{ id, position, scale }] : [];
      })
    : [];
  const groundedOn =
    observation.player?.groundedOn === "ground"
      ? "ground"
      : safeGameplayId(observation.player?.groundedOn, allowedIds);
  return {
    projectId,
    revision,
    atMs: safeGameplayTime(observation.atMs),
    renderer: ["webgl", "software"].includes(observation.renderer)
      ? observation.renderer
      : null,
    player: {
      position: safeGameplayVector(observation.player?.position),
      velocityY: safeGameplayNumber(observation.player?.velocityY),
      groundedOn,
    },
    entities,
    contacts: safeGameplayIdList(observation.contacts, allowedIds),
    collected: safeGameplayIdList(observation.collected, allowedIds),
    scoreIds: safeGameplayIdList(observation.scoreIds, allowedIds),
    gameScore: safeGameplayNumber(observation.gameScore),
    status: ["playing", "won", "lost"].includes(observation.status)
      ? observation.status
      : null,
    won: typeof observation.won === "boolean" ? observation.won : null,
    lost: typeof observation.lost === "boolean" ? observation.lost : null,
    reset: safeGameplayCount(observation.reset),
    sessionGeneration: safeGameplayCount(observation.sessionGeneration),
  };
}

function safePlatformTraversalObservation(observation, allowedIds) {
  if (!observation || typeof observation !== "object") return null;
  const platform = observation.platform;
  return {
    atMs: safeGameplayTime(observation.atMs),
    player: {
      position: safeGameplayVector(observation.player?.position),
      velocityY: safeGameplayNumber(observation.player?.velocityY),
      groundedOn:
        observation.player?.groundedOn === "ground"
          ? "ground"
          : safeGameplayId(observation.player?.groundedOn, allowedIds),
    },
    platform: platform
      ? {
          position: safeGameplayVector(platform.position),
          scale: safeGameplayVector(platform.scale),
        }
      : null,
    platformContactId: safeGameplayId(
      observation.platformContactId,
      allowedIds,
    ),
    bounceContactId: safeGameplayId(observation.bounceContactId, allowedIds),
    platformContactCount: safeGameplayCount(
      observation.platformContactCount,
    ),
    bounceContactCount: safeGameplayCount(observation.bounceContactCount),
  };
}

function safePlatformSurfaceCrossing(crossing, allowedIds) {
  if (
    crossing?.kind !== "descending-estimated-platform-top-crossing" ||
    crossing.estimateOnly !== true ||
    crossing.footprint?.model !==
      "procedural-xz-half-extents-0.55-times-scale" ||
    crossing.footprint?.authoritativeContact !== false
  )
    return null;
  const safeSide = (side) => {
    const observation = safePlatformTraversalObservation(
      side?.observation,
      allowedIds,
    );
    const estimatedTopY = safeGameplayNumber(side?.estimatedTopY);
    if (!observation || estimatedTopY === null) return null;
    return {
      observation,
      estimatedTopY,
      insideEstimatedFootprint:
        typeof side.insideEstimatedFootprint === "boolean"
          ? side.insideEstimatedFootprint
          : null,
    };
  };
  const previous = safeSide(crossing.previous);
  const current = safeSide(crossing.current);
  if (!previous || !current) return null;
  return {
    kind: "descending-estimated-platform-top-crossing",
    estimateOnly: true,
    footprint: {
      model: "procedural-xz-half-extents-0.55-times-scale",
      authoritativeContact: false,
    },
    previous,
    current,
    contactCountersChanged: {
      platform:
        typeof crossing.contactCountersChanged?.platform === "boolean"
          ? crossing.contactCountersChanged.platform
          : null,
      bounce:
        typeof crossing.contactCountersChanged?.bounce === "boolean"
          ? crossing.contactCountersChanged.bounce
          : null,
    },
  };
}

function safeGameplayAttempt(value) {
  if (Number.isSafeInteger(value) && value >= 0 && value <= 2) return value;
  const recovery = typeof value === "string" && /^recovery-([0-2])$/.exec(value);
  return recovery ? `recovery-${recovery[1]}` : null;
}

function safePlatformJumpEvidence(attempts, platformId, allowedIds) {
  if (!Array.isArray(attempts)) return [];
  return attempts.slice(-3).flatMap((attempt) => {
    if (
      safeGameplayId(attempt?.id, allowedIds) !== platformId ||
      safeGameplayAttempt(attempt?.attempt) === null
    )
      return [];
    const safeKeys = (keys) =>
      Array.isArray(keys)
        ? keys
            .slice(0, 5)
            .filter((key) => SAFE_GAMEPLAY_KEYS.has(key))
        : [];
    return [
      {
        attempt: safeGameplayAttempt(attempt.attempt),
        before: safePlatformTraversalObservation(attempt.before, allowedIds),
        inputKeys: Array.isArray(attempt.inputKeys)
          ? attempt.inputKeys
              .slice(-8)
              .map((keys) => safeKeys(keys))
          : [],
        samples: Array.isArray(attempt.samples)
          ? attempt.samples
              .slice(-12)
              .map((sample) =>
                safePlatformTraversalObservation(sample, allowedIds),
              )
          : [],
        apex: safePlatformTraversalObservation(attempt.apex, allowedIds),
        surfaceCrossing: safePlatformSurfaceCrossing(
          attempt.surfaceCrossing,
          allowedIds,
        ),
        landing: safePlatformTraversalObservation(attempt.landing, allowedIds),
        contact: safePlatformTraversalObservation(attempt.contact, allowedIds),
        recovery: safePlatformTraversalObservation(
          attempt.recovery,
          allowedIds,
        ),
      },
    ];
  });
}

/** Record failed traversal with bounded gameplay fields bound to its revision. */
export function recordFreshFlagshipGameplayFailure(
  report,
  phase,
  project,
  error,
) {
  assert(
    FRESH_GAMEPLAY_FAILURE_PHASES.has(phase),
    `Unsupported fresh flagship gameplay phase: ${phase}`,
  );
  const projectId = safeGameplayId(project?.id);
  const revision =
    Number.isSafeInteger(project?.revision) && project.revision >= 0
      ? project.revision
      : null;
  const allowedIds = new Set(
    (Array.isArray(project?.entities) ? project.entities.slice(0, 1000) : [])
      .map((entity) => safeGameplayId(entity?.id))
      .filter(Boolean),
  );
  const raw = error?.freshGameplayEvidence;
  const portalWin = raw?.portalWin;
  const movement = raw?.movement;
  const inputTrace = Array.isArray(raw?.inputTrace)
    ? raw.inputTrace.slice(-20).flatMap((entry) => {
        if (!entry || !SAFE_GAMEPLAY_REASONS.has(entry.reason)) return [];
        return [
          {
            atMs: safeGameplayTime(entry.atMs),
            keys: Array.isArray(entry.keys)
              ? entry.keys
                  .slice(0, 5)
                  .filter((key) => SAFE_GAMEPLAY_KEYS.has(key))
              : [],
            reason: entry.reason,
          },
        ];
      })
    : [];
  const platformEvidence = Array.isArray(raw?.platformEvidence)
    ? raw.platformEvidence.slice(0, 32).flatMap((platform) => {
        const id = safeGameplayId(platform?.id, allowedIds);
        return id
          ? [
              {
                id,
                behavior: ["move", "bounce"].includes(platform.behavior)
                  ? platform.behavior
                  : null,
                groundedFrames: safeGameplayCount(platform.groundedFrames),
                bounceFrames: safeGameplayCount(platform.bounceFrames),
                startPosition: safeGameplayVector(platform.startPosition),
                maximumDisplacement: safeGameplayNumber(
                  platform.maximumDisplacement,
                ),
                jumpEvidence: safePlatformJumpEvidence(
                  platform.jumpEvidence,
                  id,
                  allowedIds,
                ),
              },
            ]
          : [];
      })
    : [];
  const gameplay = {
    status: "failed",
    projectId,
    revision,
    failureEvidence: {
      source: "fresh-gameplay-traversal",
      phase,
      projectId,
      revision,
      observationCount: safeGameplayCount(raw?.observationCount),
      lastObservation: safeGameplayObservation(
        raw?.lastObservation,
        projectId,
        revision,
        allowedIds,
      ),
      inputTrace,
      collectibleTraversalOrder: safeGameplayIdList(
        raw?.collectibleTraversalOrder,
        allowedIds,
      ),
      movement: movement
        ? {
            distance: safeGameplayNumber(movement.distance),
            before: safeGameplayObservation(
              movement.before,
              projectId,
              revision,
              allowedIds,
            ),
            after: safeGameplayObservation(
              movement.after,
              projectId,
              revision,
              allowedIds,
            ),
          }
        : null,
      contacts: safeGameplayIdList(raw?.contacts, allowedIds),
      collections: safeGameplayIdList(raw?.collections, allowedIds),
      scoreIds: safeGameplayIdList(raw?.scoreIds, allowedIds),
      score: safeGameplayNumber(raw?.score),
      portalWin:
        portalWin?.projectId === projectId && portalWin?.revision === revision
          ? {
              projectId,
              revision,
              status: ["playing", "won", "lost"].includes(portalWin.status)
                ? portalWin.status
                : null,
              won: typeof portalWin.won === "boolean" ? portalWin.won : null,
              portalId: safeGameplayId(portalWin.portalId, allowedIds),
            }
          : null,
      restart: {
        attempted: raw?.restart?.attempted === true,
        resetCounter: safeGameplayCount(raw?.restart?.resetCounter),
      },
      platformEvidence,
    },
  };
  const story = report.flagshipStory ?? {};
  const phases = story.phases ?? {};
  report.flagshipStory = {
    ...story,
    status: "failed",
    phases: {
      ...phases,
      [phase]: {
        ...(phases[phase] ?? {}),
        status: "failed",
        revision,
        gameplay,
      },
    },
  };
  return gameplay;
}

export function trialRemainingFromHeaders(headers) {
  const value =
    typeof headers?.get === "function"
      ? headers.get("x-orbsie-trial-remaining")
      : (headers?.["x-orbsie-trial-remaining"] ??
        headers?.["X-Orbsie-Trial-Remaining"]);
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const remaining = Number(value);
  return Number.isSafeInteger(remaining) ? remaining : null;
}

function checkpointShape(project) {
  if (!project || typeof project !== "object" || Array.isArray(project))
    return false;
  if (
    project.version !== 1 ||
    typeof project.id !== "string" ||
    !Number.isSafeInteger(project.revision) ||
    project.revision < 0 ||
    !Array.isArray(project.entities) ||
    !Array.isArray(project.messages) ||
    !project.environment ||
    typeof project.environment !== "object"
  )
    return false;
  const ids = new Set();
  const proceduralKinds = new Set([
    "tree",
    "mushroom",
    "platform",
    "arch",
    "crystal",
    "pond",
    "flower",
    "rock",
    "custom",
  ]);
  for (const entity of project.entities) {
    const geometry = entity?.geometry;
    const geometryValid =
      geometry === undefined ||
      (geometry &&
        typeof geometry === "object" &&
        typeof geometry.kind === "string" &&
        ["coarse", "refined"].includes(geometry.detail) &&
        (proceduralKinds.has(geometry.kind) ||
          (geometry.kind === "asset" && typeof geometry.assetId === "string") ||
          (geometry.kind === "generated" &&
            geometry.job &&
            typeof geometry.job === "object")));
    if (
      !entity ||
      typeof entity !== "object" ||
      typeof entity.id !== "string" ||
      ids.has(entity.id) ||
      !Array.isArray(entity.position) ||
      entity.position.length !== 3 ||
      !entity.position.every(Number.isFinite) ||
      !Array.isArray(entity.scale) ||
      entity.scale.length !== 3 ||
      !entity.scale.every(Number.isFinite) ||
      !["seed", "coarse", "ready"].includes(entity.stage) ||
      !geometryValid
    )
      return false;
    ids.add(entity.id);
  }
  return true;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function publicationProjectComparable(project) {
  if (!project || typeof project !== "object") return null;
  const { messages: _messages, ...rest } = project;
  return rest;
}

/**
 * Verify the signed-out publication against the exact project that reached
 * the follow-on phases. Publication intentionally strips chat messages, so
 * those are the only fields omitted from the structural comparison.
 */
export function assertPublicationProjectMatches(
  actual,
  expected,
  label = "Published project",
) {
  assert(
    actual && typeof actual === "object",
    `${label} is missing or malformed.`,
  );
  assert.equal(actual.id, expected?.id, `${label} changed the project identity.`);
  assert.equal(
    actual.revision,
    expected?.revision,
    `${label} changed the project revision.`,
  );
  assert.deepEqual(
    publicationProjectComparable(actual),
    publicationProjectComparable(expected),
    `${label} changed the published world content.`,
  );
  return actual;
}

function approvedPublicationOrigin(
  originValue,
  approvedOrigins,
  { deployment = false } = {},
) {
  let parsed;
  try {
    parsed = new URL(originValue);
  } catch {
    throw new HarnessBlockedError("published-artifact-origin-invalid");
  }
  if (
    (deployment
      ? parsed.protocol !== "https:"
      : !(
          parsed.protocol === "https:" ||
          (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname))
        )) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !approvedOrigins?.has(parsed.origin)
  )
    throw new HarnessBlockedError("published-artifact-origin-not-approved");
  return parsed;
}

function publicationDeploymentOrigin(deploymentUrl, approvedOrigins) {
  return approvedPublicationOrigin(deploymentUrl, approvedOrigins, {
    deployment: true,
  });
}

export function assertPublicationPlaybackOrigins({
  wrapperUrl,
  appOrigin,
  deploymentUrl,
  iframeUrl,
  approvedOrigins,
}) {
  const app = new URL(appOrigin);
  const wrapper = new URL(wrapperUrl, app.origin);
  assert.equal(
    wrapper.origin,
    app.origin,
    "Published wrapper changed the approved app origin.",
  );
  const deployment = publicationDeploymentOrigin(
    deploymentUrl,
    approvedOrigins,
  );
  const iframe = new URL(iframeUrl, wrapper.href);
  assert.equal(
    iframe.origin,
    deployment.origin,
    "Published playback iframe changed the approved deployment origin.",
  );
  return { wrapper, deployment, iframe };
}

async function readBoundedPublicationResponse(response, path) {
  const rawLength = response.headers?.get?.("content-length");
  if (rawLength !== null && rawLength !== undefined) {
    const trimmed = rawLength.trim();
    if (!/^\d+$/.test(trimmed))
      throw new HarnessBlockedError("published-artifact-response-malformed");
    if (Number(trimmed) > PUBLICATION_ARTIFACT_MAX_BYTES)
      throw new HarnessBlockedError(
        `published-artifact-response-oversized:${path}`,
      );
  }
  if (!response.body) {
    let bytes;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      throw new HarnessBlockedError("published-artifact-response-malformed");
    }
    if (bytes.byteLength > PUBLICATION_ARTIFACT_MAX_BYTES)
      throw new HarnessBlockedError(
        `published-artifact-response-oversized:${path}`,
      );
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > PUBLICATION_ARTIFACT_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new HarnessBlockedError(
          `published-artifact-response-oversized:${path}`,
        );
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof HarnessBlockedError) throw error;
    throw new HarnessBlockedError("published-artifact-response-malformed");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchAnonymousPublicationArtifact(
  deploymentOrigin,
  path,
  fetchImpl,
) {
  const url = new URL(path, deploymentOrigin);
  let response;
  try {
    response = await fetchImpl(url.href, {
      credentials: "omit",
      redirect: "manual",
      signal: AbortSignal.timeout(PUBLICATION_FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new HarnessBlockedError(`published-artifact-fetch-failed:${path}`);
  }
  if (response.status >= 300 && response.status < 400)
    throw new HarnessBlockedError(`published-artifact-redirect:${path}`);
  if (!response.ok)
    throw new HarnessBlockedError(`published-artifact-missing:${path}`);
  return readBoundedPublicationResponse(response, path);
}

function assertPublicationArtifactRecordsMatch(
  actual,
  expected,
  reason = "fresh-export-target-mismatch",
) {
  if (!actual || typeof actual !== "object")
    throw new HarnessBlockedError("fresh-target-artifacts-unavailable");
  for (const path of PUBLICATION_ARTIFACT_PATHS) {
    const left = actual[path];
    const right = expected?.[path];
    if (
      !left ||
      !right ||
      left.bytes !== right.bytes ||
      left.sha256 !== right.sha256
    )
      throw new HarnessBlockedError(`${reason}:${path}`);
  }
}

/**
 * Capture the current application's player files independently of an export
 * download. The ZIP and publication must both remain bound to these bytes.
 */
export async function captureCurrentTargetArtifacts({
  appOrigin,
  approvedOrigins,
  fetchImpl = fetch,
}) {
  const origin = approvedPublicationOrigin(appOrigin, approvedOrigins);
  const artifacts = {};
  for (const path of PUBLICATION_ARTIFACT_PATHS) {
    const bytes = await fetchAnonymousPublicationArtifact(
      origin,
      `player/${path}`,
      fetchImpl,
    );
    artifacts[path] = { bytes: bytes.byteLength, sha256: sha256(bytes) };
  }
  return artifacts;
}

/**
 * Compare anonymously downloaded deployment files to bytes independently
 * captured from the fresh export ZIP. The deployment manifest is checked for
 * identity and consistency, but never serves as the source of expected bytes.
 */
export async function verifyFreshPublicationArtifacts({
  deploymentUrl,
  approvedOrigins,
  projectId,
  revision,
  expectedArtifacts,
  targetArtifacts,
  fetchImpl = fetch,
}) {
  const origin = publicationDeploymentOrigin(deploymentUrl, approvedOrigins);
  if (!expectedArtifacts || typeof expectedArtifacts !== "object")
    throw new HarnessBlockedError("fresh-export-artifacts-unavailable");
  assertPublicationArtifactRecordsMatch(expectedArtifacts, targetArtifacts);
  const manifestBytes = await fetchAnonymousPublicationArtifact(
    origin,
    PUBLICATION_MANIFEST_FILE,
    fetchImpl,
  );
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new HarnessBlockedError("published-artifact-manifest-malformed");
  }
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.projectId !== projectId ||
    manifest.revision !== revision ||
    !Array.isArray(manifest.files)
  )
    throw new HarnessBlockedError("published-artifact-manifest-identity-mismatch");
  const manifestFiles = new Map(
    manifest.files
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => [entry.file, entry]),
  );
  const files = {};
  for (const path of PUBLICATION_ARTIFACT_PATHS) {
    const expected = expectedArtifacts[path];
    if (
      !expected ||
      !Number.isInteger(expected.bytes) ||
      expected.bytes < 0 ||
      typeof expected.sha256 !== "string"
    )
      throw new HarnessBlockedError(`fresh-export-artifact-missing:${path}`);
    const manifestEntry = manifestFiles.get(path);
    if (
      !manifestEntry ||
      manifestEntry.bytes !== expected.bytes ||
      manifestEntry.sha256 !== expected.sha256
    )
      throw new HarnessBlockedError(`published-artifact-manifest-mismatch:${path}`);
    const bytes = await fetchAnonymousPublicationArtifact(
      origin,
      path,
      fetchImpl,
    );
    const observed = { bytes: bytes.byteLength, sha256: sha256(bytes) };
    files[path] = { target: targetArtifacts[path], expected, observed };
    if (
      observed.bytes !== expected.bytes ||
      observed.sha256 !== expected.sha256
    )
      throw new HarnessBlockedError(`published-artifact-mismatch:${path}`);
  }
  return {
    manifest: {
      bytes: manifestBytes.byteLength,
      sha256: sha256(manifestBytes),
      projectId: manifest.projectId,
      revision: manifest.revision,
    },
    files,
  };
}

export function assertFlagshipStoryAssetReferences(project) {
  const references = [];
  const visit = (value, path) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (key === "assetId") {
        assert(
          typeof child === "string" && STORY_CATALOG_ASSETS.has(child),
          `Story checkpoint has an unknown catalog asset reference at ${childPath}.`,
        );
        references.push(child);
      }
      visit(child, childPath);
    }
  };
  visit(project, "project");
  for (const entity of project?.entities ?? []) {
    if (entity?.geometry?.kind !== "asset") continue;
    assert(
      typeof entity.geometry.assetId === "string" &&
        STORY_CATALOG_ASSETS.has(entity.geometry.assetId),
      `Story asset entity ${entity.id} has no supported catalog asset reference.`,
    );
  }
  return [...new Set(references)];
}

function assertFlagshipResumeSourceBinding(
  evidence,
  checkpointPath,
  checkpointBytes,
) {
  assert(
    typeof evidence.sourceSnapshot === "string" &&
      resolve(SOURCE_ROOT, evidence.sourceSnapshot) === checkpointPath,
    "Flagship resume evidence is not bound to the supplied checkpoint.",
  );
  assert.equal(
    evidence.sourceSnapshotSha256,
    sha256(checkpointBytes),
    "Flagship resume evidence has an invalid source snapshot hash.",
  );
}

function readFlagshipCreationCheckpointEvidence(
  checkpointPath,
  modelsDir,
  project,
  checkpointBytes,
) {
  let evidence;
  try {
    evidence = JSON.parse(
      readFileSync(join(modelsDir, "story-created-generated.json")),
    );
  } catch {
    throw Error(
      "Flagship creation checkpoint or story-created-generated.json could not be read.",
    );
  }
  assertFlagshipStoryAssetReferences(project);
  assertFlagshipResumeSourceBinding(evidence, checkpointPath, checkpointBytes);
  assert.equal(
    evidence?.phase,
    "created",
    "Flagship creation evidence has an unexpected phase.",
  );
  assert.equal(
    evidence?.status,
    "complete",
    "Flagship creation evidence is incomplete.",
  );
  assert(
    Array.isArray(evidence.models) && Array.isArray(evidence.missing),
    "Flagship creation evidence has an invalid generated-model manifest.",
  );
  assert.equal(
    evidence.missing.length,
    0,
    "Flagship creation evidence contains missing generated assets.",
  );
  const { references, invalid } = generatedModelReferences(project);
  assert.equal(
    invalid.length,
    0,
    "Flagship creation checkpoint contains unsupported generated asset metadata.",
  );
  assert.equal(
    evidence.models.length,
    references.length,
    references.length
      ? "Flagship creation evidence omitted a generated asset."
      : "Flagship creation evidence contains an unexpected generated asset.",
  );
  const expectedByHash = new Map(
    references.map((reference) => [reference.sha256, reference]),
  );
  const seen = new Set();
  const models = [];
  let totalBytes = 0;
  for (const record of evidence.models) {
    const expected = expectedByHash.get(record?.sha256);
    const path = record?.path;
    assert(
      expected &&
        !seen.has(record.sha256) &&
        record.status === "complete" &&
        record.bytes === expected.expectedBytes &&
        Array.isArray(record.entityIds) &&
        [...new Set(record.entityIds)].sort().join("\0") ===
          [...expected.entityIds].sort().join("\0") &&
        typeof path === "string",
      "Flagship creation evidence has mismatched generated-model metadata.",
    );
    assert(/^generated\/[a-f0-9]{64}\.glb$/.test(path), "Flagship creation evidence contains an unsafe model path.");
    const modelPath = resolve(modelsDir, path);
    const modelRelative = relative(modelsDir, modelPath);
    assert(
      modelRelative === path && !modelRelative.startsWith(".."),
      "Flagship creation evidence contains an unsafe model path.",
    );
    let glb;
    try {
      glb = readFileSync(modelPath);
    } catch {
      throw Error(
        `Flagship creation generated model ${record.sha256} could not be read; generated bytes cannot be reconstructed.`,
      );
    }
    assert(
      glb.byteLength === expected.expectedBytes &&
        sha256(glb) === expected.sha256,
      `Flagship creation generated model ${record.sha256} failed its hash or byte check.`,
    );
    seen.add(record.sha256);
    totalBytes += glb.byteLength;
    models.push({
      entityIds: expected.entityIds,
      metadata: project.entities.find(
        (entity) => entity.geometry?.model?.sha256 === expected.sha256,
      ).geometry.model,
      glb: [...glb],
    });
  }
  assert.equal(
    totalBytes,
    evidence.totalBytes,
    "Flagship creation evidence has an incorrect generated-model byte total.",
  );
  return {
    models,
    sourceSnapshotSha256: sha256(checkpointBytes),
  };
}

function readFlagshipCapturedPhaseEvidence(
  checkpointPath,
  modelsDir,
  project,
  checkpointBytes,
  phase,
) {
  let evidence;
  try {
    evidence = JSON.parse(
      readFileSync(join(modelsDir, `story-${phase}-generated.json`)),
    );
  } catch {
    throw Error(
      `Flagship captured ${phase} checkpoint or generated-model manifest could not be read.`,
    );
  }
  assertFlagshipStoryAssetReferences(project);
  assertFlagshipResumeSourceBinding(evidence, checkpointPath, checkpointBytes);
  assert.equal(
    evidence?.phase,
    phase,
    `Flagship captured evidence has an unexpected ${phase} phase.`,
  );
  assert.equal(
    evidence?.status,
    "complete",
    `Flagship captured ${phase} evidence is incomplete.`,
  );
  assert(
    Array.isArray(evidence.models) && Array.isArray(evidence.missing),
    `Flagship captured ${phase} evidence has an invalid generated-model manifest.`,
  );
  assert.equal(
    evidence.missing.length,
    0,
    `Flagship captured ${phase} evidence contains missing generated assets.`,
  );
  const { references, invalid } = generatedModelReferences(project);
  assert.equal(
    invalid.length,
    0,
    `Flagship captured ${phase} checkpoint contains unsupported generated asset metadata.`,
  );
  assert.equal(
    evidence.models.length,
    references.length,
    references.length
      ? `Flagship captured ${phase} evidence omitted a generated asset.`
      : `Flagship captured ${phase} evidence contains an unexpected generated asset.`,
  );
  const expectedByHash = new Map(
    references.map((reference) => [reference.sha256, reference]),
  );
  const seen = new Set();
  const models = [];
  let totalBytes = 0;
  for (const record of evidence.models) {
    const expected = expectedByHash.get(record?.sha256);
    const path = record?.path;
    assert(
      expected &&
        !seen.has(record.sha256) &&
        record.status === "complete" &&
        record.bytes === expected.expectedBytes &&
        Array.isArray(record.entityIds) &&
        [...new Set(record.entityIds)].sort().join("\0") ===
          [...expected.entityIds].sort().join("\0") &&
        typeof path === "string",
      `Flagship captured ${phase} evidence has mismatched generated-model metadata.`,
    );
    assert(
      /^generated\/[a-f0-9]{64}\.glb$/.test(path),
      `Flagship captured ${phase} evidence contains an unsafe model path.`,
    );
    const modelPath = resolve(modelsDir, path);
    const modelRelative = relative(modelsDir, modelPath);
    assert(
      modelRelative === path && !modelRelative.startsWith(".."),
      `Flagship captured ${phase} evidence contains an unsafe model path.`,
    );
    let glb;
    try {
      glb = readFileSync(modelPath);
    } catch {
      throw Error(
        `Flagship captured ${phase} generated model ${record.sha256} could not be read; generated bytes cannot be reconstructed.`,
      );
    }
    assert(
      glb.byteLength === expected.expectedBytes &&
        sha256(glb) === expected.sha256,
      `Flagship captured ${phase} generated model ${record.sha256} failed its hash or byte check.`,
    );
    const modelEntity = project.entities.find(
      (entity) =>
        expected.entityIds.includes(entity.id) &&
        entity.geometry?.model?.sha256 === expected.sha256,
    );
    assert(
      modelEntity?.geometry?.model,
      `Flagship captured ${phase} generated model ${record.sha256} has no project metadata.`,
    );
    seen.add(record.sha256);
    totalBytes += glb.byteLength;
    models.push({
      id: expected.entityIds.length === 1 ? expected.entityIds[0] : record.sha256,
      entityIds: expected.entityIds,
      metadata: modelEntity.geometry.model,
      glb: [...glb],
    });
  }
  assert.equal(
    totalBytes,
    evidence.totalBytes,
    `Flagship captured ${phase} evidence has an incorrect generated-model byte total.`,
  );
  return {
    models,
    sourceSnapshotSha256: sha256(checkpointBytes),
    phase,
  };
}

export function readFlagshipResumeCheckpoint(
  checkpointArg,
  modelsArg,
  stage = "mushroom",
  artifactMode = "reconstructed",
) {
  const checkpointPath = resolve(checkpointArg);
  const modelsDir = resolve(modelsArg);
  let checkpointBytes;
  let project;
  let evidence;
  try {
    checkpointBytes = readFileSync(checkpointPath);
    project = JSON.parse(checkpointBytes.toString("utf8"));
    evidence = JSON.parse(
      readFileSync(
        join(
          modelsDir,
          artifactMode === "captured"
            ? "story-mushroom-generated.json"
            : stage === "creation"
              ? "story-created-generated.json"
              : "report.json",
        ),
      ).toString("utf8"),
    );
  } catch {
    throw Error("Flagship resume checkpoint or evidence report could not be read.");
  }
  if (!checkpointShape(project))
    throw Error("Flagship resume checkpoint has an invalid project shape.");
  if (project.revision < 1 || !project.id)
    throw Error("Flagship resume checkpoint is missing a project revision.");
  if (!FLAGSHIP_RESUME_ARTIFACT_MODES.has(artifactMode))
    throw Error(
      "Flagship resume artifact mode must be reconstructed or captured.",
    );
  if (artifactMode === "captured") {
    assert.equal(
      stage,
      "mushroom",
      "Captured flagship artifacts require mushroom-stage resume.",
    );
    try {
      assertFlagshipStoryCreation(project);
      assert(
        project.messages.some(
          (message) => message?.text === FLAGSHIP_STORY_PROMPT,
        ),
        "Flagship captured checkpoint is missing the original story prompt.",
      );
      assert(
        project.messages.some(
          (message) => message?.text === FLAGSHIP_STORY_MUSHROOM_PROMPT,
        ),
        "Flagship captured checkpoint is missing the mushroom checkpoint prompt.",
      );
      assert(
        project.entities.some((entity) => storyMushroomEvidence(entity)),
        "Flagship captured checkpoint has no supported mushroom entity.",
      );
      const evidence = readFlagshipCapturedPhaseEvidence(
        checkpointPath,
        modelsDir,
        project,
        checkpointBytes,
        "mushroom",
      );
      return {
        project,
        models: evidence.models,
        checkpointPath,
        modelsDir,
        sourceSnapshotSha256: evidence.sourceSnapshotSha256,
        stage,
        artifactMode,
      };
    } catch (error) {
      throw Error(
        error instanceof Error
          ? error.message
          : "Flagship captured checkpoint failed its story validation.",
      );
    }
  }
  if (stage === "creation") {
    try {
      assertFlagshipStoryCreation(project);
      assert(
        project.messages.some(
          (message) => message?.text === FLAGSHIP_STORY_PROMPT,
        ),
        "Flagship creation checkpoint is missing the original story prompt.",
      );
      const evidence = readFlagshipCreationCheckpointEvidence(
        checkpointPath,
        modelsDir,
        project,
        checkpointBytes,
      );
      return {
        project,
        models: evidence.models,
        checkpointPath,
        modelsDir,
        sourceSnapshotSha256: evidence.sourceSnapshotSha256,
        stage,
        artifactMode,
      };
    } catch (error) {
      throw Error(
        error instanceof Error
          ? error.message
          : "Flagship creation checkpoint failed its story validation.",
      );
    }
  }
  assert.equal(
    stage,
    "mushroom",
    "Flagship resume checkpoint stage must be creation or mushroom.",
  );
  try {
    assertFlagshipStoryCreation(project);
    assert(
      project.messages.some(
        (message) => message?.text === FLAGSHIP_STORY_PROMPT,
      ),
      "Flagship resume checkpoint is missing the original story prompt.",
    );
    assert(
      project.messages.some(
        (message) => message?.text === FLAGSHIP_STORY_MUSHROOM_PROMPT,
      ),
      "Flagship resume checkpoint is missing the mushroom checkpoint prompt.",
    );
    assert(
      project.entities.some((entity) => storyMushroomEvidence(entity)),
      "Flagship resume checkpoint has no supported mushroom entity.",
    );
  } catch (error) {
    throw Error(
      error instanceof Error
        ? error.message
        : "Flagship resume checkpoint failed its story validation.",
    );
  }
  if (
    evidence?.status !== "passed" ||
    evidence?.method !== "reconstructed-from-recipe" ||
    typeof evidence.sourceSnapshot !== "string" ||
    resolve(SOURCE_ROOT, evidence.sourceSnapshot) !== checkpointPath ||
    evidence.sourceSnapshotSha256 !== sha256(checkpointBytes) ||
    !Array.isArray(evidence.models) ||
    evidence.models.length !== 5
  )
    throw Error("Flagship resume evidence is not bound to the supplied checkpoint.");

  const sourceModels = new Map(
    project.entities
      .filter(
        (entity) =>
          /^crystal-[1-5]$/.test(entity?.id ?? "") &&
          entity?.geometry?.kind === "generated" &&
          entity?.geometry?.model,
      )
      .map((entity) => [entity.id, entity.geometry.model]),
  );
  if (sourceModels.size !== 5)
    throw Error("Flagship resume checkpoint does not contain five crystal models.");
  const seenIds = new Set();
  const models = [];
  for (const record of evidence.models) {
    const id = record?.id;
    const sourceModel = sourceModels.get(id);
    const expected = record?.expected;
    const path = record?.path;
    if (
      typeof id !== "string" ||
      seenIds.has(id) ||
      !sourceModel ||
      !expected ||
      expected.sha256 !== sourceModel.sha256 ||
      expected.bytes !== sourceModel.bytes ||
      typeof path !== "string"
    )
      throw Error("Flagship resume evidence has mismatched model metadata or path.");
    if (!/^generated\/[a-f0-9]{64}\.glb$/.test(path))
      throw Error("Flagship resume evidence contains an unsafe model path.");
    seenIds.add(id);
    const modelPath = resolve(modelsDir, path);
    const modelRelative = relative(modelsDir, modelPath);
    if (modelRelative !== path || modelRelative.startsWith(".."))
      throw Error("Flagship resume evidence contains an unsafe model path.");
    let glb;
    try {
      glb = readFileSync(modelPath);
    } catch {
      throw Error(`Flagship resume model ${id} could not be read.`);
    }
    const actualHash = sha256(glb);
    if (glb.byteLength !== sourceModel.bytes || actualHash !== sourceModel.sha256)
      throw Error(`Flagship resume model ${id} failed its hash or byte check.`);
    models.push({
      id,
      metadata: sourceModel,
      glb: [...glb],
    });
  }
  if (seenIds.size !== sourceModels.size)
    throw Error("Flagship resume evidence omitted a crystal model.");
  return {
    project,
    models,
    checkpointPath,
    modelsDir,
    sourceSnapshotSha256: sha256(checkpointBytes),
    stage,
    artifactMode,
  };
}

export function assertFlagshipStoryGoalSeven(project) {
  const game = project?.game;
  assert(
    game && Array.isArray(game.rules),
    "Flagship project has no game program.",
  );
  const crystalsVariable = game.variables?.find(
    (variable) => variable?.name === "crystals",
  );
  assert(
    crystalsVariable && crystalsVariable.initial === 0,
    "Flagship game has no zeroed crystals variable.",
  );
  const collectRules = new Map();
  for (const rule of game.rules) {
    const entityId = rule?.trigger?.entityId;
    if (
      rule?.trigger?.type === "collect" &&
      /^crystal-[1-7]$/.test(entityId ?? "")
    )
      collectRules.set(entityId, rule);
  }
  assert.equal(
    collectRules.size,
    7,
    "Flagship game must collect all seven crystals.",
  );
  for (let index = 1; index <= 7; index += 1) {
    const rule = collectRules.get(`crystal-${index}`);
    assert(rule, `Flagship game is missing crystal-${index} collection.`);
    assert.deepEqual(
      rule.conditions ?? [],
      [],
      `Flagship crystal-${index} collection has an unexpected condition.`,
    );
    assert(
      rule.actions?.some(
        (action) =>
          action?.type === "add_variable" &&
          action.name === "crystals" &&
          action.amount === 1,
      ),
      `Flagship crystal-${index} collection does not increment crystals.`,
    );
    assert(
      rule.actions?.some(
        (action) => action?.type === "add_score" && action.amount === 1,
      ),
      `Flagship crystal-${index} collection does not increment score.`,
    );
  }
  const portalRule = game.rules.find(
    (rule) =>
      rule?.trigger?.type === "collision" &&
      rule.trigger.entityId === "portal" &&
      rule.actions?.some((action) => action?.type === "win"),
  );
  assert(portalRule, "Flagship game has no winning portal rule.");
  assert(
    portalRule.conditions?.some(
      (condition) =>
        condition?.operand?.type === "variable" &&
        condition.operand.name === "crystals" &&
        condition.comparison === "gte" &&
        condition.value === 7,
    ),
    "Flagship portal win must require crystals >= 7.",
  );
  return {
    variable: "crystals",
    collectibles: 7,
    portal: "crystals >= 7",
    ui: "game-score",
  };
}

export function readFlagshipResumeOfflineArtifacts(
  checkpoint,
  editedArg,
  modelsArg,
  artifactMode = "reconstructed",
) {
  const editedPath = resolve(editedArg);
  const modelsDir = resolve(modelsArg);
  let editedBytes;
  let edited;
  let evidence;
  try {
    editedBytes = readFileSync(editedPath);
    edited = JSON.parse(editedBytes.toString("utf8"));
    evidence = JSON.parse(
      readFileSync(
        join(
          modelsDir,
          artifactMode === "captured"
            ? "story-goal7-generated.json"
            : "story-resumed-generated.json",
        ),
        "utf8",
      ),
    );
  } catch {
    throw Error(
      "Offline flagship resume snapshot or model evidence could not be read.",
    );
  }
  if (!checkpointShape(edited))
    throw Error(
      "Offline flagship resume edited snapshot has an invalid project shape.",
    );
  if (
    edited.id !== checkpoint.project.id ||
    edited.revision <= checkpoint.project.revision
  )
    throw Error(
      "Offline flagship resume edited snapshot is not a newer revision of the checkpoint.",
    );
  try {
    assertFlagshipStoryPlatform(
      checkpoint.project,
      edited,
      storyPlatforms(checkpoint.project)[1]?.id,
    );
    assertFlagshipStoryGoalSeven(edited);
  } catch (error) {
    throw Error(
      error instanceof Error
        ? error.message
        : "Offline flagship resume edited snapshot failed validation.",
    );
  }
  if (artifactMode === "captured") {
    try {
      const captured = readFlagshipCapturedPhaseEvidence(
        editedPath,
        modelsDir,
        edited,
        editedBytes,
        "goal7",
      );
      return {
        baseline: checkpoint.project,
        baselineModels: checkpoint.models,
        edited,
        editedSnapshotSha256: sha256(editedBytes),
        models: captured.models,
        checkpointPath: checkpoint.checkpointPath,
        modelsDir,
        artifactMode,
      };
    } catch (error) {
      throw Error(
        error instanceof Error
          ? error.message
          : "Offline captured flagship resume artifacts failed validation.",
      );
    }
  }
  if (
    evidence?.status !== "complete" ||
    evidence.phase !== "resumed" ||
    !Array.isArray(evidence.models) ||
    evidence.models.length !== 7 ||
    evidence.missing?.length
  )
    throw Error("Offline flagship resume model evidence is incomplete.");
  const modelByEntity = new Map();
  for (const record of evidence.models) {
    const entityIds = record?.entityIds;
    const path = record?.path;
    if (
      !Array.isArray(entityIds) ||
      entityIds.length !== 1 ||
      !/^crystal-[1-7]$/.test(entityIds[0] ?? "") ||
      modelByEntity.has(entityIds[0]) ||
      !/^generated\/[a-f0-9]{64}\.glb$/.test(path ?? "") ||
      !Number.isSafeInteger(record?.bytes) ||
      record.bytes < 1 ||
      typeof record.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.sha256)
    )
      throw Error(
        "Offline flagship resume model evidence has invalid metadata.",
      );
    const modelPath = resolve(modelsDir, path);
    const relativePath = relative(modelsDir, modelPath);
    if (relativePath !== path || relativePath.startsWith(".."))
      throw Error(
        "Offline flagship resume model evidence contains an unsafe path.",
      );
    let glb;
    try {
      glb = readFileSync(modelPath);
    } catch {
      throw Error(
        `Offline flagship resume model ${entityIds[0]} could not be read.`,
      );
    }
    if (glb.byteLength !== record.bytes || sha256(glb) !== record.sha256)
      throw Error(
        `Offline flagship resume model ${entityIds[0]} failed its hash or byte check.`,
      );
    const entity = edited.entities.find(
      (candidate) => candidate.id === entityIds[0],
    );
    const model = entity?.geometry?.model;
    if (
      !model ||
      model.sha256 !== record.sha256 ||
      model.bytes !== record.bytes
    )
      throw Error(
        `Offline flagship resume model ${entityIds[0]} does not match the edited snapshot.`,
      );
    modelByEntity.set(entityIds[0], {
      id: entityIds[0],
      metadata: model,
      glb: [...glb],
    });
  }
  if (modelByEntity.size !== 7)
    throw Error(
      "Offline flagship resume model evidence omitted a crystal model.",
    );
  return {
    baseline: checkpoint.project,
    baselineModels: checkpoint.models,
    edited,
    editedSnapshotSha256: sha256(editedBytes),
    models: [...modelByEntity.values()],
    checkpointPath: checkpoint.checkpointPath,
    modelsDir,
    artifactMode,
  };
}

function checkpointSummary(project) {
  if (!project || typeof project !== "object") return null;
  return {
    id: typeof project.id === "string" ? project.id : null,
    revision: Number.isSafeInteger(project.revision) ? project.revision : null,
    entityIds: Array.isArray(project.entities)
      ? project.entities
          .map((entity) => (typeof entity?.id === "string" ? entity.id : null))
          .filter(Boolean)
      : [],
  };
}

export function classifyFailureCheckpoint(before, after) {
  const beforeSummary = checkpointSummary(before);
  const afterSummary = checkpointSummary(after);
  const result = (status, reason) => ({
    status,
    reason,
    scope: "structural-only",
    before: beforeSummary,
    after: afterSummary,
  });
  if (!checkpointShape(before))
    return result("unavailable", "before-missing-or-invalid");
  if (!after) return result("unavailable", "after-missing");
  if (!checkpointShape(after)) return result("corrupt", "after-invalid");
  if (after.id !== before.id) return result("corrupt", "project-id-changed");
  if (after.revision < before.revision)
    return result("corrupt", "revision-regressed");
  const scene = (project) => {
    const { messages: _messages, ...committedScene } = project;
    return committedScene;
  };
  const unchanged =
    JSON.stringify(scene(before)) === JSON.stringify(scene(after));
  if (!unchanged && after.revision === before.revision)
    return result("corrupt", "changed-without-revision");
  return result(
    unchanged ? "unchanged" : "partial-unverified",
    unchanged ? "same-committed-scene" : "structural-check-only",
  );
}

export function buildFreeTrialFailureEvidence({
  responseRemaining,
  trialStatus,
  trialBody,
  beforeProject,
  afterProject,
}) {
  const remaining =
    Number.isSafeInteger(responseRemaining) && responseRemaining >= 0
      ? responseRemaining
      : null;
  const refreshedRemaining =
    Number.isSafeInteger(trialBody?.remaining) && trialBody.remaining >= 0
      ? trialBody.remaining
      : null;
  return {
    status:
      trialStatus === 200 && trialBody?.enabled === true
        ? "observed"
        : "unavailable",
    responseRemaining: remaining,
    refreshedTrial: {
      status: Number.isSafeInteger(trialStatus) ? trialStatus : null,
      enabled: trialBody?.enabled === true,
      remaining: refreshedRemaining,
      limit: Number.isSafeInteger(trialBody?.limit) ? trialBody.limit : null,
    },
    checkpoint: classifyFailureCheckpoint(beforeProject, afterProject),
  };
}

export function recordGenerationResponseEvidence(response, config, info) {
  info.generationStatuses.push(response.status());
  if (config.provider === "free")
    info.generationTrialRemaining.push(
      trialRemainingFromHeaders(response.headers()),
    );
}

function trialTrafficEvidence(config, info) {
  return config.provider === "free"
    ? { generationTrialRemaining: [...info.generationTrialRemaining] }
    : {};
}

function persistenceJSON(value) {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? undefined : JSON.parse(encoded);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function emptyReport(config, provenance) {
  const reportProvenance = provenance ?? {
    checkedAt: new Date().toISOString(),
    harness: {
      checkoutSHA: null,
      dirty: null,
      status: "unavailable",
    },
    application:
      config.applicationSource ?? parseApplicationSourceCommit(undefined),
  };
  return {
    checkedAt: reportProvenance.checkedAt,
    provenance: reportProvenance,
    provider: config.provider,
    mode: REPORT_MODE,
    targetOrigin: config.baseOrigin,
    model: config.expectedModel,
    reasoning: "low",
    serviceTier: "default",
    keyScope: config.keyScope,
    outputCapTokens: config.outputCap,
    outputTokenCap:
      config.provider === HOSTED_PROVIDER ? null : config.outputCap,
    generationBudget: config.generationBudget,
    ...(PUBLIC_GENERATION_PROVIDERS.has(config.provider)
      ? {
          originPreflight: {
            status: "not-started",
            method: "POST",
            path: "/api/generate",
            expectedStatus: 400,
            httpStatus: null,
            requestCount: 0,
            responseBodyRetained: false,
          },
        }
      : {}),
    ...(config.provider === HOSTED_PROVIDER
      ? {
          reusedConsent: false,
          liveLogin: false,
          liveInference: false,
          syntheticAuthorization: false,
          syntheticInference: false,
          hosted: {
            status: "blocked",
            authStatus: "unknown",
            lifecycle: "unknown",
            modelsStatus: "not-started",
            generationStatus: "not-started",
            testLimits: config.hostedTestLimits,
            actualBounds: config.hostedActualBounds,
            outputTokenCap: null,
          },
        }
      : {}),
    creation: {
      status: "blocked",
      operations: 0,
      firstReservationMs: null,
      seedObserved: false,
    },
    edit: {
      status: "blocked",
      type: config.mushroomReplacement
        ? "mushroom-replacement"
        : config.requireGeometryEdit
          ? "geometry"
          : "material",
      selectedIdPreserved: false,
    },
    ...(config.flagshipStory
      ? {
          flagshipStory: {
            status: "not-started",
            generationBudget: config.generationBudget,
          },
        }
      : {}),
    ...(config.mushroomReplacement
      ? {
          mushroomReplacement: {
            status: "not-started",
            generationBudget: config.generationBudget,
          },
        }
      : {}),
    ...(config.flagshipResume
      ? {
          flagshipResume: {
            status: "not-started",
            generationBudget: config.generationBudget,
            mode: config.flagshipResumeOffline ? "offline-seeded" : "live",
            stage: config.flagshipResumeStage,
            checkpoint: config.resumeCheckpoint
              ? {
                  projectId: config.resumeCheckpoint.project.id,
                  revision: config.resumeCheckpoint.project.revision,
                  sourceSnapshotSha256:
                    config.resumeCheckpoint.sourceSnapshotSha256,
                }
              : null,
          },
        }
      : {}),
    freeTrial: config.provider === "free" ? { status: "blocked" } : null,
    localRecovery: "blocked",
    export: "blocked",
    standalonePlayback: "blocked",
    publication: {
      mode: config.publication ? "real" : "blocked",
      status: config.publication ? "not-started" : "not-requested",
    },
    cloudRecovery: {
      mode: config.cloudRecovery ? "real" : "not-requested",
      status: config.cloudRecovery ? "not-started" : "not-requested",
      phases: [],
      interruptedRecovery: config.interruptedRecovery
        ? {
            mode: "real",
            status: "not-started",
            method: config.interruptionMethod,
            phases: [],
            requestCounts: [],
          }
        : undefined,
    },
    fallbackUsed: false,
    traffic: {
      generationRequests: 0,
      blockedExternalRequests: 0,
      interceptedGeneration: false,
      ...(config.provider === HOSTED_PROVIDER
        ? {
            hostedGenerationRequests: 0,
            hostedGenerationAttempts: 0,
            apiGenerationRequests: 0,
            companionGenerationRequests: 0,
            loopbackGenerationRequests: 0,
            hostedPayloadErrors: [],
            hostedViolations: [],
            hostedNDJSON: [],
          }
        : {}),
    },
    evidence: [],
    error: undefined,
  };
}

async function writeReport(report, config) {
  report.flagshipJourneyAcceptance = flagshipJourneyAcceptance(report);
  await mkdir(REPORT_DIR, { recursive: true });
  const path = join(REPORT_DIR, `${config.provider}.json`);
  const clean = JSON.parse(JSON.stringify(report));
  await writeFile(path, `${JSON.stringify(clean, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return path;
}

function storageKeyDigest(key) {
  return createHash("sha256").update(key).digest("hex");
}

export async function installTrafficGuard(
  context,
  config,
  approvedOrigins,
  info,
) {
  await context.route("**/*", async (route) => {
    const requestURL = new URL(route.request().url());
    const isApiGeneration =
      requestURL.origin === config.baseOrigin &&
      requestURL.pathname === "/api/generate" &&
      route.request().method() === "POST";
    if (isApiGeneration) {
      const allowedBudgets = config.flagshipResume ? [1, 2] : [2, 3];
      if (!allowedBudgets.includes(config.generationBudget)) {
        info.generationBudgetViolations ||= [];
        info.generationBudgetViolations.push("invalid-generation-budget");
        await route.abort("blockedbyclient");
        return;
      }
      const attempt = info.apiGenerationAttempts ?? 0;
      if (attempt >= config.generationBudget) {
        info.generationBudgetViolations ||= [];
        info.generationBudgetViolations.push("api-generation-budget-exhausted");
        await route.abort("blockedbyclient");
        return;
      }
      info.apiGenerationAttempts = attempt + 1;
    }
    if (config.provider === HOSTED_PROVIDER) {
      info.hostedViolations ||= [];
      let payload;
      const isHostedGeneration =
        requestURL.origin === config.baseOrigin &&
        requestURL.pathname === "/api/chatgpt/generate" &&
        route.request().method() === "POST";
      if (isHostedGeneration) {
        const generationCount = info.hostedGenerationAttempts ?? 0;
        info.hostedGenerationAttempts = generationCount + 1;
        try {
          payload = route.request().postDataJSON();
        } catch {
          payload = undefined;
        }
      }
      const decision = hostedRouteDecision({
        url: route.request().url(),
        method: route.request().method(),
        generationCount: isHostedGeneration
          ? info.hostedGenerationAttempts - 1
          : (info.hostedGenerationRequests ?? 0),
        consentReady: info.hostedConsentReady,
        catalogReady: info.hostedCatalogReady,
        generationBudget: config.generationBudget,
        flagshipStory: config.flagshipStory,
        interruptedRecovery: config.interruptedRecovery,
        payload,
      });
      if (decision.action === "abort") {
        info.hostedViolations.push(decision.reason);
        await route.abort("blockedbyclient");
        return;
      }
      if (
        isHostedGeneration &&
        (!info.hostedProjectValidator ||
          !info.hostedProjectValidator(payload?.project))
      ) {
        info.hostedViolations.push("invalid-hosted-project");
        await route.abort("blockedbyclient");
        return;
      }
    }
    if (
      requestURL.protocol === "data:" ||
      requestURL.protocol === "blob:" ||
      approvedOrigins.has(requestURL.origin)
    ) {
      await route.continue();
      return;
    }
    info.blockedExternalRequests += 1;
    info.blockedExternalOrigins.add(requestURL.origin || requestURL.protocol);
    await route.abort("blockedbyclient");
  });
}

function attachRequestEvidence(page, config, info) {
  page.on("request", (request) => {
    const requestURL = new URL(request.url());
    const isApiGeneration =
      requestURL.origin === config.baseOrigin &&
      requestURL.pathname === "/api/generate" &&
      request.method() === "POST";
    const isHostedGeneration =
      config.provider === HOSTED_PROVIDER &&
      requestURL.origin === config.baseOrigin &&
      requestURL.pathname === "/api/chatgpt/generate" &&
      request.method() === "POST";
    const isCompanionGeneration =
      config.provider === "chatgpt-local" &&
      requestURL.origin === config.companionURL &&
      requestURL.pathname === "/generate" &&
      request.method() === "POST";
    if (
      config.provider === HOSTED_PROVIDER &&
      request.method() === "POST" &&
      requestURL.pathname === "/generate" &&
      isLoopbackHostname(requestURL.hostname)
    )
      info.loopbackGenerationRequests += 1;
    if (!isApiGeneration && !isHostedGeneration && !isCompanionGeneration)
      return;
    info.generationRequestTimes ||= [];
    info.generationRequestTimes.push({
      request: info.generationRequests + 1,
      atMs: Date.now(),
      path: requestURL.pathname,
    });
    info.generationRequests += 1;
    if (isApiGeneration) info.apiGenerationRequests += 1;
    if (isHostedGeneration) info.hostedGenerationRequests += 1;
    if (isCompanionGeneration) info.companionGenerationRequests += 1;
    let payload;
    try {
      payload = request.postDataJSON();
    } catch {
      payload = undefined;
    }
    if (!payload || typeof payload !== "object") {
      info.interceptedGeneration = true;
      return;
    }
    if (isApiGeneration) {
      const hasKey = typeof payload.key === "string" && payload.key.length > 0;
      info.generationBodies.push({
        transport: "same-origin-api",
        provider: payload.provider,
        model: payload.model,
        hasKey,
        promptLength:
          typeof payload.prompt === "string" ? payload.prompt.length : 0,
        projectSnapshot: payload.project,
        projectId: payload.project?.id ?? null,
        projectRevision: payload.project?.revision ?? null,
        selected: typeof payload.selected === "string" ? true : false,
        selectedId:
          typeof payload.selected === "string" ? payload.selected : null,
      });
    } else if (isHostedGeneration) {
      let payloadShape;
      try {
        payloadShape = assertHostedGenerationPayload(payload, {
          browserModeling: true,
        });
      } catch (error) {
        info.hostedPayloadErrors.push(
          sanitizeMessage(
            error instanceof Error ? error.message : error,
            config,
          ),
        );
      }
      info.generationBodies.push({
        transport: "same-origin-hosted-chatgpt",
        ...(payloadShape ?? { valid: false }),
        projectSnapshot: payload.project,
        projectId: payload.project?.id ?? null,
        projectRevision: payload.project?.revision ?? null,
        selected: typeof payload.selected === "string",
        selectedId:
          typeof payload.selected === "string" ? payload.selected : null,
      });
    } else {
      const auth = request.headers().authorization || "";
      info.generationBodies.push({
        transport: "loopback-companion",
        hasCapabilityHeader: /^Bearer\s+.+$/.test(auth),
        hasProviderField: Object.hasOwn(payload, "provider"),
        hasModelField: Object.hasOwn(payload, "model"),
        hasKeyField: Object.hasOwn(payload, "key"),
        promptLength:
          typeof payload.prompt === "string" ? payload.prompt.length : 0,
        projectSnapshot: payload.project,
        projectId: payload.project?.id ?? null,
        projectRevision: payload.project?.revision ?? null,
        selected: typeof payload.selected === "string" ? true : false,
        selectedId:
          typeof payload.selected === "string" ? payload.selected : null,
      });
    }
  });
  page.on("response", (response) => {
    const responseURL = new URL(response.url());
    if (
      config.interruptedRecovery &&
      responseURL.origin === config.baseOrigin &&
      responseURL.pathname === "/api/generation-runs" &&
      response.request().method() === "PUT" &&
      response.status() === 200
    ) {
      void response
        .json()
        .then((body) => {
          if (
            body.run &&
            (!info.latestJournalRun ||
              body.run.sequence >= info.latestJournalRun.sequence)
          )
            info.latestJournalRun = body.run;
        })
        .catch(() => {});
    }
    if (
      (responseURL.pathname === "/api/generate" &&
        responseURL.origin === config.baseOrigin) ||
      (responseURL.pathname === "/api/chatgpt/generate" &&
        responseURL.origin === config.baseOrigin) ||
      (responseURL.pathname === "/generate" &&
        responseURL.origin === config.companionURL)
    ) {
      if (response.request().method() !== "POST") return;
      recordGenerationResponseEvidence(response, config, info);
      const bodyRead = response.text();
      if (
        config.provider === HOSTED_PROVIDER &&
        responseURL.pathname === "/api/chatgpt/generate"
      ) {
        info.ndjsonReads.push(
          bodyRead.then((body) => {
            const contentType = response.headers()["content-type"] || "";
            const ndjson = validateHostedNDJSON(body);
            info.hostedNDJSON.push({
              status: response.status(),
              contentType: contentType.split(";", 1)[0],
              ...ndjson,
            });
          }),
        );
      } else {
        info.diagnosticReads.push(
          bodyRead
            .then((body) => {
              if (body.length > 1000000) return;
              for (const line of body.split("\n")) {
                let record;
                try {
                  record = JSON.parse(line);
                } catch {
                  continue;
                }
                if (
                  ![
                    "INVALID_SCENE_UPDATE",
                    "INVALID_SCENE_JSON",
                    "INVALID_SCENE_PROTOCOL",
                    "TRUNCATED_SCENE_STREAM",
                  ].includes(record.code)
                )
                  continue;
                if (info.generationDiagnostics.length >= 8) break;
                info.generationDiagnostics.push({
                  code: record.code,
                  diagnostic: sanitizeMessage(
                    JSON.stringify(record.diagnostic ?? {}).slice(0, 4000),
                    config,
                  ),
                });
              }
            })
            .catch(() => {}),
        );
      }
    }
  });
}

async function assertNoStoredKey(page, config) {
  const snapshot = await storageSnapshot(
    page,
    (config.key ?? config.companionToken)
      ? storageKeyDigest(config.key ?? config.companionToken)
      : undefined,
  );
  assert.equal(
    snapshot.sensitive,
    false,
    "Provider capability appeared in browser storage.",
  );
  if (config.builderToken) {
    const builderSnapshot = await storageSnapshot(
      page,
      storageKeyDigest(config.builderToken),
    );
    assert.equal(
      builderSnapshot.sensitive,
      false,
      "Builder capability appeared in storage.",
    );
  }
  return snapshot;
}

async function prepareObserver(page) {
  await page.evaluate(() => {
    const evidence = { startedAt: performance.now(), stages: [] };
    const seen = new Set();
    const observe = () => {
      for (const button of document.querySelectorAll(".object-list button")) {
        const text = (button.textContent || "").trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        const parts = text.split(/\s+/);
        const stage =
          button.querySelector("span")?.textContent?.trim() ||
          parts.at(-1) ||
          "";
        evidence.stages.push({
          stage,
          at: performance.now() - evidence.startedAt,
        });
      }
    };
    const observer = new MutationObserver(observe);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    Object.defineProperty(window, "__orbsieProviderEvidence", {
      configurable: true,
      value: evidence,
    });
  });
}

async function observerEvidence(page) {
  return page.evaluate(() => window.__orbsieProviderEvidence || null);
}

async function waitForSavedProject(page, minRevision, assistantCount = 0) {
  const deadline = Date.now() + 180000;
  while (true) {
    const failure = page.locator(".toast.error");
    if (await failure.isVisible())
      throw new Error(
        `Generation failed before saving: ${await failure.innerText()}`,
      );
    const snapshot = await storageSnapshot(page);
    const replies =
      snapshot.project?.messages.filter(
        (message) => message.role === "assistant",
      ).length ?? 0;
    if (replies >= assistantCount) break;
    if (Date.now() >= deadline)
      throw new Error("Generation did not save a reply within 180 seconds.");
    await page.waitForTimeout(250);
  }
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0, { timeout: 180000 });
  await expect
    .poll(
      async () => {
        const snapshot = await storageSnapshot(page);
        return snapshot.revision ?? -1;
      },
      { timeout: 180000, intervals: [250, 500, 1000, 2500] },
    )
    .toBeGreaterThanOrEqual(minRevision);
  await expect(page.locator(".saved")).toHaveText("Saved on this device", {
    timeout: 30000,
  });
  const snapshot = await storageSnapshot(page);
  assert(snapshot.project, "No committed project was found in IndexedDB.");
  assert(
    snapshot.project.entities.length > 0,
    "The provider committed no entities.",
  );
  assert(snapshot.project.revision >= minRevision);
  return snapshot.project;
}

const MAX_GENERATED_MODEL_EVIDENCE_BYTES = 2 * 1024 * 1024;
const MAX_GENERATED_MODEL_EVIDENCE_TOTAL_BYTES = 6 * 1024 * 1024;
const GENERATED_MODEL_EVIDENCE_WAIT_MS = 30000;

async function readStoredGeneratedModelDigest(page, hash, includeBytes = false) {
  return page.evaluate(
    async ({ storageKey, includeBytes: shouldIncludeBytes, maxBytes }) => {
      const record = await new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onerror = () =>
          reject(request.error || Error("IndexedDB open failed"));
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("keyval")) {
            db.close();
            resolve(null);
            return;
          }
          const transaction = db.transaction("keyval", "readonly");
          const getRequest = transaction.objectStore("keyval").get(storageKey);
          getRequest.onerror = () =>
            reject(getRequest.error || Error("IndexedDB read failed"));
          getRequest.onsuccess = () => {
            const value = getRequest.result;
            db.close();
            resolve(value ?? null);
          };
        };
      });
      const value = record && typeof record === "object" ? record.glb : null;
      if (!value) return null;
      const declaredBytes =
        Number.isSafeInteger(value?.byteLength) && value.byteLength >= 0
          ? value.byteLength
          : Array.isArray(value) && value.length;
      if (Number.isSafeInteger(declaredBytes) && declaredBytes > maxBytes)
        return { bytes: declaredBytes, sha256: null, tooLarge: true };
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes),
      );
      if (bytes.byteLength > maxBytes)
        return {
          bytes: bytes.byteLength,
          sha256: [...digest]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join(""),
          tooLarge: true,
        };
      return {
        bytes: bytes.byteLength,
        sha256: [...digest]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
        ...(shouldIncludeBytes ? { glb: [...bytes] } : {}),
      };
    },
    {
      storageKey: `orbsie-model:${hash}`,
      includeBytes,
      maxBytes: MAX_GENERATED_MODEL_EVIDENCE_BYTES,
    },
  );
}

function generatedModelBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (
    Array.isArray(value) &&
    value.every(
      (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
    )
  )
    return Uint8Array.from(value);
  return null;
}

function generatedModelReferences(project) {
  const byHash = new Map();
  const invalid = [];
  for (const entity of project?.entities ?? []) {
    if (entity?.geometry?.kind !== "generated") continue;
    const model = entity.geometry.model;
    if (!model || typeof model !== "object") {
      invalid.push({
        entityIds: [entity.id],
        status: "incomplete",
        reason: "missing-model-metadata",
      });
      continue;
    }
    const hash = model.sha256;
    const bytes = model.bytes;
    if (
      typeof hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(hash) ||
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      bytes > MAX_GENERATED_MODEL_EVIDENCE_BYTES
    ) {
      invalid.push({
        entityIds: [entity.id],
        status: "incomplete",
        reason: "invalid-model-metadata",
      });
      continue;
    }
    const current = byHash.get(hash);
    if (current) {
      current.entityIds.push(entity.id);
      if (current.expectedBytes !== bytes) current.metadataConflict = true;
    } else {
      byHash.set(hash, {
        entityIds: [entity.id],
        expectedBytes: bytes,
        metadataConflict: false,
      });
    }
  }
  return { references: [...byHash].map(([sha256, reference]) => ({ sha256, ...reference })), invalid };
}

export function buildGeneratedModelEvidence(project, storedByHash) {
  const { references, invalid } = generatedModelReferences(project);
  const models = [];
  const missing = [...invalid];
  let totalBytes = 0;
  for (const reference of references) {
    const stored =
      storedByHash instanceof Map
        ? storedByHash.get(reference.sha256)
        : storedByHash?.[reference.sha256];
    if (!stored || reference.metadataConflict) {
      missing.push({
        entityIds: reference.entityIds,
        sha256: reference.sha256,
        expectedBytes: reference.expectedBytes,
        status: "incomplete",
        reason: reference.metadataConflict
          ? "conflicting-model-metadata"
          : "missing-indexeddb-record",
      });
      continue;
    }
    if (stored.tooLarge) {
      missing.push({
        entityIds: reference.entityIds,
        sha256: reference.sha256,
        expectedBytes: reference.expectedBytes,
        status: "incomplete",
        reason: "model-byte-budget-exceeded",
      });
      continue;
    }
    const bytes = generatedModelBytes(stored.glb);
    const actualHash =
      bytes && createHash("sha256").update(bytes).digest("hex");
    if (
      !bytes ||
      stored.sha256 !== reference.sha256 ||
      actualHash !== reference.sha256
    ) {
      missing.push({
        entityIds: reference.entityIds,
        sha256: reference.sha256,
        expectedBytes: reference.expectedBytes,
        status: "incomplete",
        reason: "hash-mismatch",
      });
      continue;
    }
    if (
      bytes.byteLength !== reference.expectedBytes ||
      stored.bytes !== reference.expectedBytes
    ) {
      missing.push({
        entityIds: reference.entityIds,
        sha256: reference.sha256,
        expectedBytes: reference.expectedBytes,
        status: "incomplete",
        reason: "byte-count-mismatch",
      });
      continue;
    }
    if (totalBytes + bytes.byteLength > MAX_GENERATED_MODEL_EVIDENCE_TOTAL_BYTES) {
      missing.push({
        entityIds: reference.entityIds,
        sha256: reference.sha256,
        expectedBytes: reference.expectedBytes,
        status: "incomplete",
        reason: "evidence-byte-budget-exceeded",
      });
      continue;
    }
    totalBytes += bytes.byteLength;
    models.push({
      entityIds: reference.entityIds,
      sha256: reference.sha256,
      bytes: reference.expectedBytes,
      path: `generated/${reference.sha256}.glb`,
      status: "complete",
      glb: bytes,
    });
  }
  return {
    status: missing.length === 0 ? "complete" : "incomplete",
    models,
    missing,
    totalBytes,
  };
}

async function captureStoredGeneratedModelEvidence(page, project) {
  const deadline = Date.now() + GENERATED_MODEL_EVIDENCE_WAIT_MS;
  const references = generatedModelReferences(project);
  const storedDigests = new Map();
  while (Date.now() < deadline) {
    for (const reference of references.references) {
      if (storedDigests.has(reference.sha256)) continue;
      const digest = await readStoredGeneratedModelDigest(
        page,
        reference.sha256,
      ).catch(() => null);
      if (digest) storedDigests.set(reference.sha256, digest);
    }
    const waitingForRecord = references.references.some(
      (reference) => !storedDigests.has(reference.sha256),
    );
    if (!waitingForRecord) break;
    try {
      await page.waitForTimeout(250);
    } catch {
      break;
    }
  }
  for (const reference of references.references) {
    const digest = storedDigests.get(reference.sha256);
    if (!digest) continue;
    const stored = await readStoredGeneratedModelDigest(
      page,
      reference.sha256,
      true,
    ).catch(() => null);
    storedDigests.set(reference.sha256, stored ?? digest);
  }
  return { project, storedByHash: storedDigests };
}

async function waitForTrustedBrowserBake(page, entityId) {
  await expect
    .poll(
      async () => {
        const snapshot = await storageSnapshot(page);
        const entity = snapshot.project?.entities.find(
          (candidate) => candidate.id === entityId,
        );
        const model = entity?.geometry?.model;
        return Boolean(
          entity?.stage === "ready" &&
          entity.geometry?.kind === "generated" &&
          entity.geometry.job?.backend === "browser-manifold" &&
          model?.source === "browser-manifold" &&
          typeof model.sha256 === "string" &&
          /^[a-f0-9]{64}$/.test(model.sha256) &&
          Number.isInteger(model.bytes) &&
          model.bytes > 0,
        );
      },
      { timeout: 180000, intervals: [250, 500, 1000, 2500] },
    )
    .toBe(true);
  const snapshot = await storageSnapshot(page);
  const entity = snapshot.project?.entities.find(
    (candidate) => candidate.id === entityId,
  );
  const model = entity?.geometry?.model;
  assert(
    entity && model,
    "The trusted browser bake did not produce model metadata.",
  );
  const stored = await readStoredGeneratedModelDigest(page, model.sha256);
  assert(stored, "The trusted browser GLB was not found in IndexedDB.");
  assert.equal(
    stored.sha256,
    model.sha256,
    "The trusted browser GLB hash does not match its saved metadata.",
  );
  assert.equal(
    stored.bytes,
    model.bytes,
    "The trusted browser GLB byte count does not match its saved metadata.",
  );
  return snapshot.project;
}

async function verifyInputGameBrowserBakes(page, project) {
  // Metadata acceptance above is paired with the existing IndexedDB digest
  // check so generated entities are backed by the browser's actual GLB.
  let verified = project;
  for (const entity of project.entities) {
    if (entity.geometry?.kind !== "generated") continue;
    verified = await waitForTrustedBrowserBake(page, entity.id);
  }
  return verified;
}

async function setupOutputCap(page, config) {
  if (
    config.provider === "chatgpt-local" ||
    config.provider === "free" ||
    config.provider === HOSTED_PROVIDER
  )
    return null;
  const response = await page.request.get(`${config.baseOrigin}/api/config`, {
    headers: { Origin: config.baseOrigin },
    timeout: 30000,
  });
  if (!response.ok())
    throw new HarnessBlockedError(
      `The app configuration could not be read before generation (HTTP ${response.status()}).`,
    );
  let body;
  try {
    body = await response.json();
  } catch {
    throw new HarnessBlockedError(
      "The app configuration was not JSON; generation was refused.",
    );
  }
  const observed =
    body.generationMaxTokens ?? body.outputCapTokens ?? body.maxOutputTokens;
  if (observed !== config.outputCap)
    throw new HarnessBlockedError(
      `The server did not expose the requested output cap (${config.outputCap}); generation was refused before any provider call.`,
    );
  return observed;
}

async function setupFreeTrial(page, config, report) {
  await requirePublicGenerateOrigin(page, config, report);
  const trial = await page.evaluate(async () => {
    const response = await fetch("/api/trial", {
      cache: "no-store",
      credentials: "same-origin",
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  });
  if (trial.status !== 200 || !trial.body || trial.body.enabled !== true)
    throw new HarnessBlockedError(
      "The server-owned free Gateway path is unavailable; no generation was attempted.",
    );
  if (!Number.isInteger(trial.body.remaining) || trial.body.remaining < 2)
    throw new HarnessBlockedError(
      "The server-owned free Gateway allowance has fewer than two prompts; no generation was attempted.",
    );
  report.freeTrial = {
    status: "ready",
    remainingBefore: trial.body.remaining,
    limit: Number.isInteger(trial.body.limit) ? trial.body.limit : null,
    model: config.expectedModel,
    outputCapTokens: config.outputCap,
  };
  return report.freeTrial;
}

async function readFreeTrialStatus(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/trial", {
      cache: "no-store",
      credentials: "same-origin",
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  });
}

async function recordFreeTrialFailure(page, report, info, beforeProject) {
  if (report.freeTrial === null || info.generationRequests < 1) return;
  let trialStatus = null;
  let trialBody;
  try {
    const refreshed = await readFreeTrialStatus(page);
    trialStatus = refreshed.status;
    trialBody = refreshed.body;
  } catch {
    // Keep the original generation failure and record the refresh as unavailable.
  }
  let afterProject;
  try {
    afterProject = (await storageSnapshot(page)).project;
  } catch {
    // The browser may have failed before IndexedDB was available.
  }
  report.freeTrial = {
    ...report.freeTrial,
    generationResponseRemaining: [...info.generationTrialRemaining],
    failure: buildFreeTrialFailureEvidence({
      responseRemaining: info.generationTrialRemaining.at(-1),
      trialStatus,
      trialBody,
      beforeProject,
      afterProject,
    }),
  };
}

async function configureApiProvider(page, config, report, info, evidenceDir) {
  await requirePublicGenerateOrigin(page, config, report);
  const button = page
    .getByRole("button", { name: "Connections", exact: true })
    .first();
  await expect(button).toBeVisible({ timeout: 30000 });
  const catalogResponse = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.origin === config.baseOrigin &&
        url.pathname === "/api/models" &&
        url.searchParams.get("provider") === config.provider
      );
    },
    { timeout: 30000 },
  );
  await button.click();
  await page
    .getByLabel("Provider", { exact: true })
    .selectOption(config.provider);
  const response = await catalogResponse;
  if (!response.ok())
    throw new HarnessBlockedError(
      `The live ${config.provider} model catalog was unavailable (HTTP ${response.status()}); no fallback is allowed.`,
    );
  const data = await response.json();
  const ids = Array.isArray(data.models)
    ? data.models
        .filter((model) => model && typeof model.id === "string")
        .map((model) => model.id)
    : [];
  if (!ids.includes(config.expectedModel))
    throw new HarnessBlockedError(
      `The exact expected model was absent from the live ${config.provider} catalog; no fallback is allowed.`,
    );
  const details = page.locator("details.advanced-models");
  await details.locator("summary").click();
  const row = page.locator(
    `.model-catalog-row[data-model-id="${config.expectedModel.replaceAll('"', '\\"')}"]`,
  );
  await expect(row).toHaveCount(1, { timeout: 30000 });
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: join(evidenceDir, "connection-model.png"),
    fullPage: true,
  });
  const keyInput = page.getByLabel("API key", { exact: true });
  await keyInput.fill(config.key);
  await expect(
    page.getByRole("button", {
      name: "Continue with this connection",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Continue with this connection", exact: true })
    .click();
  await expect(page.locator(".mode-button")).toContainText(
    config.provider === "openrouter" ? "OpenRouter" : "AI Gateway",
  );
  await assertNoStoredKey(page, config);
  report.evidence.push("connection-model.png");
  info.catalogModel = config.expectedModel;
}

function companionLink(config) {
  const payload = encodeURIComponent(
    JSON.stringify({ url: config.companionURL, token: config.companionToken }),
  );
  return `${config.baseOrigin}/#chatgpt=${payload}`;
}

async function configureChatGPTLocal(page, config, report, info, evidenceDir) {
  const healthResponse = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.origin === config.companionURL &&
        url.pathname === "/health" &&
        response.request().method() === "GET"
      );
    },
    { timeout: 30000 },
  );
  try {
    await page.goto(companionLink(config), { waitUntil: "domcontentloaded" });
  } catch {
    throw new HarnessBlockedError(
      "ChatGPT local connection UI could not open the explicit companion link; no generation was attempted.",
    );
  }
  let response;
  try {
    response = await healthResponse;
  } catch {
    throw new HarnessBlockedError(
      "ChatGPT local companion/UI is unavailable; the browser did not receive /health and no generation was attempted.",
    );
  }
  if (!response.ok())
    throw new HarnessBlockedError(
      `The ChatGPT local companion health check failed (HTTP ${response.status()}); no generation was attempted.`,
    );
  const health = await response.json();
  if (
    health.protocolVersion !== 1 ||
    health.effort !== "low" ||
    health.model !== config.expectedModel ||
    !["ready", "busy"].includes(health.status)
  )
    throw new HarnessBlockedError(
      "ChatGPT local companion did not advertise the exact expected model with low reasoning; no fallback is allowed.",
    );
  await expect(
    page.getByText("ChatGPT is connected on this computer.", { exact: false }),
  ).toBeVisible({
    timeout: 30000,
  });
  assert.equal(
    new URL(page.url()).hash,
    "",
    "The companion capability hash remained in the browser URL.",
  );
  const connections = page
    .getByRole("button", { name: "Connections", exact: true })
    .first();
  await connections.click();
  await expect(
    page.getByText(`ChatGPT · ${config.expectedModel} · Low reasoning.`, {
      exact: false,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: join(evidenceDir, "connection-chatgpt-local.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await assertNoStoredKey(page, config);
  report.evidence.push("connection-chatgpt-local.png");
  info.catalogModel = health.model;
}

async function configureChatGPTHosted(page, config, report, info, evidenceDir) {
  const capabilities = await sameOriginJSON(page, "/api/config");
  if (
    capabilities.status !== 200 ||
    capabilities.body?.accounts !== true ||
    capabilities.body?.chatgptHosted !== true ||
    capabilities.body?.chatgptGeneration !== true
  )
    throw new HarnessBlockedError(
      "Hosted ChatGPT generation is unavailable on this deployment; no generation was attempted.",
    );
  const consent = await statusFirstHostedGate({
    readHostedStatus: async () => {
      const result = await sameOriginJSON(page, "/api/chatgpt/status");
      if (result.status !== 200)
        throw new HarnessBlockedError(
          `The hosted ChatGPT status check returned HTTP ${result.status}; sign in to Orbsie and complete ChatGPT device consent before rerunning. No generation was attempted.`,
        );
      return result.body;
    },
    readOrbsieSession: async () => {
      const result = await sameOriginJSON(page, "/api/auth/get-session");
      if (result.status !== 200) return null;
      return result.body;
    },
  });
  report.reusedConsent = consent.reusedConsent;
  report.hosted.status = "connected";
  report.hosted.authStatus = consent.authStatus;
  report.hosted.lifecycle = consent.lifecycle;
  info.reusedConsent = true;
  info.hostedConsentReady = true;

  const modelsResponse = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.origin === config.baseOrigin &&
        url.pathname === "/api/chatgpt/models" &&
        response.request().method() === "GET"
      );
    },
    { timeout: 30000 },
  );
  const connections = page
    .getByRole("button", { name: "Connections", exact: true })
    .first();
  await expect(connections).toBeVisible({ timeout: 30000 });
  await connections.click();
  const response = await modelsResponse;
  if (!response.ok())
    throw new HarnessBlockedError(
      `The hosted ChatGPT model catalog returned HTTP ${response.status()}; no fallback was selected and no generation was attempted.`,
    );
  let catalog;
  try {
    catalog = await response.json();
  } catch {
    throw new HarnessBlockedError(
      "The hosted ChatGPT model catalog was not JSON; no generation was attempted.",
    );
  }
  let expected;
  try {
    expected = assertHostedModelCatalog(catalog);
  } catch (error) {
    if (error instanceof HostedAcceptanceBlockedError)
      throw new HarnessBlockedError(error.message);
    throw error;
  }
  const modelSelect = page.getByLabel("ChatGPT model", { exact: true });
  await expect(modelSelect).toBeVisible({ timeout: 30000 });
  await modelSelect.selectOption(config.expectedModel);
  await expect(modelSelect).toHaveValue(config.expectedModel);
  const effortSelect = page.getByLabel("ChatGPT reasoning", { exact: true });
  await effortSelect.selectOption(HOSTED_EFFORT);
  await expect(effortSelect).toHaveValue(HOSTED_EFFORT);
  info.hostedCatalogReady = true;
  await expect(
    page.getByRole("button", { name: "Use ChatGPT", exact: false }),
  ).toBeEnabled();
  await page.screenshot({
    path: join(evidenceDir, "connection-chatgpt-hosted.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use ChatGPT", exact: false }).click();
  await expect(page.locator(".mode-button")).toContainText(
    `ChatGPT · ${config.expectedModel}`,
  );
  await assertNoStoredKey(page, config);
  report.hosted.modelsStatus = "passed";
  report.hosted.catalogModel = expected.model;
  report.hosted.catalogEffort = expected.effort;
  report.evidence.push("connection-chatgpt-hosted.png");
  info.catalogModel = expected.model;
  info.catalogEffort = expected.effort;
}

function assertGenerationRequests(config, info) {
  if (config.provider === HOSTED_PROVIDER) {
    const expectedCount = config.generationBudget;
    assert.equal(
      info.hostedGenerationRequests,
      expectedCount,
      `Expected exactly ${expectedCount} hosted ChatGPT generation requests, observed ${info.hostedGenerationRequests}.`,
    );
    assert.equal(
      info.hostedGenerationAttempts,
      expectedCount,
      `Expected exactly ${expectedCount} hosted ChatGPT generation attempts, observed ${info.hostedGenerationAttempts}.`,
    );
    assert.equal(
      info.apiGenerationRequests,
      0,
      "Hosted ChatGPT acceptance made an unexpected /api/generate request.",
    );
    assert.equal(
      info.companionGenerationRequests,
      0,
      "Hosted ChatGPT acceptance made an unexpected companion generation request.",
    );
    assert.equal(
      info.loopbackGenerationRequests,
      0,
      "Hosted ChatGPT acceptance made an unexpected loopback generation request.",
    );
    assert.deepEqual(
      info.hostedViolations,
      [],
      "Hosted ChatGPT acceptance blocked a forbidden request.",
    );
    assert.equal(
      info.interceptedGeneration,
      false,
      "A hosted ChatGPT generation request was not a complete live request.",
    );
    assert.deepEqual(
      info.generationStatuses,
      Array.from({ length: expectedCount }, () => 200),
      `Hosted ChatGPT generation did not return ${expectedCount} successful responses.`,
    );
    assert.deepEqual(
      info.hostedPayloadErrors,
      [],
      "A hosted ChatGPT generation payload violated the browser-only contract.",
    );
    assert.equal(
      info.hostedNDJSON.length,
      expectedCount,
      `Hosted ChatGPT did not produce ${expectedCount} observed NDJSON responses.`,
    );
    for (const response of info.hostedNDJSON) {
      assert.equal(response.status, 200);
      assert.equal(response.contentType, "application/x-ndjson");
      assert.equal(response.valid, true);
      assert(response.recordCount > 0);
    }
    return;
  }
  const expectedCount = config.generationBudget;
  assert.equal(
    info.generationRequests,
    expectedCount,
    config.flagshipResume
      ? config.flagshipResumeStage === "creation"
        ? `Expected exactly two live generation requests for the creation-stage flagship continuation, observed ${info.generationRequests}.`
        : `Expected exactly one live generation request for the flagship checkpoint resume, observed ${info.generationRequests}.`
      : config.interruptedRecovery
      ? `Expected exactly three live generation requests (interrupted creation, continuation, and edit), observed ${info.generationRequests}.`
      : config.flagshipStory
      ? `Expected exactly three live generation requests (creation, selected mushroom edit, and platform edit), observed ${info.generationRequests}.`
      : `Expected exactly two live generation requests (creation and edit), observed ${info.generationRequests}.`,
  );
  assert.equal(
    info.interceptedGeneration,
    false,
    "A generation request was not a complete live request.",
  );
  if (config.interruptedRecovery) {
    assert.equal(
      info.generationStatuses.length,
      expectedCount,
      "The interrupted-recovery transport did not return exactly the configured generation count.",
    );
    assert(
      info.generationStatuses.every((status) => status === 200),
      "A live interrupted-recovery transport returned a non-success response.",
    );
    assert(
      info.generationStatuses.length >= 2,
      "The continuation and edit did not both return successful responses.",
    );
  } else {
    assert.deepEqual(
      info.generationStatuses,
      Array.from({ length: expectedCount }, () => 200),
      `A live generation transport did not return ${expectedCount} successful responses.`,
    );
  }
  if (config.provider === "chatgpt-local") {
    for (const body of info.generationBodies) {
      assert.equal(body.transport, "loopback-companion");
      assert.equal(body.hasCapabilityHeader, true);
      assert.equal(body.hasProviderField, false);
      assert.equal(body.hasModelField, false);
      assert.equal(body.hasKeyField, false);
    }
  } else if (config.provider === "free") {
    for (const body of info.generationBodies) {
      assert.equal(body.transport, "same-origin-api");
      assert.equal(body.provider, "free");
      assert.equal(body.model, "");
      assert.equal(body.hasKey, false);
    }
  } else {
    for (const body of info.generationBodies) {
      assert.equal(body.transport, "same-origin-api");
      assert.equal(body.provider, config.provider);
      assert.equal(body.model, config.expectedModel);
      assert.equal(body.hasKey, true);
    }
  }
}

function assertBrowserGeneratedGeometryMetadata(geometry, label) {
  assert(
    geometry && geometry.kind === "generated",
    `${label} must use generated geometry for a browser-built original model.`,
  );
  const job = geometry.job;
  assert(
    job && job.backend === "browser-manifold",
    `${label} must retain a browser-manifold modeling job.`,
  );
  assert(
    !Object.hasOwn(geometry, "url") &&
      !Object.hasOwn(job, "url") &&
      !Object.hasOwn(geometry.model ?? {}, "url"),
    `${label} contains an external model URL.`,
  );

  const model = geometry.model;
  assert(
    model &&
      model.source === "browser-manifold" &&
      /^[a-f0-9]{64}$/.test(model.sha256) &&
      Number.isInteger(model.bytes) &&
      model.bytes > 0,
    `${label} does not contain baked browser-manifold model metadata.`,
  );

  const authoring = job.authoring;
  if (authoring === undefined) return;
  const source = authoring.source;
  assert(
    source &&
      source.version === 1 &&
      source.language === "quickjs" &&
      Number.isInteger(source.seed) &&
      typeof source.code === "string" &&
      source.code.length > 0 &&
      /^[a-f0-9]{64}$/.test(authoring.sourceHash),
    `${label} has invalid browser procedural source provenance.`,
  );
  const canonicalSource = {
    version: source.version,
    language: source.language,
    code: source.code,
    seed: source.seed,
  };
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(canonicalSource), "utf8")
      .digest("hex"),
    authoring.sourceHash,
    `${label} has a mismatched browser procedural source hash.`,
  );
}

export function assertInputGameProject(
  project,
  label = "Input game project",
  canonicalProjectValidator,
) {
  if (canonicalProjectValidator)
    assert(
      canonicalProjectValidator(project),
      `${label} failed canonical project validation.`,
    );
  assert(
    project && Array.isArray(project.entities),
    `${label} has no entities.`,
  );
  assert.equal(
    project.entities.length,
    2,
    `${label} must contain exactly the requested tree and mushroom entities.`,
  );
  const entityDescriptions = project.entities.map((entity) => {
    assert.equal(entity.stage, "ready", `${label} has unfinished geometry.`);
    if (
      entity.geometry &&
      ["tree", "mushroom", "custom"].includes(entity.geometry.kind)
    ) {
      // Existing procedural/custom geometry remains a valid original object.
    } else if (entity.geometry?.kind === "generated") {
      assertBrowserGeneratedGeometryMetadata(
        entity.geometry,
        `${label} entity ${entity.id}`,
      );
    } else {
      assert(false, `${label} contains a non-procedural/non-custom entity.`);
    }
    assert.equal(
      entity.geometry.detail,
      "refined",
      `${label} contains geometry that is not refined.`,
    );
    return `${entity.id} ${entity.label} ${entity.geometry.kind}`.toLowerCase();
  });
  const treeIndex = entityDescriptions.findIndex((value) =>
    value.includes("tree"),
  );
  const mushroomIndex = entityDescriptions.findIndex((value) =>
    value.includes("mushroom"),
  );
  assert(treeIndex >= 0, `${label} has no tree entity.`);
  assert(mushroomIndex >= 0, `${label} has no mushroom entity.`);
  assert.notEqual(
    treeIndex,
    mushroomIndex,
    `${label} must contain separate tree and mushroom entities.`,
  );

  const game = project.game;
  assert(game && Array.isArray(game.rules), `${label} has no game program.`);
  assert.equal(
    game.rules.length,
    3,
    `${label} must contain exactly three rules.`,
  );
  assert.equal(
    game.variables?.length ?? 0,
    0,
    `${label} must not add game variables for this input-only scenario.`,
  );
  const expected = new Map([
    ["right", [{ type: "add_score", amount: 7 }]],
    ["up", [{ type: "win" }]],
    ["left", [{ type: "lose" }]],
  ]);
  const actions = new Set();
  for (const rule of game.rules) {
    assert.equal(rule.trigger?.type, "input", `${label} has a non-input rule.`);
    const action = rule.trigger.action;
    assert(!actions.has(action), `${label} repeats input ${action}.`);
    actions.add(action);
    assert(expected.has(action), `${label} has unexpected input ${action}.`);
    assert.deepEqual(rule.conditions ?? [], [], `${label} adds a condition.`);
    assert.deepEqual(rule.actions, expected.get(action));
  }
  assert.deepEqual([...actions].sort(), ["left", "right", "up"]);
  return {
    entityCount: project.entities.length,
    treeAndMushroom: true,
    refinedGeometry: true,
    exactRuleCount: true,
    rightAdds7: true,
    upWins: true,
    leftLoses: true,
    noTimersOrCollectionScoring: true,
  };
}

function storyEntityText(entity) {
  return `${entity?.label ?? ""} ${entity?.geometry?.kind ?? ""}`.toLowerCase();
}

function storyTreeEvidence(entity) {
  const geometry = entity?.geometry;
  if (geometry?.kind === "tree") return "supported-geometry-kind";
  if (
    STORY_TREE_LABEL_KINDS.has(geometry?.kind) &&
    /\btree\b/i.test(String(entity.label ?? ""))
  )
    return "supported-kind-tree-label";
  if (geometry?.kind !== "asset") return null;
  const asset = STORY_CATALOG_ASSETS.get(geometry.assetId);
  if (!asset) return null;
  if (asset.tags?.includes("tree")) return "catalog-tree-tag";
  return null;
}

function storyMushroomEvidence(entity) {
  const geometry = entity?.geometry;
  if (geometry?.kind === "mushroom") return "supported-geometry-kind";
  if (
    STORY_MUSHROOM_LABEL_KINDS.has(geometry?.kind) &&
    /\bmushroom\b/i.test(String(entity.label ?? ""))
  )
    return "supported-kind-mushroom-label";
  if (geometry?.kind !== "asset") return null;
  const asset = STORY_CATALOG_ASSETS.get(geometry.assetId);
  if (asset?.tags?.includes("mushroom")) return "catalog-mushroom-tag";
  return null;
}

function storyCollectibles(project) {
  return project.entities.filter(
    (entity) => entity.stage === "ready" && entity.behavior?.type === "collect",
  );
}

function storyPlatformMotionWriters(project, entityId) {
  const rules = project?.game?.rules;
  if (!Array.isArray(rules)) return [];
  const writers = [];
  for (const rule of rules) {
    if (!Array.isArray(rule.actions)) continue;
    rule.actions.forEach((action, actionIndex) => {
      if (
        (action?.type === "move_path" || action?.type === "set_position") &&
        action.entityId === entityId
      )
        writers.push({ rule, action, actionIndex });
    });
  }
  return writers;
}

function storyActiveStartPath(project, entityId) {
  const writers = storyPlatformMotionWriters(project, entityId);
  assert(
    writers.length <= 1,
    `Story platform ${entityId} has conflicting motion writers.`,
  );
  const writer = writers[0];
  if (
    !writer ||
    writer.action.type !== "move_path" ||
    writer.rule.trigger?.type !== "start" ||
    (writer.rule.conditions ?? []).length !== 0
  )
    return null;
  const points = writer.action.points;
  const validPoints =
    Array.isArray(points) &&
    points.length >= 2 &&
    points.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 3 &&
        point.every((value) => Number.isFinite(value)),
    );
  const nondegenerate =
    validPoints &&
    points.some((point, index) => {
      if (index === 0) return false;
      return point.some((value, axis) => value !== points[index - 1][axis]);
    });
  const validDuration =
    Number.isFinite(writer.action.duration) && writer.action.duration > 0;
  const validLoop =
    writer.action.loop === undefined || typeof writer.action.loop === "boolean";
  if (!validPoints || !nondegenerate || !validDuration || !validLoop)
    return null;
  return writer;
}

function storyPlatforms(project) {
  const candidates = project.entities
    .filter((entity) => {
      if (
        entity.stage !== "ready" ||
        !/\bplatform\b/.test(storyEntityText(entity))
      )
        return false;
        if (entity.behavior?.type === "move") {
          storyActiveStartPath(project, entity.id);
          return true;
        }
      return (
        entity.behavior?.type === "bounce" &&
        Boolean(storyActiveStartPath(project, entity.id))
      );
    });
  const spawn =
    Array.isArray(project.game?.spawn) &&
    project.game.spawn.length === 3 &&
    project.game.spawn.every(Number.isFinite)
      ? project.game.spawn
      : [0, 0.5, 5];
  const distanceSquared = (from, to) =>
    from.reduce((sum, component, axis) => sum + (component - to[axis]) ** 2, 0);
  const route = [];
  let anchor = spawn;
  while (candidates.length > 0) {
    candidates.sort(
      (a, b) =>
        distanceSquared(anchor, a.position) -
          distanceSquared(anchor, b.position) ||
        a.id.localeCompare(b.id),
    );
    const next = candidates.shift();
    route.push(next);
    anchor = next.position;
  }
  return route;
}

export function assertFlagshipStoryCreation(project) {
  assert(
    project && Array.isArray(project.entities),
    "Story project has no entities.",
  );
  const trees = project.entities.filter((entity) => storyTreeEvidence(entity));
  const platforms = storyPlatforms(project);
  const collectibles = storyCollectibles(project);
  const ponds = project.entities.filter((entity) =>
    /\bpond\b/.test(storyEntityText(entity)),
  );
  const portals = project.entities.filter(
    (entity) => entity.stage === "ready" && entity.behavior?.type === "portal",
  );
  assert(trees.length >= 1, "Story creation must contain a friendly tree.");
  assert.equal(
    platforms.length,
    3,
    "Story creation must contain three moving platforms.",
  );
  assert.equal(
    collectibles.length,
    5,
    "Story creation must contain five collectibles.",
  );
  assert.equal(ponds.length, 1, "Story creation must contain one pond.");
  assert.equal(portals.length, 1, "Story creation must contain one portal.");
  for (const entity of [
    ...trees,
    ...platforms,
    ...collectibles,
    ...ponds,
    ...portals,
  ])
    assert.equal(
      entity.stage,
      "ready",
      `Story entity ${entity.id} is unfinished.`,
    );
  return {
    tree: trees[0],
    middlePlatform: platforms[1],
    collectibles,
    trees,
    platforms,
    portal: portals[0],
  };
}

function storyObjectiveEvidence(project, label) {
  const collectibles = storyCollectibles(project);
  const portals = project.entities.filter(
    (entity) => entity.stage === "ready" && entity.behavior?.type === "portal",
  );
  assert.equal(portals.length, 1, `${label} must have one portal.`);
  const winningRules = (project.game?.rules ?? []).filter((rule) =>
    storyPortalWinRule(rule, portals[0].id),
  );
  assert.equal(
    winningRules.length,
    1,
    `${label} must have one portal win rule.`,
  );
  const condition = storyCrystalGoalCondition(winningRules[0]);
  assert(condition, `${label} portal win rule has no crystals objective.`);
  return {
    collectibleIds: collectibles.map((entity) => entity.id),
    collectibleCount: collectibles.length,
    portalId: portals[0].id,
    portalComparison: condition.condition.comparison,
    portalThreshold: condition.condition.value,
  };
}

function freshGameplayStoryForProject(
  project,
  expectedCollectibleCount,
  label,
) {
  const platforms = storyPlatforms(project);
  const collectibles = storyCollectibles(project);
  const portals = project.entities.filter(
    (entity) => entity.stage === "ready" && entity.behavior?.type === "portal",
  );
  assert.equal(platforms.length, 3, `${label} must retain three platforms.`);
  assert.equal(
    collectibles.length,
    expectedCollectibleCount,
    `${label} has the wrong collectible count.`,
  );
  assert.equal(portals.length, 1, `${label} must retain one portal.`);
  return { platforms, collectibles, portal: portals[0] };
}

function storyEntityMap(project) {
  return new Map(project.entities.map((entity) => [entity.id, entity]));
}

function assertStoryUnchangedEntities(before, after, excludedIds) {
  const previous = storyEntityMap(before);
  const current = storyEntityMap(after);
  for (const [id, entity] of previous) {
    if (excludedIds.has(id)) continue;
    assert.deepEqual(
      current.get(id),
      entity,
      `Story edit changed unrelated entity ${id}.`,
    );
  }
}

function isPink(value) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return false;
  const red = Number.parseInt(value.slice(1, 3), 16);
  const green = Number.parseInt(value.slice(3, 5), 16);
  const blue = Number.parseInt(value.slice(5, 7), 16);
  return red >= 160 && blue >= 120 && red > green && blue > green;
}

function scaledModelBoundsSize(bounds, scale) {
  if (
    !bounds ||
    !Array.isArray(bounds.min) ||
    !Array.isArray(bounds.max) ||
    bounds.min.length !== 3 ||
    bounds.max.length !== 3 ||
    !Array.isArray(scale) ||
    scale.length !== 3 ||
    ![...bounds.min, ...bounds.max, ...scale].every(Number.isFinite)
  ) {
    return null;
  }
  return [0, 1, 2].map(
    (axis) =>
      Math.abs(bounds.max[axis] - bounds.min[axis]) * Math.abs(scale[axis]),
  );
}

function storyEntityBounds(entity) {
  const modelBounds = entity?.geometry?.model?.bounds;
  if (scaledModelBoundsSize(modelBounds, [1, 1, 1]))
    return { bounds: modelBounds, source: "model" };
  if (entity?.geometry?.kind === "asset") {
    const catalogBounds = STORY_CATALOG_ASSETS.get(
      entity.geometry.assetId,
    )?.bounds;
    if (scaledModelBoundsSize(catalogBounds, [1, 1, 1]))
      return { bounds: catalogBounds, source: "catalog" };
  }
  return { bounds: null, source: "missing" };
}

function storyPortalWinRule(rule, portalId) {
  return (
    rule?.trigger?.type === "collision" &&
    rule.trigger.entityId === portalId &&
    Array.isArray(rule.actions) &&
    rule.actions.some((action) => action?.type === "win")
  );
}

function storyCrystalGoalCondition(rule) {
  const matches = (rule?.conditions ?? []).flatMap((condition, index) =>
    condition?.operand?.type === "variable" &&
    condition.operand.name === "crystals" &&
    ["eq", "gte"].includes(condition.comparison)
      ? [{ condition, index }]
      : [],
  );
  return matches.length === 1 ? matches[0] : null;
}

function storyRulesById(project, label) {
  const rules = project?.game?.rules;
  assert(Array.isArray(rules), `${label} has no game rules.`);
  const byId = new Map();
  for (const rule of rules) {
    assert(
      typeof rule?.id === "string" && !byId.has(rule.id),
      `${label} has ambiguous game rule IDs.`,
    );
    byId.set(rule.id, rule);
  }
  return { rules, byId };
}

function storyNormalizedPathRule(writer) {
  return {
    ...writer.rule,
    actions: writer.rule.actions.map((action, index) =>
      index === writer.actionIndex
        ? {
            ...action,
            duration: "__path_duration__",
            loop: action.loop ?? false,
          }
        : action,
    ),
  };
}

function storyNormalizedGoalRule(rule, conditionIndex) {
  return {
    ...rule,
    conditions: (rule.conditions ?? []).map((condition, index) =>
      index === conditionIndex
        ? { ...condition, value: "__goal_threshold__" }
        : condition,
    ),
  };
}

function assertStoryPlatformRules(before, after, beforePath, afterPath) {
  const beforeHasGame = before?.game !== undefined;
  const afterHasGame = after?.game !== undefined;
  if (!beforeHasGame && !afterHasGame) return;
  assert(
    beforeHasGame && afterHasGame,
    "Story platform edit changed the presence of the game program.",
  );
  const previous = storyRulesById(before, "Story platform baseline");
  const current = storyRulesById(after, "Story platform edit");
  const previousPortals = before.entities.filter(
    (entity) => entity.stage === "ready" && entity.behavior?.type === "portal",
  );
  const currentPortals = after.entities.filter(
    (entity) => entity.stage === "ready" && entity.behavior?.type === "portal",
  );
  assert.equal(
    previousPortals.length,
    1,
    "Story platform baseline must have one portal entity.",
  );
  assert.equal(
    currentPortals.length,
    1,
    "Story platform edit must preserve one portal entity.",
  );
  const portalId = previousPortals[0].id;
  assert.equal(
    currentPortals[0].id,
    portalId,
    "Story platform edit replaced the portal entity.",
  );
  const previousGoalRules = previous.rules.filter((rule) =>
    storyPortalWinRule(rule, portalId),
  );
  const currentGoalRules = current.rules.filter((rule) =>
    storyPortalWinRule(rule, portalId),
  );
  assert.equal(
    previousGoalRules.length,
    1,
    "Story platform baseline must have one portal win rule.",
  );
  assert.equal(
    currentGoalRules.length,
    1,
    "Story platform edit must preserve one portal win rule.",
  );
  const previousGoal = previousGoalRules[0];
  const currentGoal = currentGoalRules[0];
  assert.equal(
    currentGoal.id,
    previousGoal.id,
    "Story platform edit replaced the portal win rule.",
  );
  const previousGoalCondition = storyCrystalGoalCondition(previousGoal);
  const currentGoalCondition = storyCrystalGoalCondition(currentGoal);
  assert(
    previousGoalCondition && currentGoalCondition,
    "Story platform edit must preserve the crystal portal threshold rule.",
  );
  assert(
    previousGoalCondition.condition.value === 5,
    "Story platform baseline must require five crystals.",
  );
  assert.equal(
    currentGoalCondition.condition.value,
    7,
    "Story platform edit must reconcile the portal goal to seven crystals.",
  );
  const previousPathId = beforePath?.rule.id;
  const currentPathId = afterPath?.rule.id;
  assert.equal(
    currentPathId,
    previousPathId,
    "Story platform edit replaced the active platform path rule.",
  );
  for (const rule of previous.rules) {
    const editedRule = current.byId.get(rule.id);
    assert(
      editedRule,
      `Story platform edit removed unrelated rule ${rule.id}.`,
    );
    if (rule.id === previousGoal.id) {
      assert.deepEqual(
        storyNormalizedGoalRule(editedRule, currentGoalCondition.index),
        storyNormalizedGoalRule(rule, previousGoalCondition.index),
        "Story platform edit changed the portal rule beyond goal reconciliation.",
      );
    } else if (rule.id === previousPathId) {
      assert.deepEqual(
        storyNormalizedPathRule(afterPath),
        storyNormalizedPathRule(beforePath),
        "Story platform edit changed the active path beyond its duration.",
      );
    } else {
      assert.deepEqual(
        editedRule,
        rule,
        `Story platform edit changed unrelated rule ${rule.id}.`,
      );
    }
  }
  const addedRules = current.rules.filter(
    (rule) => !previous.byId.has(rule.id),
  );
  assert.equal(
    addedRules.length,
    2,
    "Story platform edit must add exactly two collectible rules.",
  );
  const previousCollectibleIds = new Set(
    storyCollectibles(before).map((entity) => entity.id),
  );
  const previousCollectScoreAmounts = previous.rules.flatMap((rule) => {
    if (
      rule.trigger?.type !== "collect" ||
      !previousCollectibleIds.has(rule.trigger.entityId)
    )
      return [];
    return (rule.actions ?? [])
      .filter(
        (action) =>
          action?.type === "add_score" &&
          Number.isFinite(action.amount) &&
          action.amount > 0,
      )
      .map((action) => action.amount);
  });
  assert(
    previousCollectScoreAmounts.length > 0 &&
      previousCollectScoreAmounts.every(
        (amount) => amount === previousCollectScoreAmounts[0],
      ),
    "Story platform baseline has no consistent positive collectible score.",
  );
  const collectibleScoreAmount = previousCollectScoreAmounts[0];
  const addedCollectibleIds = new Set(
    storyCollectibles(after)
      .filter((entity) => !previousCollectibleIds.has(entity.id))
      .map((entity) => entity.id),
  );
  assert.equal(
    addedCollectibleIds.size,
    2,
    "Story platform edit must add two collectible entities for its new rules.",
  );
  const addedRuleTargets = new Set();
  for (const rule of addedRules) {
    const target =
      rule.trigger?.type === "collect" ? rule.trigger.entityId : null;
    assert(
      addedCollectibleIds.has(target) && !addedRuleTargets.has(target),
      "Story platform edit added an unrelated or duplicate game rule.",
    );
    addedRuleTargets.add(target);
    assert.deepEqual(
      rule.conditions ?? [],
      [],
      `Story collectible rule ${rule.id} has an unexpected condition.`,
    );
    assert(
      Array.isArray(rule.actions),
      `Story collectible rule ${rule.id} has no actions.`,
    );
    assert(
      rule.actions.some(
        (action) =>
          action?.type === "add_variable" &&
          action.name === "crystals" &&
          action.amount === 1,
      ),
      `Story collectible rule ${rule.id} does not increment crystals.`,
    );
    assert(
      rule.actions.some(
        (action) =>
          action?.type === "add_score" &&
          action.amount === collectibleScoreAmount,
      ),
      `Story collectible rule ${rule.id} does not increment score.`,
    );
  }
}

export function assertFlagshipStoryMushroom(before, after, treeId) {
  const beforeEntity = storyEntityMap(before).get(treeId);
  const afterEntity = storyEntityMap(after).get(treeId);
  assert(beforeEntity && afterEntity, "Story mushroom target disappeared.");
  const mushroomEvidence = storyMushroomEvidence(afterEntity);
  assert(
    mushroomEvidence,
    "Story mushroom edit did not provide supported mushroom evidence.",
  );
  assert.notDeepEqual(
    afterEntity.geometry,
    beforeEntity.geometry,
    "Story mushroom edit did not change geometry.",
  );
  const beforeBoundsEvidence = storyEntityBounds(beforeEntity);
  const afterBoundsEvidence = storyEntityBounds(afterEntity);
  const beforeBounds = beforeBoundsEvidence.bounds;
  const afterBounds = afterBoundsEvidence.bounds;
  const rawBoundsExpanded =
    beforeBounds &&
    afterBounds &&
    [0, 1, 2].some(
      (axis) =>
        afterBounds.max[axis] - afterBounds.min[axis] >
        beforeBounds.max[axis] - beforeBounds.min[axis],
    );
  const beforeSize = scaledModelBoundsSize(beforeBounds, beforeEntity.scale);
  const afterSize = scaledModelBoundsSize(afterBounds, afterEntity.scale);
  const transformedBoundsExpanded =
    beforeSize &&
    afterSize &&
    afterSize.some((size, axis) => size > beforeSize[axis]);
  const dimensions = {
    status: beforeSize && afterSize ? "observed" : "inconclusive",
    source: {
      before: beforeBoundsEvidence.source,
      after: afterBoundsEvidence.source,
    },
    before: beforeSize,
    after: afterSize,
  };
  assert(
    isPink(afterEntity.color) || isPink(afterEntity.geometry?.tint),
    "Story mushroom edit did not produce a pink material.",
  );
  assert.equal(after.entities.length, before.entities.length);
  assertStoryUnchangedEntities(before, after, new Set([treeId]));
  assert.deepEqual(after.environment, before.environment);
  return {
    targetId: treeId,
    label: afterEntity.label,
    mushroomEvidence,
    rawBoundsExpanded: Boolean(rawBoundsExpanded),
    transformedBoundsExpanded: Boolean(transformedBoundsExpanded),
    dimensions,
    sizeVisualReview: "pending",
  };
}

export function assertMushroomReplacement(before, after, treeId) {
  const check = assertFlagshipStoryMushroom(before, after, treeId);
  const afterEntity = storyEntityMap(after).get(treeId);
  const geometry = afterEntity?.geometry;
  const supportedCatalog =
    geometry?.kind === "asset" &&
    check.mushroomEvidence === "catalog-mushroom-tag";
  const supportedBrowserModel =
    geometry?.kind === "generated" &&
    geometry.job?.backend === "browser-manifold" &&
    geometry.model?.source === "browser-manifold";
  assert(
    supportedCatalog || supportedBrowserModel,
    "Mushroom replacement must use a catalog mushroom or trusted browser-generated geometry.",
  );
  assert.equal(
    check.dimensions.status,
    "observed",
    "Mushroom replacement did not provide before/after physical bounds.",
  );
  assert(
    check.transformedBoundsExpanded,
    "Mushroom replacement did not expand any scaled physical dimension.",
  );
  assert.deepEqual(
    after.game,
    before.game,
    "Mushroom replacement changed the game program.",
  );
  assert.deepEqual(
    after.groups,
    before.groups,
    "Mushroom replacement changed unrelated scene groups.",
  );
  assert.equal(
    after.id,
    before.id,
    "Mushroom replacement changed project identity.",
  );
  assert.equal(
    after.seed,
    before.seed,
    "Mushroom replacement changed project seed.",
  );
  return {
    ...check,
    supportedGeometry: supportedCatalog ? "catalog" : "browser-generated",
    physicalSizeExpansion: check.transformedBoundsExpanded,
    sizeVisualReview: "pending",
  };
}

export function selectMushroomReplacementTree(project) {
  const tree = project?.entities?.find(
    (entity) => entity.stage === "ready" && storyTreeEvidence(entity),
  );
  assert(tree, "Mushroom replacement creation must contain a ready tree.");
  return { tree };
}

function pickSnapshotFields(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    fields.flatMap((field) =>
      Object.prototype.hasOwnProperty.call(value, field)
        ? [[field, persistenceJSON(value[field])]]
        : [],
    ),
  );
}

function sanitizedSnapshotGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return geometry;
  const base = pickSnapshotFields(geometry, [
    "kind",
    "detail",
    "tint",
    "assetId",
    "collision",
    "parts",
  ]);
  if (geometry.kind === "generated") {
    if (geometry.job)
      base.job = pickSnapshotFields(geometry.job, [
        "backend",
        "version",
        "parts",
        "recipe",
        "authoring",
      ]);
    if (geometry.model)
      base.model = pickSnapshotFields(geometry.model, [
        "version",
        "sha256",
        "bytes",
        "source",
        "kernelVersion",
        "blenderVersion",
        "bounds",
        "createdAt",
      ]);
  }
  return base;
}

export function sanitizedMushroomReplacementSnapshot(project) {
  const snapshot = pickSnapshotFields(project, [
    "version",
    "id",
    "title",
    "seed",
    "revision",
    "groups",
    "environment",
    "game",
    "messages",
  ]);
  snapshot.entities = Array.isArray(project?.entities)
    ? project.entities.map((entity) => {
        const sanitized = pickSnapshotFields(entity, [
          "id",
          "label",
          "position",
          "scale",
          "rotation",
          "parentId",
          "color",
          "behavior",
          "assetPolicy",
          "stage",
        ]);
        if (entity.geometry)
          sanitized.geometry = sanitizedSnapshotGeometry(entity.geometry);
        return sanitized;
      })
    : [];
  return snapshot;
}

export async function persistMushroomReplacementSnapshot(
  report,
  evidenceDir,
  phase,
  project,
) {
  const filename = `mushroom-replacement-${phase}.json`;
  const snapshot = sanitizedMushroomReplacementSnapshot(project);
  assert(snapshot, `Mushroom replacement ${phase} snapshot is empty.`);
  await writeFile(
    join(evidenceDir, filename),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  if (!report.evidence.includes(filename)) report.evidence.push(filename);
  return filename;
}

export function assertFlagshipStoryPlatform(before, after, platformId) {
  const beforeMap = storyEntityMap(before);
  const afterMap = storyEntityMap(after);
  const beforePlatform = beforeMap.get(platformId);
  const afterPlatform = afterMap.get(platformId);
  assert(beforePlatform && afterPlatform, "Story middle platform disappeared.");
  const beforePath = storyActiveStartPath(before, platformId);
  const afterPath = storyActiveStartPath(after, platformId);
  const beforeUsesPath = Boolean(beforePath);
  const beforeSpeed = beforePlatform.behavior?.speed;
  const afterSpeed = afterPlatform.behavior?.speed;
  if (beforeUsesPath) {
    assert(
      beforePath,
      "Story middle platform had no valid active start path.",
    );
    assert.equal(
      afterPlatform.behavior?.type,
      beforePlatform.behavior?.type,
      "Story middle platform changed its path composition.",
    );
    assert(
      afterPath,
      "Story middle platform lost its active start path.",
    );
    assert(
      afterPath.action.duration > beforePath.action.duration,
      "Story middle platform path duration did not increase while staying positive.",
    );
    assert.deepEqual(
      afterPath.action.points,
      beforePath.action.points,
      "Story middle platform path geometry changed while slowing.",
    );
    assert.equal(
      afterPath.action.loop ?? false,
      beforePath.action.loop ?? false,
      "Story middle platform path loop changed while slowing.",
    );
    assert.deepEqual(
      afterPath.rule.trigger,
      beforePath.rule.trigger,
      "Story middle platform path trigger changed while slowing.",
    );
    const { speed: _beforeSpeed, ...beforeBehaviorProperties } =
      beforePlatform.behavior;
    const { speed: _afterSpeed, ...afterBehaviorProperties } =
      afterPlatform.behavior;
    assert.deepEqual(
      afterBehaviorProperties,
      beforeBehaviorProperties,
      "Story platform edit changed the bounce behavior beyond speed.",
    );
  } else {
    assert(
      typeof beforeSpeed === "number" && beforeSpeed > 0,
      "Story middle platform had no positive starting speed.",
    );
    assert(
      typeof afterSpeed === "number" &&
        afterSpeed > 0 &&
        afterSpeed < beforeSpeed,
      "Story middle platform speed did not decrease while staying positive.",
    );
  }
  assert.deepEqual(afterPlatform.position, beforePlatform.position);
  const { behavior: beforeBehavior, ...beforePlatformProperties } =
    beforePlatform;
  const { behavior: afterBehavior, ...afterPlatformProperties } = afterPlatform;
  assert.deepEqual(
    afterPlatformProperties,
    beforePlatformProperties,
    "Story platform edit changed the middle platform beyond its speed.",
  );
  if (!beforeUsesPath) {
    const { speed: _beforeSpeed, ...beforeBehaviorProperties } = beforeBehavior;
    const { speed: _afterSpeed, ...afterBehaviorProperties } = afterBehavior;
    assert.deepEqual(
      afterBehaviorProperties,
      beforeBehaviorProperties,
      "Story platform edit changed the middle platform behavior beyond speed.",
    );
  }
  const beforeCollectibles = storyCollectibles(before);
  const afterCollectibles = storyCollectibles(after);
  const beforeIds = new Set(beforeCollectibles.map((entity) => entity.id));
  const added = afterCollectibles.filter((entity) => !beforeIds.has(entity.id));
  assert.equal(
    after.entities.length,
    before.entities.length + 2,
    "Story platform edit must add exactly two entities.",
  );
  assert.equal(
    added.length,
    2,
    "Story platform edit must add exactly two collectibles.",
  );
  assert.equal(
    afterCollectibles.length,
    7,
    "Story platform edit must reach goal 7.",
  );
  assert.equal(
    new Set(afterCollectibles.map((entity) => entity.id)).size,
    7,
    "Story goal 7 collectibles must have unique IDs.",
  );
  assertStoryUnchangedEntities(before, after, new Set([platformId]));
  assert.deepEqual(after.environment, before.environment);
  assertStoryPlatformRules(before, after, beforePath, afterPath);
  return {
    platformId,
    ...(beforeUsesPath
      ? {
          previousPathDuration: beforePath.action.duration,
          revisedPathDuration: afterPath.action.duration,
        }
      : { previousSpeed: beforeSpeed, revisedSpeed: afterSpeed }),
    addedCollectibleIds: added.map((entity) => entity.id),
    collectibles: afterCollectibles.length,
  };
}

function storyComparable(project) {
  const { revision: _revision, messages: _messages, ...rest } = project;
  return rest;
}

export async function persistFlagshipStoryPhase(
  report,
  evidenceDir,
  phase,
  project,
  page,
) {
  const filename = `story-${phase}-project.json`;
  let snapshotWritten = true;
  try {
    await writeFile(
      join(evidenceDir, filename),
      `${JSON.stringify(project, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    report.evidence.push(filename);
  } catch {
    snapshotWritten = false;
  }

  const captured = await captureStoredGeneratedModelEvidence(page, project);
  const artifact = buildGeneratedModelEvidence(
    captured.project,
    captured.storedByHash,
  );
  if (!snapshotWritten)
    artifact.missing.push({
      entityIds: [],
      status: "incomplete",
      reason: "snapshot-write-failed",
    });
  const generatedDir = join(evidenceDir, "generated");
  let generatedDirReady = true;
  try {
    await mkdir(generatedDir, { recursive: true, mode: 0o700 });
  } catch {
    generatedDirReady = false;
  }
  const previousEvidence = report.flagshipStory?.generatedModels ?? {};
  const writtenHashes = new Set(previousEvidence.writtenHashes ?? []);
  const writtenModels = [];
  const writeFailures = [];
  for (const model of artifact.models) {
    if (!generatedDirReady) {
      writeFailures.push({
        entityIds: model.entityIds,
        sha256: model.sha256,
        expectedBytes: model.bytes,
        status: "incomplete",
        reason: "evidence-directory-write-failed",
      });
      continue;
    }
    const target = join(generatedDir, `${model.sha256}.glb`);
    const bytes = generatedModelBytes(model.glb);
    let validExisting = false;
    try {
      const existing = await readFile(target);
      validExisting =
        existing.byteLength === model.bytes &&
        createHash("sha256").update(existing).digest("hex") === model.sha256;
    } catch {
      // The model is written below when this phase has not already captured it.
    }
    if (!validExisting && bytes) {
      try {
        await writeFile(target, bytes, { mode: 0o600 });
        validExisting = true;
      } catch {
        // The phase manifest records the incomplete evidence without masking
        // a semantic story assertion that follows this call.
      }
    }
    if (validExisting) {
      writtenHashes.add(model.sha256);
      writtenModels.push(model);
    } else {
      writeFailures.push({
        entityIds: model.entityIds,
        sha256: model.sha256,
        expectedBytes: model.bytes,
        status: "incomplete",
        reason: "evidence-file-write-failed",
      });
    }
  }
  const phaseManifest = {
    phase,
    status:
      snapshotWritten &&
      artifact.missing.length === 0 &&
      artifact.status === "complete" &&
      writeFailures.length === 0
        ? "complete"
        : "incomplete",
    models: writtenModels.map(({ glb: _glb, ...model }) => model),
    missing: [...artifact.missing, ...writeFailures],
    totalBytes: writtenModels.reduce((sum, model) => sum + model.bytes, 0),
  };
  const manifestFilename = `story-${phase}-generated.json`;
  let manifestWritten = true;
  try {
    await writeFile(
      join(evidenceDir, manifestFilename),
      `${JSON.stringify(phaseManifest, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    report.evidence.push(manifestFilename);
  } catch {
    manifestWritten = false;
  }
  if (!manifestWritten) phaseManifest.status = "incomplete";
  report.flagshipStory.generatedModels = {
    ...previousEvidence,
    status:
      previousEvidence.status === "incomplete" ||
      phaseManifest.status === "incomplete" ||
      !manifestWritten
        ? "incomplete"
        : "complete",
    writtenHashes: [...writtenHashes],
    phases: {
      ...(previousEvidence.phases ?? {}),
      [phase]: {
        status: phaseManifest.status,
        modelCount: phaseManifest.models.length,
        missingCount: phaseManifest.missing.length,
        totalBytes: phaseManifest.totalBytes,
      },
    },
  };
  return phaseManifest;
}

async function readGameplayObservation(page) {
  return page.evaluate(() => {
    const read = window.__ORBSIE_GAMEPLAY_READ__;
    return typeof read === "function" ? read() : null;
  });
}

/** Give keyboard gameplay events a real rendered surface target. */
async function focusGameplaySurface(page) {
  const surface = page.getByRole("region", {
    name: "Gameplay area",
    exact: true,
  });
  await expect(surface).toBeVisible({ timeout: 30000 });
  if (
    !(await surface.evaluate((element) => element === document.activeElement))
  )
    await surface.focus();
  await expect(surface).toBeFocused();
}

async function createFlagshipGameplayInput(
  page,
  requestedMode = "auto",
  { standalone = false } = {},
) {
  const touch =
    requestedMode === "touch" ||
    (requestedMode === "auto" &&
      (await page.evaluate(
        () => window.matchMedia("(pointer: coarse)").matches,
      )));
  const held = new Set();
  let touchInput;
  let cdp;
  if (touch) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });
    touchInput = createTraversalTouchInput({
      cdp,
      touchPoint: async (key, id) => {
        const label = standalone
          ? { " ": "Jump", a: "Left", d: "Right", s: "Back", w: "Forward" }[key]
          : key === " "
            ? "Jump"
            : `Move ${key}`;
        const box = await page
          .getByRole("button", { name: label, exact: true })
          .boundingBox();
        if (!box) throw new Error(`Missing flagship touch control ${key}.`);
        return {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
          id,
        };
      },
    });
  }
  return {
    mode: touch ? "touch" : "keyboard",
    setKeys: async (keys) => {
      if (touch) {
        await touchInput.setKeys(keys);
        return;
      }
      const next = new Set(keys);
      for (const key of held) {
        if (!next.has(key)) {
          await page.keyboard.up(key);
          held.delete(key);
        }
      }
      for (const key of next) {
        if (!held.has(key)) {
          await page.keyboard.down(key);
          held.add(key);
        }
      }
    },
    releaseAll: async () => {
      if (touch) {
        await touchInput.releaseAll();
        return;
      }
      for (const key of held) await page.keyboard.up(key);
      held.clear();
    },
    close: async () => {
      await touchInput?.releaseAll().catch(() => {});
      if (!touch) {
        for (const key of held) await page.keyboard.up(key).catch(() => {});
        held.clear();
      }
      await cdp?.detach().catch(() => {});
    },
  };
}

export async function runFreshFlagshipGameplay(
  page,
  project,
  story,
  options = {},
) {
  const standalone = options.surface === "standalone";
  const targets = buildFreshGameplayTargets(project, story, {
    expectedCollectibleCount: options.expectedCollectibleCount ?? 5,
    expectedRevision: options.expectedRevision ?? project?.revision,
  });
  const input = await createFlagshipGameplayInput(
    page,
    options.inputMode ?? "auto",
    { standalone },
  );
  const observations = [];
  const inputTrace = [];
  const collectibleTraversalOrder = [];
  const platformEvidence = new Map(
    targets.platforms.map((target) => [
      target.id,
      {
        id: target.id,
        behavior: target.behavior,
        groundedFrames: 0,
        bounceFrames: 0,
        startPosition: null,
        maximumDisplacement: 0,
        jumpEvidence: [],
      },
    ]),
  );
  const startedAt = Date.now();
  let expectedRenderer;
  let expectedReset;
  let expectedSessionGeneration;
  let lastObservationAt = -Infinity;
  let previous;
  let movementBefore;
  let movementAfter;
  let movementDistance;
  let portalWinObservation;
  let restartControl;
  let restartAttempted = false;
  const staleObservationWaits = [];
  const read = async ({ allowLifecycleChange = false } = {}) => {
    let observation = await readGameplayObservation(page);
    if (!observation) return null;
    if (observation.atMs <= lastObservationAt) {
      const waitStartedAt = Date.now();
      const waitDeadline =
        waitStartedAt + FRESH_GAMEPLAY_LIMITS.maxObservationWaitMs;
      observation = await readGameplayObservation(page);
      while (
        observation &&
        observation.atMs <= lastObservationAt &&
        Date.now() < waitDeadline
      ) {
        await page.waitForTimeout(50);
        observation = await readGameplayObservation(page);
      }
      staleObservationWaits.push({
        waitedMs: Date.now() - waitStartedAt,
        previousAtMs: lastObservationAt,
        observedAtMs: observation?.atMs ?? null,
      });
      if (!observation || observation.atMs <= lastObservationAt) return null;
    }
    validateFreshGameplayObservation(observation, {
      projectId: project.id,
      revision: project.revision,
      renderer: expectedRenderer,
      lastAtMs: lastObservationAt,
      reset: expectedReset,
      sessionGeneration: expectedSessionGeneration,
      allowLifecycleChange,
    });
    if (observations.length >= 6000)
      throw new Error("Fresh gameplay observation trace exceeded its bound.");
    expectedRenderer ??= observation.renderer;
    if (!allowLifecycleChange) {
      expectedReset ??= observation.reset;
      expectedSessionGeneration ??= observation.sessionGeneration;
    }
    observations.push(observation);
    for (const target of targets.platforms) {
      const live = observation.entities.find(
        (entity) => entity.id === target.id,
      );
      const evidence = platformEvidence.get(target.id);
      const contact = observePlatformContact(
        previous,
        observation,
        live ?? target,
      );
      if (contact.grounded) evidence.groundedFrames += 1;
      if (contact.bounced) evidence.bounceFrames += 1;
      if (live) {
        evidence.startPosition ??= [...live.position];
        evidence.maximumDisplacement = Math.max(
          evidence.maximumDisplacement,
          Math.hypot(
            live.position[0] - evidence.startPosition[0],
            live.position[1] - evidence.startPosition[1],
            live.position[2] - evidence.startPosition[2],
          ),
        );
      }
    }
    lastObservationAt = observation.atMs;
    previous = observation;
    return observation;
  };
  const setKeys = async (keys, reason) => {
    await input.setKeys(keys);
    inputTrace.push({
      atMs: Date.now() - startedAt,
      keys: [...keys],
      reason,
    });
    if (inputTrace.length > 2000)
      throw new Error("Fresh gameplay input trace exceeded its bound.");
  };
  const compactPlatformObservation = (observation, targetId) => {
    const platform = observation?.entities?.find(
      (entity) => entity.id === targetId,
    );
    return observation
      ? {
          atMs: observation.atMs,
          player: {
            position: [...observation.player.position],
            velocityY: observation.player.velocityY,
            groundedOn: observation.player.groundedOn ?? null,
          },
          platform: platform
            ? { position: [...platform.position], scale: [...platform.scale] }
            : null,
          platformContactId: observation.platformContacts?.includes(targetId)
            ? targetId
            : null,
          bounceContactId: observation.bounceContacts?.includes(targetId)
            ? targetId
            : null,
          platformContactCount:
            observation.platformContactCounts?.[targetId] ?? 0,
          bounceContactCount:
            observation.bounceContactCounts?.[targetId] ?? 0,
        }
      : null;
  };
  const waitForJumpResponse = async (before) => {
    const deadline =
      Date.now() + FRESH_GAMEPLAY_LIMITS.maxObservationWaitMs;
    let latest = before;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      await page.waitForTimeout(
        Math.min(FRESH_GAMEPLAY_LIMITS.jumpPressMs, remaining),
      );
      latest = await read();
      if (
        latest &&
        latest.player.velocityY > 0.1 &&
        latest.player.position[1] > before.player.position[1] + 0.005
      )
        return latest;
    }
    return null;
  };
  const recordJumpSample = (phase, observation, target) => {
    const sample = compactPlatformObservation(observation, phase.id);
    if (!sample) return;
    const previousSample = phase.samples.at(-1) ?? phase.before;
    if (!phase.surfaceCrossing)
      phase.surfaceCrossing = detectDescendingPlatformSurfaceCrossing(
        previousSample,
        sample,
        target,
      );
    phase.samples = retainFreshGameplayJumpSample(phase.samples, sample);
    if (
      !phase.apex &&
      previousSample?.player?.velocityY > 0 &&
      sample.player.velocityY <= 0
    )
      phase.apex = sample;
  };
  const finish = async () => {
    await input.releaseAll().catch(() => {});
    await input.close();
  };
  try {
    const play = page.getByRole("button", { name: "Play", exact: true });
    if (!standalone && (await play.isVisible())) await play.click();
    if (standalone) {
      await expect(page.locator("main[data-ready=true]")).toBeVisible({
        timeout: 30000,
      });
      await expect(page.locator(".score")).toBeVisible({ timeout: 30000 });
      await expect(page.locator(".score")).toHaveText(
        new RegExp(
          `^(?:Score: 0|◆\\s*0\\s*/\\s*${targets.collectibles.length})$`,
        ),
      );
    } else {
      await expect(page.locator(".game-hud")).toBeVisible({ timeout: 30000 });
    }
    if (input.mode === "keyboard") await focusGameplaySurface(page);
    const observationEpoch = await page.evaluate(() => performance.now());
    await expect
      .poll(
        async () => {
          const observation = await readGameplayObservation(page);
          return Boolean(observation && observation.atMs > observationEpoch);
        },
        {
          timeout: 30000,
        },
      )
      .toBe(true);
    const start = await read();
    if (!start)
      throw new Error("Fresh gameplay renderer exposed no player observation.");
    if (start.projectId !== project.id || start.revision !== project.revision)
      throw new Error(
        "Fresh gameplay started with a different project snapshot.",
      );

    movementBefore = start;
    await setKeys(["d"], "movement-check");
    await page.waitForTimeout(280);
    movementAfter = await read();
    await setKeys([], "movement-release");
    if (!movementAfter)
      throw new Error("Fresh gameplay movement produced no observation.");
    movementDistance = Math.hypot(
      movementAfter.player.position[0] - movementBefore.player.position[0],
      movementAfter.player.position[2] - movementBefore.player.position[2],
    );
    if (movementDistance < FRESH_GAMEPLAY_LIMITS.movementMinDistance)
      throw new Error(
        `Fresh gameplay movement was not observed (${movementDistance.toFixed(3)} units).`,
      );

    const approach = async (target, kind) => {
      let last;
      let portalSettled = false;
      const portalCompleted = (observation) =>
        portalCompletionIsAuthoritative(observation, {
          portalId: targets.portal.id,
          expectedCollectibleIds: targets.collectibles.map(
            (collectible) => collectible.id,
          ),
        });
      for (
        let step = 0;
        step < FRESH_GAMEPLAY_LIMITS.maxSteeringStepsPerTarget;
        step++
      ) {
        last = await read();
        if (!last)
          throw new Error(`No observation while approaching ${target.id}.`);
        let live = last.entities.find((entity) => entity.id === target.id);
        if (!live)
          throw new Error(
            `Fresh gameplay could not observe target ${target.id}.`,
          );
        if (kind === "collect" && last.scoreIds.includes(target.id))
          return last;
        if (kind === "portal" && portalCompleted(last)) return last;
        let distance = Math.hypot(
          last.player.position[0] - live.position[0],
          last.player.position[2] - live.position[2],
        );
        if (
          distance <= FRESH_GAMEPLAY_LIMITS.targetDistance &&
          (kind !== "portal" || !portalSettled)
        ) {
          await setKeys([], `${kind}-settle`);
          await page.waitForTimeout(FRESH_GAMEPLAY_LIMITS.settleMs);
          last = await read();
          if (kind === "portal") {
            if (portalCompleted(last)) return last;
            portalSettled = true;
            if (!last)
              throw new Error(
                `No observation while approaching ${target.id}.`,
              );
            const settledTarget = last.entities.find(
              (entity) => entity.id === target.id,
            );
            if (!settledTarget)
              throw new Error(
                `Fresh gameplay could not observe target ${target.id}.`,
              );
            live = settledTarget;
            distance = Math.hypot(
              last.player.position[0] - live.position[0],
              last.player.position[2] - live.position[2],
            );
          } else if (
            kind !== "collect" ||
            last?.scoreIds.includes(target.id)
          ) {
            return last;
          }
        }
        const supportId = gameplaySupportId(last);
        const jump =
          Boolean(supportId) &&
          (live.position[1] > last.player.position[1] + 0.15 ||
            (kind === "collect" && step % 18 === 0));
        const steering =
          kind === "portal"
            ? distance > 0
              ? chooseGameplayKeys(last.player.position, live.position)
              : []
            : chooseGameplaySteeringKeys(last.player.position, live.position);
        await setKeys(
          jump ? [" ", ...steering] : steering,
          `${kind}-${jump ? "jump" : "steer"}`,
        );
        if (jump) {
          const launch = await waitForJumpResponse(last);
          await setKeys(
            chooseGameplaySteeringKeys(
              (launch ?? last).player.position,
              live.position,
            ),
            `${kind}-jump-release`,
          );
        }
        await page.waitForTimeout(FRESH_GAMEPLAY_LIMITS.steeringStepMs);
      }
      await setKeys([], `${kind}-unreachable`);
      throw new Error(
        `Fresh gameplay could not reach ${target.id}: ${JSON.stringify(last)}`,
      );
    };

    const platformApproach = async (
      target,
      attempt,
      {
        baselinePlatformContactCount = 0,
        baselineBounceContactCount = 0,
      } = {},
    ) => {
      const evidence = platformEvidence.get(target.id);
      const phase = {
        id: target.id,
        attempt,
        before: compactPlatformObservation(previous, target.id),
        inputKeys: [],
        samples: [],
        apex: null,
        surfaceCrossing: null,
        landing: null,
        contact: null,
        recovery: null,
      };
      evidence.jumpEvidence.push(phase);
      let jumping = false;
      let last;
      for (
        let step = 0;
        step < FRESH_GAMEPLAY_LIMITS.maxSteeringStepsPerTarget;
        step++
      ) {
        last = await read();
        if (!last)
          throw new Error(`No observation while approaching ${target.id}.`);
        recordJumpSample(phase, last, target);
        const live = last.entities.find((entity) => entity.id === target.id);
        if (!live)
          throw new Error(
            `Fresh gameplay could not observe target ${target.id}.`,
          );
        const contact = platformContactProgress(last, target.id, {
          baselinePlatformContactCount,
          baselineBounceContactCount,
        });
        if (contact.contacted) {
          phase.contact = compactPlatformObservation(last, target.id);
          if (contact.grounded)
            phase.landing = phase.contact;
          await setKeys([], "platform-contact-release");
          return { observation: last, contacted: true };
        }
        const action = chooseGameplayPlatformAction({
          observation: last,
          target: { ...target, position: [...live.position] },
          jumping,
        });
        if (action.phase === "recovered") {
          phase.recovery = compactPlatformObservation(last, target.id);
          await setKeys([], "platform-recovery-release");
          return { observation: last, contacted: false, recovered: true };
        }
        phase.inputKeys.push(action.keys);
        if (action.phase === "jumping" && !jumping) {
          jumping = true;
          await setKeys(action.keys, "platform-jump-start");
          const launch = await waitForJumpResponse(last);
          if (!launch) {
            await setKeys([], "platform-jump-no-response-release");
            phase.recovery = compactPlatformObservation(previous, target.id);
            return { observation: previous ?? last, contacted: false };
          }
          recordJumpSample(phase, launch, target);
          await setKeys(
            chooseGameplaySteeringKeys(
              launch.player.position,
              live.position,
            ),
            "platform-jump-release",
          );
        } else {
          await setKeys(action.keys, `platform-${action.phase}`);
        }
        await page.waitForTimeout(FRESH_GAMEPLAY_LIMITS.steeringStepMs);
      }
      await setKeys([], "platform-attempt-timeout");
      return { observation: last, contacted: false };
    };

    for (const [platformIndex, target] of targets.platforms.entries()) {
      const previousTarget = targets.platforms[platformIndex - 1];
      let contacted = false;
      for (
        let attempt = 0;
        attempt < FRESH_GAMEPLAY_LIMITS.maxJumpAttempts;
        attempt++
      ) {
        const baselinePlatformContactCount =
          previous?.platformContactCounts?.[target.id] ?? 0;
        const baselineBounceContactCount =
          previous?.bounceContactCounts?.[target.id] ?? 0;
        const outcome = await platformApproach(target, attempt, {
          baselinePlatformContactCount,
          baselineBounceContactCount,
        });
        if (outcome.contacted) {
          contacted = true;
          break;
        }
        const supportId = gameplaySupportId(outcome.observation);
        if (
          previousTarget &&
          supportId &&
          supportId !== previousTarget.id &&
          supportId !== target.id
        ) {
          const previousPlatformContactCount =
            outcome.observation?.platformContactCounts?.[previousTarget.id] ??
            0;
          const previousBounceContactCount =
            outcome.observation?.bounceContactCounts?.[previousTarget.id] ?? 0;
          const recovery = await platformApproach(
            previousTarget,
            `recovery-${attempt}`,
            {
              baselinePlatformContactCount: previousPlatformContactCount,
              baselineBounceContactCount: previousBounceContactCount,
            },
          );
          if (!recovery.contacted)
            throw new Error(
              `Fresh gameplay could not recover reachable support ${previousTarget.id} before retrying ${target.id}.`,
            );
        }
      }
      if (!contacted)
        throw new Error(
          `Fresh gameplay did not contact platform ${target.id} after bounded support-driven attempts.`,
        );
    }

    const finalPlatform = targets.platforms.at(-1);
    const liveFinalSupport = previous?.entities.find(
      (entity) => entity.id === finalPlatform.id,
    );
    const finalSupportPosition =
      liveFinalSupport?.position ?? finalPlatform.position;
    const orderedCollectibles = orderFreshGameplayCollectiblesFromSupport(
      targets.collectibles,
      finalSupportPosition,
    );
    for (const target of orderedCollectibles) {
      collectibleTraversalOrder.push(target.id);
      const before = previous;
      await approach(target, "collect");
      let after = previous;
      for (
        let attempt = 0;
        attempt < FRESH_GAMEPLAY_LIMITS.maxJumpAttempts;
        attempt++
      ) {
        if (after?.scoreIds.includes(target.id)) break;
        await setKeys(
          [" ", ...chooseGameplayKeys(after.player.position, target.position)],
          "collect-jump",
        );
        await page.waitForTimeout(240);
        await setKeys([], "collect-jump-release");
        await page.waitForTimeout(FRESH_GAMEPLAY_LIMITS.settleMs);
        after = await read();
      }
      if (!after?.scoreIds.includes(target.id))
        throw new Error(
          `Fresh gameplay reached ${target.id} without observing its collection from ${JSON.stringify(before)}.`,
        );
    }

    await approach(targets.portal, "portal");
    await setKeys([], "portal-settle");
    await page.waitForTimeout(FRESH_GAMEPLAY_LIMITS.settleMs);
    const won = await read();
    portalWinObservation = won;
    await expect(
      page.getByText("Adventure complete", { exact: true }),
    ).toBeVisible({
      timeout: 5000,
    });
    if (
      !won?.won ||
      won.status !== "won" ||
      !won.contacts.includes(targets.portal.id)
    )
      throw new Error("Fresh gameplay did not observe a portal collision win.");
    const completionObservations = [...observations];
    const completion = summarizeFreshGameplayRun({
      project,
      observations: completionObservations,
      targets,
    });
    if (
      completion.collectedIds.length !== targets.collectibles.length ||
      !targets.collectibles.every((target) =>
        completion.collectedIds.includes(target.id),
      )
    )
      throw new Error(
        "Fresh gameplay did not collect the complete crystal set.",
      );
    await options.onWin?.(won);

    const platformResults = [...platformEvidence.values()];
    const missingPlatforms = platformResults.filter(
      (entry) => entry.groundedFrames === 0 && entry.bounceFrames === 0,
    );
    if (missingPlatforms.length > 0)
      throw new Error(
        `Fresh gameplay did not contact every platform: ${missingPlatforms
          .map((entry) => entry.id)
          .join(", ")}`,
      );
    const missingBounces = platformResults.filter(
      (entry) => entry.behavior === "bounce" && entry.bounceFrames === 0,
    );
    if (missingBounces.length > 0)
      throw new Error(
        `Fresh gameplay did not observe every bouncy platform: ${missingBounces
          .map((entry) => entry.id)
          .join(", ")}`,
      );
    const stationaryPlatforms = platformResults.filter(
      (entry) => entry.maximumDisplacement < 0.05,
    );
    if (stationaryPlatforms.length > 0)
      throw new Error(
        `Fresh gameplay did not observe movement for every platform: ${stationaryPlatforms
          .map((entry) => entry.id)
          .join(", ")}`,
      );
    const resetBefore = won.reset;
    const restart = standalone
      ? page.getByRole("button", { name: /Restart/ }).first()
      : page.getByRole("button", { name: "Restart game", exact: true });
    restartControl =
      (await restart.getAttribute("aria-label")) ||
      (await restart.innerText()).trim();
    restartAttempted = true;
    await restart.click();
    await expect
      .poll(
        async () => {
          const observation = await readGameplayObservation(page);
          return observation &&
            observation.atMs > lastObservationAt &&
            observation.reset > resetBefore
            ? true
            : false;
        },
        {
          timeout: 5000,
        },
      )
      .toBe(true);
    await page.waitForTimeout(30);
    const reset = await read({ allowLifecycleChange: true });
    if (standalone) {
      await expect(page.locator(".score")).toHaveText(
        new RegExp(
          `^(?:Score: 0|◆\\s*0\\s*/\\s*${targets.collectibles.length})$`,
        ),
      );
      await expect(page.locator(".win")).toHaveCount(0);
    }
    if (
      !reset ||
      reset.projectId !== project.id ||
      reset.revision !== project.revision ||
      (reset.reset <= resetBefore &&
        reset.sessionGeneration <= won.sessionGeneration) ||
      reset.scoreIds.length !== 0 ||
      reset.gameScore !== 0 ||
      reset.status !== "playing" ||
      reset.won ||
      reset.lost ||
      Math.hypot(reset.player.position[0], reset.player.position[2] - 5) > 0.2
    )
      throw new Error(
        "Fresh gameplay reset did not restore the same world and avatar state.",
      );
    await options.onReset?.(reset);
    return {
      status: "passed",
      ...completion,
      collectibleTraversalOrder,
      inputMode: input.mode,
      surface: standalone ? "standalone-player" : "editor-play",
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      inputTrace,
      movement: {
        distance: movementDistance,
        before: movementBefore,
        after: movementAfter,
      },
      timing: {
        observationSamples: completionObservations.length,
        observedSpanMs: completion.elapsedMs,
        staleObservationWaits,
        source: "renderer performance.now timestamps",
      },
      contacts: [
        ...new Set(observations.flatMap((observation) => observation.contacts)),
      ],
      collections: [
        ...new Set(
          observations.flatMap((observation) => observation.collected),
        ),
      ],
      platformEvidence: platformResults,
      win: {
        projectId: won.projectId,
        revision: won.revision,
        score: won.gameScore,
        status: won.status,
        portalId: targets.portal.id,
      },
      reset: {
        projectId: reset.projectId,
        revision: reset.revision,
        control: restartControl,
        scoreIds: reset.scoreIds,
        reset: reset.reset,
        score: reset.gameScore,
        status: reset.status,
        lifecycleAdvanced:
          reset.reset > resetBefore ||
          reset.sessionGeneration > won.sessionGeneration,
        player: reset.player,
      },
    };
  } catch (error) {
    const evidence = {
      observationCount: observations.length,
      lastObservation: previous,
      inputTrace: inputTrace.slice(-20),
      collectibleTraversalOrder,
      movement:
        movementBefore && movementAfter
          ? {
              distance: movementDistance,
              before: movementBefore,
              after: movementAfter,
            }
          : null,
      contacts: [
        ...new Set(observations.flatMap((observation) => observation.contacts)),
      ],
      collections: [
        ...new Set(
          observations.flatMap((observation) => observation.collected),
        ),
      ],
      scoreIds: previous?.scoreIds ?? [],
      score: previous?.gameScore ?? null,
      portalWin: portalWinObservation
        ? {
            projectId: portalWinObservation.projectId,
            revision: portalWinObservation.revision,
            status: portalWinObservation.status,
            won: portalWinObservation.won,
            portalId: targets.portal.id,
          }
        : null,
      restart: {
        attempted: restartAttempted,
        control: restartControl,
        resetCounter: previous?.reset ?? null,
      },
      platformEvidence: [...platformEvidence.values()],
    };
    if (error && typeof error === "object") {
      error.freshGameplayEvidence = evidence;
    }
    throw error;
  } finally {
    await finish();
  }
}

export async function observeFlagshipMovementDuringGeneration(
  page,
  info,
  options = {},
) {
  const startedAt = Date.now();
  const expectedProjectId =
    options.projectId ?? info.generationBodies.at(-1)?.projectId;
  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeVisible({ timeout: 30000 });
  await play.click();
  await expect(page.locator(".game-hud")).toBeVisible({ timeout: 30000 });
  const observationEpoch = await page.evaluate(() => performance.now());
  await expect
    .poll(
      async () => {
        const observation = await readGameplayObservation(page);
        return Boolean(
          observation &&
          observation.atMs > observationEpoch &&
          (!expectedProjectId || observation.projectId === expectedProjectId),
        );
      },
      {
        timeout: 30000,
      },
    )
    .toBe(true);
  const input = await createFlagshipGameplayInput(
    page,
    options.inputMode ?? "auto",
  );
  let before = null;
  let after = null;
  let beforeSample = null;
  let afterSample = null;
  let validation = null;
  try {
    if (input.mode === "keyboard") await focusGameplaySurface(page);
    beforeSample = await waitForFreshGameplayObservation(
      () => readGameplayObservation(page),
      (delayMs) => page.waitForTimeout(delayMs),
      { lastAtMs: observationEpoch },
    );
    before = beforeSample.observation;
    const stopControlVisible = await page
      .getByRole("button", { name: "Stop", exact: true })
      .isVisible()
      .catch(() => false);
    const inProgressBeforeInput = generationStreamIsOpen({
      stopControlVisible,
    });
    await input.setKeys(["d"]);
    await page.waitForTimeout(260);
    afterSample = await waitForFreshGameplayObservation(
      () => readGameplayObservation(page),
      (delayMs) => page.waitForTimeout(delayMs),
      { lastAtMs: before?.atMs ?? observationEpoch },
    );
    after = afterSample.observation;
    await input.releaseAll();
    const stopControlVisibleAfter = await page
      .getByRole("button", { name: "Stop", exact: true })
      .isVisible()
      .catch(() => false);
    validation = validateGenerationMovementObservation(before, after, {
      projectId: expectedProjectId,
      streamOpenBefore: inProgressBeforeInput,
      streamOpenAfter: stopControlVisibleAfter,
    });
    if (!validation.valid)
      throw new Error(
        `Flagship generation movement evidence failed: ${JSON.stringify(validation)}`,
      );
    return {
      status: "passed",
      inputMode: input.mode,
      startedAt: new Date(startedAt).toISOString(),
      movementAtMs: Date.now() - startedAt,
      movementAt: new Date().toISOString(),
      generationRequestsAtMovement: info.generationRequests,
      generationResponsesAtMovement: info.generationStatuses.length,
      generationStreamOpenAtMovement: stopControlVisible,
      generationStreamOpenAfterMovement: stopControlVisibleAfter,
      generationRequestAtMs: info.generationRequestTimes?.at(-1)?.atMs ?? null,
      generationRequestAt: info.generationRequestTimes?.at(-1)?.atMs
        ? new Date(info.generationRequestTimes.at(-1).atMs).toISOString()
        : null,
      projectId: before?.projectId ?? null,
      revisionBefore: before?.revision ?? null,
      revisionAfter: after?.revision ?? null,
      movementDistance: validation.movementDistance,
      before,
      after,
      beforeSample,
      afterSample,
    };
  } catch (error) {
    if (error && typeof error === "object") {
      error.generationMovementEvidence = {
        before,
        after,
        beforeSample,
        afterSample,
        validation,
      };
    }
    throw error;
  } finally {
    await input.releaseAll().catch(() => {});
    await input.close();
  }
}

async function runFlagshipStory(
  page,
  config,
  report,
  info,
  evidenceDir,
  created,
  onGoodProject,
  options = {},
) {
  const generationRequestOffset =
    options.generationRequestOffset ?? info.generationRequests;
  const assistantMessageBaseline =
    options.assistantMessageBaseline ??
    created.messages.filter((message) => message.role === "assistant").length;
  const runGameplayPhase = async (phase, project, story, gameplayOptions) => {
    try {
      return await runFreshFlagshipGameplay(
        page,
        project,
        story,
        gameplayOptions,
      );
    } catch (error) {
      recordFreshFlagshipGameplayFailure(report, phase, project, error);
      throw error;
    }
  };
  if (options.seeded) {
    report.flagshipStory = {
      ...(report.flagshipStory ?? {}),
      status: "seeded-creation",
      visualReview: "pending",
      phases: {
        creation: {
          status: "seeded",
          revision: created.revision,
        },
      },
    };
  } else {
    report.flagshipStory = {
      ...(report.flagshipStory ?? {}),
      status: "creation-observed",
      visualReview: "pending",
      phases: {
        creation: { revision: created.revision },
      },
    };
    await persistFlagshipStoryPhase(
      report,
      evidenceDir,
      "created",
      created,
      page,
    );
  }
  const initialStory = assertFlagshipStoryCreation(created);
  assert.equal(
    created.messages[0]?.text,
    FLAGSHIP_STORY_PROMPT,
    "Story creation did not persist the exact flagship prompt.",
  );
  onGoodProject(created);
  report.flagshipStory = {
    ...report.flagshipStory,
    status: "running",
    visualReview: "pending",
  };
  if (options.seeded) {
    report.flagshipStory.phases.creation.gameplay = {
      status: "not-run",
      reason: "saved-checkpoint-resume-is-not-fresh-world-evidence",
    };
  } else {
    const creationGameplay = await runGameplayPhase(
      "creation",
      created,
      initialStory,
      {
        inputMode: config.flagshipInputMode,
        expectedCollectibleCount: 5,
        expectedRevision: created.revision,
      },
    );
    report.flagshipStory.phases.creation.gameplay = creationGameplay;
    await page.screenshot({
      path: join(evidenceDir, "story-creation-gameplay-reset.png"),
      fullPage: true,
    });
    report.evidence.push("story-creation-gameplay-reset.png");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
  }
  if (!(await page.locator(".object-list").isVisible()))
    await page.getByRole("button", { name: "Show objects", exact: true }).click();
  const treeRow = page
    .locator(".object-list button")
    .filter({ hasText: initialStory.tree.label })
    .first();
  await expect(treeRow).toHaveCount(1);
  await treeRow.click();
  await expect(page.locator(".selection-chip")).toContainText(
    initialStory.tree.label,
  );
  await page.locator("#prompt").fill(FLAGSHIP_STORY_MUSHROOM_PROMPT);
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect
    .poll(() => info.generationRequests, { timeout: 30000 })
    .toBe(generationRequestOffset + 1);
  assert.equal(
    info.generationBodies.at(-1)?.selectedId,
    initialStory.tree.id,
    "Story mushroom edit did not target the selected tree.",
  );
  const mushroom = await waitForSavedProject(
    page,
    created.revision + 1,
    assistantMessageBaseline + 1,
  );
  assert.equal(
    mushroom.messages.filter((message) => message.role === "user").at(-1)?.text,
    FLAGSHIP_STORY_MUSHROOM_PROMPT,
    "Story mushroom edit did not persist the exact fixed prompt.",
  );
  report.flagshipStory.phases.mushroom = {
    status: "observed",
    revision: mushroom.revision,
  };
  await persistFlagshipStoryPhase(report, evidenceDir, "mushroom", mushroom, page);
  const mushroomCheck = assertFlagshipStoryMushroom(
    created,
    mushroom,
    initialStory.tree.id,
  );
  onGoodProject(mushroom);
  report.flagshipStory.phases.mushroom = {
    status: "passed",
    revision: mushroom.revision,
    ...mushroomCheck,
  };
  await page.screenshot({
    path: join(evidenceDir, "story-mushroom.png"),
    fullPage: true,
  });
  report.evidence.push("story-mushroom.png");

  await page
    .getByRole("button", { name: "Clear selected object", exact: true })
    .click();
  await page.locator("#prompt").fill(FLAGSHIP_STORY_PLATFORM_PROMPT);
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect
    .poll(() => info.generationRequests, { timeout: 30000 })
    .toBe(generationRequestOffset + 2);
  assert.equal(
    info.generationBodies.at(-1)?.selectedId ?? null,
    null,
    "Story platform edit unexpectedly retained a selected entity.",
  );
  const goal7 = await waitForSavedProject(
    page,
    mushroom.revision + 1,
    assistantMessageBaseline + 2,
  );
  assert.equal(
    goal7.messages.filter((message) => message.role === "user").at(-1)?.text,
    FLAGSHIP_STORY_PLATFORM_PROMPT,
    "Story platform edit did not persist the exact fixed prompt.",
  );
  report.flagshipStory.phases.goal7 = {
    status: "observed",
    revision: goal7.revision,
  };
  await persistFlagshipStoryPhase(report, evidenceDir, "goal7", goal7, page);
  const platformCheck = assertFlagshipStoryPlatform(
    mushroom,
    goal7,
    initialStory.middlePlatform.id,
  );
  const goal7Objective = storyObjectiveEvidence(goal7, "Story goal-7 edit");
  assert.equal(
    goal7Objective.collectibleCount,
    7,
    "Story goal-7 edit must expose seven collectible objectives.",
  );
  assert.equal(
    goal7Objective.portalThreshold,
    7,
    "Story goal-7 edit portal must require seven crystals.",
  );
  onGoodProject(goal7);
  let goal7Gameplay = {
    status: "not-run",
    reason: "saved-checkpoint-resume-is-not-fresh-world-evidence",
  };
  if (!options.seeded) {
    goal7Gameplay = await runGameplayPhase(
      "goal7",
      goal7,
      freshGameplayStoryForProject(goal7, 7, "Story goal-7 edit"),
      {
        inputMode: config.flagshipInputMode,
        expectedCollectibleCount: 7,
        expectedRevision: goal7.revision,
      },
    );
    report.flagshipStory.phases.goal7 = {
      status: "passed",
      revision: goal7.revision,
      ...platformCheck,
      objective: goal7Objective,
      gameplay: goal7Gameplay,
    };
    await page.screenshot({
      path: join(evidenceDir, "story-goal-7-gameplay-reset.png"),
      fullPage: true,
    });
    report.evidence.push("story-goal-7-gameplay-reset.png");
  } else {
    report.flagshipStory.phases.goal7 = {
      status: "structural-passed",
      revision: goal7.revision,
      ...platformCheck,
      objective: goal7Objective,
      gameplay: goal7Gameplay,
    };
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.locator(".game-hud")).toBeVisible();
    await expect(page.locator(".game-hud strong")).toHaveText("0");
    report.flagshipStory.phases.goal7.hud = "game-score-starts-at-zero";
  }
  await page.screenshot({
    path: join(evidenceDir, "story-goal-7.png"),
    fullPage: true,
  });
  report.evidence.push("story-goal-7.png");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(
    page.getByText("Previous change restored.", { exact: true }),
  ).toBeVisible();
  const undone = await waitForSavedProject(
    page,
    goal7.revision + 1,
    mushroom.messages.filter((message) => message.role === "assistant").length,
  );
  assert.deepEqual(
    storyComparable(undone),
    storyComparable(mushroom),
    "Story undo did not restore the mushroom revision apart from revision/messages.",
  );
  const undoneObjective = storyObjectiveEvidence(undone, "Story undo");
  assert.equal(
    undoneObjective.collectibleCount,
    5,
    "Story undo must restore five collectible objectives.",
  );
  assert.equal(
    undoneObjective.portalThreshold,
    5,
    "Story undo portal must restore the five-crystal objective.",
  );
  onGoodProject(undone);
  let undoGameplay = {
    status: "not-run",
    reason: "saved-checkpoint-resume-is-not-fresh-world-evidence",
  };
  if (!options.seeded) {
    undoGameplay = await runGameplayPhase(
      "undo",
      undone,
      freshGameplayStoryForProject(undone, 5, "Story undo"),
      {
        inputMode: config.flagshipInputMode,
        expectedCollectibleCount: 5,
        expectedRevision: undone.revision,
      },
    );
    await page.screenshot({
      path: join(evidenceDir, "story-undo-gameplay-reset.png"),
      fullPage: true,
    });
    report.evidence.push("story-undo-gameplay-reset.png");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
  }
  report.flagshipStory.phases.undo = {
    status: options.seeded ? "structural-passed" : "passed",
    revision: undone.revision,
    objective: undoneObjective,
    gameplay: undoGameplay,
  };
  report.flagshipStory = {
    ...report.flagshipStory,
    status: options.seeded ? "structural-passed" : "passed",
    scope: options.seeded
      ? "structural-and-persistence"
      : "fresh-gameplay-and-persistence",
    visualReview: "pending",
    initial: {
      trees: initialStory.trees.length,
      platforms: initialStory.platforms.length,
      collectibles: initialStory.collectibles.length,
      treeId: initialStory.tree.id,
      middlePlatformId: initialStory.middlePlatform.id,
    },
    mushroom: { ...mushroomCheck, revision: mushroom.revision },
    goal7: {
      ...platformCheck,
      revision: goal7.revision,
      objective: goal7Objective,
      gameplay: goal7Gameplay,
    },
    undo: {
      restoredRevision: undone.revision,
      restoredMushroomState: true,
      exportedGoal: 5,
      objective: undoneObjective,
      gameplay: undoGameplay,
    },
    limitations: options.seeded
      ? [
          "Saved-checkpoint continuation has structural objective checks only; goal-7 and undo gameplay were not run.",
        ]
      : [],
  };
  report.edit = {
    status: "passed",
    type: "flagship-story",
    selectedIdPreserved: true,
  };
  return undone;
}

async function runMushroomReplacement(
  page,
  config,
  report,
  info,
  evidenceDir,
  created,
  onGoodProject,
) {
  const { tree } = selectMushroomReplacementTree(created);
  const targetIndex = created.entities.findIndex(
    (entity) => entity.id === tree.id,
  );
  assert(
    targetIndex >= 0,
    "Mushroom replacement tree is not in the created scene.",
  );
  const targetRow = page.locator(".object-list button").nth(targetIndex);
  await expect(targetRow).toHaveCount(1);
  await targetRow.click();
  await expect(page.locator(".selection-chip")).toContainText(tree.label);
  await page.locator("#prompt").fill(config.editPrompt);
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect.poll(() => info.generationRequests, { timeout: 30000 }).toBe(2);
  assert.equal(
    info.generationBodies.at(-1)?.selectedId,
    tree.id,
    "Mushroom replacement did not target the selected tree.",
  );
  let edited = await waitForSavedProject(
    page,
    created.revision + 1,
    created.messages.filter((message) => message.role === "assistant").length +
      1,
  );
  // Persist the acquired edit before optional baking so a bake failure still
  // leaves the provider's committed scene available for diagnosis.
  await persistMushroomReplacementSnapshot(
    report,
    evidenceDir,
    "after",
    edited,
  );
  const editedTree = edited.entities.find((entity) => entity.id === tree.id);
  if (
    editedTree?.geometry?.kind === "generated" &&
    editedTree.geometry.job?.backend === "browser-manifold"
  )
    edited = await waitForTrustedBrowserBake(page, tree.id);
  await persistMushroomReplacementSnapshot(
    report,
    evidenceDir,
    "after",
    edited,
  );
  // The snapshot above is persisted before semantic assertions so later
  // failures retain the acquired scene.
  const mushroomCheck = assertMushroomReplacement(created, edited, tree.id);
  onGoodProject(edited);
  report.mushroomReplacement = {
    status: "passed",
    targetId: tree.id,
    targetLabel: tree.label,
    ...mushroomCheck,
  };
  report.edit = {
    status: "passed",
    type: "mushroom-replacement",
    selectedIdPreserved: true,
  };
  return edited;
}

async function putIndexedDBValue(page, key, value) {
  await page.evaluate(
    ({ key: recordKey, value: recordValue }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("keyval"))
            request.result.createObjectStore("keyval");
        };
        request.onerror = () => reject(request.error ?? Error("IndexedDB open failed"));
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("keyval", "readwrite");
          transaction.objectStore("keyval").put(recordValue, recordKey);
          transaction.onerror = () => reject(transaction.error);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
        };
      }),
    { key, value },
  );
}

async function seedFlagshipProject(page, project, models, history = []) {
  await putIndexedDBValue(page, "orbsie-draft", {
    project,
    history,
    future: [],
    savedAt: Date.now(),
  });
  await putIndexedDBValue(page, "orbsie-library", {
    [project.id]: project,
  });
  await putIndexedDBValue(page, "orbsie-history", {
    [project.id]: {
      project,
      history,
      future: [],
    },
  });
  for (const model of models)
    await putIndexedDBValue(page, `orbsie-model:${model.metadata.sha256}`, {
      metadata: model.metadata,
      glb: model.glb,
    });
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function seedFlagshipResume(page, checkpoint) {
  await seedFlagshipProject(page, checkpoint.project, checkpoint.models);
}

async function seedFlagshipOfflineResume(page, artifacts) {
  await seedFlagshipProject(page, artifacts.edited, artifacts.models, [
    artifacts.baseline,
  ]);
  for (const model of artifacts.baselineModels)
    await putIndexedDBValue(page, `orbsie-model:${model.metadata.sha256}`, {
      metadata: model.metadata,
      glb: model.glb,
    });
}

async function openFlagshipResumeProject(page, project) {
  const continueButton = page.getByRole("button", {
    name: "Continue your saved world",
    exact: true,
  });
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.click();
  } else {
    const worlds = page.getByRole("button", {
      name: "Your worlds",
      exact: true,
    });
    await expect(worlds).toBeVisible({ timeout: 30000 });
    await worlds.click();
    await page
      .getByRole("button", {
        name: new RegExp(escapeRegExp(project.title)),
      })
      .first()
      .click();
  }
  await expect(page.locator(".workspace-heading h2")).toContainText(
    project.title,
    { timeout: 30000 },
  );
}

function resumeTrafficEvidence(config, info) {
  return {
    generationRequests: info.generationRequests,
    generationStatuses: info.generationStatuses,
    generationDiagnostics: info.generationDiagnostics,
    generationBudgetViolations: info.generationBudgetViolations ?? [],
    blockedExternalRequests: info.blockedExternalRequests,
    blockedExternalOrigins: [...info.blockedExternalOrigins].slice(0, 8),
    interceptedGeneration: info.interceptedGeneration,
    provider: config.provider,
  };
}

async function runFlagshipResume(
  config,
  report,
  info,
  evidenceDir,
  approvedOrigins,
) {
  const browser = await chromium.launch({
    headless: process.env.ORBSIE_HEADLESS !== "0",
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await installTrafficGuard(context, config, approvedOrigins, info);
  const page = await context.newPage();
  attachRequestEvidence(page, config, info);
  let lastGoodProject = config.resumeCheckpoint.project;
  try {
    await page.goto(config.baseOrigin, { waitUntil: "domcontentloaded" });
    await seedFlagshipResume(page, config.resumeCheckpoint);
    await setupOutputCap(page, config);
    await configureApiProvider(page, config, report, info, evidenceDir);
    await prepareObserver(page);
    await installGenerationDiagnosticObserver(page);
    await openFlagshipResumeProject(page, config.resumeCheckpoint.project);
    const checkpointSnapshot = await storageSnapshot(page);
    assert.deepEqual(
      persistenceJSON(checkpointSnapshot.project),
      persistenceJSON(config.resumeCheckpoint.project),
      "The seeded flagship checkpoint did not reopen exactly.",
    );
    for (const model of config.resumeCheckpoint.models) {
      const stored = await readStoredGeneratedModelDigest(
        page,
        model.metadata.sha256,
      );
      assert(stored, `Seeded checkpoint model ${model.id} was not reopened.`);
      assert.equal(stored.sha256, model.metadata.sha256);
      assert.equal(stored.bytes, model.metadata.bytes);
    }
    await assertNoStoredKey(page, config);
    report.flagshipResume = {
      status: "checkpoint-restored",
      checkpoint: {
        projectId: config.resumeCheckpoint.project.id,
        revision: config.resumeCheckpoint.project.revision,
        sourceSnapshotSha256: config.resumeCheckpoint.sourceSnapshotSha256,
        models: config.resumeCheckpoint.models.map((model) => ({
          id: model.id,
          sha256: model.metadata.sha256,
          bytes: model.metadata.bytes,
        })),
      },
      generationBudget: 1,
    };

    const clearSelection = page.getByRole("button", {
      name: "Clear selected object",
      exact: true,
    });
    if (await clearSelection.isVisible().catch(() => false))
      await clearSelection.click();
    await page.locator("#prompt").fill(config.editPrompt);
    await page.getByRole("button", { name: "Change this", exact: true }).click();
    await expect
      .poll(() => info.generationRequests, { timeout: 30000 })
      .toBe(1);
    assert.equal(
      info.generationBodies.at(-1)?.projectId,
      config.resumeCheckpoint.project.id,
    );
    assert.equal(
      info.generationBodies.at(-1)?.projectRevision,
      config.resumeCheckpoint.project.revision,
    );
    assert.equal(
      info.generationBodies.at(-1)?.selectedId ?? null,
      null,
      "Flagship resume unexpectedly sent a selected entity.",
    );
    const edited = await waitForSavedProject(
      page,
      config.resumeCheckpoint.project.revision + 1,
      config.resumeCheckpoint.project.messages.filter(
        (message) => message.role === "assistant",
      ).length + 1,
    );
    report.flagshipStory = {
      status: "checkpoint-resumed",
      visualReview: "pending",
      phases: { resumed: { status: "observed", revision: edited.revision } },
    };
    await persistFlagshipStoryPhase(
      report,
      evidenceDir,
      "resumed",
      edited,
      page,
    );
    const platformCheck = assertFlagshipStoryPlatform(
      config.resumeCheckpoint.project,
      edited,
      storyPlatforms(config.resumeCheckpoint.project)[1].id,
    );
    const goalCheck = assertFlagshipStoryGoalSeven(edited);
    lastGoodProject = edited;
    report.flagshipStory.phases.resumed = {
      status: "passed",
      revision: edited.revision,
      ...platformCheck,
    };
    await page.screenshot({
      path: join(evidenceDir, "resume-edited.png"),
      fullPage: true,
    });
    report.evidence.push("resume-edited.png");
    report.flagshipResume.edited = {
      revision: edited.revision,
      platform: platformCheck,
      goal: goalCheck,
      collectibles: storyCollectibles(edited).length,
    };

    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.locator(".game-hud")).toBeVisible();
    await expect(page.locator(".game-hud strong")).toHaveText("0");
    await expect(page.locator(".game-hud")).toContainText("Score");
    await page.screenshot({
      path: join(evidenceDir, "resume-goal-7.png"),
      fullPage: true,
    });
    report.evidence.push("resume-goal-7.png");

    // Capture the exact edited goal-7 revision before undo. Keep this ZIP
    // separate from the restored baseline export below so traversal can run
    // against the seven-crystal saved program and its seven generated models.
    await page.getByRole("button", { name: "Share Orb", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^Download your world/ }),
    ).toBeVisible({ timeout: 30000 });
    const editedDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Download your world/ }).click();
    const editedDownload = await editedDownloadPromise;
    const editedZip = await extractZip(
      editedDownload,
      config,
      edited.revision,
      evidenceDir,
      "world-goal-7.zip",
    );
    assert.deepEqual(
      storyComparable(editedZip.project),
      storyComparable(edited),
      "The goal-7 export did not preserve the edited checkpoint.",
    );
    assert.equal(storyCollectibles(editedZip.project).length, 7);
    const editedGeneratedModels = editedZip.names.filter((name) =>
      /^models\/generated\/[a-f0-9]{64}\.glb$/.test(name),
    );
    assert.equal(
      editedGeneratedModels.length,
      7,
      "The goal-7 export must include seven generated crystal models.",
    );
    report.flagshipResume.editedExport = {
      status: "goal-7",
      revision: editedZip.project.revision,
      collectibles: storyCollectibles(editedZip.project).length,
      generatedModels: editedGeneratedModels.length,
      file: "world-goal-7.zip",
    };
    report.evidence.push("world-goal-7.zip");
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();

    await page.reload({ waitUntil: "domcontentloaded" });
    await openFlagshipResumeProject(page, edited);
    const reloadedEdited = await waitForSavedProject(page, edited.revision);
    assert.deepEqual(
      persistenceJSON(reloadedEdited),
      persistenceJSON(edited),
      "The goal-7 checkpoint did not survive reload.",
    );
    report.localRecovery = "passed";

    await page.getByRole("button", { name: "Edit", exact: true }).click().catch(() => undefined);
    await page
      .getByRole("button", { name: "Undo last change", exact: true })
      .click();
    await expect(
      page.getByText("Previous change restored.", { exact: true }),
    ).toBeVisible();
    const undone = await waitForSavedProject(
      page,
      edited.revision + 1,
      config.resumeCheckpoint.project.messages.filter(
        (message) => message.role === "assistant",
      ).length,
    );
    assert.deepEqual(
      storyComparable(undone),
      storyComparable(config.resumeCheckpoint.project),
      "Resume undo did not restore the seeded mushroom checkpoint.",
    );
    assert.equal(storyCollectibles(undone).length, 5);
    report.flagshipResume.undo = {
      restoredRevision: undone.revision,
      restoredCheckpoint: true,
      restoredCollectibles: storyCollectibles(undone).length,
    };
    lastGoodProject = undone;

    await page.reload({ waitUntil: "domcontentloaded" });
    await openFlagshipResumeProject(page, undone);
    const reloadedUndone = await waitForSavedProject(page, undone.revision);
    assert.deepEqual(
      storyComparable(reloadedUndone),
      storyComparable(config.resumeCheckpoint.project),
      "The restored checkpoint did not survive reload.",
    );

    await page.getByRole("button", { name: "Share Orb", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^Download your world/ }),
    ).toBeVisible({ timeout: 30000 });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Download your world/ }).click();
    const download = await downloadPromise;
    const zip = await extractZip(
      download,
      config,
      reloadedUndone.revision,
      evidenceDir,
    );
    assert.deepEqual(
      storyComparable(zip.project),
      storyComparable(config.resumeCheckpoint.project),
      "The resume export did not preserve the restored five-crystal checkpoint.",
    );
    assert.equal(storyCollectibles(zip.project).length, 5);
    report.flagshipResume.exportedGoal = 5;
    report.flagshipResume.exportedRevision = zip.project.revision;
    report.evidence.push("world.zip");
    report.export = "passed";
    await verifyStandalone(browser, zip, config, report, evidenceDir);
    report.standalonePlayback = "passed";
    await assertNoStoredKey(page, config);
    await Promise.allSettled(info.diagnosticReads);
    assertGenerationRequests(config, info);
    report.flagshipResume.status = "structural-passed";
    report.liveInference = true;
    report.traffic = resumeTrafficEvidence(config, info);
  } catch (error) {
    await Promise.allSettled(info.diagnosticReads);
    const diagnostics = await readGenerationDiagnostics(page).catch(() => []);
    info.generationDiagnostics.push(
      ...diagnostics.map((record) => ({
        code: record.code,
        diagnostic: sanitizeMessage(record.diagnostic, config),
      })),
    );
    try {
      await page.screenshot({
        path: join(evidenceDir, "resume-failure.png"),
        fullPage: true,
      });
      report.evidence.push("resume-failure.png");
    } catch {
      // The report retains the sanitized error if the page never loaded.
    }
    report.flagshipResume = {
      ...(report.flagshipResume ?? {}),
      status: "failed",
      lastGoodCheckpoint: checkpointSummary(lastGoodProject),
    };
    report.error = sanitizedError(error, config);
    report.traffic = resumeTrafficEvidence(config, info);
    await writeReport(report, config);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
  return report;
}

async function runFlagshipResumeOffline(
  config,
  report,
  info,
  evidenceDir,
  approvedOrigins,
) {
  const browser = await chromium.launch({
    headless: process.env.ORBSIE_HEADLESS !== "0",
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await installTrafficGuard(context, config, approvedOrigins, info);
  const page = await context.newPage();
  attachRequestEvidence(page, config, info);
  const artifacts = config.resumeOffline;
  let lastGoodProject = artifacts.edited;
  try {
    await page.goto(config.baseOrigin, { waitUntil: "domcontentloaded" });
    await seedFlagshipOfflineResume(page, artifacts);
    await prepareObserver(page);
    await installGenerationDiagnosticObserver(page);
    await openFlagshipResumeProject(page, artifacts.edited);
    const opened = await waitForSavedProject(page, artifacts.edited.revision);
    assert.deepEqual(
      persistenceJSON(opened),
      persistenceJSON(artifacts.edited),
      "The seeded edited checkpoint did not reopen exactly.",
    );
    for (const model of artifacts.models) {
      const stored = await readStoredGeneratedModelDigest(
        page,
        model.metadata.sha256,
      );
      assert(stored, `Seeded edited model ${model.id} was not reopened.`);
      assert.equal(stored.sha256, model.metadata.sha256);
      assert.equal(stored.bytes, model.metadata.bytes);
    }
    const goalCheck = assertFlagshipStoryGoalSeven(artifacts.edited);
    report.flagshipResume = {
      ...(report.flagshipResume ?? {}),
      status: "offline-checkpoint-restored",
      artifactMode: artifacts.artifactMode ?? "reconstructed",
      source: {
        baselineRevision: artifacts.baseline.revision,
        editedRevision: artifacts.edited.revision,
        editedSnapshotSha256: artifacts.editedSnapshotSha256,
        generatedModelCount: artifacts.models.length,
      },
      seededHistory: true,
      seededHistoryCaveat:
        "Undo evidence uses the captured baseline seeded into local history; it is not the live model run's history.",
      generationBudget: 0,
    };
    report.evidence.push("offline-edited-project.json");
    await writeFile(
      join(evidenceDir, "offline-edited-project.json"),
      `${JSON.stringify(artifacts.edited, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );

    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.locator(".game-hud")).toBeVisible();
    await expect(page.locator(".game-hud strong")).toHaveText("0");
    await expect(page.locator(".game-hud")).toContainText("Score");
    report.flagshipResume.goal = {
      ...goalCheck,
      hud: "game-score-starts-at-zero",
      goalSevenUiCounter: "not-rendered-for-variable-based-game",
      gameplayTraversal: "not-run",
    };
    await page.screenshot({
      path: join(evidenceDir, "offline-goal-hud.png"),
      fullPage: true,
    });
    report.evidence.push("offline-goal-hud.png");

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await openFlagshipResumeProject(page, artifacts.edited);
    const reloadedEdited = await waitForSavedProject(
      page,
      artifacts.edited.revision,
    );
    assert.deepEqual(
      persistenceJSON(reloadedEdited),
      persistenceJSON(artifacts.edited),
      "The edited checkpoint did not survive reload.",
    );
    report.localRecovery = "offline-edited-reload-passed";

    // Preserve the exact edited goal-7 export before seeded undo restores the
    // baseline. The existing world.zip remains the separate goal-5 export.
    await page.getByRole("button", { name: "Share Orb", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^Download your world/ }),
    ).toBeVisible({ timeout: 30000 });
    const editedDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Download your world/ }).click();
    const editedDownload = await editedDownloadPromise;
    const editedZip = await extractZip(
      editedDownload,
      config,
      artifacts.edited.revision,
      evidenceDir,
      "world-goal-7.zip",
    );
    assert.deepEqual(
      storyComparable(editedZip.project),
      storyComparable(artifacts.edited),
      "The offline goal-7 export did not preserve the edited checkpoint.",
    );
    assert.equal(storyCollectibles(editedZip.project).length, 7);
    const editedGeneratedModels = editedZip.names.filter((name) =>
      /^models\/generated\/[a-f0-9]{64}\.glb$/.test(name),
    );
    assert.equal(
      editedGeneratedModels.length,
      artifacts.models.length,
      `The offline goal-7 export must include ${artifacts.models.length} generated crystal models.`,
    );
    report.flagshipResume.editedExport = {
      status: "goal-7",
      revision: editedZip.project.revision,
      collectibles: storyCollectibles(editedZip.project).length,
      generatedModels: editedGeneratedModels.length,
      artifactMode: artifacts.artifactMode ?? "reconstructed",
      file: "world-goal-7.zip",
    };
    report.evidence.push("world-goal-7.zip");
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    await page
      .getByRole("button", { name: "Edit", exact: true })
      .click()
      .catch(() => undefined);
    await page
      .getByRole("button", { name: "Undo last change", exact: true })
      .click();
    await expect(
      page.getByText("Previous change restored.", { exact: true }),
    ).toBeVisible();
    const undone = await waitForSavedProject(
      page,
      artifacts.edited.revision + 1,
    );
    assert.deepEqual(
      storyComparable(undone),
      storyComparable(artifacts.baseline),
      "Seeded offline undo did not restore the baseline checkpoint.",
    );
    assert.equal(storyCollectibles(undone).length, 5);
    lastGoodProject = undone;
    report.flagshipResume.undo = {
      status: "offline-seeded-history-passed",
      restoredRevision: undone.revision,
      restoredCheckpoint: true,
      restoredCollectibles: storyCollectibles(undone).length,
    };

    await page.reload({ waitUntil: "domcontentloaded" });
    await openFlagshipResumeProject(page, undone);
    const reloadedUndone = await waitForSavedProject(page, undone.revision);
    assert.deepEqual(
      storyComparable(reloadedUndone),
      storyComparable(artifacts.baseline),
      "The restored baseline did not survive reload.",
    );

    await page.getByRole("button", { name: "Share Orb", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^Download your world/ }),
    ).toBeVisible({ timeout: 30000 });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Download your world/ }).click();
    const download = await downloadPromise;
    const zip = await extractZip(
      download,
      config,
      reloadedUndone.revision,
      evidenceDir,
    );
    assert.deepEqual(
      storyComparable(zip.project),
      storyComparable(artifacts.baseline),
      "The offline export did not preserve the restored baseline.",
    );
    assert.equal(storyCollectibles(zip.project).length, 5);
    report.flagshipResume.exported = {
      status: "baseline-goal-5",
      revision: zip.project.revision,
      seededHistory: true,
    };
    report.evidence.push("world.zip");
    report.export = "offline-baseline-passed";
    await verifyStandalone(browser, zip, config, report, evidenceDir);
    report.standalonePlayback = "passed";
    await assertNoStoredKey(page, config);
    assert.equal(
      info.generationRequests,
      0,
      "Offline resume made a generation request.",
    );
    assert.deepEqual(
      info.generationStatuses,
      [],
      "Offline resume observed a generation response.",
    );
    assert.deepEqual(
      info.generationBudgetViolations ?? [],
      [],
      "Offline resume triggered a generation budget violation.",
    );
    assert.equal(info.interceptedGeneration, false);
    report.flagshipResume.status = "offline-structural-passed";
    report.liveInference = false;
    report.traffic = resumeTrafficEvidence(config, info);
  } catch (error) {
    const diagnostics = await readGenerationDiagnostics(page).catch(() => []);
    info.generationDiagnostics.push(
      ...diagnostics.map((record) => ({
        code: record.code,
        diagnostic: sanitizeMessage(record.diagnostic, config),
      })),
    );
    try {
      await page.screenshot({
        path: join(evidenceDir, "offline-resume-failure.png"),
        fullPage: true,
      });
      report.evidence.push("offline-resume-failure.png");
    } catch {
      // The report retains the sanitized failure if the page never loaded.
    }
    report.flagshipResume = {
      ...(report.flagshipResume ?? {}),
      status: "offline-failed",
      lastGoodCheckpoint: checkpointSummary(lastGoodProject),
      generationRequests: info.generationRequests,
    };
    report.error = sanitizedError(error, config);
    report.traffic = resumeTrafficEvidence(config, info);
    await writeReport(report, config);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
  return report;
}

export async function extractZip(
  download,
  config,
  expectedRevision,
  evidenceDir,
  artifactName = "world.zip",
) {
  assert(
    /^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/.test(artifactName),
    "Export evidence filename must be a simple ZIP filename.",
  );
  const tempDir = await mkdtemp(join(tmpdir(), "orbsie-provider-e2e-"));
  const zipPath = join(tempDir, "world.zip");
  await download.saveAs(zipPath);
  const bytes = await readFile(zipPath);
  const files = unzipSync(new Uint8Array(bytes));
  const names = Object.keys(files);
  const required = [
    "index.html",
    "project.json",
    "runtime.js",
    "runtime.css",
    "generated-geometry-worker.js",
    "asset-geometry-worker.js",
    "package.json",
    "README.md",
    "build.mjs",
  ];
  for (const name of required) assert(files[name], `ZIP is missing ${name}.`);
  assert(
    names.some((name) => name.startsWith("src/")),
    "ZIP does not include runtime source.",
  );
  assert(
    names.every((name) => !name.startsWith("/") && !name.includes(`..${sep}`)),
    "ZIP contains an unsafe path.",
  );
  const project = JSON.parse(strFromU8(files["project.json"]));
  assert.equal(
    project.revision,
    expectedRevision,
    "ZIP project revision differs from committed IndexedDB revision.",
  );
  const textFiles = names.map((name) => strFromU8(files[name]));
  const joined = textFiles.join("\n");
  assert(
    !/authorization|cookie|chatgpt|refresh.?token|access.?token/i.test(
      JSON.stringify(project),
    ),
    "ZIP project contains provider/session data.",
  );
  assert(
    !(config.key ?? config.companionToken) ||
      !joined.includes(config.key ?? config.companionToken),
    "Provider key appeared in the exported ZIP.",
  );
  assert(
    !config.builderToken || !joined.includes(config.builderToken),
    "Builder capability appeared in exported ZIP.",
  );
  await writeFile(join(evidenceDir, artifactName), bytes, { mode: 0o600 });
  const publicationArtifacts = Object.fromEntries(
    PUBLICATION_ARTIFACT_PATHS.map((path) => [
      path,
      { bytes: files[path].byteLength, sha256: sha256(files[path]) },
    ]),
  );
  return { tempDir, names, project, publicationArtifacts };
}

async function serveStaticDirectory(directory) {
  const root = resolve(directory);
  const server = createServer(async (request, response) => {
    try {
      const requestPath = decodeURIComponent(
        new URL(request.url || "/", "http://127.0.0.1").pathname,
      );
      const candidate = resolve(
        root,
        `.${requestPath === "/" ? "/index.html" : requestPath}`,
      );
      const relativePath = relative(root, candidate);
      if (
        relativePath.startsWith("..") ||
        relativePath.split(sep).includes("..")
      ) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      const body = await readFile(candidate);
      const contentType = candidate.endsWith(".js")
        ? "text/javascript"
        : candidate.endsWith(".css")
          ? "text/css"
          : candidate.endsWith(".json")
            ? "application/json"
            : "text/html";
      response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  await new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveServer();
    });
  });
  const address = server.address();
  assert(address && typeof address === "object" && address.port);
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

export async function verifyStandalone(
  browser,
  zip,
  config,
  report,
  evidenceDir,
) {
  // The ZIP has already been validated. Extract once through fflate for the
  // static playback server, keeping all output in the temporary directory.
  const bytes = await readFile(join(zip.tempDir, "world.zip"));
  const files = unzipSync(new Uint8Array(bytes));
  for (const [name, content] of Object.entries(files)) {
    const target = resolve(zip.tempDir, name);
    const parent = resolve(target, "..");
    assert(
      parent.startsWith(resolve(zip.tempDir)),
      "Unsafe ZIP extraction path.",
    );
    await mkdir(parent, { recursive: true });
    await writeFile(target, content);
  }
  const served = await serveStaticDirectory(zip.tempDir);
  const freshStory = report.flagshipStory;
  const standaloneGameplayEligible =
    config.flagshipStory === true &&
    freshStory?.status === "passed" &&
    freshStory?.scope === "fresh-gameplay-and-persistence";
  const standaloneReport = {
    status: "running",
    readyObservedMs: null,
    blockedExternalRequests: 0,
    pageErrors: [],
    inputGame: config.requireInputGame
      ? {
          ready: false,
          rightAdds7: false,
          heldRightDeduplicated: false,
          upWins: false,
          restartResetsScore: false,
          leftLoses: false,
        }
      : null,
  };
  report.standalone = standaloneReport;
  let standaloneGameplayBase = null;
  if (config.flagshipStory) {
    report.standaloneGameplay = {
      status: "not-run",
      reason: standaloneGameplayEligible
        ? "fresh-story-export-binding-pending"
        : "fresh-flagship-story-not-complete",
      projectId: zip.project?.id ?? null,
      revision: zip.project?.revision ?? null,
    };
  }
  let context;
  const info = {
    generationRequests: 0,
    blockedExternalRequests: 0,
    blockedExternalOrigins: new Set(),
    interceptedGeneration: false,
  };
  try {
    // Exported games must stand alone: even the originating editor is external.
    const approved = new Set([served.origin]);
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce",
    });
    await installTrafficGuard(context, config, approved, info);
    const page = await context.newPage();
    if (standaloneGameplayEligible) {
      const phaseGameplay = [
        freshStory.phases?.creation?.gameplay,
        freshStory.phases?.goal7?.gameplay,
        freshStory.phases?.undo?.gameplay,
      ];
      const phaseRevisions = [
        freshStory.phases?.creation?.revision,
        freshStory.phases?.goal7?.revision,
        freshStory.phases?.undo?.revision,
      ];
      assert(
        phaseGameplay.every((gameplay) => gameplay?.status === "passed"),
        "Fresh flagship standalone gameplay requires passed creation, seven, and undo traversal.",
      );
      assert.equal(
        zip.project.id,
        phaseGameplay[0].projectId,
        "Standalone ZIP changed the fresh flagship project identity.",
      );
      assert.deepEqual(
        phaseGameplay.map((gameplay) => gameplay.projectId),
        [zip.project.id, zip.project.id, zip.project.id],
        "Standalone ZIP project identity differs from a gameplay phase.",
      );
      assert.deepEqual(
        phaseGameplay.map((gameplay) => gameplay.revision),
        phaseRevisions,
        "A fresh flagship gameplay result is not bound to its phase revision.",
      );
      assert.equal(
        zip.project.revision,
        freshStory.phases?.undo?.revision,
        "Standalone ZIP revision differs from the original undo revision.",
      );
      const targets = freshGameplayStoryForProject(
        zip.project,
        5,
        "Fresh flagship standalone export",
      );
      standaloneGameplayBase = {
        status: "running",
        projectId: zip.project.id,
        revision: zip.project.revision,
        expectedCollectibleIds: targets.collectibles.map(
          (collectible) => collectible.id,
        ),
        expectedCollectibleCount: 5,
        runtime: {
          bytes: files["runtime.js"]?.byteLength ?? 0,
          sha256: createHash("sha256")
            .update(files["runtime.js"] ?? new Uint8Array())
            .digest("hex"),
          source: "exported-static-zip",
        },
        inputMode: config.flagshipInputMode ?? "auto",
      };
      report.standaloneGameplay = standaloneGameplayBase;
      await page.addInitScript(() => {
        window.__ORBSIE_GAMEPLAY_READ_REQUESTED__ = true;
      });
    }
    const unexpected = [];
    page.on("pageerror", (error) => {
      standaloneReport.pageErrors.push(
        sanitizeMessage(error?.message ?? error, config),
      );
    });
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        path.startsWith("/api/") ||
        path === "/generate" ||
        path === "/health"
      )
        unexpected.push(path);
    });
    await page.goto(`${served.origin}/`, { waitUntil: "networkidle" });
    await expect(page.locator("canvas")).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".score")).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".message")).toHaveCount(0, {
      timeout: 30000,
    });
    await expect(page.locator("main[data-ready=true]")).toBeVisible({
      timeout: 30000,
    });
    // Observation includes navigation and the preceding assertions; this is an
    // upper bound on readiness, not an exact first-frame performance metric.
    standaloneReport.readyObservedMs = await page.evaluate(() =>
      performance.now(),
    );
    if (config.requireInputGame) {
      await expect(page.locator(".score")).toHaveText("Score: 0");
      standaloneReport.inputGame.ready = true;
      await page.screenshot({
        path: join(evidenceDir, "standalone-input-ready.png"),
      });
      report.evidence.push("standalone-input-ready.png");

      await page.keyboard.down("d");
      try {
        await expect(page.locator(".score")).toHaveText("Score: 7");
        standaloneReport.inputGame.rightAdds7 = true;
        await page.waitForTimeout(150);
        await expect(page.locator(".score")).toHaveText("Score: 7");
        standaloneReport.inputGame.heldRightDeduplicated = true;
      } finally {
        await page.keyboard.up("d").catch(() => undefined);
      }
      await page.screenshot({
        path: join(evidenceDir, "standalone-input-right.png"),
      });
      report.evidence.push("standalone-input-right.png");

      await page.keyboard.press("w", { delay: 100 });
      await expect(page.locator(".win")).toContainText("Final score: 7");
      standaloneReport.inputGame.upWins = true;
      await page.screenshot({
        path: join(evidenceDir, "standalone-input-win.png"),
      });
      report.evidence.push("standalone-input-win.png");

      await page.getByRole("button", { name: /Restart/ }).click();
      await expect(page.locator(".score")).toHaveText("Score: 0");
      standaloneReport.inputGame.restartResetsScore = true;
      await page.keyboard.press("a", { delay: 100 });
      await expect(page.locator(".win")).toContainText("Try another adventure");
      standaloneReport.inputGame.leftLoses = true;
      await page.screenshot({
        path: join(evidenceDir, "standalone-input-loss.png"),
      });
      report.evidence.push("standalone-input-loss.png");
    }
    if (standaloneGameplayEligible) {
      const targets = freshGameplayStoryForProject(
        zip.project,
        5,
        "Fresh flagship standalone export",
      );
      try {
        const gameplay = await runFreshFlagshipGameplay(
          page,
          zip.project,
          targets,
          {
            surface: "standalone",
            inputMode: config.flagshipInputMode,
            expectedCollectibleCount: 5,
            expectedRevision: zip.project.revision,
            onWin: async () => {
              await page.screenshot({
                path: join(
                  evidenceDir,
                  "standalone-flagship-gameplay-win.png",
                ),
                fullPage: true,
              });
              report.evidence.push("standalone-flagship-gameplay-win.png");
            },
            onReset: async () => {
              await page.screenshot({
                path: join(
                  evidenceDir,
                  "standalone-flagship-gameplay-reset.png",
                ),
                fullPage: true,
              });
              report.evidence.push("standalone-flagship-gameplay-reset.png");
            },
          },
        );
        report.standaloneGameplay = {
          ...standaloneGameplayBase,
          ...gameplay,
          editorProviderRequests: unexpected.length,
          blockedExternalRequests: info.blockedExternalRequests,
        };
      } catch (error) {
        report.standaloneGameplay = {
          ...standaloneGameplayBase,
          status: "failed",
          error: sanitizeMessage(error?.message ?? error, config),
          failureEvidence: error?.freshGameplayEvidence ?? null,
          editorProviderRequests: unexpected.length,
          blockedExternalRequests: info.blockedExternalRequests,
        };
        throw error;
      }
    }
    // Capture the loaded scene after its initial formation frames, not the globe.
    await page.waitForTimeout(2000);
    standaloneReport.blockedExternalRequests = info.blockedExternalRequests;
    assert.equal(
      info.blockedExternalRequests,
      0,
      "Standalone playback attempted an external request.",
    );
    assert.deepEqual(
      unexpected,
      [],
      "Standalone playback made an editor/provider request.",
    );
    await page.screenshot({
      path: join(evidenceDir, "standalone-playback.png"),
    });
    report.evidence.push("standalone-playback.png");
    assert.deepEqual(
      standaloneReport.pageErrors,
      [],
      "Standalone playback reported page errors.",
    );
    standaloneReport.status = "passed";
  } catch (error) {
    standaloneReport.status = "failed";
    if (standaloneGameplayBase) {
      report.standaloneGameplay = {
        ...standaloneGameplayBase,
        ...(report.standaloneGameplay ?? {}),
        status: "failed",
        error: sanitizeMessage(error?.message ?? error, config),
        failureEvidence: error?.freshGameplayEvidence ?? null,
        blockedExternalRequests: info.blockedExternalRequests,
      };
    } else if (standaloneGameplayEligible) {
      report.standaloneGameplay = {
        ...(report.standaloneGameplay ?? {}),
        status: "failed",
        error: sanitizeMessage(error?.message ?? error, config),
        blockedExternalRequests: info.blockedExternalRequests,
      };
    }
    throw error;
  } finally {
    standaloneReport.blockedExternalRequests = info.blockedExternalRequests;
    await context?.close().catch(() => undefined);
    await new Promise((resolveServer) => {
      try {
        served.server.close(() => resolveServer());
      } catch {
        resolveServer();
      }
    });
  }
}

async function readExplicitCloudStorageState(config) {
  if (!config.publication && !config.cloudRecovery) return undefined;
  const cloudStatePath = resolve(process.env.ORBSIE_CLOUD_TEST_STATE);
  const mode = await stat(cloudStatePath);
  if ((mode.mode & 0o077) !== 0)
    throw new HarnessBlockedError(
      "ORBSIE_CLOUD_TEST_STATE must be mode 0600 or stricter.",
    );
  const state = JSON.parse(await readFile(cloudStatePath, "utf8"));
  const storageState = state.storageState || state.users?.[0]?.storageState;
  if (!storageState)
    throw new HarnessBlockedError(
      "The explicit cloud test state has no storageState.",
    );
  if (
    config.interruptedRecovery &&
    (!Array.isArray(storageState.cookies) || storageState.cookies.length === 0)
  )
    throw new HarnessBlockedError(
      "Interrupted recovery requires an authenticated cloud storageState with session cookies; no inference was attempted.",
    );
  return storageState;
}

async function readHostedAccountStorageState(config) {
  let mode;
  try {
    mode = await stat(config.accountStorageStatePath);
  } catch {
    throw new HarnessBlockedError(
      "ORBSIE_ACCOUNT_STORAGE_STATE could not be opened; supply the private authenticated Orbsie storage state and rerun. No generation was attempted.",
    );
  }
  if (!mode.isFile() || (mode.mode & 0o077) !== 0)
    throw new HarnessBlockedError(
      "ORBSIE_ACCOUNT_STORAGE_STATE must be a regular mode 0600-or-stricter file; no generation was attempted.",
    );
  let parsed;
  try {
    parsed = JSON.parse(await readFile(config.accountStorageStatePath, "utf8"));
  } catch {
    throw new HarnessBlockedError(
      "ORBSIE_ACCOUNT_STORAGE_STATE was not valid JSON; no generation was attempted.",
    );
  }
  try {
    return filterHostedStorageState(parsed, config.baseOrigin);
  } catch (error) {
    if (error instanceof HostedAcceptanceBlockedError)
      throw new HarnessBlockedError(error.message);
    throw error;
  }
}

async function sameOriginJSON(page, path) {
  return page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath, {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }, path);
}

function readyCheckpointEntities(project) {
  return Array.isArray(project?.entities)
    ? project.entities.filter(
        (entity) => entity?.stage === "ready" && entity?.geometry,
      )
    : [];
}

function journalRunDescription(run) {
  if (!run) return "no run returned";
  return `state=${run.state}, sequence=${run.sequence}, revision=${run.checkpoint?.revision ?? "?"}, readyEntities=${readyCheckpointEntities(run.checkpoint).length}`;
}

async function readLatestJournalRun(page, projectId) {
  const latestResponse = await sameOriginJSON(
    page,
    `/api/generation-runs?projectId=${encodeURIComponent(projectId)}`,
  );
  if (latestResponse.status !== 200)
    throw new HarnessBlockedError(
      `Authenticated cloud journal lookup failed before interruption (HTTP ${latestResponse.status}).`,
    );
  const run = latestResponse.body?.run;
  assert(run, "Authenticated cloud journal response omitted its run.");
  assert.equal(
    run.projectId,
    projectId,
    "Authenticated cloud journal returned a different project.",
  );
  return run;
}

export function providerReloadStrategy(provider) {
  if (provider === "chatgpt-local") return "companion";
  if (provider === HOSTED_PROVIDER) return "hosted";
  if (provider === "openrouter" || provider === "gateway") return "api";
  throw new HarnessConfigurationError(
    `Interrupted reload recovery is unsupported for provider ${provider}.`,
  );
}

async function reconnectChatGPTLocalAfterReload(page, config) {
  // The app consumes pairing fragments on mount, not on hash-only navigation.
  await page.goto("about:blank");
  const healthResponse = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.origin === config.companionURL &&
        url.pathname === "/health" &&
        response.request().method() === "GET"
      );
    },
    { timeout: 30000 },
  );
  await page.goto(companionLink(config), { waitUntil: "domcontentloaded" });
  const response = await healthResponse;
  assert.equal(
    response.status(),
    200,
    "ChatGPT local companion health failed after interruption reload.",
  );
  const health = await response.json();
  assert.equal(health.protocolVersion, 1);
  assert.equal(health.effort, "low");
  assert.equal(
    health.model,
    config.expectedModel,
    "ChatGPT local model changed after interruption reload.",
  );
  assert(["ready", "busy"].includes(health.status));
  await expect(
    page.getByText("ChatGPT is connected on this computer.", { exact: false }),
  ).toBeVisible({ timeout: 30000 });
  assert.equal(new URL(page.url()).hash, "");
}

async function reconnectProviderAfterReload(
  page,
  config,
  report,
  info,
  evidenceDir,
) {
  switch (providerReloadStrategy(config.provider)) {
    case "companion":
      await reconnectChatGPTLocalAfterReload(page, config);
      return "chatgpt-local-reconnected";
    case "hosted":
      await configureChatGPTHosted(page, config, report, info, evidenceDir);
      return "chatgpt-hosted-reconnected";
    case "api":
      await configureApiProvider(page, config, report, info, evidenceDir);
      return `${config.provider}-reconnected`;
  }
}

async function restoreReloadedWorldThroughAccountUI(
  page,
  projectId,
  run,
  interruption,
) {
  const account = page.getByRole("button", {
    name: /Your worlds|Your account and cloud worlds/,
  });
  await expect(account).toBeVisible({ timeout: 30000 });
  await account.click();
  const projectsResponse = await sameOriginJSON(page, "/api/projects");
  assert.equal(
    projectsResponse.status,
    200,
    "Authenticated cloud project lookup failed while restoring after reload.",
  );
  const projects = Array.isArray(projectsResponse.body?.projects)
    ? projectsResponse.body.projects
    : [];
  const baselineProject = projects.find(
    (candidate) =>
      candidate?.id === projectId && candidate?.revision === run.baseRevision,
  );
  const title = baselineProject?.title ?? "";
  const cloudRows = projects.filter(
    (candidate) =>
      candidate?.title === title && candidate?.revision === run.baseRevision,
  );
  const cloudIndex = cloudRows.findIndex(
    (candidate) => candidate?.id === projectId,
  );
  const cloudEntry = page
    .getByRole("button", {
      name: new RegExp(
        `${escapeRegExp(title)}[\\s\\S]*Revision ${run.baseRevision} · Cloud`,
      ),
    })
    .nth(Math.max(0, cloudIndex));
  if (cloudIndex >= 0) {
    await expect(cloudEntry).toBeVisible({ timeout: 30000 });
    await cloudEntry.click();
    await expect(page.locator(".workspace-heading h2")).toBeVisible({
      timeout: 30000,
    });
    await expect
      .poll(async () => (await storageSnapshot(page)).project, {
        timeout: 30000,
        intervals: [100, 200, 400, 800, 1200],
      })
      .toMatchObject({ id: projectId, revision: run.baseRevision });
    interruption.reloadRestoredVia = "account-cloud-baseline";
  } else {
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click()
      .catch(() => undefined);
    const resume = page.getByRole("button", {
      name: "Continue your saved world",
      exact: true,
    });
    await expect(resume).toBeVisible({ timeout: 30000 });
    await resume.click();
    await expect(page.locator(".workspace-heading h2")).toBeVisible({
      timeout: 30000,
    });
    await expect
      .poll(async () => (await storageSnapshot(page)).project?.id, {
        timeout: 30000,
        intervals: [100, 200, 400, 800, 1200],
      })
      .toBe(projectId);
    interruption.reloadRestoredVia = "resume-same-id";
  }
  await prepareObserver(page);
}

/**
 * Interrupt the first real ChatGPT-local stream after a durable ready
 * checkpoint, then drive the account UI recovery and its continuation.
 *
 * The journal is the timing source. The harness never sleeps hoping that a
 * provider command arrived: it polls the authenticated API and records the
 * last durable run state when a bounded wait fails.
 */
async function verifyInterruptedRecovery(
  page,
  config,
  report,
  info,
  projectId,
  evidenceDir,
) {
  assert(config.interruptedRecovery);
  const interruption = report.cloudRecovery.interruptedRecovery;
  interruption.status = "running";
  const phases = interruption.phases;
  const requestCounts = interruption.requestCounts;
  let lastRun;
  let earlyCompleteRun;
  let observerBeforeInterruption;

  requestCounts.push({
    phase: "initial-generation-started",
    count: info.generationRequests,
  });
  assert.equal(
    info.generationRequests,
    1,
    "Interrupted recovery requires exactly one initial live generation request before checkpoint polling.",
  );

  try {
    await expect
      .poll(
        async () => {
          lastRun = info.latestJournalRun;
          if (!lastRun) return "waiting-for-durable-acknowledgement";
          assert.equal(lastRun.projectId, projectId);
          if (lastRun.state === "complete") {
            earlyCompleteRun = lastRun;
            return "complete";
          }
          const ready = readyCheckpointEntities(lastRun.checkpoint).length;
          return `${lastRun.state}:${lastRun.sequence}:${ready}`;
        },
        {
          timeout: JOURNAL_POLL_TIMEOUT,
          intervals: [100, 150, 250],
        },
      )
      .toMatch(/^running:[1-9]\d*:[1-9]\d*$/);
  } catch (error) {
    if (earlyCompleteRun)
      throw Error(
        `The initial generation completed before it could be interrupted (${journalRunDescription(earlyCompleteRun)}). Rerun with a slower or longer-lived real ChatGPT stream; a completed run is not treated as interrupted recovery.`,
      );
    throw Error(
      `Timed out waiting for a running cloud journal checkpoint with sequence > 0 and a ready entity after ${JOURNAL_POLL_TIMEOUT}ms (${journalRunDescription(lastRun)}): ${error instanceof Error ? error.message : error}`,
    );
  }
  phases.push("ready-checkpoint-sequence-observed");
  requestCounts.push({
    phase: "ready-checkpoint",
    count: info.generationRequests,
  });
  interruption.checkpointSequence = lastRun.sequence;
  interruption.checkpointRevision = lastRun.checkpoint.revision;
  interruption.readyEntityCount = readyCheckpointEntities(
    lastRun.checkpoint,
  ).length;
  await expect(page.locator(".object-list button").first()).toBeVisible({
    timeout: 30000,
  });
  observerBeforeInterruption = await observerEvidence(page);
  let terminalRun;
  if (config.interruptionMethod === "reload") {
    interruption.preReloadObserverStageCount =
      observerBeforeInterruption?.stages?.length ?? 0;
    phases.push("ready-checkpoint-observer-captured");
    await page.reload({ waitUntil: "domcontentloaded" });
    phases.push("page-reloaded-while-journal-running");
    phases.push(
      await reconnectProviderAfterReload(
        page,
        config,
        report,
        info,
        evidenceDir,
      ),
    );
    await restoreReloadedWorldThroughAccountUI(
      page,
      projectId,
      lastRun,
      interruption,
    );
    phases.push(interruption.reloadRestoredVia);
  } else {
    const stop = page.getByRole("button", { name: "Stop", exact: true });
    try {
      await expect(stop).toBeVisible({ timeout: 30000 });
    } catch (error) {
      const current = await readLatestJournalRun(page, projectId).catch(
        () => lastRun,
      );
      if (current?.state === "complete")
        throw Error(
          `The initial generation completed before the harness could click the live Stop control (${journalRunDescription(current)}).`,
        );
      throw Error(
        `The live Stop control disappeared before interruption (${journalRunDescription(current)}): ${error instanceof Error ? error.message : error}`,
      );
    }
    phases.push("live-stop-control-observed");
    await stop.click();
    requestCounts.push({
      phase: "stop-clicked",
      count: info.generationRequests,
    });
    assert.equal(
      info.generationRequests,
      1,
      "Stopping the initial stream unexpectedly created another generation request.",
    );
    await expect(stop).toHaveCount(0, { timeout: 30000 });
    phases.push("live-stop-clicked");
  }

  if (config.interruptionMethod === "reload") {
    requestCounts.push({
      phase: "reload-before-account-recovery",
      count: info.generationRequests,
    });
  } else {
    let terminalCompleteRun;
    try {
      await expect
        .poll(
          async () => {
            terminalRun = await readLatestJournalRun(page, projectId);
            if (terminalRun.state === "complete") {
              terminalCompleteRun = terminalRun;
              return "complete";
            }
            return terminalRun.state;
          },
          {
            timeout: JOURNAL_POLL_TIMEOUT,
            intervals: [100, 200, 400, 800, 1200],
          },
        )
        .toMatch(/^(cancelled|interrupted)$/);
    } catch (error) {
      if (terminalCompleteRun)
        throw Error(
          `The initial generation completed after Stop was clicked; the harness will not treat it as interrupted (${journalRunDescription(terminalCompleteRun)}).`,
        );
      throw Error(
        `The stopped generation did not reach a terminal noncomplete journal state within ${JOURNAL_POLL_TIMEOUT}ms (${journalRunDescription(terminalRun)}): ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  if (terminalRun) {
    assert(
      terminalRun.sequence > 0,
      `The terminal interrupted journal checkpoint has no committed operation (${journalRunDescription(terminalRun)}).`,
    );
    assert(
      ["cancelled", "interrupted"].includes(terminalRun.state),
      `The initial generation did not end in a noncomplete state (${journalRunDescription(terminalRun)}).`,
    );
    phases.push(`terminal-${terminalRun.state}`);
    requestCounts.push({
      phase: `terminal-${terminalRun.state}`,
      count: info.generationRequests,
    });
  }

  await page
    .getByRole("button", {
      name: /Your worlds|Your account and cloud worlds/,
    })
    .click();
  phases.push("account-ui-opened-for-recovery");
  const recover = page.getByRole("button", {
    name: "Recover latest generation",
    exact: true,
  });
  await expect(recover).toBeVisible({ timeout: 30000 });
  await recover.click();
  const finishedNotice = page.getByText(
    "Recovered finished work. Send the continuation to start a new generation request.",
    { exact: true },
  );
  const completedNotice = page.getByText(
    "Recovered the completed generation. Save it to your account when ready.",
    { exact: true },
  );
  await expect
    .poll(
      async () => {
        if (await completedNotice.isVisible().catch(() => false))
          return "completed";
        if (await finishedNotice.isVisible().catch(() => false))
          return "finished";
        return "waiting";
      },
      { timeout: 30000, intervals: [100, 200, 400, 800, 1200] },
    )
    .toMatch(/^(finished|completed)$/);
  if (await completedNotice.isVisible().catch(() => false))
    throw Error(
      `The ${config.interruptionMethod} interruption completed before account recovery could settle it; completed generation is not treated as interrupted recovery.`,
    );
  phases.push("account-ui-recovery-terminal-noncomplete");

  if (!terminalRun) {
    let terminalCompleteRun;
    try {
      await expect
        .poll(
          async () => {
            terminalRun = await readLatestJournalRun(page, projectId);
            if (terminalRun.state === "complete") {
              terminalCompleteRun = terminalRun;
              return "complete";
            }
            return terminalRun.state;
          },
          {
            timeout: 30000,
            intervals: [100, 200, 400, 800, 1200],
          },
        )
        .toMatch(/^(cancelled|interrupted)$/);
    } catch (error) {
      if (terminalCompleteRun)
        throw Error(
          `The reloaded generation completed before account recovery settled it (${journalRunDescription(terminalCompleteRun)}).`,
        );
      throw Error(
        `Account recovery did not settle the reloaded journal to a terminal noncomplete state (${journalRunDescription(terminalRun)}): ${error instanceof Error ? error.message : error}`,
      );
    }
    assert(terminalRun.sequence > 0);
    phases.push(`terminal-${terminalRun.state}`);
    requestCounts.push({
      phase: `terminal-${terminalRun.state}`,
      count: info.generationRequests,
    });
  }
  interruption.runId = terminalRun.id;
  interruption.terminalState = terminalRun.state;
  interruption.terminalSequence = terminalRun.sequence;

  const expectedCheckpoint =
    terminalRun.recoveryCheckpoint ?? terminalRun.checkpoint;
  interruption.recoveryCheckpointUsed = terminalRun.recoveryCheckpoint
    ? "recoveryCheckpoint"
    : "checkpoint";
  await expect
    .poll(async () => persistenceJSON((await storageSnapshot(page)).project), {
      timeout: 30000,
      intervals: [100, 200, 400, 800, 1200],
    })
    .toEqual(persistenceJSON(expectedCheckpoint));
  const recovered = await storageSnapshot(page);
  assert.deepEqual(
    persistenceJSON(recovered.project),
    persistenceJSON(expectedCheckpoint),
    "Interrupted recovery installed a different project than the terminal journal checkpoint.",
  );
  assert.equal(recovered.project.id, projectId);
  phases.push("terminal-checkpoint-persistence-equal");
  await page.screenshot({
    path: join(evidenceDir, "interrupted-recovery.png"),
    fullPage: true,
  });
  report.evidence.push("interrupted-recovery.png");
  const showObjects = page.getByRole("button", {
    name: "Show objects",
    exact: true,
  });
  if (await showObjects.isVisible().catch(() => false))
    await showObjects.click();
  await expect(page.locator(".object-list button").first()).toBeVisible({
    timeout: 30000,
  });

  const continuationPrompt = page.locator("#prompt");
  await expect(continuationPrompt).toHaveValue(/.+/, { timeout: 30000 });
  const continuation = await continuationPrompt.inputValue();
  assert(
    continuation.includes(terminalRun.prompt),
    "Recovered continuation prompt omitted the original generation prompt.",
  );
  const selectedEntity = terminalRun.selected
    ? expectedCheckpoint.entities.find(
        (entity) => entity.id === terminalRun.selected,
      )
    : undefined;
  if (terminalRun.selected) {
    assert(
      selectedEntity,
      "The terminal journal selected entity was not present in its checkpoint.",
    );
    await expect(page.locator(".selection-chip")).toContainText(
      selectedEntity.label,
    );
  } else {
    assert.equal(
      await page.locator(".selection-chip").count(),
      0,
      "Recovery restored a selection that the terminal journal did not record.",
    );
  }
  phases.push("continuation-prompt-original-and-selection-restored");
  interruption.continuationPromptIncludesOriginal = true;
  interruption.selectedRestored = true;
  requestCounts.push({
    phase: "recovery-installed-before-continuation",
    count: info.generationRequests,
  });

  const continuationButton = page.getByRole("button", {
    name: "Change this",
    exact: true,
  });
  await expect(continuationButton).toBeEnabled({ timeout: 30000 });
  assert.equal(
    info.generationRequests,
    1,
    `The ${config.interruptionMethod} recovery path created an unexpected generation before the continuation was submitted.`,
  );
  await continuationButton.click();
  await expect.poll(() => info.generationRequests, { timeout: 30000 }).toBe(2);
  const continuationRequest = info.generationBodies[1];
  assert.deepEqual(
    persistenceJSON({
      ...continuationRequest.projectSnapshot,
      messages: expectedCheckpoint.messages,
    }),
    persistenceJSON(expectedCheckpoint),
    "Continuation request did not carry the recovered scene checkpoint.",
  );
  assert.equal(continuationRequest.selectedId, terminalRun.selected ?? null);
  interruption.continuationContextVerified = true;
  phases.push("continuation-submitted");
  requestCounts.push({
    phase: "continuation-submitted",
    count: info.generationRequests,
  });
  return {
    checkpoint: expectedCheckpoint,
    terminalRun,
    continuation,
    observerEvidence: observerBeforeInterruption,
  };
}

async function verifyCloudRecovery(
  page,
  browser,
  config,
  report,
  approvedOrigins,
  projectAfterEdit,
  storageState,
  evidenceDir,
) {
  if (!config.cloudRecovery) return;
  const phases = [];
  const interruptedRecovery = report.cloudRecovery.interruptedRecovery;
  report.cloudRecovery = {
    mode: "real",
    status: "running",
    projectId: projectAfterEdit.id,
    expectedRevision: projectAfterEdit.revision,
    phases,
    ...(interruptedRecovery ? { interruptedRecovery } : {}),
  };

  const latestResponse = await sameOriginJSON(
    page,
    `/api/generation-runs?projectId=${encodeURIComponent(projectAfterEdit.id)}`,
  );
  assert.equal(
    latestResponse.status,
    200,
    "Latest cloud journal lookup failed.",
  );
  const latestRun = latestResponse.body?.run;
  assert(latestRun, "Latest cloud journal response omitted its run.");
  assert.equal(latestRun.projectId, projectAfterEdit.id);
  assert.equal(
    latestRun.state,
    "complete",
    "Latest cloud journal is not complete.",
  );
  assert.equal(latestRun.checkpoint.revision, projectAfterEdit.revision);
  assert.deepEqual(
    persistenceJSON(latestRun.checkpoint),
    persistenceJSON(projectAfterEdit),
    "Latest cloud journal checkpoint entities differ from the edited world.",
  );
  phases.push("latest-journal-complete");

  await page
    .getByRole("button", { name: "Close dialog", exact: true })
    .click()
    .catch(() => undefined);
  await page
    .getByRole("button", {
      name: "Your account and cloud worlds",
      exact: true,
    })
    .click();
  const recover = page.getByRole("button", {
    name: "Recover latest generation",
    exact: true,
  });
  await expect(recover).toBeVisible({ timeout: 30000 });
  await recover.click();
  await expect(
    page.getByText(
      "Recovered the completed generation. Save it to your account when ready.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 30000 });
  phases.push("account-ui-recovery-complete");
  await expect(page.locator("#prompt")).toHaveValue("", { timeout: 30000 });
  await expect
    .poll(async () => (await storageSnapshot(page)).project, {
      timeout: 30000,
    })
    .toMatchObject({
      id: projectAfterEdit.id,
      revision: projectAfterEdit.revision,
    });
  const recovered = await storageSnapshot(page);
  assert.deepEqual(
    persistenceJSON(recovered.project),
    persistenceJSON(projectAfterEdit),
  );
  phases.push("recovered-indexeddb-verified");
  await page.screenshot({
    path: join(evidenceDir, "cloud-recovery.png"),
    fullPage: true,
  });
  report.evidence.push("cloud-recovery.png");

  await page
    .getByRole("button", { name: "Your account and cloud worlds", exact: true })
    .click();
  const save = page.getByRole("button", {
    name: "Save current world to cloud",
    exact: true,
  });
  await expect(save).toBeVisible({ timeout: 30000 });
  const saveResponsePromise = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.origin === config.baseOrigin &&
        url.pathname === "/api/projects" &&
        response.request().method() === "PUT"
      );
    },
    { timeout: 30000 },
  );
  await save.click();
  const saveResponse = await saveResponsePromise;
  let saveBody = null;
  try {
    saveBody = await saveResponse.json();
  } catch {
    // The status assertion below reports a non-JSON cloud response.
  }
  assert.equal(saveResponse.status(), 200, "Recovered cloud save failed.");
  assert.equal(saveBody?.revision, projectAfterEdit.revision);
  assert.match(
    saveBody?.snapshotToken ?? "",
    /^[a-f0-9]{64}$/,
    "Recovered cloud save omitted its snapshot token.",
  );
  phases.push("cloud-save-200-same-revision");
  await page
    .getByRole("button", { name: "Close dialog", exact: true })
    .click()
    .catch(() => undefined);

  const cookieOnlyState = {
    cookies: Array.isArray(storageState?.cookies) ? storageState.cookies : [],
    origins: [],
  };
  const freshContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    storageState: cookieOnlyState,
  });
  const freshInfo = {
    generationRequests: [],
    blockedExternalRequests: 0,
    blockedExternalOrigins: new Set(),
  };
  let freshPage;
  const freshPageErrors = [];
  try {
    await installTrafficGuard(freshContext, config, approvedOrigins, freshInfo);
    freshPage = await freshContext.newPage();
    freshPage.on("pageerror", (error) =>
      freshPageErrors.push(sanitizeMessage(error?.message ?? error, config)),
    );
    freshPage.on("request", (request) => {
      const url = new URL(request.url());
      if (
        (url.pathname === "/api/generate" &&
          url.origin === config.baseOrigin) ||
        (url.pathname === "/generate" && url.origin === config.companionURL)
      )
        freshInfo.generationRequests.push(url.pathname);
    });
    const projectsResponsePromise = freshPage.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          url.origin === config.baseOrigin &&
          url.pathname === "/api/projects" &&
          response.request().method() === "GET" &&
          !url.searchParams.has("id")
        );
      },
      { timeout: 30000 },
    );
    await freshPage.goto(config.baseOrigin, { waitUntil: "domcontentloaded" });
    const empty = await storageSnapshot(freshPage);
    assert.equal(
      empty.project,
      null,
      "Fresh cloud context inherited local world data.",
    );
    await expect(
      freshPage.getByRole("button", {
        name: /^(Your worlds|Your account and cloud worlds)$/,
      }),
    ).toBeVisible({ timeout: 30000 });
    const projectsResponse = await projectsResponsePromise;
    assert.equal(projectsResponse.status(), 200);
    const projectsBody = await projectsResponse.json();
    const projects = Array.isArray(projectsBody.projects)
      ? projectsBody.projects
      : [];
    const matchingCloudRows = projects.filter(
      (candidate) =>
        candidate?.title === projectAfterEdit.title &&
        candidate?.revision === projectAfterEdit.revision,
    );
    const matchingCloudIndex = matchingCloudRows.findIndex(
      (candidate) => candidate?.id === projectAfterEdit.id,
    );
    assert(
      matchingCloudIndex >= 0,
      "Fresh cloud project listing omitted the recovered project.",
    );
    await freshPage
      .getByRole("button", {
        name: /^(Your worlds|Your account and cloud worlds)$/,
      })
      .click();
    const cloudEntry = freshPage
      .getByRole("button", {
        name: new RegExp(
          `${escapeRegExp(projectAfterEdit.title)}[\\s\\S]*Revision ${projectAfterEdit.revision} · Cloud`,
        ),
      })
      .nth(matchingCloudIndex);
    await expect(cloudEntry).toBeVisible({ timeout: 30000 });
    await cloudEntry.click();
    await expect(freshPage.locator(".workspace-heading h2")).toBeVisible({
      timeout: 30000,
    });
    await expect
      .poll(async () => (await storageSnapshot(freshPage)).project, {
        timeout: 30000,
      })
      .toMatchObject({
        id: projectAfterEdit.id,
        revision: projectAfterEdit.revision,
      });
    phases.push("fresh-cookie-only-context-cloud-open");
    const freshSnapshot = await storageSnapshot(freshPage);
    assert.deepEqual(
      persistenceJSON(freshSnapshot.project),
      persistenceJSON(projectAfterEdit),
    );
    assert.deepEqual(
      freshInfo.generationRequests,
      [],
      "Fresh cloud recovery made a provider generation request.",
    );
    assert.deepEqual(
      freshPageErrors,
      [],
      "Fresh cloud recovery reported a page error.",
    );
    report.cloudRecovery.freshContextTraffic = {
      generationRequests: freshInfo.generationRequests.length,
      blockedExternalRequests: freshInfo.blockedExternalRequests,
      blockedExternalOrigins: [...freshInfo.blockedExternalOrigins].slice(0, 8),
      pageErrors: freshPageErrors,
    };
    phases.push("fresh-indexeddb-verified");
    await freshPage.screenshot({
      path: join(evidenceDir, "cloud-recovery-fresh-context.png"),
      fullPage: true,
    });
    report.evidence.push("cloud-recovery-fresh-context.png");
  } catch (error) {
    if (freshPage) {
      await freshPage
        .screenshot({
          path: join(evidenceDir, "cloud-recovery-fresh-context-failure.png"),
          fullPage: true,
        })
        .then(() =>
          report.evidence.push("cloud-recovery-fresh-context-failure.png"),
        )
        .catch(() => undefined);
    }
    throw error;
  } finally {
    report.cloudRecovery.freshContextTraffic = {
      generationRequests: freshInfo.generationRequests.length,
      blockedExternalRequests: freshInfo.blockedExternalRequests,
      blockedExternalOrigins: [...freshInfo.blockedExternalOrigins].slice(0, 8),
      pageErrors: freshPageErrors,
    };
    await freshContext.close().catch(() => undefined);
  }
  report.cloudRecovery.status = "passed";
  report.cloudRecovery.runId = latestRun.id;
}

async function runPublication(
  page,
  browser,
  config,
  report,
  approvedOrigins,
  expectedRevision,
  evidenceDir,
  expectedProject,
  expectedArtifacts,
  targetArtifacts,
) {
  if (!config.publication) return;
  if (!expectedProject || !expectedArtifacts || !targetArtifacts) {
    report.publication = {
      mode: "blocked",
      status: "fresh-export-artifacts-unavailable",
    };
    return;
  }
  // The explicit state was supplied when the original context was created, so
  // this page retains the exact local IndexedDB draft produced by the provider
  // run while also carrying the authorized account cookies.
  await page
    .getByRole("button", { name: "Close dialog", exact: true })
    .click()
    .catch(() => undefined);
  const account = page.getByRole("button", {
    name: "Your account and cloud worlds",
    exact: true,
  });
  await expect(account).toBeVisible({ timeout: 30000 });
  await account.click();
  const save = page.getByRole("button", {
    name: "Save current world to cloud",
    exact: true,
  });
  if (!(await save.isVisible().catch(() => false))) {
    report.publication = {
      mode: "blocked",
      status: "cloud-account-unavailable",
    };
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click()
      .catch(() => undefined);
    return;
  }
  const saveRequestPromise = page.waitForRequest(
    (request) => {
      const url = new URL(request.url());
      return (
        url.origin === config.baseOrigin &&
        url.pathname === "/api/projects" &&
        request.method() === "PUT"
      );
    },
    { timeout: 30000 },
  );
  const saveResponsePromise = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.origin === config.baseOrigin &&
        url.pathname === "/api/projects" &&
        response.request().method() === "PUT"
      );
    },
    { timeout: 30000 },
  );
  await save.click();
  const saveRequest = await saveRequestPromise;
  try {
    const requestBody = saveRequest.postDataJSON();
    assertPublicationProjectMatches(
      requestBody?.project,
      expectedProject,
      "Cloud save project",
    );
  } catch {
    report.publication = {
      mode: "blocked",
      status: "cloud-save-project-mismatch",
    };
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click()
      .catch(() => undefined);
    return;
  }
  const saveResponse = await saveResponsePromise;
  let saveBody = {};
  try {
    saveBody = await saveResponse.json();
  } catch {
    // The status below remains the source of truth; no body is recorded.
  }
  if (saveResponse.status() === 403 || saveResponse.status() === 401) {
    report.publication = {
      mode: "blocked",
      status: `cloud-save-http-${saveResponse.status()}`,
    };
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click()
      .catch(() => undefined);
    return;
  }
  if (!saveResponse.ok() || saveBody.revision !== expectedRevision) {
    report.publication = {
      mode: "blocked",
      status: "cloud-save-revision-mismatch",
    };
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click()
      .catch(() => undefined);
    return;
  }
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  const publish = page.getByRole("button", {
    name: "Publish Orb",
    exact: true,
  });
  await expect(publish).toBeVisible({ timeout: 30000 });
  const publishResponsePromise = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.origin === config.baseOrigin &&
        url.pathname === "/api/publish" &&
        response.request().method() === "POST"
      );
    },
    { timeout: 30000 },
  );
  await publish.click();
  const publishResponse = await publishResponsePromise;
  let publishBody = {};
  try {
    publishBody = await publishResponse.json();
  } catch {
    // No raw provider/cloud response is written to evidence.
  }
  if (publishResponse.status() === 403) {
    report.publication = { mode: "blocked", status: "publication-http-403" };
    return;
  }
  if (!publishResponse.ok()) {
    report.publication = {
      mode: "blocked",
      status: `publication-http-${publishResponse.status()}`,
    };
    return;
  }
  if (typeof publishBody.deploymentUrl !== "string") {
    report.publication = {
      mode: "blocked",
      status: "publication-deployment-unavailable",
    };
    return;
  }
  try {
    approvedOrigins.add(new URL(publishBody.deploymentUrl).origin);
  } catch {
    report.publication = {
      mode: "blocked",
      status: "published-artifact-origin-invalid",
    };
    return;
  }
  const readyLink = page.getByRole("link", {
    name: "Open published Orb",
    exact: true,
  });
  try {
    await expect(readyLink).toBeVisible({ timeout: 180000 });
  } catch {
    report.publication = {
      mode: "blocked",
      status: "publication-did-not-reach-ready",
    };
    return;
  }
  const href = await readyLink.getAttribute("href");
  assert(
    href && !href.includes("#"),
    "Published URL must not contain a capability or snapshot hash.",
  );
  const publishedUrl = new URL(href, config.baseOrigin);
  const deploymentOrigin = publicationDeploymentOrigin(
    publishBody.deploymentUrl,
    approvedOrigins,
  ).origin;
  assert.equal(
    publishedUrl.origin,
    config.baseOrigin,
    "Published wrapper changed the approved app origin.",
  );
  const publicContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const publicInfo = {
    generationRequests: 0,
    blockedExternalRequests: 0,
    blockedExternalOrigins: new Set(),
    interceptedGeneration: false,
  };
  await installTrafficGuard(publicContext, config, approvedOrigins, publicInfo);
  const publicPage = await publicContext.newPage();
  const publicApiRequests = [];
  let publishedRevision;
  let publishedProject;
  let publishedProjectMalformed = false;
  publicPage.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") || path === "/generate" || path === "/health")
      publicApiRequests.push(path);
  });
  publicPage.on("response", async (response) => {
    const responseUrl = new URL(response.url());
    if (
      responseUrl.origin !== deploymentOrigin ||
      responseUrl.pathname !== "/project.json"
    )
      return;
    try {
      const value = await response.json();
      publishedProject = value;
      if (Number.isInteger(value.revision)) publishedRevision = value.revision;
    } catch {
      publishedProjectMalformed = true;
    }
  });
  await publicPage.goto(publishedUrl.href, {
    waitUntil: "domcontentloaded",
  });
  const iframe = publicPage.locator("iframe");
  await expect(iframe).toBeVisible({ timeout: 60000 });
  const iframeSrc = await iframe.getAttribute("src");
  assert(iframeSrc, "Published playback iframe has no source.");
  assertPublicationPlaybackOrigins({
    wrapperUrl: publishedUrl.href,
    appOrigin: config.baseOrigin,
    deploymentUrl: publishBody.deploymentUrl,
    iframeUrl: iframeSrc,
    approvedOrigins,
  });
  await expect(publicPage.frameLocator("iframe").locator("canvas")).toBeVisible(
    { timeout: 60000 },
  );
  if (publishedProjectMalformed) {
    report.publication = {
      mode: "blocked",
      status: "published-project-mismatch",
    };
    await publicContext.close();
    return;
  }
  await expect
    .poll(() => publishedRevision ?? -1, { timeout: 60000 })
    .toBe(expectedRevision);
  let artifactEvidence;
  try {
    assertPublicationProjectMatches(
      publishedProject,
      expectedProject,
      "Published project",
    );
    artifactEvidence = await verifyFreshPublicationArtifacts({
      deploymentUrl: publishBody.deploymentUrl,
      approvedOrigins,
      projectId: expectedProject.id,
      revision: expectedProject.revision,
      expectedArtifacts,
      targetArtifacts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    report.publication = {
      mode: "blocked",
      status:
        message.startsWith("published-artifact") ||
        message.startsWith("fresh-export")
          ? message
          : "published-project-mismatch",
    };
    await publicContext.close();
    return;
  }
  assert.deepEqual(
    publicApiRequests,
    [],
    "Signed-out playback made an editor/provider request.",
  );
  await publicPage.screenshot({
    path: join(evidenceDir, "signed-out-playback.png"),
    fullPage: true,
  });
  report.evidence.push("signed-out-playback.png");
  await publicContext.close();
  report.publication = {
    mode: "real",
    status: "READY",
    projectId: expectedProject.id,
    revision: expectedRevision,
    artifactEvidence,
    signedOut: true,
    editorProviderRequests: publicApiRequests.length,
  };
}

function assertFollowOnProject(value, expected, phase) {
  const project = value?.project ?? value;
  assert(
    project && typeof project === "object",
    `${phase} did not return a project.`,
  );
  assert.equal(
    project.id,
    expected.projectId,
    `${phase} changed the project identity.`,
  );
  assert.equal(
    project.revision,
    expected.revision,
    `${phase} changed the project revision.`,
  );
  return project;
}

/**
 * Keep non-inference phases attached to the exact project returned after the
 * story's live undo. Callbacks are injected so this identity/revision contract
 * can be checked without starting a browser or making provider requests.
 * @param {{
 *   project: any,
 *   refresh: (expected: any) => Promise<any>,
 *   exportProject: (project: any, expected: any) => Promise<any>,
 *   standalonePlayback: (exported: any, expected: any) => Promise<any>,
 *   cloudRecovery?: (project: any, expected: any) => Promise<any>,
 *   publication?: (project: any, expected: any, exported: any) => Promise<any>,
 * }} options
 */
export async function runProjectFollowOnPhases({
  project,
  refresh,
  exportProject,
  standalonePlayback,
  cloudRecovery = undefined,
  publication = undefined,
}) {
  assert(
    project &&
      typeof project === "object" &&
      typeof project.id === "string" &&
      Number.isInteger(project.revision),
    "Story undo did not return a project with an ID and revision.",
  );
  const expected = {
    projectId: project.id,
    revision: project.revision,
  };
  const refreshed = assertFollowOnProject(
    await refresh(expected),
    expected,
    "Refresh",
  );
  const exported = await exportProject(refreshed, expected);
  assertFollowOnProject(exported, expected, "Export");
  await standalonePlayback(exported, expected);
  if (cloudRecovery) {
    assertFollowOnProject(project, expected, "Cloud recovery input");
    await cloudRecovery(project, expected);
  }
  if (publication) {
    assertFollowOnProject(project, expected, "Publication input");
    await publication(project, expected, exported);
  }
  return { projectId: expected.projectId, revision: expected.revision };
}

async function run(config, report = emptyReport(config)) {
  const evidenceDir = join(REPORT_DIR, config.provider);
  await mkdir(evidenceDir, { recursive: true });
  const approvedOrigins = new Set([config.baseOrigin]);
  if (config.companionURL) approvedOrigins.add(config.companionURL);
  if (config.builderURL) approvedOrigins.add(config.builderURL);
  const info = {
    generationRequests: 0,
    generationBodies: [],
    generationStatuses: [],
    generationTrialRemaining: [],
    generationDiagnostics: [],
    diagnosticReads: [],
    blockedExternalRequests: 0,
    blockedExternalOrigins: new Set(),
    interceptedGeneration: false,
    catalogModel: null,
    catalogEffort: null,
    reusedConsent: false,
    hostedConsentReady: false,
    hostedCatalogReady: false,
    hostedViolations: [],
    hostedGenerationRequests: 0,
    hostedGenerationAttempts: 0,
    apiGenerationRequests: 0,
    companionGenerationRequests: 0,
    loopbackGenerationRequests: 0,
    hostedPayloadErrors: [],
    hostedNDJSON: [],
    ndjsonReads: [],
    hostedProjectValidator: null,
    projectValidator: null,
  };
  let storageState;
  try {
    storageState =
      config.provider === HOSTED_PROVIDER
        ? await readHostedAccountStorageState(config)
        : await readExplicitCloudStorageState(config);
    if (config.requireInputGame || config.provider === HOSTED_PROVIDER) {
      info.projectValidator = await loadHostedProjectValidator();
      if (config.provider === HOSTED_PROVIDER)
        info.hostedProjectValidator = info.projectValidator;
    }
  } catch (error) {
    report.error = sanitizedError(error, config);
    report.traffic = {
      generationRequests: 0,
      blockedExternalRequests: 0,
      interceptedGeneration: false,
      ...(config.provider === HOSTED_PROVIDER
        ? {
            hostedGenerationRequests: 0,
            hostedGenerationAttempts: 0,
            apiGenerationRequests: 0,
            companionGenerationRequests: 0,
            loopbackGenerationRequests: 0,
            hostedPayloadErrors: [],
            hostedViolations: [],
            hostedNDJSON: [],
          }
        : {}),
    };
    await writeReport(report, config);
    throw error;
  }
  const resumeExecutionMode = flagshipResumeExecutionMode(config);
  if (resumeExecutionMode === "offline")
    return runFlagshipResumeOffline(
      config,
      report,
      info,
      evidenceDir,
      approvedOrigins,
    );
  if (resumeExecutionMode === "checkpoint")
    return runFlagshipResume(
      config,
      report,
      info,
      evidenceDir,
      approvedOrigins,
    );
  const browser = await chromium.launch({
    headless: process.env.ORBSIE_HEADLESS !== "0",
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...(storageState ? { storageState } : {}),
  });
  await context.addInitScript(() => {
    // The gameplay bridge is opt-in and returns copied primitive observations.
    window.__ORBSIE_GAMEPLAY_READ_REQUESTED__ = true;
  });
  await installTrafficGuard(context, config, approvedOrigins, info);
  const page = await context.newPage();
  attachRequestEvidence(page, config, info);
  let projectBefore;
  let lastGoodProject;
  let projectAfterCreation;
  let projectAfterEdit;
  const creationContinuation =
    config.flagshipResumeStage === "creation" && config.flagshipResume;
  try {
    if (config.provider !== "chatgpt-local")
      await page.goto(config.baseOrigin, { waitUntil: "domcontentloaded" });
    if (creationContinuation)
      await seedFlagshipResume(page, config.resumeCheckpoint);
    await setupOutputCap(page, config);
    if (config.provider === "chatgpt-local")
      await configureChatGPTLocal(page, config, report, info, evidenceDir);
    else if (config.provider === HOSTED_PROVIDER)
      await configureChatGPTHosted(page, config, report, info, evidenceDir);
    else if (config.provider === "free")
      await setupFreeTrial(page, config, report);
    else await configureApiProvider(page, config, report, info, evidenceDir);
    if (config.builderURL) {
      await page
        .getByRole("button", { name: "Connections", exact: true })
        .first()
        .click();
      const link =
        config.baseOrigin +
        "/#builder=" +
        encodeURIComponent(
          JSON.stringify({
            url: config.builderURL,
            token: config.builderToken,
          }),
        );
      await page
        .getByLabel("Local Blender connection link", { exact: true })
        .fill(link);
      await page
        .getByRole("button", { name: "Connect local Blender", exact: true })
        .click();
      await expect(
        page.getByText("Blender is ready to build models on this computer.", {
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    }
    if (config.cloudRecovery) {
      const account = page.getByRole("button", {
        name: /Your worlds|Your account and cloud worlds/,
      });
      await expect(account).toBeVisible({ timeout: 30000 });
      await account.click();
      await expect(
        page.getByRole("button", {
          name: "Save current world to cloud",
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });
      await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    }
    await prepareObserver(page);
    await installGenerationDiagnosticObserver(page);
    if (creationContinuation) {
      await openFlagshipResumeProject(
        page,
        config.resumeCheckpoint.project,
      );
      const seededSnapshot = await storageSnapshot(page);
      assert.deepEqual(
        persistenceJSON(seededSnapshot.project),
        persistenceJSON(config.resumeCheckpoint.project),
        "The seeded creation checkpoint did not reopen exactly.",
      );
      assert.equal(
        info.generationRequests,
        0,
        "Creation-stage continuation made a generation request while restoring the checkpoint.",
      );
      for (const model of config.resumeCheckpoint.models) {
        const stored = await readStoredGeneratedModelDigest(
          page,
          model.metadata.sha256,
        );
        assert(
          stored,
          `Seeded creation checkpoint model ${model.id} was not reopened.`,
        );
        assert.equal(stored.sha256, model.metadata.sha256);
        assert.equal(stored.bytes, model.metadata.bytes);
      }
      await assertNoStoredKey(page, config);
      projectBefore = config.resumeCheckpoint.project;
      projectAfterCreation = config.resumeCheckpoint.project;
      lastGoodProject = projectAfterCreation;
      report.creation = {
        status: "seeded",
        operations: 0,
        firstReservationMs: null,
        seedObserved: false,
        catalogEntities: projectAfterCreation.entities.filter(
          (entity) => entity.geometry?.kind === "asset",
        ).length,
        proceduralEntities: projectAfterCreation.entities.filter(
          (entity) =>
            entity.geometry &&
            !["asset", "generated"].includes(entity.geometry.kind),
        ).length,
        generatedEntities: projectAfterCreation.entities.filter(
          (entity) => entity.geometry?.kind === "generated" && entity.geometry.model,
        ).length,
      };
      report.flagshipResume = {
        ...(report.flagshipResume ?? {}),
        status: "checkpoint-restored",
        stage: "creation",
        seededCreation: {
          status: "validated",
          projectId: projectAfterCreation.id,
          revision: projectAfterCreation.revision,
          sourceSnapshot: relative(
            SOURCE_ROOT,
            config.resumeCheckpoint.checkpointPath,
          ),
          sourceSnapshotSha256: config.resumeCheckpoint.sourceSnapshotSha256,
          assetReferences: assertFlagshipStoryAssetReferences(
            projectAfterCreation,
          ),
          generatedModels: config.resumeCheckpoint.models.length,
        },
      };
    }
    if (!creationContinuation) {
      projectBefore = await storageSnapshot(
        page,
        (config.key ?? config.companionToken)
          ? storageKeyDigest(config.key ?? config.companionToken)
          : undefined,
      );
      lastGoodProject = projectBefore.project;
      assert.equal(projectBefore.sensitive, false);
      const prompt = page.getByPlaceholder("What experience to build?");
      await expect(page.locator("main")).toHaveAttribute(
        "data-renderer-availability",
        "ready",
        { timeout: 30000 },
      );
      await expect(prompt).toBeVisible({ timeout: 30000 });
      await prompt.fill(config.prompt);
      await expect(prompt).toHaveValue(config.prompt);
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expect
        .poll(() => info.generationRequests, { timeout: 30000 })
        .toBeGreaterThan(0);
      const showObjects = page.getByRole("button", {
        name: "Show objects",
        exact: true,
      });
      await expect(showObjects).toBeVisible({ timeout: 30000 });
      await showObjects.click();
      const interrupted = config.interruptedRecovery
        ? await verifyInterruptedRecovery(
            page,
            config,
            report,
            info,
            info.generationBodies[0].projectId,
            evidenceDir,
          )
        : null;
      // A rejected request cannot reserve an entity. Surface that response now
      // instead of spending the entire first-object timeout on an empty scene.
      const firstObject = page.locator(".object-list button").first();
      const reservationDeadline = Date.now() + 180000;
      while (!(await firstObject.isVisible())) {
        const rejectedStatus = info.generationStatuses.find(
          (status) => status >= 400,
        );
        if (rejectedStatus)
          throw new Error(
            `Generation request returned HTTP ${rejectedStatus} before the first entity reservation.`,
          );
        const streamFailure = await page.evaluate(() => {
          const code = window.__orbsieDiagnosticObserver?.records?.[0]?.code;
          return [
            "INVALID_SCENE_UPDATE",
            "INVALID_SCENE_JSON",
            "INVALID_SCENE_PROTOCOL",
            "TRUNCATED_SCENE_STREAM",
            "PROVIDER_STREAM_ERROR",
          ].includes(code)
            ? code
            : null;
        });
        if (streamFailure)
          throw new Error(
            `Generation stream reported ${streamFailure} before the first entity reservation.`,
          );
        if (Date.now() >= reservationDeadline)
          throw new Error("No entity reservation appeared within 180 seconds.");
        await page.waitForTimeout(100);
      }
      const firstEvidence =
        interrupted?.observerEvidence ?? (await observerEvidence(page));
      const seedObserved = Boolean(
        firstEvidence?.stages?.some((entry) =>
          ["seed", "coarse"].includes(entry.stage),
        ),
      );
      report.creation.firstReservationMs = seedObserved
        ? Math.max(0, Math.round(firstEvidence.stages[0].at))
        : null;
      report.creation.seedObserved = seedObserved;
      if (!interrupted) {
        report.evidence.push("intermediate-seed.png");
        await page.screenshot({
          path: join(evidenceDir, "intermediate-seed.png"),
          fullPage: true,
        });
      }
      const gameplayDuringGeneration = config.flagshipStory
        ? observeFlagshipMovementDuringGeneration(page, info, {
            inputMode: config.flagshipInputMode,
          })
        : undefined;
      gameplayDuringGeneration?.catch(() => {});
      try {
      projectAfterCreation = await waitForSavedProject(
        page,
        interrupted ? interrupted.checkpoint.revision + 1 : 1,
        1,
      );
        if (gameplayDuringGeneration) {
          report.creation.gameplayDuringGeneration =
            await gameplayDuringGeneration;
          await page.getByRole("button", { name: "Edit", exact: true }).click();
        }
      } catch (error) {
        await gameplayDuringGeneration?.catch(() => {});
        throw error;
      }
      lastGoodProject = projectAfterCreation;
      if (config.requireBrowserModel) {
        const bakedEntity = projectAfterCreation.entities.find(
          (entity) =>
            entity.geometry?.kind === "generated" &&
            entity.geometry.job?.backend === "browser-manifold",
        );
        assert(
          bakedEntity,
          "The committed project did not expose a browser-manifold entity to bake.",
        );
        projectAfterCreation = await waitForTrustedBrowserBake(
          page,
          bakedEntity.id,
        );
      }
      if (config.mushroomReplacement) {
        await persistMushroomReplacementSnapshot(
          report,
          evidenceDir,
          "before",
          projectAfterCreation,
        );
        const treeEntity = projectAfterCreation.entities.find(
          (entity) => entity.stage === "ready" && storyTreeEvidence(entity),
        );
        if (
          treeEntity?.geometry?.kind === "generated" &&
          treeEntity.geometry.job?.backend === "browser-manifold"
        )
          projectAfterCreation = await waitForTrustedBrowserBake(
            page,
            treeEntity.id,
          );
        await persistMushroomReplacementSnapshot(
          report,
          evidenceDir,
          "before",
          projectAfterCreation,
        );
      }
      if (interrupted) {
        for (const finished of readyCheckpointEntities(
          interrupted.checkpoint,
        )) {
          assert.deepEqual(
            persistenceJSON(
              projectAfterCreation.entities.find(
                (entity) => entity.id === finished.id,
              ),
            ),
            persistenceJSON(finished),
            "Continuation replaced or altered an already finished entity.",
          );
        }
        report.cloudRecovery.interruptedRecovery.completedEntitiesPreserved = true;
        report.cloudRecovery.interruptedRecovery.status = "passed";
      }
      if (config.requireInputGame) {
        report.inputGame = {
          status: "checking-creation",
          ...assertInputGameProject(
            projectAfterCreation,
            "Created project",
            info.projectValidator,
          ),
        };
        projectAfterCreation = await verifyInputGameBrowserBakes(
          page,
          projectAfterCreation,
        );
      }
      assert.equal(
        seedObserved,
        true,
        "No browser-visible entity reservation/seed was observed.",
      );
      assert(
        projectAfterCreation.messages.some(
          (message) => message.role === "assistant",
        ),
        "The creation stream did not commit an assistant response.",
      );
      await assertNoStoredKey(page, config);
      report.creation.status = "passed";
      report.creation.operations = projectAfterCreation.revision;
      report.creation.catalogEntities = projectAfterCreation.entities.filter(
        (entity) => entity.geometry?.kind === "asset",
      ).length;
      report.creation.proceduralEntities = projectAfterCreation.entities.filter(
        (entity) =>
          entity.geometry &&
          !["asset", "generated"].includes(entity.geometry.kind),
      ).length;

      report.creation.generatedEntities = projectAfterCreation.entities.filter(
        (entity) =>
          entity.geometry?.kind === "generated" && entity.geometry.model,
      ).length;
      if (config.requireNewOnly)
        assert.equal(
          report.creation.catalogEntities,
          0,
          "The explicit new-only creation produced a catalog entity.",
        );
      if (config.builderURL)
        assert(
          report.creation.generatedEntities > 0,
          "The live model did not build a local Blender asset.",
        );

      const browserEntities = projectAfterCreation.entities.filter(
        (entity) =>
          entity.geometry?.kind === "generated" &&
          entity.geometry.job?.backend === "browser-manifold" &&
          entity.geometry.model?.source === "browser-manifold",
      );
      if (config.requireBrowserModel) {
        assert(
          browserEntities.length > 0,
          "The live model did not produce a browser-manifold asset.",
        );
        report.creation.browserGeneratedEntities = browserEntities.length;
      }
      if (config.flagshipStory) {
        projectAfterEdit = await runFlagshipStory(
          page,
          config,
          report,
          info,
          evidenceDir,
          projectAfterCreation,
          (project) => {
            lastGoodProject = project;
          },
        );
      } else if (config.mushroomReplacement) {
        projectAfterEdit = await runMushroomReplacement(
          page,
          config,
          report,
          info,
          evidenceDir,
          projectAfterCreation,
          (project) => {
            lastGoodProject = project;
          },
        );
      } else {
    const targetBefore = config.requireBrowserModel
      ? browserEntities[0]
      : config.builderURL
        ? projectAfterCreation.entities.find(
            (entity) =>
              entity.geometry?.kind === "generated" && entity.geometry.model,
          )
        : projectAfterCreation.entities[0];
    if (config.requireProcedural) {
      const authoring = targetBefore?.geometry?.job?.authoring;
      assert.equal(
        authoring?.source?.language,
        "quickjs",
        "The live model did not produce retained procedural source.",
      );
      assert.equal(authoring.source.version, 1);
      assert.equal(typeof authoring.source.code, "string");
      assert(authoring.source.code.length > 0);
      assert.match(authoring.sourceHash, /^[a-f0-9]{64}$/);
      report.creation.browserProcedural = true;
    }
    if (config.requireExtrusion) {
      assert(
        targetBefore?.geometry?.job?.backend === "browser-manifold" &&
          targetBefore.geometry.job.recipe.nodes.some(
            (node) => node.kind === "extrude",
          ),
        "The live model did not produce the required browser extrusion.",
      );
      report.creation.browserExtrusion = true;
    }
    assert(
      targetBefore,
      "The visible object list did not map to a committed entity.",
    );
    if (config.requireRevolution) {
      assert(
        targetBefore.geometry?.job?.backend === "browser-manifold" &&
          targetBefore.geometry.job.recipe.nodes.some(
            (node) => node.kind === "revolve",
          ),
        "The selected browser model did not use a revolve recipe.",
      );
      report.creation.browserRevolution = true;
    }
    if (config.builderURL)
      assert.equal(
        targetBefore.geometry?.kind,
        "generated",
        "The Blender run did not produce a generated entity for the scoped edit.",
      );
    const targetIndex = projectAfterCreation.entities.findIndex(
      (entity) => entity.id === targetBefore.id,
    );
    assert(targetIndex >= 0);
    const targetRow = page.locator(".object-list button").nth(targetIndex);
    await expect(targetRow).toHaveCount(1);
    await targetRow.click();
    await expect(page.locator(".selection-chip")).toContainText(
      targetBefore.label,
    );
    const editInput = page.locator("#prompt");
    await editInput.fill(config.editPrompt);
    await expect(
      page.getByRole("button", { name: "Change this", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Change this", exact: true })
      .click();
    await expect
      .poll(() => info.generationRequests, { timeout: 30000 })
      .toBe(config.generationBudget);
    assert.equal(
      info.generationBodies.at(-1)?.selectedId,
      targetBefore.id,
      "The edit request did not target the selected entity identity.",
    );
    await expect(page.locator(".message.user").last()).toContainText(
      config.editPrompt.slice(0, 40),
    );
    await expect(
      page.locator(".message.user").last().locator(".entity-chip"),
    ).toBeVisible();
    projectAfterEdit = await waitForSavedProject(
      page,
      projectAfterCreation.revision + 1,
      2,
    );
    lastGoodProject = projectAfterEdit;
    if (config.requireBrowserModel)
        projectAfterEdit = await waitForTrustedBrowserBake(
          page,
          targetBefore.id,
        );
    if (config.requireInputGame) {
      projectAfterEdit = await verifyInputGameBrowserBakes(
        page,
        projectAfterEdit,
      );
      assert.deepEqual(
        projectAfterEdit.game,
        projectAfterCreation.game,
        "The selected material edit changed the input game program.",
      );
      report.inputGame = {
        status: "passed",
        ...assertInputGameProject(
          projectAfterEdit,
          "Edited project",
          info.projectValidator,
        ),
        preservedAcrossEdit: true,
      };
    }
    assert(
      projectAfterEdit.messages.filter(
        (message) => message.role === "assistant",
      ).length >= 2,
      "The edit stream did not commit a terminal assistant response.",
    );
    if (config.requireNewOnly)
      assert.equal(
        projectAfterEdit.entities.filter(
          (entity) => entity.geometry?.kind === "asset",
        ).length,
        0,
        "The explicit new-only workflow introduced a catalog entity during edit.",
      );
    const targetAfter = projectAfterEdit.entities.find(
      (entity) => entity.id === targetBefore.id,
    );
    assert(targetAfter, "The provider edit removed the selected entity.");
    assert.equal(targetAfter.id, targetBefore.id);
    if (config.requireGeometryEdit) {
      assert.equal(targetAfter.geometry?.kind, "generated");
      assert.equal(
        targetAfter.geometry?.job?.backend,
        "browser-manifold",
        "The geometry edit lost browser-manifold job provenance.",
      );
      assert.equal(
        targetAfter.geometry?.model?.source,
        "browser-manifold",
        "The geometry edit lost browser-manifold model provenance.",
      );
      assert.equal(
        targetAfter.geometry?.model?.kernelVersion,
        targetBefore.geometry?.model?.kernelVersion,
        "The geometry edit changed the browser kernel provenance.",
      );
      const beforeRecipe = targetBefore.geometry?.job?.recipe;
      const afterRecipe = targetAfter.geometry?.job?.recipe;
        assert(
          beforeRecipe && afterRecipe,
          "The geometry edit lost its recipe.",
        );
      if (config.requireProcedural) {
        const beforeSource = targetBefore.geometry.job.authoring;
        const afterSource = targetAfter.geometry.job.authoring;
        assert.equal(
          afterSource?.source?.language,
          "quickjs",
          "The edit lost procedural source.",
        );
        assert.match(afterSource.sourceHash, /^[a-f0-9]{64}$/);
        assert.notEqual(
          afterSource.source.code,
          beforeSource.source.code,
          "The edit did not revise procedural source.",
        );
        assert.notEqual(
          afterSource.sourceHash,
          beforeSource.sourceHash,
          "The edit did not change source provenance.",
        );
      }
      assert(
        afterRecipe.revision > beforeRecipe.revision,
        "The geometry edit did not increase the recipe revision.",
      );
      assert.notEqual(
        targetAfter.geometry.model?.sha256,
        targetBefore.geometry?.model?.sha256,
        "The geometry edit did not change the trusted GLB hash.",
      );
      const afterModel = targetAfter.geometry.model;
      assert(
        afterModel,
        "The geometry edit did not produce trusted model metadata.",
      );
      const storedAfter = await readStoredGeneratedModelDigest(
        page,
        afterModel.sha256,
      );
      assert(storedAfter, "The edited trusted browser GLB was not stored.");
      assert.equal(storedAfter.sha256, afterModel.sha256);
      assert.equal(storedAfter.bytes, afterModel.bytes);
      const { geometry: beforeGeometry, ...beforeEntity } = targetBefore;
      const { geometry: afterGeometry, ...afterEntity } = targetAfter;
      const {
        job: beforeJob,
        model: beforeModel,
        ...beforeProperties
      } = beforeGeometry;
      const {
        job: afterJob,
        model: afterMetadata,
        ...afterProperties
      } = afterGeometry;
      assert.deepEqual(
        afterProperties,
        beforeProperties,
        "The recipe edit changed appearance or collision properties.",
      );
      assert.deepEqual(
        afterEntity,
        beforeEntity,
        "The geometry edit changed a non-geometry entity field.",
      );
      const {
        job: _beforeJob,
        model: _beforeModel,
        ...beforeGeometryProperties
      } = beforeGeometry ?? {};
      const {
        job: _afterJob,
        model: _afterModel,
        ...afterGeometryProperties
      } = afterGeometry ?? {};
      assert.deepEqual(
        afterGeometryProperties,
        beforeGeometryProperties,
        "The geometry edit changed appearance or collision properties.",
      );
      if (config.requireRevolution) {
        const beforeRevolve = beforeRecipe.nodes.find(
          (node) => node.kind === "revolve",
        );
        const afterRevolve = afterRecipe.nodes.find(
          (node) => node.kind === "revolve",
        );
        assert(
          beforeRevolve && afterRevolve,
          "The geometry edit lost the revolve recipe.",
        );
        const beforeRadius = Math.max(
          ...beforeRevolve.profile.map((point) => point[0]),
        );
        const afterRadius = Math.max(
          ...afterRevolve.profile.map((point) => point[0]),
        );
        assert(
          afterRadius > beforeRadius,
          "The revolve geometry edit did not increase profile width.",
        );
        const beforeBounds = beforeGeometry?.model?.bounds;
        const afterBounds = afterGeometry?.model?.bounds;
        assert(
          beforeBounds && afterBounds,
          "The revolve edit lost model bounds.",
        );
        assert(
          afterBounds.max[0] - afterBounds.min[0] >
            beforeBounds.max[0] - beforeBounds.min[0],
          "The revolve geometry edit did not increase X width.",
        );
        assert.equal(
          afterBounds.min[1],
          beforeBounds.min[1],
          "The revolve edit changed the explicit minimum Y height.",
        );
        assert.equal(
          afterBounds.max[1],
          beforeBounds.max[1],
          "The revolve edit changed the explicit maximum Y height.",
        );
      }
    } else {
      if (config.builderURL) {
        assert.equal(targetAfter.geometry?.kind, "generated");
        assert.equal(
          targetAfter.geometry.model?.sha256,
          targetBefore.geometry.model?.sha256,
          "The scoped edit replaced the generated Blender model.",
        );
      }
      assert.equal(
        targetAfter.color.toLowerCase(),
        "#ff44aa",
        "The scoped recolor did not use the requested color.",
      );
      const { color: beforeColor, ...beforeShape } = targetBefore;
      const { color: afterColor, ...afterShape } = targetAfter;
      assert.notEqual(
        afterColor.toLowerCase(),
        beforeColor.toLowerCase(),
        "The scoped recolor did not change the selected entity color.",
      );
      if (
        beforeShape.geometry &&
        afterShape.geometry?.kind === beforeShape.geometry.kind
      ) {
        assert.equal(afterShape.geometry.tint?.toLowerCase(), "#ff44aa");
        const { tint: beforeTint, ...beforeGeometry } = beforeShape.geometry;
        const { tint: afterTint, ...afterGeometry } = afterShape.geometry;
        beforeShape.geometry = beforeGeometry;
        afterShape.geometry = afterGeometry;
      }
      assert.deepEqual(
        afterShape,
        beforeShape,
        "The scoped edit changed the selected object beyond its color.",
      );
      assert.deepEqual(
        targetAfter.position,
        targetBefore.position,
        "The scoped edit changed the selected position.",
      );
    }
    assert.deepEqual(
      projectAfterEdit.entities.filter(
        (entity) => entity.id !== targetBefore.id,
      ),
      projectAfterCreation.entities.filter(
        (entity) => entity.id !== targetBefore.id,
      ),
      "The scoped edit changed an unrelated entity.",
    );
    assert.deepEqual(
      projectAfterEdit.environment,
      projectAfterCreation.environment,
      "The scoped edit changed the environment.",
    );
    report.edit = {
      status: "passed",
      type: config.requireGeometryEdit ? "geometry" : "material",
      selectedIdPreserved: true,
    };
      }
    } else {
      projectAfterEdit = await runFlagshipStory(
        page,
        config,
        report,
        info,
        evidenceDir,
        projectAfterCreation,
        (project) => {
          lastGoodProject = project;
        },
        {
          seeded: true,
          generationRequestOffset: 0,
          assistantMessageBaseline:
            config.resumeCheckpoint.project.messages.filter(
              (message) => message.role === "assistant",
            ).length,
        },
      );
    }
    await page.screenshot({
      path: join(evidenceDir, "edit.png"),
      fullPage: true,
    });
    report.evidence.push("edit.png");
    await assertNoStoredKey(page, config);

    if (config.provider === HOSTED_PROVIDER) {
      await Promise.allSettled(info.ndjsonReads);
      assertGenerationRequests(config, info);
      report.liveInference = true;
      report.hosted.generationStatus = "inference-observed";
    }

    report.followOn = await runProjectFollowOnPhases({
      project: projectAfterEdit,
      refresh: async ({ revision }) => {
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(
          page.getByRole("button", {
            name: "Continue your saved world",
            exact: true,
          }),
        ).toBeVisible({ timeout: 30000 });
        await page
          .getByRole("button", { name: "Continue your saved world", exact: true })
          .click();
        await expect(page.locator(".workspace-heading h2")).toBeVisible({
          timeout: 30000,
        });
        const recovered = await waitForSavedProject(page, revision);
        if (config.requireInputGame) {
          assertInputGameProject(
            recovered,
            "Reloaded project",
            info.projectValidator,
          );
          assert.deepEqual(
            recovered.game,
            projectAfterEdit.game,
            "The input game program changed after local reload.",
          );
          report.inputGame = {
            ...report.inputGame,
            preservedAcrossReload: true,
          };
        }
        assert.deepEqual(
          recovered.entities.map((entity) => entity.id),
          projectAfterEdit.entities.map((entity) => entity.id),
        );
        assert.equal(recovered.messages.length, projectAfterEdit.messages.length);
        report.localRecovery = "passed";
        return recovered;
      },
      exportProject: async (recovered, { revision }) => {
        await page.getByRole("button", { name: "Share Orb", exact: true }).click();
        await expect(
          page.getByRole("button", { name: /^Download your world/ }),
        ).toBeVisible({ timeout: 30000 });
        await page.screenshot({
          path: join(evidenceDir, "share.png"),
          fullPage: true,
        });
        report.evidence.push("share.png");
        const downloadPromise = page.waitForEvent("download");
        await page.getByRole("button", { name: /^Download your world/ }).click();
        const download = await downloadPromise;
        const zip = await extractZip(
          download,
          config,
          revision,
          evidenceDir,
        );
        if (config.publication)
          assertPublicationProjectMatches(
            zip.project,
            recovered,
            "Exported project",
          );
        if (config.requireInputGame) {
          assertInputGameProject(
            zip.project,
            "Exported project",
            info.projectValidator,
          );
          assert.deepEqual(
            zip.project.game,
            projectAfterEdit.game,
            "The exported ZIP changed the input game program.",
          );
          report.inputGame = {
            ...report.inputGame,
            preservedInZip: true,
          };
        }
        report.evidence.push("world.zip");
        if (config.publication) {
          try {
            zip.targetArtifacts = await captureCurrentTargetArtifacts({
              appOrigin: config.baseOrigin,
              approvedOrigins,
            });
            assertPublicationArtifactRecordsMatch(
              zip.publicationArtifacts,
              zip.targetArtifacts,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            report.publication = {
              mode: "blocked",
              status: message.startsWith("published-artifact") ||
                message.startsWith("fresh-")
                ? message
                : "fresh-export-target-mismatch",
            };
            throw error;
          }
        }
        report.export = "passed";
        return zip;
      },
      standalonePlayback: async (zip) => {
        await verifyStandalone(browser, zip, config, report, evidenceDir);
        report.standalonePlayback = "passed";
      },
      cloudRecovery: config.cloudRecovery
        ? async (project, { revision }) => {
            await verifyCloudRecovery(
              page,
              browser,
              config,
              report,
              approvedOrigins,
              project,
              storageState,
              evidenceDir,
            );
            assert.equal(
              project.revision,
              revision,
              "Cloud recovery changed the story revision binding.",
            );
          }
        : undefined,
      publication: config.publication
        ? async (project, { revision }, exported) => {
            await runPublication(
              page,
              browser,
              config,
              report,
              approvedOrigins,
              revision,
              evidenceDir,
              project,
              exported.publicationArtifacts,
              exported.targetArtifacts,
            );
            if (report.publication.mode === "blocked")
              throw new HarnessBlockedError(
                `The explicit publication phase was blocked: ${report.publication.status}.`,
              );
            assert.equal(
              project.id,
              projectAfterEdit.id,
              "Publication changed the story project identity.",
            );
          }
        : undefined,
    });
    await Promise.allSettled(info.ndjsonReads);
    assertGenerationRequests(config, info);
    if (creationContinuation) {
      report.flagshipResume = {
        ...(report.flagshipResume ?? {}),
        status: "structural-passed",
        liveEdits: {
          generationRequests: info.generationRequests,
          mushroomRevision: report.flagshipStory?.phases?.mushroom?.revision,
          goal7Revision: report.flagshipStory?.phases?.goal7?.revision,
          undoRevision: projectAfterEdit.revision,
        },
      };
    }
    if (config.provider === HOSTED_PROVIDER) {
      report.liveInference = true;
      report.hosted.generationStatus = "passed";
    }
    if (config.provider === "free" && report.freeTrial)
      report.freeTrial = {
        ...report.freeTrial,
        generationResponseRemaining: [...info.generationTrialRemaining],
      };
    report.traffic = {
      generationRequests: info.generationRequests,
      ...trialTrafficEvidence(config, info),
      ...(config.provider === HOSTED_PROVIDER
        ? {
            hostedGenerationRequests: info.hostedGenerationRequests,
            hostedGenerationAttempts: info.hostedGenerationAttempts,
            apiGenerationRequests: info.apiGenerationRequests,
            companionGenerationRequests: info.companionGenerationRequests,
            loopbackGenerationRequests: info.loopbackGenerationRequests,
            hostedPayloadErrors: info.hostedPayloadErrors,
            hostedViolations: info.hostedViolations,
            hostedNDJSON: info.hostedNDJSON,
          }
        : {}),
      generationStatuses: info.generationStatuses,
      generationRequestTimes: info.generationRequestTimes ?? [],
      generationDiagnostics: info.generationDiagnostics,
      generationBudgetViolations: info.generationBudgetViolations ?? [],
      blockedExternalRequests: info.blockedExternalRequests,
      blockedExternalOrigins: [...info.blockedExternalOrigins].slice(0, 8),
      interceptedGeneration: info.interceptedGeneration,
    };
  } catch (error) {
    await Promise.allSettled(info.diagnosticReads);
    {
      const diagnostics = await readGenerationDiagnostics(page).catch(() => []);
      info.generationDiagnostics.push(
        ...diagnostics.map((record) => ({
          code: record.code,
          diagnostic: sanitizeMessage(record.diagnostic, config),
        })),
      );
    }
    info.generationDiagnostics = [
      ...new Map(
        info.generationDiagnostics.map((record) => [
          JSON.stringify(record),
          record,
        ]),
      ).values(),
    ].slice(0, 8);
    report.error = sanitizedError(error, config);
    if (config.provider === "free")
      await recordFreeTrialFailure(page, report, info, lastGoodProject);
    if (config.cloudRecovery && report.cloudRecovery.status !== "passed")
      report.cloudRecovery.status = "failed";
    if (
      config.interruptedRecovery &&
      report.cloudRecovery.interruptedRecovery.status !== "passed"
    )
      report.cloudRecovery.interruptedRecovery.status = "failed";
    if (report.publication.status === "not-started" && config.publication)
      report.publication.status = isBlockedError(error) ? "blocked" : "failed";
    try {
      await page.screenshot({
        path: join(evidenceDir, "failure.png"),
        fullPage: true,
      });
      report.evidence.push("failure.png");
    } catch {
      // The report still contains the sanitized failure when the page never loaded.
    }
    report.traffic = {
      generationRequests: info.generationRequests,
      ...trialTrafficEvidence(config, info),
      ...(config.provider === HOSTED_PROVIDER
        ? {
            hostedGenerationRequests: info.hostedGenerationRequests,
            hostedGenerationAttempts: info.hostedGenerationAttempts,
            apiGenerationRequests: info.apiGenerationRequests,
            companionGenerationRequests: info.companionGenerationRequests,
            loopbackGenerationRequests: info.loopbackGenerationRequests,
            hostedPayloadErrors: info.hostedPayloadErrors,
            hostedViolations: info.hostedViolations,
            hostedNDJSON: info.hostedNDJSON,
          }
        : {}),
      generationStatuses: info.generationStatuses,
      generationRequestTimes: info.generationRequestTimes ?? [],
      generationDiagnostics: info.generationDiagnostics,
      generationBudgetViolations: info.generationBudgetViolations ?? [],
      blockedExternalRequests: info.blockedExternalRequests,
      interceptedGeneration: info.interceptedGeneration,
    };
    await writeReport(report, config);
    throw error;
  } finally {
    report.traffic = {
      generationRequests: info.generationRequests,
      ...trialTrafficEvidence(config, info),
      ...(config.provider === HOSTED_PROVIDER
        ? {
            hostedGenerationRequests: info.hostedGenerationRequests,
            hostedGenerationAttempts: info.hostedGenerationAttempts,
            apiGenerationRequests: info.apiGenerationRequests,
            companionGenerationRequests: info.companionGenerationRequests,
            loopbackGenerationRequests: info.loopbackGenerationRequests,
            hostedPayloadErrors: info.hostedPayloadErrors,
            hostedViolations: info.hostedViolations,
            hostedNDJSON: info.hostedNDJSON,
          }
        : {}),
      generationStatuses: info.generationStatuses,
      generationRequestTimes: info.generationRequestTimes ?? [],
      generationDiagnostics: info.generationDiagnostics,
      blockedExternalRequests: info.blockedExternalRequests,
      blockedExternalOrigins: [...info.blockedExternalOrigins].slice(0, 8),
      generationBudgetViolations: info.generationBudgetViolations ?? [],
      interceptedGeneration: info.interceptedGeneration,
    };
    await context.close();
    await browser.close();
  }
  await writeReport(report, config);
  return report;
}

async function main() {
  let config;
  let report;
  let runStarted = false;
  try {
    config = readConfiguration(process.argv.slice(2));
    report = emptyReport(
      config,
      await collectProviderBrowserE2EProvenance({
        appSourceCommit: config.applicationSource,
      }),
    );
    runStarted = true;
    const result = await run(config, report);
    const reportPath = await writeReport(result, config);
    console.log(
      `Configured provider checks passed; flagship journey ${result.flagshipJourneyAcceptance.status}; sanitized report: ${reportPath}`,
    );
  } catch (error) {
    if (config) {
      report ||= emptyReport(config);
      report.error = sanitizedError(error, config);
      const blocked = isBlockedError(error);
      report.publication.status =
        config.publication && blocked ? "blocked" : report.publication.status;
      // run() writes its progress and sanitized failure evidence before
      // rethrowing. Configuration failures occur before run() starts and need
      // their initial report written here.
      const reportPath = runStarted
        ? join(REPORT_DIR, `${config.provider}.json`)
        : await writeReport(report, config);
      console.error(
        `Provider browser E2E ${blocked ? "blocked" : "failed"}; sanitized report: ${reportPath}`,
      );
      console.error(report.error);
    } else {
      console.error(
        sanitizedError(error, { key: undefined, companionToken: undefined }),
      );
    }
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
