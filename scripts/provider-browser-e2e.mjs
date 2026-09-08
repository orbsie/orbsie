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
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

const PROVIDERS = new Set(["openrouter", "gateway", "chatgpt-local"]);
const KEY_SCOPES = new Set(["local-only", "cloud-authorized"]);
const DEFAULT_PROMPT =
  "Build a tiny island with one tree and one crystal. Keep it simple and commit the world.";
const DEFAULT_EDIT =
  "Change only the selected entity to bright pink #ff44aa. Preserve its geometry and every unrelated entity and environment. Commit the edit.";
const REPORT_DIR = resolve("docs/evidence/provider-e2e");
const REPORT_MODE = "live-browser";

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
          "  node scripts/provider-browser-e2e.mjs --provider openrouter|gateway|chatgpt-local",
          "",
          "Add --publication (and ORBSIE_CLOUD_TEST_STATE) only for an explicitly authorized real cloud/publication check.",
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
      "--provider is required and must be openrouter, gateway, or chatgpt-local.",
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
    prompt: process.env.ORBSIE_CREATION_PROMPT || DEFAULT_PROMPT,
    editPrompt: process.env.ORBSIE_EDIT_PROMPT || DEFAULT_EDIT,
    publication:
      args.publication || process.env.ORBSIE_REAL_PUBLICATION === "1",
    keyEnv:
      provider === "openrouter" ? "OPENROUTER_API_KEY" : "AI_GATEWAY_API_KEY",
  };

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
  } else {
    // This is the only point where an API credential is read, and it is
    // unreachable unless the explicit live flag and all safety gates passed.
    config.key = process.env[config.keyEnv];
    if (typeof config.key !== "string" || config.key.length < 10)
      throw new HarnessConfigurationError(
        `Set ${config.keyEnv} for the explicitly scoped live run. The value is never printed or written to evidence.`,
      );
  }

  if (config.publication && !process.env.ORBSIE_CLOUD_TEST_STATE)
    throw new HarnessConfigurationError(
      "Real publication was explicitly requested; set ORBSIE_CLOUD_TEST_STATE to the private mode-0600 state file.",
    );
  return config;
}

function sanitizeMessage(message, config) {
  let value = String(message || "");
  for (const secret of [config?.key, config?.companionToken]) {
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

function emptyReport(config) {
  return {
    provider: config.provider,
    mode: REPORT_MODE,
    targetOrigin: config.baseOrigin,
    model: config.expectedModel,
    reasoning: "low",
    serviceTier: "default",
    keyScope: config.keyScope,
    creation: {
      status: "blocked",
      operations: 0,
      firstReservationMs: null,
      seedObserved: false,
    },
    edit: { status: "blocked", selectedIdPreserved: false },
    localRecovery: "blocked",
    export: "blocked",
    standalonePlayback: "blocked",
    publication: {
      mode: config.publication ? "real" : "blocked",
      status: config.publication ? "not-started" : "not-requested",
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

async function storageSnapshot(page, keyDigest) {
  return page.evaluate(async (digest) => {
    const textDigest = async (value) => {
      const bytes = new TextEncoder().encode(value);
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(hash)]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
    };
    const containsKey = async (value) => {
      if (typeof value === "string")
        return (await textDigest(value)) === digest;
      if (Array.isArray(value)) {
        for (const child of value) if (await containsKey(child)) return true;
        return false;
      }
      if (value && typeof value === "object") {
        for (const [name, child] of Object.entries(value)) {
          if ((await textDigest(name)) === digest) return true;
          if (await containsKey(child)) return true;
        }
      }
      return false;
    };
    const getValue = (key) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onerror = () =>
          reject(request.error || Error("IndexedDB open failed"));
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("keyval")) {
            db.close();
            resolve(undefined);
            return;
          }
          const transaction = db.transaction("keyval", "readonly");
          const getRequest = transaction.objectStore("keyval").get(key);
          getRequest.onerror = () =>
            reject(getRequest.error || Error("IndexedDB read failed"));
          getRequest.onsuccess = () => {
            const value = getRequest.result;
            db.close();
            resolve(value);
          };
        };
      }).catch(() => undefined);
    const draft = await getValue("orbsie-draft");
    const library = await getValue("orbsie-library");
    const project =
      draft && typeof draft === "object" ? draft.project : undefined;
    const storedProject =
      project && library && typeof library === "object"
        ? library[project.id]
        : undefined;
    const sensitive =
      (await containsKey(draft)) ||
      (await containsKey(library)) ||
      (await containsKey(localStorage)) ||
      (await containsKey(sessionStorage));
    return {
      project: storedProject || project || null,
      revision: storedProject?.revision ?? project?.revision ?? null,
      sensitive,
      localStorageKeys: Object.keys(localStorage),
    };
  }, keyDigest || "__no-provider-key__");
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
        projectRevision: payload.project?.revision ?? null,
        selected: typeof payload.selected === "string" ? true : false,
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
        projectRevision: payload.project?.revision ?? null,
        selected: typeof payload.selected === "string" ? true : false,
      });
    }
  });
  page.on("response", (response) => {
    const responseURL = new URL(response.url());
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
  if (config.provider === "chatgpt-local") return null;
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
  const expectedCount = 2;
  assert.equal(
    info.generationRequests,
    expectedCount,
    `Expected exactly two live generation requests (creation and edit), observed ${info.generationRequests}.`,
  );
  assert.equal(
    info.interceptedGeneration,
    false,
    "A generation request was not a complete live request.",
  );
  assert.deepEqual(
    info.generationStatuses,
    [200, 200],
    "A live generation transport did not return two successful responses.",
  );
  if (config.provider === "chatgpt-local") {
    for (const body of info.generationBodies) {
      assert.equal(body.transport, "loopback-companion");
      assert.equal(body.hasCapabilityHeader, true);
      assert.equal(body.hasProviderField, false);
      assert.equal(body.hasModelField, false);
      assert.equal(body.hasKeyField, false);
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
  const approved = new Set([config.baseOrigin, served.origin]);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
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
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") || path === "/generate" || path === "/health")
      unexpected.push(path);
  });
  await page.goto(`${served.origin}/`, { waitUntil: "networkidle" });
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".score")).toBeVisible({ timeout: 30000 });
  assert.deepEqual(
    unexpected,
    [],
    "Standalone playback made an editor/provider request.",
  );
  await page.screenshot({ path: join(evidenceDir, "standalone-playback.png") });
  report.evidence.push("standalone-playback.png");
  await context.close();
  await new Promise((resolveServer) => served.server.close(resolveServer));
}

async function readExplicitCloudStorageState(config) {
  if (!config.publication) return undefined;
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
  return storageState;
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
    else await configureApiProvider(page, config, report, info, evidenceDir);
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
    await expect(page.locator(".object-list button").first()).toBeVisible({
      timeout: 180000,
    });
    const firstEvidence = await observerEvidence(page);
    const seedObserved = Boolean(
      firstEvidence?.stages?.some((entry) =>
        ["seed", "coarse"].includes(entry.stage),
      ),
    );
    report.creation.firstReservationMs = seedObserved
      ? Math.max(0, Math.round(firstEvidence.stages[0].at))
      : null;
    report.creation.seedObserved = seedObserved;
    report.evidence.push("intermediate-seed.png");
    await page.screenshot({
      path: join(evidenceDir, "intermediate-seed.png"),
      fullPage: true,
    });
    projectAfterCreation = await waitForSavedProject(page, 1, 1);
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

    const firstRow = page.locator(".object-list button").first();
    const selectedLabel = (await firstRow.innerText()).split("\n")[0].trim();
    const targetBefore =
      projectAfterCreation.entities.find(
        (entity) => entity.label === selectedLabel,
      ) || projectAfterCreation.entities[0];
    assert(
      targetBefore,
      "The visible object list did not map to a committed entity.",
    );
    await firstRow.click();
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
      .toBe(2);
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
    assert(
      projectAfterEdit.messages.filter(
        (message) => message.role === "assistant",
      ).length >= 2,
      "The edit stream did not commit a terminal assistant response.",
    );
    const targetAfter = projectAfterEdit.entities.find(
      (entity) => entity.id === targetBefore.id,
    );
    assert(targetAfter, "The provider edit removed the selected entity.");
    assert.equal(
      targetAfter.color.toLowerCase(),
      "#ff44aa",
      "The scoped recolor did not use the requested color.",
    );
    const { color: beforeColor, ...beforeShape } = targetBefore;
    const { color: afterColor, ...afterShape } = targetAfter;
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
    report.evidence.push("world.zip");
    report.export = "passed";
    await verifyStandalone(browser, zip, config, report, evidenceDir);
    report.standalonePlayback = "passed";
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
      blockedExternalRequests: info.blockedExternalRequests,
      blockedExternalOrigins: [...info.blockedExternalOrigins].slice(0, 8),
      interceptedGeneration: info.interceptedGeneration,
    };
  } catch (error) {
    report.error = sanitizedError(error, config);
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
      blockedExternalRequests: info.blockedExternalRequests,
      interceptedGeneration: info.interceptedGeneration,
    };
    await writeReport(report, config);
    throw error;
  } finally {
    report.traffic = {
      generationRequests: info.generationRequests,
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
