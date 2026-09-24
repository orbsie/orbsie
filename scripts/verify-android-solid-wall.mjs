#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { unzipSync } from "fflate";

const FIXTURE_ZIP = "docs/evidence/solid-wall-browser/world.zip";
const EVIDENCE_DIRECTORY = "docs/evidence/android-solid-wall";
const AVD = process.env.ORBSIE_ANDROID_AVD ?? "droidlm_api35_midrange";
const DEVICE = process.env.ORBSIE_ANDROID_DEVICE ?? "emulator-5554";
const BOOT_TIMEOUT_MS = 180_000;
const CDP_TIMEOUT_MS = 30_000;
const WALL_ID = "fixture-solid-wall";
const BEHIND_ID = "fixture-behind-wall";
const WALL_APPROACH_TOUCH_LABEL = "Back";
const WALL_APPROACH_KEY = "s";
const EXPECTED_WEBGL_ERROR =
  "THREE.WebGLRenderer: Error creating WebGL context.";
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
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

assert(/^[A-Za-z0-9_.-]{1,80}$/.test(AVD), "Invalid Android AVD name.");
assert(
  /^emulator-(\d{4,5})$/.test(DEVICE),
  "The Android solid-wall verifier only supports an emulator serial.",
);
const emulatorPort = Number(DEVICE.slice("emulator-".length));
assert(emulatorPort % 2 === 0 && emulatorPort >= 5554 && emulatorPort <= 5584);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runAdb(...args) {
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
    "The exported ZIP contains an unsafe path.",
  );
  return path;
}

function createStaticServer(files) {
  return createServer((request, response) => {
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
    const path = pathname.slice(1) || "index.html";
    const bytes = files[path];
    if (!bytes) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": bytes.byteLength,
      "Content-Type": contentType(path),
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : bytes);
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

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function availableLoopbackPort() {
  const probe = createServer();
  const port = await listen(probe);
  await closeServer(probe);
  return port;
}

function listDevices() {
  const output = execFileSync("adb", ["devices"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return new Map(
    output
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter(([serial, state]) => serial && state)
      .map(([serial, state]) => [serial, state]),
  );
}

async function bootEmulatorIfNeeded() {
  const devices = listDevices();
  const state = devices.get(DEVICE);
  if (state && state !== "device") {
    throw new Error(`Configured emulator is present in ADB state ${state}.`);
  }

  let processHandle;
  let startedHere = false;
  if (!state) {
    const avds = execFileSync("emulator", ["-list-avds"], {
      encoding: "utf8",
      timeout: 10_000,
    })
      .split(/\r?\n/)
      .filter(Boolean);
    assert(avds.includes(AVD), `Configured AVD was not found: ${AVD}`);
    processHandle = spawn(
      "emulator",
      [
        "-avd",
        AVD,
        "-port",
        String(emulatorPort),
        "-no-window",
        "-no-audio",
        "-no-boot-anim",
        "-no-snapshot-save",
        "-gpu",
        "swiftshader",
        "-memory",
        "3072",
      ],
      { detached: true, stdio: "ignore" },
    );
    processHandle.once("error", (error) => {
      report.emulatorLaunchError = String(error.message).slice(0, 300);
    });
    startedHere = true;
    report.device.emulatorStartedByHarness = true;
  } else {
    report.device.emulatorStartedByHarness = false;
  }

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let bootCompleted = false;
  while (Date.now() < deadline) {
    if (
      processHandle?.exitCode !== null &&
      processHandle?.exitCode !== undefined
    )
      throw new Error(
        `Emulator exited during startup (${processHandle.exitCode}).`,
      );
    try {
      if (listDevices().get(DEVICE) === "device") {
        const completed = runAdb("shell", "getprop", "sys.boot_completed");
        if (completed === "1") {
          bootCompleted = true;
          break;
        }
      }
    } catch {
      // adb may need a few seconds to attach to a newly starting emulator.
    }
    await wait(1000);
  }
  assert(
    bootCompleted,
    `Android AVD did not boot within ${BOOT_TIMEOUT_MS} ms.`,
  );

  const avdName = runAdb("shell", "getprop", "ro.boot.qemu.avd_name");
  assert.equal(
    avdName,
    AVD,
    `Connected emulator is ${avdName || "unknown"}, expected ${AVD}.`,
  );
  const chromePackage = runAdb(
    "shell",
    "dumpsys",
    "package",
    "com.android.chrome",
  );
  const chromeVersion = chromePackage.match(/versionName=([^\s]+)/)?.[1];
  assert(
    chromeVersion,
    "Google Chrome is not installed on the configured AVD.",
  );
  report.device = {
    ...report.device,
    id: DEVICE,
    avd: AVD,
    androidRelease: runAdb("shell", "getprop", "ro.build.version.release"),
    model: runAdb("shell", "getprop", "ro.product.model"),
    size: runAdb("shell", "wm", "size"),
    density: runAdb("shell", "wm", "density"),
    chromeVersion,
    evidenceClass: "Android emulator Chrome",
    physicalDeviceProof: false,
    emulatorStartedByHarness: startedHere,
  };
  return { processHandle, startedHere };
}

async function waitForBootedChrome(forwardPort, timeoutMs = CDP_TIMEOUT_MS) {
  const url = `http://127.0.0.1:${forwardPort}/json/version`;
  const deadline = Date.now() + timeoutMs;
  let chromeLaunched = false;
  let stablePageLists = 0;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const version = await response.json();
        if (version.Browser?.includes("Chrome")) {
          const targetsResponse = await fetch(
            `http://127.0.0.1:${forwardPort}/json/list`,
            { signal: AbortSignal.timeout(1500) },
          );
          const targets = targetsResponse.ok
            ? await targetsResponse.json()
            : [];
          if (
            Array.isArray(targets) &&
            targets.some(
              (target) => target.type === "page" && target.webSocketDebuggerUrl,
            )
          ) {
            stablePageLists += 1;
            if (stablePageLists >= 3) return version;
          } else stablePageLists = 0;
        }
      }
    } catch {
      // Chrome's DevTools socket is not ready yet.
    }
    if (!chromeLaunched) {
      runAdb(
        "shell",
        "am",
        "start",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        "about:blank",
        "-p",
        "com.android.chrome",
      );
      chromeLaunched = true;
      await wait(2000);
      continue;
    }
    await wait(500);
  }
  throw new Error(
    `Android Chrome DevTools did not become ready within ${timeoutMs} ms.`,
  );
}

function adbReversePorts() {
  return new Set(
    runAdb("reverse", "--list")
      .split(/\s+/)
      .filter((entry) => entry.startsWith("tcp:")),
  );
}

function chooseReversePort() {
  const configured = adbReversePorts();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const port = randomInt(20_000, 50_000);
    if (!configured.has(`tcp:${port}`)) return port;
  }
  throw new Error("Could not find an unused ADB reverse port.");
}

async function readObservation(page) {
  return page.evaluate(() => {
    const read = window.__ORBSIE_GAMEPLAY_READ__;
    return typeof read === "function" ? read() : null;
  });
}

async function waitForObservation(page, predicate, options) {
  const { afterAtMs = -Infinity, timeoutMs = 15_000, label } = options;
  const startedAt = Date.now();
  let cursor = afterAtMs;
  let latest = null;
  while (Date.now() - startedAt < timeoutMs) {
    const observation = await readObservation(page);
    if (observation && observation.atMs > cursor) {
      latest = observation;
      cursor = observation.atMs;
      if (predicate(observation)) return observation;
    }
    await page.waitForTimeout(50);
  }
  throw new Error(
    `${label} did not match a fresh observation: ${JSON.stringify({ latest, waitedMs: Date.now() - startedAt })}`,
  );
}

async function waitForStableWallContact(page, afterAtMs) {
  const startedAt = Date.now();
  let cursor = afterAtMs;
  let stableSince;
  let latest;
  while (Date.now() - startedAt < 20_000) {
    const observation = await readObservation(page);
    if (observation && observation.atMs > cursor) {
      cursor = observation.atMs;
      latest = observation;
      if (
        observation.playing &&
        observation.contacts.includes(WALL_ID) &&
        observation.gameScore === 11
      ) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= 450) return observation;
      } else stableSince = undefined;
    }
    await page.waitForTimeout(50);
  }
  throw new Error(
    `Held ${WALL_APPROACH_TOUCH_LABEL} did not reach a stable wall contact: ${JSON.stringify({ latest, waitedMs: Date.now() - startedAt })}`,
  );
}

async function touchButton(page, session, name, action) {
  const button = page.getByRole("button", { name, exact: true });
  await expect(button).toBeVisible({ timeout: 15_000 });
  const box = await button.boundingBox();
  assert(
    box && box.width > 0 && box.height > 0,
    `Missing touch control: ${name}`,
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
  try {
    return await action();
  } finally {
    await session
      .send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      })
      .catch(() => {});
  }
}

async function saveReport() {
  await writeFile(
    join(EVIDENCE_DIRECTORY, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

const report = {
  mode: "exported-zip-android-solid-wall-acceptance",
  startedAt: new Date().toISOString(),
  fixture: {},
  device: {},
  renderer: "Canvas2D forced by denying WebGL context requests",
  wallApproachControl: {
    accessibleLabel: WALL_APPROACH_TOUCH_LABEL,
    mappedKey: WALL_APPROACH_KEY,
    fixtureDirection: "+Z toward the authored wall from spawn",
  },
  providerCalls: 0,
  generationRequests: [],
  externalRequests: [],
  unexpectedLocalRequests: [],
  failedResponses: [],
  pageErrors: [],
  consoleErrors: [],
  expectedWebglInitializationErrors: 0,
  checks: {},
};

await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
const temporaryRoot = await mkdtemp(
  join(tmpdir(), "orbsie-android-solid-wall-"),
);
const files = {};
const zipBytes = await readFile(FIXTURE_ZIP);
const archive = unzipSync(new Uint8Array(zipBytes));
for (const [archivePath, bytes] of Object.entries(archive)) {
  files[safeArchivePath(archivePath)] = Buffer.from(bytes);
}
const projectBytes = files["project.json"];
assert(projectBytes, "The exported ZIP is missing project.json.");
const project = JSON.parse(projectBytes.toString("utf8"));
const wall = project.entities?.find((entity) => entity.id === WALL_ID);
const behind = project.entities?.find((entity) => entity.id === BEHIND_ID);
assert.equal(wall?.stage, "ready", "Exported wall is not ready.");
assert.equal(wall?.behavior?.type, "solid", "Exported wall is not solid.");
assert.equal(wall?.geometry?.kind, "custom");
assert(wall.geometry.parts?.some((part) => part.shape === "box"));
assert.equal(behind?.behavior?.type, "collect");
assert.equal(behind?.stage, "ready");
assert(
  project.game?.rules?.some(
    (rule) =>
      rule.trigger?.type === "collision" &&
      rule.trigger.entityId === WALL_ID &&
      rule.actions?.some(
        (action) => action.type === "add_score" && action.amount === 11,
      ),
  ),
  "Exported program is missing its wall-contact score rule.",
);
report.fixture = {
  zipSha256: sha256(zipBytes),
  bytes: zipBytes.byteLength,
  fileCount: Object.keys(files).length,
  title: project.title,
  revision: project.revision,
  wallId: WALL_ID,
  behindWallCollectibleId: BEHIND_ID,
};

let emulatorProcess;
let emulatorStartedHere = false;
let server;
let reversePort;
let reverseInstalled = false;
let forwardPort;
let forwardInstalled = false;
let browser;
let page;
let session;
try {
  ({ processHandle: emulatorProcess, startedHere: emulatorStartedHere } =
    await bootEmulatorIfNeeded());
  server = createStaticServer(files);
  const serverPort = await listen(server);
  reversePort = chooseReversePort();
  runAdb("reverse", `tcp:${reversePort}`, `tcp:${serverPort}`);
  reverseInstalled = true;
  forwardPort = await availableLoopbackPort();
  runAdb(
    "forward",
    `tcp:${forwardPort}`,
    "localabstract:chrome_devtools_remote",
  );
  forwardInstalled = true;
  await waitForBootedChrome(forwardPort);
  await wait(2500);

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${forwardPort}`, {
    timeout: CDP_TIMEOUT_MS,
  });
  const context = browser.contexts()[0];
  assert(context, "Android Chrome did not expose a browser context.");
  page = context.pages().find((candidate) => candidate.url() === "about:blank");
  report.device.reusedInitialBlankTab = Boolean(page);
  page ??= await context.newPage();
  await context.addInitScript(() => {
    window.__ORBSIE_GAMEPLAY_READ_REQUESTED__ = true;
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    window.__orbsieAndroidSolidWall = { blockedWebglRequests: 0 };
    HTMLCanvasElement.prototype.getContext = function (kind, options) {
      if (["webgl", "webgl2", "experimental-webgl"].includes(kind)) {
        window.__orbsieAndroidSolidWall.blockedWebglRequests += 1;
        return null;
      }
      return originalGetContext.call(this, kind, options);
    };
  });

  const artifactOrigin = `http://127.0.0.1:${reversePort}`;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === "data:" || url.protocol === "blob:") {
      await route.continue();
      return;
    }
    if (GENERATION_PATHS.has(url.pathname)) {
      report.generationRequests.push(url.pathname);
      await route.abort("blockedbyclient");
      return;
    }
    if (url.origin !== artifactOrigin) {
      report.externalRequests.push({
        origin: url.origin || url.protocol,
        path: url.pathname,
      });
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
    if (response.status() >= 400) {
      report.failedResponses.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
    }
  });
  page.on("pageerror", (error) => {
    if (error.message.includes(EXPECTED_WEBGL_ERROR)) {
      report.expectedWebglInitializationErrors += 1;
      return;
    }
    report.pageErrors.push(error.message.slice(0, 300));
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const messageText = message.text();
    if (messageText.includes(EXPECTED_WEBGL_ERROR)) {
      report.expectedWebglInitializationErrors += 1;
      return;
    }
    report.consoleErrors.push(messageText.slice(0, 300));
  });

  report.cookiesBefore = (await context.cookies(artifactOrigin)).length;
  assert.equal(
    report.cookiesBefore,
    0,
    "Temporary artifact origin has existing cookies.",
  );
  const response = await page.goto(`${artifactOrigin}/`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  assert.equal(
    response?.status(),
    200,
    "Exported ZIP did not return HTTP 200.",
  );
  await expect(page.locator('main[data-ready="true"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".software-world")).toBeVisible({
    timeout: 30_000,
  });
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
  assert(
    report.viewport.touchPoints > 0,
    "Android Chrome did not expose touch input.",
  );
  assert(
    !report.viewport.horizontalOverflow && !report.viewport.verticalOverflow,
    "Exported player overflows the Android viewport.",
  );
  report.checks = {
    readySolidWall: true,
    visibleRenderedScene: true,
    noViewportOverflow: true,
  };
  await page.screenshot({ path: join(EVIDENCE_DIRECTORY, "ready.png") });

  const baseline = await waitForObservation(
    page,
    (observation) =>
      observation.playing &&
      observation.entities.some(
        (entity) =>
          entity.id === WALL_ID &&
          entity.behavior === "solid" &&
          entity.stage === "ready",
      ),
    { label: "ready solid-wall gameplay baseline" },
  );
  session = await context.newCDPSession(page);
  const { contact, blocked } = await touchButton(
    page,
    session,
    WALL_APPROACH_TOUCH_LABEL,
    async () => {
      const contact = await waitForStableWallContact(page, baseline.atMs);
      await page.waitForTimeout(350);
      const blocked = await waitForObservation(
        page,
        (observation) =>
          observation.playing &&
          observation.contacts.includes(WALL_ID) &&
          observation.gameScore === 11,
        {
          afterAtMs: contact.atMs,
          timeoutMs: 5000,
          label: "fresh held-touch wall block",
        },
      );
      return { contact, blocked };
    },
  );
  await expect(page.locator(".score")).toHaveText("Score: 11", {
    timeout: 10_000,
  });
  const wallNearFaceZ = wall.position[2] - wall.geometry.parts[0].scale[2] / 2;
  const maximumFrontPlayerZ = wallNearFaceZ - 0.22 + 0.12;
  assert(
    blocked.atMs > baseline.atMs,
    "Wall contact must come from a fresh gameplay observation.",
  );
  assert(
    blocked.player.position[2] <= maximumFrontPlayerZ,
    `Player center crossed the wall face: z=${blocked.player.position[2].toFixed(3)} > ${maximumFrontPlayerZ.toFixed(3)}.`,
  );
  assert.equal(
    blocked.gameScore,
    11,
    "Wall contact rule must score exactly 11.",
  );
  assert(
    !blocked.collected.includes(BEHIND_ID),
    "Collectible behind the wall was collected.",
  );
  report.blocking = {
    baselineAtMs: Number(baseline.atMs.toFixed(1)),
    contactAtMs: Number(blocked.atMs.toFixed(1)),
    renderer: blocked.renderer,
    playerCenter: blocked.player.position.map((value) =>
      Number(value.toFixed(3)),
    ),
    wallNearFaceZ: Number(wallNearFaceZ.toFixed(3)),
    maximumFrontPlayerZ: Number(maximumFrontPlayerZ.toFixed(3)),
    wallContact: blocked.contacts.includes(WALL_ID),
    score: blocked.gameScore,
    behindWallCollected: blocked.collected.includes(BEHIND_ID),
  };
  report.checks.freshWallContact = true;
  report.checks.playerRemainsBeforeWallFace = true;
  report.checks.scoreElevenAndNoRearCollectible = true;
  await page.screenshot({ path: join(EVIDENCE_DIRECTORY, "wall-contact.png") });

  report.cookiesAfter = (await context.cookies(artifactOrigin)).length;
  report.blockedWebglRequests = await page.evaluate(
    () => window.__orbsieAndroidSolidWall.blockedWebglRequests,
  );
  assert.equal(report.cookiesAfter, 0, "Exported artifact set a cookie.");
  assert(report.blockedWebglRequests > 0, "WebGL was not forced unavailable.");
  assert.deepEqual(
    report.generationRequests,
    [],
    "A generation request was attempted.",
  );
  assert.deepEqual(
    report.externalRequests,
    [],
    "An external request was attempted.",
  );
  assert.deepEqual(report.unexpectedLocalRequests, []);
  assert.deepEqual(report.failedResponses, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  assert(
    report.expectedWebglInitializationErrors > 0,
    "Expected WebGL initialization fallback was not observed.",
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error =
    error instanceof Error
      ? error.message.slice(0, 700)
      : "Android acceptance failed.";
  if (page) {
    await page
      .screenshot({ path: join(EVIDENCE_DIRECTORY, "failure.png") })
      .catch(() => undefined);
  }
  process.exitCode = 1;
} finally {
  const cleanup = {};
  if (session) {
    await session.detach().then(
      () => (cleanup.cdpSessionDetached = true),
      () => (cleanup.cdpSessionDetached = false),
    );
  } else cleanup.cdpSessionDetached = true;
  await page?.close().then(
    () => (cleanup.newTabClosed = true),
    () => (cleanup.newTabClosed = false),
  );
  if (!page) cleanup.newTabClosed = true;
  await browser?.close().catch(() => undefined);

  if (forwardInstalled) {
    try {
      runAdb("forward", "--remove", `tcp:${forwardPort}`);
      cleanup.cdpForwardRemoved = true;
    } catch {
      cleanup.cdpForwardRemoved = false;
    }
  } else cleanup.cdpForwardRemoved = true;
  if (reverseInstalled) {
    try {
      runAdb("reverse", "--remove", `tcp:${reversePort}`);
      cleanup.adbReverseRemoved = true;
    } catch {
      cleanup.adbReverseRemoved = false;
    }
  } else cleanup.adbReverseRemoved = true;
  await closeServer(server).then(
    () => (cleanup.localServerClosed = true),
    () => (cleanup.localServerClosed = false),
  );
  if (!server) cleanup.localServerClosed = true;
  await rm(temporaryRoot, { recursive: true, force: true }).then(
    () => (cleanup.temporaryFilesRemoved = true),
    () => (cleanup.temporaryFilesRemoved = false),
  );

  if (emulatorStartedHere) {
    try {
      runAdb("emu", "kill");
    } catch {
      // The process can already have exited during a failed boot.
    }
    try {
      if (emulatorProcess && emulatorProcess.exitCode === null) {
        await Promise.race([
          new Promise((resolveExit) =>
            emulatorProcess.once("exit", resolveExit),
          ),
          wait(10_000),
        ]);
        if (emulatorProcess.exitCode === null) {
          try {
            process.kill(-emulatorProcess.pid, "SIGTERM");
          } catch {
            // It may have exited between the status check and signal.
          }
          await wait(1000);
        }
      }
      cleanup.emulatorStopped =
        !emulatorProcess || emulatorProcess.exitCode !== null;
    } catch {
      cleanup.emulatorStopped = false;
    }
  } else cleanup.emulatorStopped = true;

  if (Object.values(cleanup).some((value) => value !== true)) {
    report.status = "failed";
    report.cleanupError =
      "One or more owned emulator or local resources did not clean up.";
    process.exitCode = 1;
  }
  report.cleanup = cleanup;
  report.finishedAt = new Date().toISOString();
  await saveReport();
  console.log(
    JSON.stringify({
      status: report.status,
      error: report.error,
      checks: report.checks,
      blocking: report.blocking,
      device: report.device,
      cleanup: report.cleanup,
      evidenceDirectory: EVIDENCE_DIRECTORY,
    }),
  );
}
