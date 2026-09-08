#!/usr/bin/env node

/**
 * Read-only smoke check for a deployed Orbsie release.
 *
 * This script deliberately never submits the editor prompt. Its browser
 * traffic is limited to GET/HEAD requests, and its report records paths and
 * hashes without query strings, fragments, or capability URLs.
 */
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const execFile = promisify(execFileCallback);
const DEFAULT_ORIGIN = "https://orbsie.com";
const EVIDENCE_DIRECTORY = "docs/evidence/game-runtime-release";
const SCREENSHOT_PATH = `${EVIDENCE_DIRECTORY}/landing.png`;
const REPORT_PATH = `${EVIDENCE_DIRECTORY}/report.json`;
const MAX_RUNTIME_BYTES = 8 * 1024 * 1024;

function safePath(value) {
  try {
    return (new URL(value).pathname || "/").replace(
      /\/[A-Za-z0-9_-]{32,}(?=\/|$)/g,
      "/[redacted]",
    );
  } catch {
    return "[unparseable-url]";
  }
}

function sanitizeText(value) {
  return String(value ?? "")
    .replace(/https?:\/\/[^\s)\]}>'"]+/gi, (candidate) => {
      try {
        const url = new URL(candidate);
        return `${url.origin}${url.pathname}`;
      } catch {
        return "[url-redacted]";
      }
    })
    .replace(
      /([?&](?:token|key|secret|code|authorization)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 500);
}

function safeScalar(value, fallback = null) {
  if (typeof value !== "string" || !value) return fallback;
  return /^[A-Za-z0-9_.:/-]{1,200}$/.test(value) ? value : "[redacted]";
}

function safeDeploymentOrigin(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const candidate = value.includes("://") ? value : `https://${value}`;
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      return "[redacted]";
    return parsed.origin;
  } catch {
    return "[redacted]";
  }
}

function releaseOrigin() {
  const value = process.env.ORBSIE_RELEASE_ORIGIN || DEFAULT_ORIGIN;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw Error("ORBSIE_RELEASE_ORIGIN must be a valid HTTPS origin.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    throw Error(
      "ORBSIE_RELEASE_ORIGIN must be an HTTPS origin without credentials or a path.",
    );
  return parsed.origin;
}

async function sourceCommit() {
  const supplied =
    process.env.ORBSIE_RELEASE_SOURCE_COMMIT ||
    process.env.SOURCE_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA;
  if (supplied && /^[0-9a-f]{7,64}$/i.test(supplied)) return supplied;
  try {
    const result = await execFile("git", ["rev-parse", "HEAD"], {
      timeout: 5000,
      maxBuffer: 2000,
    });
    const value = result.stdout.trim();
    return /^[0-9a-f]{7,64}$/i.test(value) ? value : "unknown";
  } catch {
    return "unknown";
  }
}

function deploymentFields(origin) {
  return {
    origin,
    id: safeScalar(
      process.env.ORBSIE_RELEASE_DEPLOYMENT_ID ||
        process.env.VERCEL_DEPLOYMENT_ID,
    ),
    environment: safeScalar(
      process.env.ORBSIE_RELEASE_DEPLOYMENT_ENV || process.env.VERCEL_ENV,
    ),
    url: safeDeploymentOrigin(
      process.env.ORBSIE_RELEASE_DEPLOYMENT_URL || process.env.VERCEL_URL,
    ),
  };
}

async function get(url) {
  return fetch(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: { Accept: "text/html,application/javascript,application/json" },
  });
}

async function readRuntime(url) {
  const response = await get(url);
  assert.equal(
    response.status,
    200,
    `Player runtime returned HTTP ${response.status}.`,
  );
  const length = Number(response.headers.get("content-length") || 0);
  assert(
    !length || length <= MAX_RUNTIME_BYTES,
    "Player runtime exceeds the smoke-check size budget.",
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert(
    bytes.byteLength <= MAX_RUNTIME_BYTES,
    "Player runtime exceeds the smoke-check size budget.",
  );
  return { response, bytes };
}

async function main() {
  const origin = releaseOrigin();
  const source = await sourceCommit();
  const report = {
    status: "running",
    checkedAt: new Date().toISOString(),
    sourceCommit: source,
    deployment: deploymentFields(origin),
    checks: {
      root: { status: "pending", httpStatus: null },
      generationRunsUnauthorized: { status: "pending", httpStatus: null },
      playerRuntime: {
        status: "pending",
        httpStatus: null,
        expectedSha256: null,
        observedSha256: null,
        bytes: null,
      },
      browser: {
        status: "pending",
        rootHttpStatus: null,
        canvasVisible: false,
        promptPlaceholder: null,
        pageErrors: [],
        nonGetRequests: [],
        externalRequests: [],
      },
    },
    screenshot: SCREENSHOT_PATH,
  };
  let browser;
  let context;
  let page;
  try {
    const expectedRuntime = await readFile("public/player/runtime.js");
    const expectedSha256 = createHash("sha256")
      .update(expectedRuntime)
      .digest("hex");

    const rootResponse = await get(`${origin}/`);
    report.checks.root.httpStatus = rootResponse.status;
    assert.equal(
      rootResponse.status,
      200,
      `Release root returned HTTP ${rootResponse.status}.`,
    );
    await rootResponse.body?.cancel();
    report.checks.root.status = "passed";

    const generationRuns = await get(
      `${origin}/api/generation-runs?projectId=release-smoke`,
    );
    report.checks.generationRunsUnauthorized.httpStatus = generationRuns.status;
    assert.equal(
      generationRuns.status,
      401,
      `Generation-run probe returned HTTP ${generationRuns.status}; expected 401.`,
    );
    await generationRuns.body?.cancel();
    report.checks.generationRunsUnauthorized.status = "passed";

    const runtime = await readRuntime(`${origin}/player/runtime.js`);
    const observedSha256 = createHash("sha256")
      .update(runtime.bytes)
      .digest("hex");
    Object.assign(report.checks.playerRuntime, {
      httpStatus: runtime.response.status,
      expectedSha256,
      observedSha256,
      bytes: runtime.bytes.byteLength,
    });
    assert.equal(
      observedSha256,
      expectedSha256,
      "Deployed player runtime does not match checked-in public/player/runtime.js.",
    );
    report.checks.playerRuntime.status = "passed";

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
    const nonGetRequests = report.checks.browser.nonGetRequests;
    const externalRequests = report.checks.browser.externalRequests;
    await context.route("**/*", async (route) => {
      const request = route.request();
      const method = request.method().toUpperCase();
      const path = safePath(request.url());
      if (!["GET", "HEAD"].includes(method)) {
        nonGetRequests.push({ method, path });
        await route.abort("blockedbyclient");
        return;
      }
      let requestURL;
      try {
        requestURL = new URL(request.url());
      } catch {
        externalRequests.push({ method, path: "[unparseable-url]" });
        await route.abort("blockedbyclient");
        return;
      }
      if (
        requestURL.protocol === "data:" ||
        requestURL.protocol === "blob:" ||
        requestURL.origin === origin
      ) {
        await route.continue();
        return;
      }
      externalRequests.push({ method, path });
      await route.abort("blockedbyclient");
    });
    page = await context.newPage();
    page.on("pageerror", (error) => {
      report.checks.browser.pageErrors.push(
        sanitizeText(error?.message ?? error),
      );
    });
    const rootNavigation = await page.goto(`${origin}/`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    report.checks.browser.rootHttpStatus = rootNavigation?.status() ?? null;
    assert.equal(
      rootNavigation?.status(),
      200,
      `Browser root returned HTTP ${rootNavigation?.status() ?? "no response"}.`,
    );
    await expect(page.locator("canvas")).toBeVisible({ timeout: 30000 });
    report.checks.browser.canvasVisible = true;
    const prompt = page.locator("#prompt");
    await expect(prompt).toHaveAttribute(
      "placeholder",
      "What experience to build?",
      { timeout: 30000 },
    );
    report.checks.browser.promptPlaceholder =
      await prompt.getAttribute("placeholder");
    await page.waitForTimeout(1000);
    await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    assert.deepEqual(
      nonGetRequests,
      [],
      "Release browser traffic attempted a non-GET request.",
    );
    assert.deepEqual(
      report.checks.browser.pageErrors,
      [],
      "Release browser reported page errors.",
    );
    report.checks.browser.status = "passed";
    report.status = "passed";
    console.log(
      `Production release smoke passed; evidence: ${EVIDENCE_DIRECTORY}`,
    );
  } catch (error) {
    report.status = "failed";
    report.error = sanitizeText(error);
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    });
  }
}

await main();
