#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, randomInt } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve, sep } from "node:path";
import { chromium, expect } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import {
  assertFlagshipStoryCreation,
  runFreshFlagshipGameplay,
} from "./provider-browser-e2e.mjs";
import { preflightArtifact } from "./verify-provider-artifact-publication.mjs";

const FIXTURE_ZIP =
  process.env.ORBSIE_ANDROID_FIXTURE_ZIP ??
  "docs/evidence/provider-e2e/gateway-reload-recovery/gateway/world.zip";
const PLAYER_DIRECTORY = "public/player";
const PLAYER_FILES = [
  "runtime.js",
  "runtime.css",
  "generated-geometry-worker.js",
  "asset-geometry-worker.js",
];
const RENDERER_MODE = process.env.ORBSIE_ANDROID_RENDERER ?? "canvas2d";
const FLAGSHIP_MODE = process.env.ORBSIE_ANDROID_FLAGSHIP_MODE === "1";
const RUNTIME_MODE = process.env.ORBSIE_ANDROID_RUNTIME_MODE ?? "current";
const EXPECTED_FLAGSHIP_ZIP_SHA256 =
  "7630cb95236386713f84c5fc40559273e37fec18b204ea242c6c8ba8f595978a";
const EXPECTED_FLAGSHIP_PROJECT_ID = "f7db190b-34fb-497e-bdee-92adeec85584";
const EXPECTED_FLAGSHIP_REVISION = 42;
const REPORTED_RUNTIME_MODE =
  RUNTIME_MODE === "exported"
    ? "exact-exported-zip"
    : "current-runtime-repacked";
assert(
  ["canvas2d", "webgl"].includes(RENDERER_MODE),
  "Android renderer mode must be canvas2d or webgl.",
);
assert(
  ["current", "exported"].includes(RUNTIME_MODE),
  "Android runtime mode must be current or exported.",
);
assert(
  !FLAGSHIP_MODE || RENDERER_MODE === "canvas2d",
  "Flagship Android acceptance forces Canvas2D fallback.",
);
assert(
  !FLAGSHIP_MODE || RUNTIME_MODE === "exported" || RUNTIME_MODE === "current",
  "Flagship Android runtime mode is invalid.",
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

async function writeFixtureArtifact(
  artifactDirectory,
  zipBytes,
  currentFiles,
  runtimeMode = "current",
) {
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
    if (archivePath.endsWith("/")) {
      await mkdir(destination, { recursive: true });
      continue;
    }
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, bytes);
  }

  const currentRuntime = {};
  const archivedRuntime = {};
  const servedRuntime = {};
  for (const name of PLAYER_FILES) {
    const archivedBytes = archive[name];
    const currentBytes = currentFiles.get(name);
    assert(archivedBytes, `Fixture player file is missing: ${name}`);
    assert(currentBytes, `Current player file is missing: ${name}`);
    const bytes = runtimeMode === "exported" ? archivedBytes : currentBytes;
    const destination = join(artifactDirectory, name);
    await writeFile(destination, bytes);
    currentRuntime[name] = { bytes: bytes.byteLength, sha256: sha256(bytes) };
    archivedRuntime[name] = {
      bytes: archivedBytes.byteLength,
      sha256: sha256(archivedBytes),
    };
    servedRuntime[name] = {
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      matchesExported:
        bytes.byteLength === archivedBytes.byteLength &&
        sha256(bytes) === sha256(archivedBytes),
    };
  }
  return { currentRuntime, archivedRuntime, servedRuntime, runtimeMode };
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
  runtimeMode: FLAGSHIP_MODE ? REPORTED_RUNTIME_MODE : undefined,
  flagshipGameplay: FLAGSHIP_MODE ? { status: "not-started" } : undefined,
  touchRestart: FLAGSHIP_MODE ? { status: "not-started" } : undefined,
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
let phase = "source-preflight";
try {
  await mkdir(artifactDirectory, { recursive: true });
  const zipBytes = await readFile(FIXTURE_ZIP);
  let fixtureProject;
  let flagshipStory;
  if (FLAGSHIP_MODE) {
    assert.equal(
      sha256(zipBytes),
      EXPECTED_FLAGSHIP_ZIP_SHA256,
      "Flagship artifact ZIP hash does not match the reviewed source.",
    );
    const sourceArchive = unzipSync(new Uint8Array(zipBytes));
    const projectBytes = sourceArchive["project.json"];
    assert(projectBytes, "Flagship source ZIP has no project.json.");
    fixtureProject = JSON.parse(strFromU8(projectBytes));
    assert.equal(fixtureProject.id, EXPECTED_FLAGSHIP_PROJECT_ID);
    assert.equal(fixtureProject.revision, EXPECTED_FLAGSHIP_REVISION);
    flagshipStory = assertFlagshipStoryCreation(fixtureProject);
    const catalogAssetIds = [
      ...new Set(
        fixtureProject.entities
          .map((entity) => entity.geometry?.assetId)
          .filter((assetId) => typeof assetId === "string"),
      ),
    ].sort();
    report.source = {
      fixtureZipSha256: sha256(zipBytes),
      projectSha256: sha256(projectBytes),
      projectId: fixtureProject.id,
      revision: fixtureProject.revision,
      entityCount: fixtureProject.entities.length,
      generatedModelCount: 0,
      catalogAssetIds,
      story: {
        platformIds: flagshipStory.platforms.map((entity) => entity.id),
        collectibleIds: flagshipStory.collectibles.map((entity) => entity.id),
        portalId: flagshipStory.portal.id,
      },
      sourceBytesUnchanged: true,
    };
  } else {
    const fixture = preflightArtifact(zipBytes);
    fixtureProject = fixture.project;
    report.source = {
      fixtureZipSha256: sha256(zipBytes),
      canonicalDigest: fixture.sourceDigest,
      revision: fixture.project.revision,
      generatedModelCount: fixture.models.length,
      rules: ["Right +7", "Forward win", "Left lose"],
    };
  }

  phase = "artifact-preparation";
  const currentFiles = new Map(
    await Promise.all(
      PLAYER_FILES.map(async (name) => [
        name,
        await readFile(join(PLAYER_DIRECTORY, name)),
      ]),
    ),
  );
  report.runtimeProvenance = await writeFixtureArtifact(
    artifactDirectory,
    zipBytes,
    currentFiles,
    RUNTIME_MODE,
  );
  if (FLAGSHIP_MODE && RUNTIME_MODE === "exported")
    assert(
      Object.values(report.runtimeProvenance.servedRuntime).every(
        (entry) => entry.matchesExported,
      ),
      "Exact exported-runtime mode changed one or more runtime files.",
    );
  if (!FLAGSHIP_MODE) {
    report.currentPlayerFiles = report.runtimeProvenance.currentRuntime;
  }

  phase = "android-device-preflight";
  report.device = deviceSummary();
  server = createStaticServer(artifactDirectory);
  serverPort = await listen(server);
  reversePort = chooseReversePort();
  adb("reverse", `tcp:${reversePort}`, `tcp:${serverPort}`);
  reverseInstalled = true;
  const artifactOrigin = `http://127.0.0.1:${reversePort}`;

  phase = "android-browser-setup";
  browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  assert(context, "Android Chrome did not expose a browser context.");
  page = await context.newPage();
  await page.addInitScript((rendererMode) => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    window.__ORBSIE_GAMEPLAY_READ_REQUESTED__ = true;
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
  phase = "android-renderer-and-viewport";
  if (RENDERER_MODE === "canvas2d") {
    await expect(page.locator(".software-world")).toBeVisible({
      timeout: 30_000,
    });
    report.renderer = "Canvas2D forced by rejecting WebGL context requests";
    report.webglAcceptance = "not evaluated in forced-fallback mode";
    report.blockedWebglRequests = await page.evaluate(
      () => window.__orbsieAndroidCurrentTest.blockedWebglRequests,
    );
    assert(
      report.blockedWebglRequests > 0,
      "WebGL was not unavailable during initial Canvas2D fallback setup.",
    );
    report.checks.canvas2dFallback = true;
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
  report.checks.viewport = true;
  report.checks.ready = true;
  await page.screenshot({
    path: join(EVIDENCE_DIRECTORY, "ready.png"),
    style: FLAGSHIP_MODE ? "header{visibility:hidden !important}" : undefined,
  });

  const session = await context.newCDPSession(page);
  if (FLAGSHIP_MODE) {
    phase = "touch-gameplay";
    let touchRestartEvidence;
    const gameplay = await runFreshFlagshipGameplay(
      page,
      fixtureProject,
      flagshipStory,
      {
        surface: "standalone",
        inputMode: "touch",
        expectedCollectibleCount: 5,
        expectedRevision: EXPECTED_FLAGSHIP_REVISION,
        onWin: async (won) => {
          await page.screenshot({
            path: join(EVIDENCE_DIRECTORY, "won.png"),
            style: "header{visibility:hidden !important}",
          });
          const before = await page.evaluate(() =>
            window.__ORBSIE_GAMEPLAY_READ__?.(),
          );
          assert(
            before?.won,
            "Portal win was not observable before touch restart.",
          );
          touchRestartEvidence = {
            status: "attempted",
            control: "Play again",
            scoreBefore: before.gameScore,
            uiResetObserved: false,
            freshGameplayObservation: false,
          };
          report.touchRestart = touchRestartEvidence;
          await tap(page, session, "Play again");
          await expect(page.locator(".win")).toHaveCount(0);
          await expect(page.locator(".score")).toHaveText("Score: 0");
          touchRestartEvidence = {
            ...touchRestartEvidence,
            uiResetObserved: true,
            scoreVisibleAfter: 0,
            winOverlayGone: true,
          };
          report.touchRestart = touchRestartEvidence;
          let after;
          await expect
            .poll(
              async () => {
                after = await page.evaluate((previousAtMs) => {
                  const observation = window.__ORBSIE_GAMEPLAY_READ__?.();
                  return observation && observation.atMs > previousAtMs
                    ? observation
                    : null;
                }, before.atMs);
                return Boolean(
                  after &&
                  after.status === "playing" &&
                  !after.won &&
                  after.gameScore === 0 &&
                  after.reset > won.reset,
                );
              },
              { timeout: 5000 },
            )
            .toBe(true);
          assert(
            after &&
              after.atMs > before.atMs &&
              after.status === "playing" &&
              !after.won &&
              after.gameScore === 0 &&
              after.reset > won.reset,
            "Touch restart did not publish a fresh gameplay observation at the original score.",
          );
          touchRestartEvidence = {
            status: "passed",
            control: "Play again",
            scoreBefore: before.gameScore,
            scoreAfter: after.gameScore,
            resetAdvanced: after.reset > won.reset,
            stateAfter: after.status,
            uiResetObserved: true,
            freshGameplayObservation: true,
          };
          report.touchRestart = touchRestartEvidence;
          await page.screenshot({
            path: join(EVIDENCE_DIRECTORY, "touch-restart.png"),
            style: "header{visibility:hidden !important}",
          });
        },
      },
    );
    report.flagshipGameplay = {
      status: gameplay.status,
      inputMode: gameplay.inputMode,
      surface: gameplay.surface,
      collectedIds: gameplay.collectedIds.slice().sort(),
      collectionCount: gameplay.collectedIds.length,
      score: gameplay.win.score,
      statusAtWin: gameplay.win.status,
      portalId: gameplay.win.portalId,
      contacts: gameplay.contacts,
      platforms: gameplay.platformEvidence.map((platform) => ({
        id: platform.id,
        behavior: platform.behavior,
        groundedFrames: platform.groundedFrames,
        bounceFrames: platform.bounceFrames,
        maximumDisplacement: platform.maximumDisplacement,
      })),
      reset: {
        score: gameplay.reset.score,
        status: gameplay.reset.status,
        lifecycleAdvanced: gameplay.reset.lifecycleAdvanced,
      },
    };
    report.touchRestart = touchRestartEvidence;
    assert.equal(
      gameplay.collectedIds.length,
      5,
      "Flagship gameplay must complete the five-crystal objective.",
    );
    assert.equal(
      gameplay.collectedIds.slice().sort().join(","),
      "crystal-1,crystal-2,crystal-3,crystal-4,crystal-5",
      "Flagship gameplay collected an unexpected crystal set.",
    );
    assert.equal(gameplay.win.status, "won");
    assert.equal(touchRestartEvidence?.status, "passed");
    report.checks.touchGameplay = true;
    report.checks.touchInput = gameplay.inputMode === "touch";
    report.checks.portalWin = true;
    report.checks.touchRestart = true;
  } else {
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
  }

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
    report.checks.canvas2dFallback = true;
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
  report.failurePhase = phase;
  if (FLAGSHIP_MODE) {
    report.errorCode =
      phase === "source-preflight"
        ? "flagship-source-preflight-failed"
        : phase === "artifact-preparation"
          ? "fixture-artifact-preparation-failed"
          : phase === "android-device-preflight"
            ? "android-device-preflight-failed"
            : phase === "android-browser-setup"
              ? "android-browser-setup-failed"
              : phase === "touch-gameplay"
                ? "android-flagship-gameplay-failed"
                : "android-renderer-or-viewport-check-failed";
    if (phase === "touch-gameplay") {
      const failureCode =
        error instanceof Error &&
        /touch restart|restart.*reset/i.test(error.message)
          ? "touch-restart-state-unconfirmed"
          : error instanceof Error &&
              /could not reach|unreachable/i.test(error.message)
            ? "target-unreachable"
            : error instanceof Error && /contact|bounce/i.test(error.message)
              ? "platform-contact-missing"
              : error instanceof Error && /portal|win/i.test(error.message)
                ? "portal-win-missing"
                : error instanceof Error &&
                    /collect|crystal|score/i.test(error.message)
                  ? "collectible-objective-incomplete"
                  : "driver-check-failed";
      report.flagshipGameplay = {
        ...report.flagshipGameplay,
        status: "failed",
        failureCode,
        failureMessage:
          error instanceof Error ? error.message.slice(0, 500) : undefined,
        ...(error?.freshGameplayEvidence
          ? { driverFailureEvidence: error.freshGameplayEvidence }
          : {}),
      };
    }
  } else {
    report.error =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "Android check failed.";
  }
  if (page)
    await page
      .screenshot({
        path: join(EVIDENCE_DIRECTORY, "failure.png"),
        style: FLAGSHIP_MODE
          ? "header{visibility:hidden !important}"
          : undefined,
      })
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
