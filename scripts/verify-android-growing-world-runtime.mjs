#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build } from "esbuild";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const AVD = process.env.ORBSIE_ANDROID_AVD ?? "droidlm_api35_midrange";
const DEVICE = process.env.ORBSIE_ANDROID_DEVICE ?? "emulator-5554";
const BOOT_TIMEOUT_MS = 180_000;
const CHROME_CDP_TIMEOUT_MS = 30_000;
const LOWER_COST_BASELINE = process.argv.includes("--baseline-120");
const READINESS_ONLY = process.argv.includes("--readiness-only");
const diagnosticEntityFlags = process.argv.filter((argument) =>
  argument.startsWith("--diagnostic-entities="),
);
const diagnosticEntityFlag = diagnosticEntityFlags[0];
assert(
  diagnosticEntityFlags.length <= 1,
  "Specify one diagnostic entity count.",
);
const diagnosticEntityMatch = diagnosticEntityFlag?.match(
  /^--diagnostic-entities=(\d+)$/,
);
const requestedDiagnosticEntityCount = diagnosticEntityMatch
  ? Number(diagnosticEntityMatch[1])
  : null;
assert(
  !diagnosticEntityFlag ||
    (Number.isInteger(requestedDiagnosticEntityCount) &&
      requestedDiagnosticEntityCount >= 1 &&
      requestedDiagnosticEntityCount < 120),
  "Diagnostic entity count must be an integer from 1 through 119.",
);
assert(
  !diagnosticEntityFlag || (LOWER_COST_BASELINE && READINESS_ONLY),
  "--diagnostic-entities requires --baseline-120 --readiness-only.",
);
const ENTITY_COUNT =
  requestedDiagnosticEntityCount ?? (LOWER_COST_BASELINE ? 120 : 160);
const ENTITY_LABEL = ENTITY_COUNT === 1 ? "entity" : "entities";
const RESIDENT_CAP = 48;
const EXPECTED_RESIDENT_COUNT = Math.min(ENTITY_COUNT, RESIDENT_CAP);
const EXPECTED_PROXY_COUNT = Math.max(0, ENTITY_COUNT - RESIDENT_CAP);
const CYCLE_COUNT = 4;
const HOME_X = -600;
const DISTANT_X = 600;
const SELECTED_ID = requestedDiagnosticEntityCount
  ? "home-visible-00"
  : LOWER_COST_BASELINE
    ? "distant-visible-00"
    : "outer-visible-00";
const distanceFlag = process.argv.find((argument) =>
  argument.startsWith("--diagnostic-distance="),
);
const distanceFlagMatch = distanceFlag?.match(
  /^--diagnostic-distance=(\d+(?:\.\d+)?)$/,
);
const requestedDiagnosticDistance = distanceFlagMatch
  ? Number(distanceFlagMatch[1])
  : null;
assert(
  !distanceFlag ||
    (Number.isFinite(requestedDiagnosticDistance) &&
      requestedDiagnosticDistance >= 100 &&
      requestedDiagnosticDistance <= 10000),
  "Diagnostic distance must be a finite value from 100 through 10000 meters.",
);
assert(
  !READINESS_ONLY || LOWER_COST_BASELINE,
  "Readiness-only diagnostic mode requires --baseline-120.",
);
assert(
  !distanceFlag || (READINESS_ONLY && LOWER_COST_BASELINE),
  "--diagnostic-distance requires --baseline-120 --readiness-only.",
);
const CAMERA_DISTANCE = requestedDiagnosticDistance ?? 5000;
const GENERATION_PATHS = new Set([
  "/api/generate",
  "/api/chatgpt/generate",
  "/api/generation-runs",
  "/api/generated-models",
  "/generate",
]);
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const RUN_STARTED_AT = Date.now();
const HARNESS_SOURCE_SHA256 = createHash("sha256")
  .update(await readFile(fileURLToPath(import.meta.url)))
  .digest("hex");
const EVIDENCE_PREFIX = LOWER_COST_BASELINE
  ? READINESS_ONLY
    ? `${ENTITY_COUNT}-entity-distance-${CAMERA_DISTANCE}-readiness`
    : "120-entity-baseline"
  : "160-entity";
const EVIDENCE_DIRECTORY = join(
  REPO_ROOT,
  "docs/evidence/android-growing-world-runtime",
  `${EVIDENCE_PREFIX}-${RUN_ID}`,
);

assert(/^[A-Za-z0-9_.-]{1,80}$/.test(AVD), "Invalid Android AVD name.");
assert(
  /^emulator-(\d{4,5})$/.test(DEVICE),
  "Android growing-world probe requires an emulator serial.",
);
const emulatorPort = Number(DEVICE.slice("emulator-".length));
assert(emulatorPort % 2 === 0 && emulatorPort >= 5554 && emulatorPort <= 5584);

function adb(...args) {
  return execFileSync("adb", ["-s", DEVICE, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  }).trim();
}

function recordLifecycleEvent(report, event, detail) {
  report.lifecycleEvents.push({
    event,
    at: new Date().toISOString(),
    elapsedMs: Date.now() - RUN_STARTED_AT,
    ...(detail ? { detail } : {}),
  });
}

function redactDiagnosticLine(value) {
  return value
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[address]")
    .replace(/\/(?:data|storage|home|tmp)\/[^\s)]+/g, "[path]")
    .replace(/\s+/g, " ")
    .slice(0, 260);
}

function compactError(error, limit = 240) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .slice(0, limit);
}

function collectAndroidProcessDiagnostic(report) {
  const diagnostic = { collectedAt: new Date().toISOString() };
  try {
    const logcat = adb("logcat", "-d", "-t", "1200", "-v", "brief");
    const chromeSignal = /com\.android\.chrome|org\.chromium|chromium|chrome/i;
    const failureSignal =
      /crash|fatal|renderer|killed|died|oom|low.?memory|lmkd|\banr\b|am_anr|am_crash|am_kill/i;
    const relevantLines = logcat
      .split(/\r?\n/)
      .filter((line) => {
        if (!failureSignal.test(line)) return false;
        if (chromeSignal.test(line)) return true;
        return /lmkd|low.?memory|am_anr|am_kill/i.test(line);
      })
      .slice(-30)
      .map(redactDiagnosticLine);
    diagnostic.logcat = {
      source:
        "fresh AVD logcat ring buffer; filtered Chrome/renderer/low-memory/ANR lines only",
      matchedLineCount: relevantLines.length,
      lines: relevantLines,
    };
  } catch (error) {
    diagnostic.logcatError =
      error instanceof Error
        ? error.message.slice(0, 200)
        : "logcat unavailable";
  }
  try {
    diagnostic.chromePid = adb("shell", "pidof", "com.android.chrome") || null;
  } catch {
    diagnostic.chromePid = null;
  }
  try {
    const processLines = adb("shell", "ps", "-A")
      .split(/\r?\n/)
      .filter((line) => /com\.android\.chrome|org\.chromium/i.test(line))
      .slice(0, 12)
      .map(redactDiagnosticLine);
    diagnostic.chromeProcesses = processLines;
  } catch (error) {
    diagnostic.chromeProcessError =
      error instanceof Error
        ? error.message.slice(0, 200)
        : "process state unavailable";
  }
  report.androidProcessDiagnostic = diagnostic;
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

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function availableLoopbackPort() {
  const probe = createServer();
  const port = await listen(probe);
  await closeServer(probe);
  return port;
}

function chooseDevicePort(command) {
  const configured = new Set(
    adb(command, "--list")
      .split(/\s+/)
      .filter((value) => value.startsWith("tcp:")),
  );
  for (let attempt = 0; attempt < 40; attempt++) {
    const port = randomInt(20_000, 50_000);
    if (!configured.has(`tcp:${port}`)) return port;
  }
  throw new Error(`Could not choose an unused ADB ${command} port.`);
}

function createStaticServer(bundle) {
  const html = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><title>Android growing world runtime fixture</title>
<style>
html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#07100f}
canvas{display:block;width:100%;height:100%;touch-action:none}
.software-fixture,.software-world{position:relative;width:100%;height:100%}
.software-world-status{display:none}
</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`;
  return createServer((request, response) => {
    if (!new Set(["GET", "HEAD"]).has(request.method ?? "")) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const path = new URL(request.url ?? "/", "http://local").pathname;
    if (path !== "/" && path !== "/fixture.js") {
      response.writeHead(404).end();
      return;
    }
    const bytes = path === "/" ? Buffer.from(html) : bundle;
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": bytes.byteLength,
      "Content-Type": path === "/" ? MIME_TYPES[".html"] : MIME_TYPES[".js"],
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : bytes);
  });
}

async function buildFixtureBundle(outfile) {
  const fixturePath = join(
    REPO_ROOT,
    "scripts/formation-residency-browser-fixture.tsx",
  );
  const commonOptions = {
    bundle: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    outfile,
    define: { "process.env.NODE_ENV": '"production"' },
  };

  if (requestedDiagnosticEntityCount === null) {
    await build({ entryPoints: [fixturePath], ...commonOptions });
    return;
  }

  const fixtureMarker =
    "const entities = [...baseEntities, ...growingWorldEntities];";
  const originalSource = await readFile(fixturePath, "utf8");
  assert.equal(
    originalSource.split(fixtureMarker).length - 1,
    1,
    "The fixture entity declaration changed; refusing an unsafe diagnostic transform.",
  );
  const diagnosticSource = originalSource.replace(
    fixtureMarker,
    `const completeFixtureEntities = [...baseEntities, ...growingWorldEntities];
const diagnosticEntityCount = Number(new URLSearchParams(location.search).get("diagnosticEntities"));
if (!Number.isInteger(diagnosticEntityCount) || diagnosticEntityCount < 1 || diagnosticEntityCount >= 120) {
  throw new Error("Invalid diagnostic entity count.");
}
const entities = completeFixtureEntities.slice(0, diagnosticEntityCount);`,
  );
  await build({
    stdin: {
      contents: diagnosticSource,
      loader: "tsx",
      resolveDir: dirname(fixturePath),
      sourcefile: fixturePath,
    },
    ...commonOptions,
  });
}

async function bootEmulatorIfNeeded(report) {
  const state = listDevices().get(DEVICE);
  if (state && state !== "device")
    throw new Error(`Configured emulator is present in ADB state ${state}.`);
  let processHandle;
  const startedHere = !state;
  if (startedHere) {
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
      report.emulatorLaunchError = error.message.slice(0, 300);
    });
    recordLifecycleEvent(report, "avd-process-started", { avd: AVD });
  }
  emulatorProcess = processHandle;
  emulatorStartedHere = startedHere;

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
      if (
        listDevices().get(DEVICE) === "device" &&
        adb("shell", "getprop", "sys.boot_completed") === "1"
      ) {
        bootCompleted = true;
        break;
      }
    } catch {
      // adb can need several seconds to attach while Android boots.
    }
    await wait(1000);
  }
  assert(
    bootCompleted,
    `Android AVD did not boot within ${BOOT_TIMEOUT_MS} ms.`,
  );
  assert.equal(
    adb("shell", "getprop", "ro.boot.qemu.avd_name"),
    AVD,
    "Connected emulator does not match the requested AVD.",
  );
  recordLifecycleEvent(report, "android-boot-completed", { avd: AVD });
  return { processHandle, startedHere };
}

function deviceSummary(startedHere) {
  const chromePackage = adb(
    "shell",
    "dumpsys",
    "package",
    "com.android.chrome",
  );
  return {
    id: DEVICE,
    avd: adb("shell", "getprop", "ro.boot.qemu.avd_name"),
    androidRelease: adb("shell", "getprop", "ro.build.version.release"),
    androidApi: adb("shell", "getprop", "ro.build.version.sdk"),
    buildId: adb("shell", "getprop", "ro.build.id"),
    buildFingerprint: adb("shell", "getprop", "ro.build.fingerprint"),
    manufacturer: adb("shell", "getprop", "ro.product.manufacturer"),
    model: adb("shell", "getprop", "ro.product.model"),
    product: adb("shell", "getprop", "ro.product.name"),
    cpuAbi: adb("shell", "getprop", "ro.product.cpu.abi"),
    size: adb("shell", "wm", "size"),
    density: adb("shell", "wm", "density"),
    chromeVersion:
      chromePackage.match(/versionName=([^\s]+)/)?.[1] ?? "unknown",
    evidenceClass: "Android emulator Chrome; not a physical device",
    emulatorStartedByHarness: startedHere,
  };
}

async function waitForChrome(forwardPort) {
  const deadline = Date.now() + CHROME_CDP_TIMEOUT_MS;
  let launchRequested = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${forwardPort}/json/version`,
        { signal: AbortSignal.timeout(1500) },
      );
      if (response.ok) {
        const version = await response.json();
        if (version.Browser?.includes("Chrome")) {
          return {
            browser: version.Browser,
            protocolVersion: version["Protocol-Version"],
            userAgent: version["User-Agent"],
          };
        }
      }
    } catch {
      // Chrome DevTools is not ready yet.
    }
    if (!launchRequested) {
      adb(
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
      launchRequested = true;
    }
    await wait(500);
  }
  throw new Error(
    `Android Chrome CDP did not become ready within ${CHROME_CDP_TIMEOUT_MS} ms.`,
  );
}

function pageProbeInitScript() {
  window.__androidGrowingWorld = {
    webglContextAttempts: 0,
    initStartedAt: performance.now(),
    lifecycle: [{ event: "document-start", at: performance.now() }],
  };
  document.addEventListener(
    "DOMContentLoaded",
    () =>
      window.__androidGrowingWorld.lifecycle.push({
        event: "dom-content-loaded",
        at: performance.now(),
      }),
    { once: true },
  );
  window.addEventListener(
    "load",
    () =>
      window.__androidGrowingWorld.lifecycle.push({
        event: "load",
        at: performance.now(),
      }),
    { once: true },
  );
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, options) {
    if (["webgl", "webgl2", "experimental-webgl"].includes(kind)) {
      window.__androidGrowingWorld.webglContextAttempts += 1;
      return null;
    }
    return originalGetContext.call(this, kind, options);
  };

  const probe = { running: false, last: null, intervals: [] };
  const tick = (time) => {
    if (!probe.running) return;
    if (probe.last !== null) probe.intervals.push(time - probe.last);
    probe.last = time;
    requestAnimationFrame(tick);
  };
  window.__androidGrowingWorldFrameProbe = {
    start() {
      probe.running = true;
      probe.last = null;
      probe.intervals = [];
      requestAnimationFrame(tick);
    },
    stop() {
      probe.running = false;
      return [...probe.intervals];
    },
  };
}

function percentile(values, proportion) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const offset = (sorted.length - 1) * proportion;
  const lower = Math.floor(offset);
  const upper = Math.ceil(offset);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (offset - lower);
}

async function readHeapMetrics(session, report) {
  if (!session || report.heap.supported === false) return null;
  try {
    const { metrics } = await session.send("Performance.getMetrics");
    const values = Object.fromEntries(
      metrics.map(({ name, value }) => [name, value]),
    );
    if (values.JSHeapUsedSize === undefined) {
      report.heap.supported = false;
      return null;
    }
    report.heap.supported = true;
    return {
      jsHeapUsedBytes: values.JSHeapUsedSize,
      jsHeapTotalBytes: values.JSHeapTotalSize ?? null,
    };
  } catch (error) {
    report.heap.supported = false;
    report.heap.error = error instanceof Error ? error.message : String(error);
    return null;
  }
}

function evaluateHeapGrowth(report) {
  if (report.heap.supported !== true) {
    report.heap.growthCheck = { result: "unsupported" };
    return;
  }
  const postWarmupHome = report.heap.samples
    .filter((sample) => sample.phase === "home-reentry" && sample.cycle >= 2)
    .sort((left, right) => left.cycle - right.cycle);
  if (postWarmupHome.length < 3) {
    report.heap.growthCheck = { result: "insufficient-samples" };
    return;
  }
  const first = postWarmupHome[0].jsHeapUsedBytes;
  const last = postWarmupHome.at(-1).jsHeapUsedBytes;
  const delta = last - first;
  const toleranceBytes = Math.max(8 * 1024 * 1024, first * 0.2);
  const monotonic = postWarmupHome.every(
    (sample, index) =>
      index === 0 ||
      sample.jsHeapUsedBytes >= postWarmupHome[index - 1].jsHeapUsedBytes,
  );
  const exceeded = monotonic && delta > toleranceBytes;
  report.heap.growthCheck = {
    result: exceeded ? "monotonic-growth-beyond-tolerance" : "within-tolerance",
    sampleCycles: postWarmupHome.map((sample) => sample.cycle),
    firstBytes: first,
    lastBytes: last,
    deltaBytes: delta,
    toleranceBytes,
    monotonic,
  };
  assert(
    !exceeded,
    "CDP heap grew monotonically beyond the post-warm-up tolerance.",
  );
}

async function touchSwipe(page, session, plan) {
  const steps = 8;
  const point = (x, y) => ({ x, y, id: 1, radiusX: 5, radiusY: 5, force: 1 });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(plan.start.x, plan.start.y)],
  });
  try {
    for (let index = 1; index <= steps; index++) {
      const progress = index / steps;
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          point(
            plan.start.x + (plan.end.x - plan.start.x) * progress,
            plan.start.y + (plan.end.y - plan.start.y) * progress,
          ),
        ],
      });
      await page.waitForTimeout(24);
    }
  } finally {
    await session
      .send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
      .catch(() => {});
  }
}

async function waitForSoftwareState(page, targetX) {
  let stableSamples = 0;
  let lastSample;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    lastSample = await page.evaluate(
      async ({ target, selectedId }) => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const fixture = window.formationResidencyFixture;
        const review = fixture.renderer();
        return {
          fixtureReady: fixture.ready(),
          navigation: fixture.navigation(),
          review,
          paint: fixture.paint(),
          selector: fixture.expectedAt(target, selectedId),
        };
      },
      { target: targetX, selectedId: SELECTED_ID },
    );
    const ready =
      lastSample.fixtureReady &&
      lastSample.review?.renderer === "software" &&
      lastSample.review?.mounted === true &&
      lastSample.review?.transitionSettled === true &&
      lastSample.review?.renderedRevision === 0 &&
      lastSample.review?.errors?.length === 0 &&
      lastSample.paint.frames > 0 &&
      Math.abs(lastSample.navigation.target[0] - targetX) < 10;
    stableSamples = ready ? stableSamples + 1 : 0;
    if (stableSamples >= 2) return lastSample;
    await page.waitForTimeout(40);
  }
  throw new Error(
    `SoftwareWorld did not settle at ${targetX}; last sample: ${JSON.stringify(lastSample)}`,
  );
}

function assertSoftwareSample(sample, targetX) {
  assert.equal(sample.fixtureReady, true);
  assert.equal(sample.review?.renderer, "software");
  assert.equal(sample.review?.mounted, true);
  assert.equal(sample.review?.transitionSettled, true);
  assert.equal(sample.review?.renderedRevision, 0);
  assert.deepEqual(sample.review?.errors, []);
  assert.ok(Math.abs(sample.navigation.target[0] - targetX) < 10);
  assert.ok(sample.paint.frames > 0);
  assert.equal(sample.selector.readyCount, ENTITY_COUNT);
  assert.equal(sample.selector.residentCount, EXPECTED_RESIDENT_COUNT);
  assert.equal(sample.selector.softwareProxyIds.length, EXPECTED_PROXY_COUNT);
  assert.equal(sample.selector.selectedReason, "resident-selected");
  assert.ok(sample.selector.softwareResidentIds.includes(SELECTED_ID));
}

function summarizeSoftwareSample(sample) {
  return {
    targetX: Number(sample.navigation.target[0].toFixed(2)),
    readyEntityCount: sample.selector.readyCount,
    fullResidentCount: sample.selector.residentCount,
    proxyCount: sample.selector.softwareProxyIds.length,
    selectedId: SELECTED_ID,
    selectedIsResident:
      sample.selector.softwareResidentIds.includes(SELECTED_ID),
    visibleMainCount: sample.selector.visibleMainCount,
    reviewReady: sample.fixtureReady,
    transitionSettled: sample.review.transitionSettled,
    renderedRevision: sample.review.renderedRevision,
    canvasFrames: sample.paint.frames,
    proxyArcsPainted: sample.paint.proxyArcCount,
  };
}

const report = {
  status: "running",
  currentStage: "fixture-build",
  runId: RUN_ID,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  harnessSourceSha256: HARNESS_SOURCE_SHA256,
  scope: LOWER_COST_BASELINE
    ? READINESS_ONLY
      ? `Readiness-only diagnostic with ${ENTITY_COUNT} fixture ${ENTITY_LABEL} at ${CAMERA_DISTANCE} m; no travel cycles`
      : `Lower-cost baseline with ${ENTITY_COUNT} default fixture entities, ${CYCLE_COUNT} Android touch travel/reentry cycles`
    : `${ENTITY_COUNT} ready entities, ${CYCLE_COUNT} Android touch travel/reentry cycles, direct SoftwareWorld path`,
  fixture: {
    mode: LOWER_COST_BASELINE
      ? READINESS_ONLY
        ? requestedDiagnosticEntityCount
          ? `${ENTITY_COUNT}-entity scene-readiness diagnostic with post-ready page CDP session`
          : "default 120-entity scene-readiness diagnostic with post-ready page CDP session"
        : "default 120-entity fixture diagnostic baseline"
      : "160-entity growing-world acceptance",
    entityCount: ENTITY_COUNT,
    entitySelection: requestedDiagnosticEntityCount
      ? `first ${ENTITY_COUNT} entities from the default home cluster, selected through a diagnostic-only in-memory fixture transform`
      : "default fixture entity set",
    additionalCluster: LOWER_COST_BASELINE
      ? "none; default home and distant clusters only"
      : "40 entities at X=1000 m (30 visible and 10 nearby), enabled by entities=160",
    rendererQuery: "renderer=software",
    initialCameraDistance: CAMERA_DISTANCE,
  },
  pageCdpSessionCreatedAfterFixtureReady: false,
  timings: {},
  lifecycleEvents: [],
  httpResponses: [],
  failedRequests: [],
  providerCalls: 0,
  generationRequests: [],
  externalRequests: [],
  unexpectedLocalRequests: [],
  failedResponses: [],
  pageErrors: [],
  consoleErrors: [],
  heap: { supported: null, samples: [] },
  cycles: [],
  screenshots: [],
  limitations: [
    "This is an Android 15 emulator run, not physical-device certification.",
    "SoftwareWorld renders through Canvas2D; this run does not measure WebGL, native GPU behavior, or physical-device graphics performance.",
    "Frame intervals are from the emulated Chrome viewport and do not establish 60 fps.",
    "SoftwareWorld has no WebGL particle-formation animation; no-replay evidence checks that project identity/revision and ready review state persist across reentry.",
    "CDP JavaScript heap values are tab-level samples and can vary with garbage collection.",
  ],
};

let emulatorProcess;
let emulatorStartedHere = false;
let server;
let serverPort;
let reversePort;
let reverseInstalled = false;
let forwardPort;
let forwardInstalled = false;
let browser;
let page;
let session;
let context;
let temporaryDirectory;
let harnessCleanupStarted = false;
await mkdir(EVIDENCE_DIRECTORY, { recursive: true });

try {
  temporaryDirectory = await mkdtemp(
    join(tmpdir(), "orbsie-android-growing-world-"),
  );
  const bundlePath = join(temporaryDirectory, "fixture.js");
  await buildFixtureBundle(bundlePath);
  const bundle = await readFile(bundlePath);

  report.currentStage = "emulator-boot";
  ({ processHandle: emulatorProcess, startedHere: emulatorStartedHere } =
    await bootEmulatorIfNeeded(report));
  report.device = deviceSummary(emulatorStartedHere);
  recordLifecycleEvent(report, "avd-ready", {
    androidApi: report.device.androidApi,
    chromeVersion: report.device.chromeVersion,
  });

  report.currentStage = "local-fixture-and-adb-bridges";
  server = createStaticServer(bundle);
  serverPort = await listen(server);
  reversePort = chooseDevicePort("reverse");
  adb("reverse", `tcp:${reversePort}`, `tcp:${serverPort}`);
  reverseInstalled = true;
  forwardPort = await availableLoopbackPort();
  adb("forward", `tcp:${forwardPort}`, "localabstract:chrome_devtools_remote");
  forwardInstalled = true;
  report.currentStage = "chrome-startup-and-cdp-connect";
  report.androidChromeCDP = await waitForChrome(forwardPort);
  recordLifecycleEvent(report, "chrome-cdp-ready", {
    browser: report.androidChromeCDP.browser,
  });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${forwardPort}`, {
    timeout: CHROME_CDP_TIMEOUT_MS,
  });
  browser.on("disconnected", () => {
    recordLifecycleEvent(report, "browser-disconnected", {
      initiatedByHarnessCleanup: harnessCleanupStarted,
    });
  });
  context = browser.contexts()[0];
  assert(context, "Android Chrome did not expose a browser context.");
  context.on("close", () =>
    recordLifecycleEvent(report, "context-closed", {
      initiatedByHarnessCleanup: harnessCleanupStarted,
    }),
  );
  page = await context.newPage();
  page.on("close", () =>
    recordLifecycleEvent(report, "page-closed", {
      initiatedByHarnessCleanup: harnessCleanupStarted,
    }),
  );
  page.on("crash", () => recordLifecycleEvent(report, "page-crashed"));
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame())
      recordLifecycleEvent(report, "main-frame-navigated", {
        urlPath: new URL(frame.url()).pathname,
      });
  });
  await page.addInitScript(pageProbeInitScript);
  report.currentStage = "fixture-navigation-and-dom-ready";
  recordLifecycleEvent(report, "page-created-and-instrumented");

  const artifactOrigin = `http://127.0.0.1:${reversePort}`;
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
    report.httpResponses.push({
      path: new URL(response.url()).pathname,
      status: response.status(),
      elapsedMs: Date.now() - RUN_STARTED_AT,
    });
    if (response.status() >= 400)
      report.failedResponses.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
  });
  page.on("requestfailed", (request) => {
    report.failedRequests.push({
      path: new URL(request.url()).pathname,
      error: request.failure()?.errorText?.slice(0, 160) ?? null,
      elapsedMs: Date.now() - RUN_STARTED_AT,
    });
  });
  page.on("pageerror", (error) =>
    report.pageErrors.push(error.message.slice(0, 300)),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      report.consoleErrors.push(message.text().slice(0, 300));
  });

  report.cookiesBefore = (await context.cookies(artifactOrigin)).length;
  assert.equal(report.cookiesBefore, 0);
  const fixtureQuery = new URLSearchParams({
    renderer: "software",
    distance: String(CAMERA_DISTANCE),
  });
  if (requestedDiagnosticEntityCount !== null) {
    fixtureQuery.set("diagnosticEntities", String(ENTITY_COUNT));
  } else if (!LOWER_COST_BASELINE) {
    fixtureQuery.set("entities", "160");
  }
  report.timings.navigationStartedElapsedMs = Date.now() - RUN_STARTED_AT;
  const response = await page.goto(`${artifactOrigin}/?${fixtureQuery}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  report.timings.domContentLoadedElapsedMs = Date.now() - RUN_STARTED_AT;
  assert.equal(
    response?.status(),
    200,
    "Local fixture server did not return HTTP 200.",
  );
  report.pageTimingAtDomContentLoaded = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const probe = window.__androidGrowingWorld;
    return {
      documentReadyState: document.readyState,
      initStartedAtMs: probe?.initStartedAt ?? null,
      lifecycle: probe?.lifecycle ?? [],
      navigation: navigation
        ? {
            responseStartMs: navigation.responseStart,
            responseEndMs: navigation.responseEnd,
            domInteractiveMs: navigation.domInteractive,
            domContentLoadedEventEndMs: navigation.domContentLoadedEventEnd,
            loadEventEndMs: navigation.loadEventEnd,
            transferSizeBytes: navigation.transferSize,
          }
        : null,
      resources: performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.startsWith(location.origin))
        .slice(0, 12)
        .map((entry) => ({
          path: new URL(entry.name).pathname,
          durationMs: entry.duration,
          responseEndMs: entry.responseEnd,
          transferSizeBytes: entry.transferSize,
        })),
    };
  });
  recordLifecycleEvent(report, "dom-content-loaded", {
    httpStatus: response?.status() ?? null,
  });
  await page
    .screenshot({
      path: join(EVIDENCE_DIRECTORY, "early-domcontentloaded.png"),
      timeout: 5_000,
    })
    .then(() => recordLifecycleEvent(report, "early-screenshot-captured"))
    .catch((error) => {
      report.earlyScreenshotError = compactError(error);
    });
  report.currentStage = "scene-readiness";
  await page.waitForFunction(() => window.formationResidencyFixture?.ready(), {
    timeout: 60_000,
  });
  report.timings.fixtureReadyElapsedMs = Date.now() - RUN_STARTED_AT;
  recordLifecycleEvent(report, "fixture-ready");
  report.currentStage = "post-readiness-performance-cdp-session";
  session = await context.newCDPSession(page);
  report.pageCdpSessionCreatedAfterFixtureReady = true;
  report.timings.pageCdpSessionCreatedElapsedMs = Date.now() - RUN_STARTED_AT;
  recordLifecycleEvent(report, "page-cdp-session-created-after-fixture-ready");
  try {
    await session.send("Performance.enable");
    report.heap.performanceDomainEnabled = true;
  } catch (error) {
    report.heap.supported = false;
    report.heap.error = compactError(error);
    report.heap.performanceDomainEnabled = false;
  }
  report.timings.performanceDomainEnabledElapsedMs =
    Date.now() - RUN_STARTED_AT;
  report.currentStage = READINESS_ONLY
    ? "software-scene-readiness-sample"
    : "four-cycle-travel-probe";
  await page
    .locator(".software-world")
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 20_000 });

  report.browser = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight },
    devicePixelRatio,
    maxTouchPoints: navigator.maxTouchPoints,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGiB: navigator.deviceMemory ?? null,
    renderer:
      window.__androidGrowingWorld.webglContextAttempts === 0
        ? "direct SoftwareWorld Canvas2D; zero WebGL context attempts"
        : "unexpected WebGL attempt",
    fixtureNavigation: window.formationResidencyFixture.navigation(),
  }));
  assert(
    report.browser.maxTouchPoints > 0,
    "Android Chrome did not expose touch input.",
  );
  assert.equal(
    report.browser.renderer,
    "direct SoftwareWorld Canvas2D; zero WebGL context attempts",
  );
  assert.equal(report.browser.fixtureNavigation.distance, CAMERA_DISTANCE);
  report.renderer = report.browser.renderer;
  report.viewport = report.browser.viewport;

  await page.evaluate((selectedId) => {
    window.formationResidencyFixture.select(selectedId);
    window.formationResidencyFixture.resetPaint();
  }, SELECTED_ID);
  const initial = await waitForSoftwareState(page, HOME_X);
  assertSoftwareSample(initial, HOME_X);
  report.initial = summarizeSoftwareSample(initial);
  report.projectIdentity = {
    id: initial.review.projectId,
    revision: initial.review.revision,
    renderedRevision: initial.review.renderedRevision,
  };
  report.timings.initialSoftwareStateReadyElapsedMs =
    Date.now() - RUN_STARTED_AT;
  if (READINESS_ONLY) {
    await page
      .screenshot({
        path: join(EVIDENCE_DIRECTORY, "ready-scene.png"),
        timeout: 10_000,
      })
      .then(() => {
        report.readyScreenshotCaptured = true;
        recordLifecycleEvent(report, "ready-scene-screenshot-captured");
      })
      .catch((error) => {
        report.readyScreenshotError = compactError(error);
      });
    report.timings.readyScreenshotElapsedMs = Date.now() - RUN_STARTED_AT;
  } else {
    const heapStart = await readHeapMetrics(session, report);
    if (heapStart)
      report.heap.samples.push({ phase: "initial-home", ...heapStart });
    await page.screenshot({
      path: join(EVIDENCE_DIRECTORY, "initial-home.png"),
    });

    await page.evaluate(() => window.__androidGrowingWorldFrameProbe.start());
    for (let cycle = 1; cycle <= CYCLE_COUNT; cycle++) {
      const homeBefore = await waitForSoftwareState(page, HOME_X);
      assertSoftwareSample(homeBefore, HOME_X);
      const outboundPlan = await page.evaluate(
        (target) => window.formationResidencyFixture.panPlanTo(target),
        DISTANT_X,
      );
      await page.evaluate(() => window.formationResidencyFixture.resetPaint());
      await touchSwipe(page, session, outboundPlan);
      const distant = await waitForSoftwareState(page, DISTANT_X);
      assertSoftwareSample(distant, DISTANT_X);
      const distantHeap = await readHeapMetrics(session, report);

      const returnPlan = await page.evaluate(
        (target) => window.formationResidencyFixture.panPlanTo(target),
        HOME_X,
      );
      await page.evaluate(() => window.formationResidencyFixture.resetPaint());
      await touchSwipe(page, session, returnPlan);
      const homeReentry = await waitForSoftwareState(page, HOME_X);
      assertSoftwareSample(homeReentry, HOME_X);
      const sameProject =
        homeReentry.review.projectId === report.projectIdentity.id;
      const sameRevision =
        homeReentry.review.revision === report.projectIdentity.revision;
      const noReplay =
        homeReentry.fixtureReady &&
        homeReentry.review.transitionSettled &&
        homeReentry.review.renderedRevision ===
          report.projectIdentity.revision &&
        sameProject &&
        sameRevision;
      assert(
        noReplay,
        `SoftwareWorld reentry did not preserve its ready project state (cycle ${cycle}).`,
      );
      const homeHeap = await readHeapMetrics(session, report);
      const cycleReport = {
        cycle,
        outboundTouch: {
          fromX: Number(homeBefore.navigation.target[0].toFixed(2)),
          toX: DISTANT_X,
          expectedTargetX: Number(
            outboundPlan.expectedNavigation.target[0].toFixed(2),
          ),
          start: outboundPlan.start,
          end: outboundPlan.end,
        },
        distant: summarizeSoftwareSample(distant),
        distantHeapBytes: distantHeap?.jsHeapUsedBytes ?? null,
        returnTouch: {
          fromX: Number(distant.navigation.target[0].toFixed(2)),
          toX: HOME_X,
          expectedTargetX: Number(
            returnPlan.expectedNavigation.target[0].toFixed(2),
          ),
          start: returnPlan.start,
          end: returnPlan.end,
        },
        homeReentry: summarizeSoftwareSample(homeReentry),
        homeHeapBytes: homeHeap?.jsHeapUsedBytes ?? null,
        sameProject,
        sameRevision,
        noReplayObserved: noReplay,
      };
      report.cycles.push(cycleReport);
      if (distantHeap)
        report.heap.samples.push({ cycle, phase: "distant", ...distantHeap });
      if (homeHeap)
        report.heap.samples.push({ cycle, phase: "home-reentry", ...homeHeap });
      if (cycle === 1)
        await page.screenshot({
          path: join(EVIDENCE_DIRECTORY, "first-distant-touch.png"),
        });
      if (cycle === CYCLE_COUNT)
        await page.screenshot({
          path: join(EVIDENCE_DIRECTORY, "final-home-reentry.png"),
        });
    }
    evaluateHeapGrowth(report);
    const intervals = await page.evaluate(() =>
      window.__androidGrowingWorldFrameProbe.stop(),
    );
    report.frameIntervals = {
      unit: "milliseconds between requestAnimationFrame callbacks",
      sampleCount: intervals.length,
      p50: percentile(intervals, 0.5),
      p95: percentile(intervals, 0.95),
      p99: percentile(intervals, 0.99),
      max: intervals.length ? Math.max(...intervals) : null,
    };
    assert.equal(report.cycles.length, CYCLE_COUNT);
    assert.ok(
      intervals.length > 20,
      "Android rAF probe did not collect enough frames.",
    );
    assert.equal(
      await page.evaluate(
        () => window.__androidGrowingWorld.webglContextAttempts,
      ),
      0,
      "WebGL was unexpectedly requested by this direct SoftwareWorld fixture.",
    );
  }
  report.cookiesAfter = (await context.cookies(artifactOrigin)).length;
  assert.equal(report.cookiesAfter, 0);
  assert.deepEqual(report.generationRequests, []);
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.unexpectedLocalRequests, []);
  assert.deepEqual(report.failedResponses, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  report.checks = READINESS_ONLY
    ? {
        sceneReadyAtRequestedDistance: true,
        readySceneScreenshotCaptured: report.readyScreenshotCaptured === true,
        travelCyclesAttempted: 0,
        noProviderOrExternalRequests: true,
        noPageOrConsoleErrors: true,
      }
    : {
        androidTouchInputAvailable: true,
        softwareRendererReviewReady: true,
        allTravelAndReentryCyclesReady: true,
        selectedDistantEntityRemainedResident: true,
        noSoftwareSceneRevisionReplayObserved: true,
        noProviderOrExternalRequests: true,
        noPageOrConsoleErrors: true,
      };
  recordLifecycleEvent(report, "android-process-diagnostics-started");
  collectAndroidProcessDiagnostic(report);
  recordLifecycleEvent(report, "android-process-diagnostics-finished", {
    matchedLogcatLines:
      report.androidProcessDiagnostic?.logcat?.matchedLineCount ?? null,
  });
  report.status = "passed";
  if (READINESS_ONLY) {
    report.comparisonAssessment = requestedDiagnosticEntityCount
      ? `The ${ENTITY_COUNT}-entity diagnostic fixture reached scene readiness at ${CAMERA_DISTANCE} m. It used a diagnostic-only fixture transform and did not exercise the 120- or 160-entity acceptance scene; no travel cycles were run.`
      : "With the same 120-entity, 100 m fixture settings, this run reached ready after creating the page CDP session and enabling Performance only afterward; the prior run with pre-navigation CDP setup closed before ready. This favors pre-navigation page CDP instrumentation as a possible contributor, but one run does not prove causality. The 1200 m route still needs multiple swipes or a bounded zoom-out/travel/zoom-in sequence; no travel cycles were run here.";
  }
  report.currentStage = "complete";
} catch (error) {
  report.status = "failed";
  report.failureStage = report.currentStage;
  report.error = compactError(error, 1000);
  report.timings.failureElapsedMs = Date.now() - RUN_STARTED_AT;
  recordLifecycleEvent(report, "probe-failed", { error: report.error });
  report.limitations.push(
    "The diagnostic run failed before completion; see lifecycle, timing, process-state, and filtered logcat records for evidence and any remaining uncertainty.",
  );
  if (page && !page.isClosed()) {
    report.failurePageSnapshot = await page
      .evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        return {
          documentReadyState: document.readyState,
          title: document.title.slice(0, 120),
          fixtureGlobalAvailable: Boolean(window.formationResidencyFixture),
          fixtureReady: Boolean(window.formationResidencyFixture?.ready?.()),
          webglContextAttempts:
            window.__androidGrowingWorld?.webglContextAttempts ?? null,
          navigation: navigation
            ? {
                responseEndMs: navigation.responseEnd,
                domContentLoadedEventEndMs: navigation.domContentLoadedEventEnd,
                loadEventEndMs: navigation.loadEventEnd,
              }
            : null,
          resources: performance
            .getEntriesByType("resource")
            .filter((entry) => entry.name.startsWith(location.origin))
            .slice(0, 12)
            .map((entry) => ({
              path: new URL(entry.name).pathname,
              durationMs: entry.duration,
              responseEndMs: entry.responseEnd,
            })),
        };
      })
      .catch((snapshotError) => ({
        unavailable: compactError(snapshotError),
      }));
    await page
      .screenshot({
        path: join(EVIDENCE_DIRECTORY, "failure.png"),
        timeout: 5_000,
      })
      .catch((screenshotError) => {
        report.failureScreenshotError = compactError(screenshotError);
      });
  } else {
    report.failurePageSnapshot = {
      unavailable: "page target was already closed",
    };
  }
  recordLifecycleEvent(report, "android-failure-diagnostics-started", {
    failureStage: report.failureStage,
  });
  collectAndroidProcessDiagnostic(report);
  if (READINESS_ONLY) {
    const rendererDeathLine =
      report.androidProcessDiagnostic?.logcat?.lines?.find((line) =>
        /sandboxed_process|SandboxedProcessService|renderer.*died/i.test(line),
      ) ?? null;
    report.comparisonAssessment = !report.pageCdpSessionCreatedAfterFixtureReady
      ? `The ${ENTITY_COUNT}-entity page target closed before fixture.ready(); this run never created the page CDP session or enabled Performance. ${rendererDeathLine ? "Filtered logcat identifies a Chrome sandboxed Chromium child process death, but does not establish why it exited." : "Filtered logs do not identify the failure cause; the emulator/Chrome environment and fixture remain possible contributors."}`
      : rendererDeathLine
        ? `The ${ENTITY_COUNT}-entity fixture lost its page after ready while a Chrome sandboxed Chromium child process died; this run does not identify why the process exited.`
        : `The ${ENTITY_COUNT}-entity fixture lost its page after ready; filtered logs do not identify the failure cause.`;
  } else if (LOWER_COST_BASELINE) {
    const lowMemoryLine =
      report.androidProcessDiagnostic?.logcat?.lines?.some((line) =>
        /low.?memory|lmkd/i.test(line),
      ) ?? false;
    report.comparisonAssessment =
      "The 120-entity default fixture also lost its page target, weakening attribution to the added 40-entity cluster. This run retained the 5000 m distance, so it does not isolate that distance as a cause. " +
      (lowMemoryLine
        ? "A filtered low-memory warning references an unidentified PID but does not identify it as Chrome; renderer/OOM causation remains unproven."
        : "Filtered logcat did not confirm a Chrome-attributed renderer, low-memory, or ANR cause.");
  }
  recordLifecycleEvent(report, "android-failure-diagnostics-finished", {
    matchedLogcatLines:
      report.androidProcessDiagnostic?.logcat?.matchedLineCount ?? null,
  });
  process.exitCode = 1;
} finally {
  harnessCleanupStarted = true;
  recordLifecycleEvent(report, "harness-cleanup-started");
  const cleanup = {};
  if (session) {
    const detached = await session.detach().then(
      () => true,
      () => false,
    );
    report.cdpSessionDetachAcknowledged = detached;
    cleanup.cdpSessionDetached =
      detached || Boolean(browser && !browser.isConnected());
  } else cleanup.cdpSessionDetached = true;
  await page?.close().then(
    () => (cleanup.browserTabClosed = true),
    () => (cleanup.browserTabClosed = false),
  );
  if (!page) cleanup.browserTabClosed = true;
  await browser?.close().catch(() => undefined);
  cleanup.cdpConnectionClosed = !browser || !browser.isConnected();
  if (session && cleanup.cdpConnectionClosed) cleanup.cdpSessionDetached = true;

  if (forwardInstalled) {
    try {
      adb("forward", "--remove", `tcp:${forwardPort}`);
      cleanup.cdpForwardRemoved = true;
    } catch {
      cleanup.cdpForwardRemoved = false;
    }
  } else cleanup.cdpForwardRemoved = true;
  if (reverseInstalled) {
    try {
      adb("reverse", "--remove", `tcp:${reversePort}`);
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
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true }).then(
      () => (cleanup.temporaryFilesRemoved = true),
      () => (cleanup.temporaryFilesRemoved = false),
    );
  } else cleanup.temporaryFilesRemoved = true;

  if (emulatorStartedHere) {
    try {
      const liveState = listDevices().get(DEVICE);
      const liveAvd =
        liveState === "device"
          ? adb("shell", "getprop", "ro.boot.qemu.avd_name")
          : "";
      if (liveAvd === AVD) adb("emu", "kill");
    } catch {
      // The AVD may already have stopped after a failed boot.
    }
    try {
      if (emulatorProcess && emulatorProcess.exitCode === null) {
        await Promise.race([
          new Promise((resolve) => emulatorProcess.once("exit", resolve)),
          wait(10_000),
        ]);
        if (emulatorProcess.exitCode === null) {
          try {
            process.kill(-emulatorProcess.pid, "SIGTERM");
          } catch {
            // It may have exited between the check and signal.
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
  report.screenshots = (await readdir(EVIDENCE_DIRECTORY)).filter((name) =>
    name.endsWith(".png"),
  );
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await writeFile(
    join(EVIDENCE_DIRECTORY, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    join(EVIDENCE_DIRECTORY, "README.md"),
    `# Android growing world runtime probe\n\n` +
      `Result: **${report.status}**. ${report.scope}.\n\n` +
      `Mode: ${report.fixture.mode}. Device: ${report.device?.avd ?? AVD}, Android ${report.device?.androidRelease ?? "not reached"} (API ${report.device?.androidApi ?? "unknown"}), Chrome ${report.device?.chromeVersion ?? "not reached"}. Renderer requested: direct SoftwareWorld Canvas2D. Provider calls: 0; external requests: ${report.externalRequests.length}.\n\n` +
      `${report.comparisonAssessment ? `${report.comparisonAssessment}\n\n` : ""}` +
      `${READINESS_ONLY ? "This is a scene-readiness-only run; it performs no travel gesture and records no rAF or heap result. The page CDP session and Performance domain are created only after fixture.ready(). " : "The JSON includes page/browser lifecycle times, local response timing, travel readiness, rAF percentiles and CDP heap metrics when reached. "}` +
      `The JSON also includes early/failure screenshots when captured, and only filtered/redacted Chrome renderer, low-memory, or ANR logcat lines plus Chrome process state. This emulator run does not establish physical-device behavior, native GPU performance, visual quality or 60 fps. Screenshots captured: ${report.screenshots.length ? report.screenshots.join(", ") : "none"}. See [report.json](./report.json).\n`,
  );
  console.log(
    JSON.stringify({
      status: report.status,
      mode: report.fixture.mode,
      device: report.device?.avd ?? AVD,
      cycles: report.cycles.length,
      failureStage: report.failureStage ?? null,
      renderer: report.renderer ?? "not reached",
      frameIntervals: report.frameIntervals ?? null,
      heapSupported: report.heap.supported,
      cleanup: report.cleanup,
      evidenceDirectory: EVIDENCE_DIRECTORY,
      ...(report.error ? { error: report.error } : {}),
    }),
  );
}
