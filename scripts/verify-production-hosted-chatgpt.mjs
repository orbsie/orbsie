#!/usr/bin/env node
// Read-only production connection check. Inference remains blocked until the
// hosted provider exposes an enforceable output-token ceiling.
import assert from "node:assert/strict";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

export const PRODUCTION_ORIGIN = "https://orbsie.com";
export const MODEL = "gpt-6-luna";
export const SERVICE_TIER = "default";
export const OUTPUT_TOKEN_CEILING = 4096;
export const PROVIDER_OUTPUT_CEILING_ENFORCED = false;
export const PRIVATE_STATE_ENV = "ORBSIE_PRODUCTION_CHATGPT_STORAGE_STATE";
export const LIVE_OPT_IN_ENV = "ORBSIE_PRODUCTION_CHATGPT_E2E";
const CONFIGURED_ORIGIN_ENV = "ORBSIE_PRODUCTION_CHATGPT_URL";
const SAFE_READ_ENDPOINTS = new Set([
  "/api/auth/get-session",
  "/api/chatgpt/models",
  "/api/chatgpt/status",
  "/api/config",
  "/api/models",
  "/api/projects",
  "/api/trial",
]);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ROOT = resolve(ROOT, "docs/evidence/production-hosted-chatgpt");
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class HarnessError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function require(condition, code) {
  if (!condition) throw new HarnessError(code);
}

export function parseProductionOrigin(value = `${PRODUCTION_ORIGIN}/`) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HarnessError("production-origin-must-match");
  }
  require(url.href === `${PRODUCTION_ORIGIN}/` &&
    !url.username &&
    !url.password, "production-origin-must-match");
  return url.origin;
}

export function safeEvidenceSlug(value) {
  require(/^[a-z0-9][a-z0-9-]{0,63}$/.test(
    value ?? "",
  ), "invalid-evidence-slug");
  return value;
}

export function classifyRequest({ origin, pathname, method }) {
  if (origin !== PRODUCTION_ORIGIN) return "external-request-blocked";
  if (
    pathname.startsWith("/api/") &&
    (method !== "GET" || !SAFE_READ_ENDPOINTS.has(pathname))
  )
    return /(?:generate|review|inference|completion|modeling)/i.test(pathname)
      ? "inference-route-blocked"
      : "api-write-or-unknown-read-blocked";
  return "allowed";
}

export async function requireConfiguration(args) {
  require(process.env[LIVE_OPT_IN_ENV] === "1", "live-opt-in-required");
  require(args.length === 1, "usage-requires-one-evidence-slug");
  const slug = safeEvidenceSlug(args[0]);
  parseProductionOrigin(process.env[CONFIGURED_ORIGIN_ENV]);
  const configuredPath = process.env[PRIVATE_STATE_ENV];
  require(isAbsolute(configuredPath ?? ""), "private-storage-state-required");
  const statePath = resolve(configuredPath);
  let info;
  try {
    info = await lstat(statePath);
  } catch {
    throw new HarnessError("private-storage-state-unavailable");
  }
  require(info.isFile() &&
    !info.isSymbolicLink(), "private-storage-state-not-regular-file");
  require((info.mode & 0o777) ===
    0o600, "private-storage-state-must-be-mode-0600");
  require(info.size > 0 &&
    info.size <= 2 * 1024 * 1024, "private-storage-state-size-invalid");
  const actualPath = await realpath(statePath);
  const fromRoot = relative(ROOT, actualPath);
  require(fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot), "private-storage-state-must-be-outside-repository");
  const evidenceDirectory = resolve(EVIDENCE_ROOT, slug);
  const evidenceFromRoot = relative(ROOT, evidenceDirectory);
  require(evidenceFromRoot &&
    evidenceFromRoot !== ".." &&
    !evidenceFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(evidenceFromRoot), "evidence-directory-outside-repository");
  return { origin: PRODUCTION_ORIGIN, statePath, evidenceDirectory };
}

async function readDraft(page) {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === "keyval-store"))
      return null;
    const opened = indexedDB.open("keyval-store");
    const db = await new Promise((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
      opened.onupgradeneeded = () => opened.transaction.abort();
    });
    if (!db.objectStoreNames.contains("keyval")) {
      db.close();
      return null;
    }
    const value = await new Promise((resolve, reject) => {
      const request = db
        .transaction("keyval", "readonly")
        .objectStore("keyval")
        .get("orbsie-draft");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const project = value?.project;
    if (
      !project ||
      typeof project.id !== "string" ||
      !Number.isSafeInteger(project.revision)
    )
      return null;
    return { id: project.id, revision: project.revision };
  });
}

async function assertConnected(page) {
  const connection = await page.evaluate(async () => {
    const response = await fetch("/api/chatgpt/status", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return "unavailable";
    const snapshot = await response.json().catch(() => null);
    return snapshot?.authStatus === "connected" ? "connected" : "disconnected";
  });
  require(connection === "connected", "connection-not-established");
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByText(/^ChatGPT · gpt-6-luna · (low|medium|high) reasoning$/),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByText("Signed in to ChatGPT.", { exact: false }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Close dialog" }).click();
}

function failureCode(error) {
  if (error instanceof HarnessError) return error.code;
  if (error?.name === "AssertionError") return "assertion-failed";
  return "read-only-acceptance-failed";
}

async function main() {
  if (process.argv[2] === "--preflight") {
    assert.equal(parseProductionOrigin(), PRODUCTION_ORIGIN);
    assert.equal(
      safeEvidenceSlug("static-preflight-20260924"),
      "static-preflight-20260924",
    );
    assert.equal(
      classifyRequest({
        origin: PRODUCTION_ORIGIN,
        pathname: "/api/chatgpt/generate",
        method: "POST",
      }),
      "inference-route-blocked",
    );
    console.log(
      JSON.stringify({
        preflight: "passed",
        origin: PRODUCTION_ORIGIN,
        model: MODEL,
        serviceTier: SERVICE_TIER,
        outputTokenCeiling: OUTPUT_TOKEN_CEILING,
        providerOutputCeilingEnforced: PROVIDER_OUTPUT_CEILING_ENFORCED,
        inferenceAllowed: false,
      }),
    );
    return;
  }

  if (process.argv[2] === "--configuration-preflight") {
    const config = await requireConfiguration(process.argv.slice(3));
    console.log(
      JSON.stringify({
        preflight: "passed",
        origin: config.origin,
        privateStateValidated: true,
        evidenceSlug: safeEvidenceSlug(process.argv[3]),
        inferenceAllowed: false,
      }),
    );
    return;
  }

  const config = await requireConfiguration(process.argv.slice(2));
  await mkdir(dirname(config.evidenceDirectory), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(config.evidenceDirectory, { mode: 0o700 });
  const report = {
    scope:
      "Read-only production hosted ChatGPT connection and local recovery check.",
    origin: PRODUCTION_ORIGIN,
    status: "running",
    stage: "startup",
    model: MODEL,
    serviceTier: SERVICE_TIER,
    providerOutputCeiling: {
      required: OUTPUT_TOKEN_CEILING,
      enforced: PROVIDER_OUTPUT_CEILING_ENFORCED,
    },
    inferenceRequests: 0,
    blockedInferenceAttempts: 0,
    blockedApiRequests: 0,
    externalRequestCount: 0,
    externalOrigins: [],
    browserErrors: 0,
  };
  let browser;
  let context;
  let stage = "startup";
  let violation;
  const externalOrigins = new Set();
  const pageErrors = [];
  const configResponses = [];
  const routeCounts = { inference: 0, api: 0, external: 0 };

  try {
    browser = await chromium.launch({
      args: [
        "--no-sandbox",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    });
    context = await browser.newContext({
      storageState: config.statePath,
      viewport: { width: 1280, height: 900 },
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const classification = classifyRequest({
        origin: url.origin,
        pathname: url.pathname,
        method: request.method(),
      });
      if (classification === "allowed") {
        await route.continue();
        return;
      }
      if (classification === "external-request-blocked") {
        routeCounts.external++;
        externalOrigins.add(url.origin);
      } else if (classification === "inference-route-blocked") {
        routeCounts.inference++;
      } else {
        routeCounts.api++;
      }
      violation ??= classification;
      await route.abort();
    });

    const page = await context.newPage();
    page.on("pageerror", () => pageErrors.push("pageerror"));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push("console-error");
    });
    page.on("response", async (response) => {
      const url = new URL(response.url());
      if (
        url.origin !== config.origin ||
        url.pathname !== "/api/config" ||
        response.request().method() !== "GET"
      )
        return;
      try {
        const value = await response.json();
        configResponses.push({
          status: response.status(),
          authoringReview: value?.authoringReview === true,
        });
      } catch {
        configResponses.push({ status: response.status(), invalid: true });
      }
    });

    stage = "production-app";
    const response = await page.goto(`${config.origin}/`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    assert.equal(
      response?.status(),
      200,
      "production app must return HTTP 200",
    );
    await expect(page.locator("canvas").first()).toBeVisible({
      timeout: 30000,
    });
    await expect
      .poll(() => configResponses.length, { timeout: 15000 })
      .toBeGreaterThan(0);
    assert.equal(configResponses.at(-1)?.status, 200);
    assert.equal(configResponses.at(-1)?.invalid, undefined);
    assert.equal(
      configResponses.at(-1)?.authoringReview,
      false,
      "authoring review must be disabled for this check",
    );
    report.authoringReviewEnabled = false;

    stage = "initial-connection-status";
    await assertConnected(page);
    report.connectionStatus = "connected";
    const initialDraft = await readDraft(page);

    stage = "reload-and-local-recovery";
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await expect(page.locator("canvas").first()).toBeVisible({
      timeout: 30000,
    });
    await assertConnected(page);
    report.reloadConnectionStatus = "connected";
    const recoveredDraft = await readDraft(page);
    if (initialDraft) {
      assert.deepEqual(recoveredDraft, initialDraft);
      await expect(
        page.getByRole("button", { name: "Continue your saved world" }),
      ).toBeVisible({ timeout: 15000 });
      await page
        .getByRole("button", { name: "Continue your saved world" })
        .click();
      assert.deepEqual(await readDraft(page), initialDraft);
      report.localDraftRecovery = {
        status: "passed",
        revision: initialDraft.revision,
      };
    } else {
      report.localDraftRecovery = { status: "no-existing-draft" };
    }

    stage = "pre-inference-output-cap-gate";
    assert.equal(routeCounts.inference, 0);
    assert.equal(routeCounts.api, 0);
    assert.equal(routeCounts.external, 0);
    assert.equal(pageErrors.length, 0);
    require(PROVIDER_OUTPUT_CEILING_ENFORCED, "provider-output-cap-unenforceable");
    report.status = "passed";
    report.generationStatus = "not-run";
    report.stage = "complete";
  } catch (error) {
    const code = failureCode(error);
    report.failureCode = violation ?? code;
    if (code === "provider-output-cap-unenforceable") {
      report.status = "blocked";
      report.generationStatus = "blocked-before-inference";
      report.generationFailureCode = code;
    } else {
      report.status = "failed";
      report.generationStatus = "not-run";
    }
    report.stage = stage;
  } finally {
    report.inferenceRequests = 0;
    report.blockedInferenceAttempts = routeCounts.inference;
    report.blockedApiRequests = routeCounts.api;
    report.externalRequestCount = routeCounts.external;
    report.externalOrigins = [...externalOrigins].sort();
    report.browserErrors = pageErrors.length;
    report.authoringReviewEnabled ??= null;
    report.connectionStatus ??= "unverified";
    report.reloadConnectionStatus ??= "unverified";
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await writeFile(
      resolve(config.evidenceDirectory, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
    console.log(JSON.stringify(report));
  }
  if (report.status !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const code = failureCode(error);
    console.error(`Production hosted ChatGPT harness refused to run: ${code}`);
    process.exitCode = 1;
  });
}
