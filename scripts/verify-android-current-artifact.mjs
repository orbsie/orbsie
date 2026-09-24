#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, randomInt } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve, sep } from "node:path";
import { chromium, expect } from "@playwright/test";
import { unzipSync } from "fflate";
import { preflightArtifact } from "./verify-provider-artifact-publication.mjs";

const FIXTURE_ZIP =
  "docs/evidence/provider-e2e/gateway-reload-recovery/gateway/world.zip";
const PLAYER_DIRECTORY = "public/player";
const PLAYER_FILES = [
  "runtime.js",
  "runtime.css",
  "generated-geometry-worker.js",
  "asset-geometry-worker.js",
];
const RENDERER_MODE = process.env.ORBSIE_ANDROID_RENDERER ?? "canvas2d";
assert(
  ["canvas2d", "webgl"].includes(RENDERER_MODE),
  "Android renderer mode must be canvas2d or webgl.",
);
const DEFAULT_EVIDENCE_DIRECTORY =
  RENDERER_MODE === "webgl"
    ? "docs/evidence/android-webgl-current-artifact-20260924"
    : "docs/evidence/android-current-artifact";
const evidenceDirectoryOverride = process.env.ORBSIE_ANDROID_EVIDENCE_DIRECTORY;
const EVIDENCE_DIRECTORY = resolve(
  evidenceDirectoryOverride ?? DEFAULT_EVIDENCE_DIRECTORY,
);
assert(
  !evidenceDirectoryOverride ||
    (EVIDENCE_DIRECTORY !== resolve("docs/evidence/android-current-artifact") &&
      EVIDENCE_DIRECTORY !==
        resolve(
          "docs/evidence/android-current-artifact-20260924-post-segment",
        )),
  "Android current-artifact evidence override must preserve the historical report.",
);
const DEVICE = process.env.ORBSIE_ANDROID_DEVICE ?? "emulator-5554";
const CDP_URL = process.env.ORBSIE_ANDROID_CDP_URL ?? "http://127.0.0.1:9222";
const GENERATION_PATHS = new Set([
  "/api/generate",
  "/api/chatgpt/generate",
  "/api/generation-runs",
  "/api/generated-models",
  "/generate",
]);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

assert(/^[A-Za-z0-9_.:-]{1,80}$/.test(DEVICE), "Invalid Android device ID.");
const cdp = new URL(CDP_URL);
assert(
  cdp.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(cdp.hostname) &&
    cdp.pathname === "/" &&
    !cdp.search &&
    !cdp.hash,
  "Android CDP must be forwarded on loopback.",
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function adb(...args) {
  return execFileSync("adb", ["-s", DEVICE, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  }).trim();
}

function contentType(path) {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function safeArchivePath(path) {
  assert(
    path.length > 0 &&
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.split("/").some((part) => part === ".." || part === "."),
    "Fixture ZIP contains an unsafe path.",
  );
  return path;
}

async function writeFixtureArtifact(artifactDirectory, zipBytes, currentFiles) {
  const archive = unzipSync(new Uint8Array(zipBytes));
  for (const [archivePath, bytes] of Object.entries(archive)) {
    const safePath = safeArchivePath(archivePath);
    const destination = resolve(artifactDirectory, ...safePath.split("/"));
    const relativeDestination = relative(artifactDirectory, destination);
    assert(
      relativeDestination &&
        relativeDestination !== ".." &&
        !relativeDestination.startsWith(`..${sep}`),
      "Fixture ZIP path escaped the temporary artifact directory.",
    );
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, bytes);
  }

  const currentRuntime = {};
  for (const name of PLAYER_FILES) {
    const bytes = currentFiles.get(name);
    assert(bytes, `Current player file is missing: ${name}`);
    const destination = join(artifactDirectory, name);
    await writeFile(destination, bytes);
    currentRuntime[name] = { bytes: bytes.byteLength, sha256: sha256(bytes) };
  }
  return currentRuntime;
}

function createStaticServer(root) {
  return createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://local").pathname,
      );
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (pathname.includes("\\") || pathname.split("/").includes("..")) {
      response.writeHead(400).end();
      return;
    }
    const path = resolve(
      root,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    const relativePath = relative(root, path);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const bytes = await readFile(path);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": bytes.byteLength,
        "Content-Type": contentType(path),
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
}

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen(server.address().port);
    });
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
}

function chooseReversePort() {
  const configured = new Set(adb("reverse", "--list").split(/\s+/));
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const port = randomInt(20_000, 50_000);
    if (!configured.has(`tcp:${port}`)) return port;
  }
  throw new Error("Could not find an unused ADB reverse port.");
}

function deviceSummary() {
  const chromePackage = adb(
    "shell",
    "dumpsys",
    "package",
    "com.android.chrome",
  );
  return {
    id: DEVICE,
    androidRelease: adb("shell", "getprop", "ro.build.version.release"),
    model: adb("shell", "getprop", "ro.product.model"),
    size: adb("shell", "wm", "size"),
    density: adb("shell", "wm", "density"),
    chromeVersion:
      chromePackage.match(/versionName=([^\s]+)/)?.[1] ?? "unknown",
    evidenceClass: "Android emulator Chrome",
    physicalDeviceProof: false,
  };
}

async function tap(page, session, name) {
  const button = page.getByRole("button", {
    name,
    exact: typeof name === "string",
  });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  assert(
    box && box.width > 0 && box.height > 0,
    `Missing ${String(name)} control.`,
  );
  const point = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    id: 1,
  };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  await page.waitForTimeout(180);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function saveReport(report) {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await writeFile(
    join(EVIDENCE_DIRECTORY, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

const report = {
  status: "running",
  startedAt: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  source: {},
  currentPlayerFiles: {},
  device: {},
  rendererMode: RENDERER_MODE,
  renderer: "pending runtime detection",
  rendererDetails: {},
  webglAcceptance: "not evaluated",
  providerCalls: 0,
  generationRequests: [],
  externalRequests: [],
  unexpectedLocalRequests: [],
  failedResponses: [],
  pageErrors: [],
  expectedWebglInitializationErrors: 0,
  checks: {},
};

const temporaryRoot = await mkdtemp(join(tmpdir(), "orbsie-android-current-"));
const artifactDirectory = join(temporaryRoot, "artifact");
await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
let server;
let serverPort;
let reversePort;
let reverseInstalled = false;
let browser;
let page;
try {
  await mkdir(artifactDirectory, { recursive: true });
  const zipBytes = await readFile(FIXTURE_ZIP);
  const fixture = preflightArtifact(zipBytes);
  report.source = {
    fixtureZipSha256: sha256(zipBytes),
    canonicalDigest: fixture.sourceDigest,
    revision: fixture.project.revision,
    generatedModelCount: fixture.models.length,
    rules: ["Right +7", "Forward win", "Left lose"],
  };

  const currentFiles = new Map(
    await Promise.all(
      PLAYER_FILES.map(async (name) => [
        name,
        await readFile(join(PLAYER_DIRECTORY, name)),
      ]),
    ),
  );
  report.currentPlayerFiles = await writeFixtureArtifact(
    artifactDirectory,
    zipBytes,
    currentFiles,
  );

  report.device = deviceSummary();
  server = createStaticServer(artifactDirectory);
  serverPort = await listen(server);
  reversePort = chooseReversePort();
  adb("reverse", `tcp:${reversePort}`, `tcp:${serverPort}`);
  reverseInstalled = true;
  const artifactOrigin = `http://127.0.0.1:${reversePort}`;

  browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  assert(context, "Android Chrome did not expose a browser context.");
  page = await context.newPage();
  await page.addInitScript((rendererMode) => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    window.__orbsieAndroidCurrentTest = {
      blockedWebglRequests: 0,
      webglContextAttempts: 0,
      webglContextsCreated: 0,
      webglContexts: [],
    };
    HTMLCanvasElement.prototype.getContext = function (kind, options) {
      if (["webgl", "webgl2", "experimental-webgl"].includes(kind)) {
        if (rendererMode === "canvas2d") {
          window.__orbsieAndroidCurrentTest.blockedWebglRequests += 1;
          return null;
        }
        window.__orbsieAndroidCurrentTest.webglContextAttempts += 1;
        const context = originalGetContext.call(this, kind, options);
        if (context) {
          const state = window.__orbsieAndroidCurrentTest;
          state.webglContextsCreated += 1;
          const debug = context.getExtension("WEBGL_debug_renderer_info");
          state.webglContexts.push({
            requestedType: kind,
            version: context.getParameter(context.VERSION),
            vendor: context.getParameter(context.VENDOR),
            renderer: context.getParameter(context.RENDERER),
            unmaskedVendor: debug
              ? context.getParameter(debug.UNMASKED_VENDOR_WEBGL)
              : null,
            unmaskedRenderer: debug
              ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL)
              : null,
          });
        }
        return context;
      }
      return originalGetContext.call(this, kind, options);
    };
  }, RENDERER_MODE);
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (GENERATION_PATHS.has(url.pathname)) {
      report.generationRequests.push(url.pathname);
      await route.abort("blockedbyclient");
      return;
    }
    if (["data:", "blob:"].includes(url.protocol)) {
      await route.continue();
      return;
    }
    if (url.origin !== artifactOrigin) {
      report.externalRequests.push(url.origin || url.protocol);
      await route.abort("blockedbyclient");
      return;
    }
    if (!["GET", "HEAD"].includes(request.method())) {
      report.unexpectedLocalRequests.push(
        `${request.method()} ${url.pathname}`,
      );
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      report.failedResponses.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
  });
  page.on("pageerror", (error) => {
    if (/Error creating WebGL context/i.test(error.message)) {
      report.expectedWebglInitializationErrors += 1;
      return;
    }
    report.pageErrors.push(error.message.slice(0, 300));
  });
  page.on("console", (message) => {
    if (
      RENDERER_MODE === "webgl" &&
      message.type() === "error" &&
      /Error creating WebGL context/i.test(message.text())
    ) {
      report.expectedWebglInitializationErrors += 1;
    }
  });

  report.cookiesBefore = (await context.cookies(artifactOrigin)).length;
  assert.equal(
    report.cookiesBefore,
    0,
    "The temporary artifact has an existing cookie.",
  );
  const response = await page.goto(`${artifactOrigin}/`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  assert.equal(
    response?.status(),
    200,
    "Temporary artifact did not return HTTP 200.",
  );
  await expect(page.locator('main[data-ready="true"]')).toBeVisible({
    timeout: 30_000,
  });
  if (RENDERER_MODE === "canvas2d") {
    await expect(page.locator(".software-world")).toBeVisible({
      timeout: 30_000,
    });
    report.renderer = "Canvas2D forced by rejecting WebGL context requests";
    report.webglAcceptance = "not evaluated in forced-fallback mode";
  } else {
    await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
    const softwareFallback =
      (await page.locator(".software-world").count()) > 0;
    report.rendererDetails = await page.evaluate(
      () => window.__orbsieAndroidCurrentTest,
    );
    if (softwareFallback) {
      report.renderer = "Canvas2D fallback after WebGL was allowed";
      report.webglAcceptance =
        "not accepted: Android Chrome used Canvas2D fallback";
    } else if (report.rendererDetails.webglContextsCreated > 0) {
      report.renderer = "WebGL context created by Android Chrome";
      report.webglAcceptance =
        "accepted: player used WebGL without Canvas2D fallback";
    } else {
      report.renderer =
        "unknown: no WebGL context and no Canvas2D fallback detected";
      report.webglAcceptance = "not accepted: renderer could not be verified";
    }
  }
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".score")).toHaveText("Score: 0");
  report.viewport = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      touchPoints: navigator.maxTouchPoints,
      horizontalOverflow:
        Math.max(document.body.scrollWidth, root.scrollWidth) > innerWidth + 1,
      verticalOverflow:
        Math.max(document.body.scrollHeight, root.scrollHeight) >
        innerHeight + 1,
    };
  });
  assert(report.viewport.touchPoints > 0, "Chrome did not expose touch input.");
  assert(
    !report.viewport.horizontalOverflow && !report.viewport.verticalOverflow,
    "Temporary artifact overflows the Android viewport.",
  );
  report.checks.ready = true;
  await page.screenshot({ path: join(EVIDENCE_DIRECTORY, "ready.png") });

  const session = await context.newCDPSession(page);
  await tap(page, session, "Right");
  await expect(page.locator(".score")).toHaveText("Score: 7");
  report.checks.touchScore = 7;
  await page.screenshot({ path: join(EVIDENCE_DIRECTORY, "scored.png") });
  await tap(page, session, /Restart/);
  await expect(page.locator(".score")).toHaveText("Score: 0");
  report.checks.restart = true;
  await tap(page, session, "Forward");
  await expect(page.locator(".win")).toContainText("Final score: 0");
  report.checks.win = true;
  await page.screenshot({ path: join(EVIDENCE_DIRECTORY, "won.png") });
  await tap(page, session, /Restart/);
  await expect(page.locator(".score")).toHaveText("Score: 0");
  await tap(page, session, "Left");
  await expect(page.locator(".win")).toContainText("Try another adventure");
  report.checks.loss = true;
  await page.screenshot({ path: join(EVIDENCE_DIRECTORY, "lost.png") });

  report.cookiesAfter = (await context.cookies(artifactOrigin)).length;
  report.blockedWebglRequests = await page.evaluate(
    () => window.__orbsieAndroidCurrentTest.blockedWebglRequests,
  );
  if (RENDERER_MODE === "webgl") {
    report.rendererDetails = await page.evaluate(
      () => window.__orbsieAndroidCurrentTest,
    );
  }
  assert.equal(report.cookiesAfter, 0, "The temporary artifact set a cookie.");
  assert.deepEqual(report.generationRequests, []);
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.unexpectedLocalRequests, []);
  assert.deepEqual(report.failedResponses, []);
  assert.deepEqual(report.pageErrors, []);
  if (RENDERER_MODE === "canvas2d") {
    assert(
      report.blockedWebglRequests > 0,
      "WebGL was not forced unavailable.",
    );
    report.status = "passed";
  } else {
    assert.equal(
      report.blockedWebglRequests,
      0,
      "WebGL must remain enabled in this run.",
    );
    report.status = report.webglAcceptance.startsWith("accepted:")
      ? "passed"
      : "interactions-passed-webgl-not-accepted";
  }
} catch (error) {
  report.status = "failed";
  report.error =
    error instanceof Error
      ? error.message.slice(0, 500)
      : "Android check failed.";
  if (page)
    await page
      .screenshot({ path: join(EVIDENCE_DIRECTORY, "failure.png") })
      .catch(() => undefined);
  process.exitCode = 1;
} finally {
  const cleanup = {};
  await page?.close().then(
    () => (cleanup.newTabClosed = true),
    () => (cleanup.newTabClosed = false),
  );
  await browser?.close().catch(() => undefined);
  if (reverseInstalled) {
    try {
      adb("reverse", "--remove", `tcp:${reversePort}`);
      cleanup.adbReverseRemoved = true;
    } catch {
      cleanup.adbReverseRemoved = false;
    }
  } else {
    cleanup.adbReverseRemoved = true;
  }
  await closeServer(server).then(
    () => (cleanup.localServerClosed = true),
    () => (cleanup.localServerClosed = false),
  );
  await rm(temporaryRoot, { recursive: true, force: true }).then(
    () => (cleanup.temporaryArtifactRemoved = true),
    () => (cleanup.temporaryArtifactRemoved = false),
  );
  report.cleanup = cleanup;
  if (Object.values(cleanup).some((value) => value !== true)) {
    report.status = "failed";
    report.cleanupError = "One or more local resources did not clean up.";
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await saveReport(report);
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks,
      currentPlayerFiles: report.currentPlayerFiles,
      cleanup: report.cleanup,
      evidenceDirectory: EVIDENCE_DIRECTORY,
    }),
  );
}
