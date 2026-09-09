#!/usr/bin/env node

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
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

const PROVIDERS = new Set(["openrouter", "gateway", "free", "chatgpt-local"]);
const KEY_SCOPES = new Set(["local-only", "cloud-authorized"]);
const DEFAULT_PROMPT =
  "Build a tiny island with one tree and one crystal. Keep it simple and commit the world.";
const DEFAULT_EDIT =
  "Change only the selected entity to bright pink #ff44aa. Preserve its geometry and every unrelated entity and environment. Commit the edit.";
const INPUT_GAME_PROMPT =
  "Create a complete tiny scene with exactly two genuinely original geometry objects: one tree and one mushroom. Use procedural or custom geometry only, finish both entities as ready refined geometry, and preserve a simple playable presentation. Then define exactly three input game rules: right adds score 7, up wins, and left loses. Use no timers, collection triggers, or collection scoring. Commit the world.";
const INPUT_GAME_EDIT =
  "Change only the selected entity's material to bright pink #ff44aa. Preserve its geometry, position, behavior, the complete three-rule input game, the other entity, and the environment. Commit the edit.";
const REPORT_DIR = resolve(
  process.env.ORBSIE_EVIDENCE_DIR ?? "docs/evidence/provider-e2e",
);
const REPORT_MODE = "live-browser";
const JOURNAL_POLL_TIMEOUT = 120000;
const INTERRUPTION_METHODS = new Set(["stop", "reload"]);

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
          "  ORBSIE_OUTPUT_CAP_TOKENS=<bounded-cap> \\",
          "  node scripts/provider-browser-e2e.mjs --provider openrouter|gateway|free|chatgpt-local",
          "",
          "Add --publication or ORBSIE_VERIFY_CLOUD_RECOVERY=1 (and ORBSIE_CLOUD_TEST_STATE) only for an explicitly authorized real cloud check.",
          "Add ORBSIE_VERIFY_INTERRUPTED_RECOVERY=1 only with ORBSIE_VERIFY_CLOUD_RECOVERY=1 for authenticated chatgpt-local recovery.",
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

function readConfiguration(argv) {
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
      "--provider is required and must be openrouter, gateway, free, or chatgpt-local.",
    );
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

  const keyScope = process.env.ORBSIE_KEY_SCOPE;
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

  const expectedModel = process.env.ORBSIE_EXPECTED_MODEL;
  if (!validModelId(expectedModel))
    throw new HarnessConfigurationError(
      "Set ORBSIE_EXPECTED_MODEL to the exact authorized model ID; no model fallback is allowed.",
    );
  const authorizedTestModel =
    provider === "chatgpt-local" ? "gpt-5.6-luna" : "openai/gpt-5.6-luna";
  if (expectedModel !== authorizedTestModel)
    throw new HarnessConfigurationError(
      "Live tests are authorized for Luna only; user model selection is unaffected.",
    );
  const outputCap =
    provider === "chatgpt-local"
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
    if (expectedModel !== "openai/gpt-5.6-luna")
      throw new HarnessConfigurationError(
        "The supplied local-only OpenRouter credential is restricted to the explicit Luna test model; set ORBSIE_EXPECTED_MODEL=openai/gpt-5.6-luna.",
      );
    if (outputCap > 512)
      throw new HarnessConfigurationError(
        "The supplied local-only OpenRouter run is capped at 512 output tokens or less.",
      );
  }
  if (provider === "free") {
    if (expectedModel !== "openai/gpt-5.6-luna")
      throw new HarnessConfigurationError(
        "The server-owned free path is restricted to the explicit Luna model; set ORBSIE_EXPECTED_MODEL=openai/gpt-5.6-luna.",
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
    baseOrigin: baseURL.origin,
    keyScope,
    expectedModel,
    outputCap,
    prompt:
      process.env.ORBSIE_REQUIRE_INPUT_GAME === "1"
        ? INPUT_GAME_PROMPT
        : process.env.ORBSIE_CREATION_PROMPT || DEFAULT_PROMPT,
    editPrompt:
      process.env.ORBSIE_REQUIRE_INPUT_GAME === "1"
        ? INPUT_GAME_EDIT
        : process.env.ORBSIE_EDIT_PROMPT || DEFAULT_EDIT,
    publication:
      args.publication || process.env.ORBSIE_REAL_PUBLICATION === "1",
    cloudRecovery: process.env.ORBSIE_VERIFY_CLOUD_RECOVERY === "1",
    interruptedRecovery: process.env.ORBSIE_VERIFY_INTERRUPTED_RECOVERY === "1",
    interruptionMethod: process.env.ORBSIE_INTERRUPTION_METHOD ?? "stop",
    keyEnv:
      provider === "openrouter"
        ? "OPENROUTER_API_KEY"
        : provider === "gateway"
          ? "AI_GATEWAY_API_KEY"
          : undefined,
    requireNewOnly: process.env.ORBSIE_REQUIRE_NEW_ONLY === "1",
    requireInputGame: process.env.ORBSIE_REQUIRE_INPUT_GAME === "1",
  };

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
  if (config.interruptedRecovery && provider !== "chatgpt-local")
    throw new HarnessConfigurationError(
      "ORBSIE_VERIFY_INTERRUPTED_RECOVERY=1 is currently supported only with --provider chatgpt-local.",
    );
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
  } else if (provider !== "free") {
    // This is the only point where an API credential is read, and it is
    // unreachable unless the explicit live flag and all safety gates passed.
    config.key = process.env[config.keyEnv];
    if (typeof config.key !== "string" || config.key.length < 10)
      throw new HarnessConfigurationError(
        `Set ${config.keyEnv} for the explicitly scoped live run. The value is never printed or written to evidence.`,
      );
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

function persistenceJSON(value) {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? undefined : JSON.parse(encoded);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function emptyReport(config) {
  return {
    provider: config.provider,
    mode: REPORT_MODE,
    targetOrigin: config.baseOrigin,
    model: config.expectedModel,
    reasoning: "low",
    serviceTier: "default",
    keyScope: config.keyScope,
    outputCapTokens: config.outputCap,
    creation: {
      status: "blocked",
      operations: 0,
      firstReservationMs: null,
      seedObserved: false,
    },
    edit: { status: "blocked", selectedIdPreserved: false },
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
    },
    evidence: [],
    error: undefined,
  };
}

async function writeReport(report, config) {
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

async function installTrafficGuard(context, config, approvedOrigins, info) {
  await context.route("**/*", async (route) => {
    const requestURL = new URL(route.request().url());
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
    const isCompanionGeneration =
      config.provider === "chatgpt-local" &&
      requestURL.origin === config.companionURL &&
      requestURL.pathname === "/generate" &&
      request.method() === "POST";
    if (!isApiGeneration && !isCompanionGeneration) return;
    info.generationRequests += 1;
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
      (responseURL.pathname === "/generate" &&
        responseURL.origin === config.companionURL)
    ) {
      if (response.request().method() !== "POST") return;
      info.generationStatuses.push(response.status());
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
  await expect
    .poll(
      async () => {
        const snapshot = await storageSnapshot(page);
        return (
          snapshot.project?.messages.filter(
            (message) => message.role === "assistant",
          ).length ?? 0
        );
      },
      { timeout: 180000 },
    )
    .toBeGreaterThanOrEqual(assistantCount);
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

async function setupOutputCap(page, config) {
  if (config.provider === "chatgpt-local" || config.provider === "free")
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

async function configureApiProvider(page, config, report, info, evidenceDir) {
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

function assertGenerationRequests(config, info) {
  const expectedCount = config.interruptedRecovery ? 3 : 2;
  assert.equal(
    info.generationRequests,
    expectedCount,
    config.interruptedRecovery
      ? `Expected exactly three live generation requests (interrupted creation, continuation, and edit), observed ${info.generationRequests}.`
      : `Expected exactly two live generation requests (creation and edit), observed ${info.generationRequests}.`,
  );
  assert.equal(
    info.interceptedGeneration,
    false,
    "A generation request was not a complete live request.",
  );
  if (config.interruptedRecovery) {
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
      [200, 200],
      "A live generation transport did not return two successful responses.",
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

function assertInputGameProject(project, label) {
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
    assert(
      entity.geometry &&
        ["tree", "mushroom", "custom"].includes(entity.geometry.kind),
      `${label} contains a non-procedural/non-custom entity.`,
    );
    assert.equal(
      entity.geometry.detail,
      "refined",
      `${label} contains geometry that is not refined.`,
    );
    return `${entity.id} ${entity.label} ${entity.geometry.kind}`.toLowerCase();
  });
  assert(
    entityDescriptions.some((value) => value.includes("tree")),
    `${label} has no tree entity.`,
  );
  assert(
    entityDescriptions.some((value) => value.includes("mushroom")),
    `${label} has no mushroom entity.`,
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

async function extractZip(download, config, expectedRevision, evidenceDir) {
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
  const sanitizedName = "world.zip";
  await writeFile(join(evidenceDir, sanitizedName), bytes, { mode: 0o600 });
  return { tempDir, names, project };
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

async function verifyStandalone(browser, zip, config, report, evidenceDir) {
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
  const standaloneReport = {
    status: "running",
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
  let context;
  try {
    const approved = new Set([config.baseOrigin, served.origin]);
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce",
    });
    const info = {
      generationRequests: 0,
      blockedExternalRequests: 0,
      blockedExternalOrigins: new Set(),
      interceptedGeneration: false,
    };
    await installTrafficGuard(context, config, approved, info);
    const page = await context.newPage();
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
    if (config.requireInputGame) {
      await expect(page.locator("main[data-ready=true]")).toBeVisible({
        timeout: 30000,
      });
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
    // Capture the loaded scene after its initial formation frames, not the globe.
    await page.waitForTimeout(2000);
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
    throw error;
  } finally {
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
    await reconnectChatGPTLocalAfterReload(page, config);
    phases.push("chatgpt-local-reconnected");
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
) {
  if (!config.publication) return;
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
  if (typeof publishBody.deploymentUrl === "string") {
    try {
      approvedOrigins.add(new URL(publishBody.deploymentUrl).origin);
    } catch {
      // The browser will fail closed if the deployment URL is malformed.
    }
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
  publicPage.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") || path === "/generate" || path === "/health")
      publicApiRequests.push(path);
  });
  publicPage.on("response", async (response) => {
    if (new URL(response.url()).pathname !== "/project.json") return;
    try {
      const value = await response.json();
      if (Number.isInteger(value.revision)) publishedRevision = value.revision;
    } catch {
      // The assertion below reports an unavailable deployment artifact.
    }
  });
  await publicPage.goto(new URL(href, config.baseOrigin).href, {
    waitUntil: "domcontentloaded",
  });
  await expect(publicPage.locator("iframe")).toBeVisible({ timeout: 60000 });
  await expect(publicPage.frameLocator("iframe").locator("canvas")).toBeVisible(
    { timeout: 60000 },
  );
  await expect
    .poll(() => publishedRevision ?? -1, { timeout: 60000 })
    .toBe(expectedRevision);
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
    revision: expectedRevision,
  };
}

async function run(config) {
  const report = emptyReport(config);
  const evidenceDir = join(REPORT_DIR, config.provider);
  await mkdir(evidenceDir, { recursive: true });
  const approvedOrigins = new Set([config.baseOrigin]);
  if (config.companionURL) approvedOrigins.add(config.companionURL);
  if (config.builderURL) approvedOrigins.add(config.builderURL);
  const info = {
    generationRequests: 0,
    generationBodies: [],
    generationStatuses: [],
    blockedExternalRequests: 0,
    blockedExternalOrigins: new Set(),
    interceptedGeneration: false,
    catalogModel: null,
  };
  const storageState = await readExplicitCloudStorageState(config);
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
  await installTrafficGuard(context, config, approvedOrigins, info);
  const page = await context.newPage();
  attachRequestEvidence(page, config, info);
  let projectBefore;
  let projectAfterCreation;
  let projectAfterEdit;
  try {
    if (config.provider !== "chatgpt-local")
      await page.goto(config.baseOrigin, { waitUntil: "domcontentloaded" });
    await setupOutputCap(page, config);
    if (config.provider === "chatgpt-local")
      await configureChatGPTLocal(page, config, report, info, evidenceDir);
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
    projectBefore = await storageSnapshot(
      page,
      (config.key ?? config.companionToken)
        ? storageKeyDigest(config.key ?? config.companionToken)
        : undefined,
    );
    assert.equal(projectBefore.sensitive, false);
    const prompt = page.getByPlaceholder("What experience to build?");
    await expect(prompt).toBeVisible({ timeout: 30000 });
    await prompt.fill(config.prompt);
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
    await expect(page.locator(".object-list button").first()).toBeVisible({
      timeout: 180000,
    });
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
    projectAfterCreation = await waitForSavedProject(
      page,
      interrupted ? interrupted.checkpoint.revision + 1 : 1,
      1,
    );
    if (interrupted) {
      for (const finished of readyCheckpointEntities(interrupted.checkpoint)) {
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
        ...assertInputGameProject(projectAfterCreation, "Created project"),
      };
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

    const targetBefore = config.builderURL
      ? projectAfterCreation.entities.find(
          (entity) =>
            entity.geometry?.kind === "generated" && entity.geometry.model,
        )
      : projectAfterCreation.entities[0];
    assert(
      targetBefore,
      "The visible object list did not map to a committed entity.",
    );
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
      .toBe(config.interruptedRecovery ? 3 : 2);
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
    if (config.requireInputGame) {
      assert.deepEqual(
        projectAfterEdit.game,
        projectAfterCreation.game,
        "The selected material edit changed the input game program.",
      );
      report.inputGame = {
        status: "passed",
        ...assertInputGameProject(projectAfterEdit, "Edited project"),
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
    report.edit = { status: "passed", selectedIdPreserved: true };
    await page.screenshot({
      path: join(evidenceDir, "edit.png"),
      fullPage: true,
    });
    report.evidence.push("edit.png");
    await assertNoStoredKey(page, config);

    const expectedRevision = projectAfterEdit.revision;
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
    const recovered = await waitForSavedProject(page, expectedRevision);
    assert.equal(recovered.revision, expectedRevision);
    if (config.requireInputGame) {
      assertInputGameProject(recovered, "Reloaded project");
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
      expectedRevision,
      evidenceDir,
    );
    if (config.requireInputGame) {
      assertInputGameProject(zip.project, "Exported project");
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
    report.export = "passed";
    await verifyStandalone(browser, zip, config, report, evidenceDir);
    report.standalonePlayback = "passed";
    await verifyCloudRecovery(
      page,
      browser,
      config,
      report,
      approvedOrigins,
      projectAfterEdit,
      storageState,
      evidenceDir,
    );
    await runPublication(
      page,
      browser,
      config,
      report,
      approvedOrigins,
      expectedRevision,
      evidenceDir,
    );
    if (config.publication && report.publication.mode === "blocked")
      throw new HarnessBlockedError(
        `The explicit publication phase was blocked: ${report.publication.status}.`,
      );
    assertGenerationRequests(config, info);
    report.traffic = {
      generationRequests: info.generationRequests,
      generationStatuses: info.generationStatuses,
      blockedExternalRequests: info.blockedExternalRequests,
      blockedExternalOrigins: [...info.blockedExternalOrigins].slice(0, 8),
      interceptedGeneration: info.interceptedGeneration,
    };
  } catch (error) {
    report.error = sanitizedError(error, config);
    if (config.cloudRecovery && report.cloudRecovery.status !== "passed")
      report.cloudRecovery.status = "failed";
    if (
      config.interruptedRecovery &&
      report.cloudRecovery.interruptedRecovery.status !== "passed"
    )
      report.cloudRecovery.interruptedRecovery.status = "failed";
    if (report.publication.status === "not-started" && config.publication)
      report.publication.status =
        error instanceof HarnessBlockedError ? "blocked" : "failed";
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
      generationStatuses: info.generationStatuses,
      blockedExternalRequests: info.blockedExternalRequests,
      interceptedGeneration: info.interceptedGeneration,
    };
    await writeReport(report, config);
    throw error;
  } finally {
    report.traffic = {
      generationRequests: info.generationRequests,
      generationStatuses: info.generationStatuses,
      blockedExternalRequests: info.blockedExternalRequests,
      blockedExternalOrigins: [...info.blockedExternalOrigins].slice(0, 8),
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
    report = emptyReport(config);
    runStarted = true;
    const result = await run(config);
    const reportPath = await writeReport(result, config);
    console.log(`Provider browser E2E passed; sanitized report: ${reportPath}`);
  } catch (error) {
    if (config) {
      report ||= emptyReport(config);
      report.error = sanitizedError(error, config);
      report.publication.status =
        config.publication && error instanceof HarnessBlockedError
          ? "blocked"
          : report.publication.status;
      // run() writes its progress and sanitized failure evidence before
      // rethrowing. Configuration failures occur before run() starts and need
      // their initial report written here.
      const reportPath = runStarted
        ? join(REPORT_DIR, `${config.provider}.json`)
        : await writeReport(report, config);
      console.error(
        `Provider browser E2E ${error instanceof HarnessBlockedError ? "blocked" : "failed"}; sanitized report: ${reportPath}`,
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

await main();
