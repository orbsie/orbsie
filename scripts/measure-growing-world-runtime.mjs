import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, platform, release, totalmem, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDirectory = join(
  repoRoot,
  "docs/evidence/growing-world-runtime",
  `160-entity-swiftshader-${runId}`,
);
const temporaryDirectory = await import("node:fs/promises").then(
  ({ mkdtemp }) => mkdtemp(join(tmpdir(), "orbsie-growing-world-")),
);
const cycleCount = 6;
const entityCount = 160;
const residentCap = 48;
const selectedId = "outer-visible-00";
const homeX = -600;
const outerX = 1000;
const resourceTolerance = { geometries: 8, textures: 2, programs: 2 };
const report = {
  passed: false,
  runId,
  scope:
    "160 ready entities; six repeated outer-cluster travel and home reentry cycles",
  entities: entityCount,
  residentCap,
  cycleCount,
  selectedId,
  warmup: {},
  cycles: [],
  providerCalls: 0,
  externalRequests: [],
  pageErrors: [],
  consoleErrors: [],
  limitations: [
    "WebGL measurements use Chromium SwiftShader in a headless browser; they do not represent native GPU performance.",
    "Frame intervals describe this container and software renderer, not a 60 fps or physical-device guarantee.",
    "Browser JS heap values are CDP Performance metrics for this tab and may vary with garbage collection.",
    "The software path is a browser canvas fixture, not a physical mobile device.",
  ],
  assumptions: [
    "The opt-in fixture appends 40 outer-cluster entities (30 visible and 10 nearby) to the unchanged 120-entity default scene.",
    "One warm traversal forms both home and outer residents before the six measured return checks.",
    "Settled WebGL resource growth tolerance over the warm home baseline is +8 geometries, +2 textures, and +2 programs.",
  ],
};

let server;
let browser;
let cdp;
const contexts = [];
const pages = [];

function trackPage(page) {
  pages.push(page);
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      report.consoleErrors.push(message.text().slice(0, 500));
  });
  return page;
}

async function browserContext(origin, options) {
  const context = await browser.newContext(options);
  contexts.push(context);
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    report.externalRequests.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  return context;
}

async function panWithMouse(page, plan) {
  await page.mouse.move(plan.start.x, plan.start.y);
  await page.mouse.down();
  await page.mouse.move(plan.end.x, plan.end.y, { steps: 5 });
  await page.mouse.up();
}

async function travelTo(page, targetX) {
  await page.getByRole("button", { name: "Frame content" }).click();
  const frame = await page.evaluate(() =>
    window.formationResidencyFixture.afterFrameContent(),
  );
  const plan = await page.evaluate(
    (target) => window.formationResidencyFixture.panPlanTo(target),
    targetX,
  );
  await panWithMouse(page, plan);
  const zoomSteps = await page.evaluate(() =>
    window.formationResidencyFixture.zoomInSteps(100),
  );
  const zoomButton = page.locator('button[aria-label^="Zoom in"]');
  for (let index = 0; index < zoomSteps; index++) await zoomButton.click();
  return { targetX, frameDistance: frame.distance, zoomSteps };
}

async function waitForFullResidents(page) {
  await page.waitForFunction(
    () =>
      window.formationResidencyFixture.renderer()?.fullFormationCount === 48,
    { timeout: 30000 },
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve)),
  );
  return page.evaluate(() => window.formationResidencyFixture.renderer());
}

async function waitForCompletedFormations(page) {
  try {
    await page.waitForFunction(
      () => {
        const sample = window.formationResidencyFixture.renderer();
        return (
          sample?.fullFormationCount === 48 &&
          sample.visibleFormationMeshCount === 48 &&
          sample.activeParticleTransitionCount === 0
        );
      },
      { timeout: 10000 },
    );
  } catch (error) {
    const sample = await page
      .evaluate(() => window.formationResidencyFixture.renderer())
      .catch(() => null);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; last WebGL state: ${JSON.stringify(sample)}`,
    );
  }
  return page.evaluate(() => window.formationResidencyFixture.renderer());
}

function summarizeWebGL(sample, selector) {
  return {
    projectEntityCount: sample.projectEntityCount,
    fullFormationCount: sample.fullFormationCount,
    proxyGroupCount: sample.proxyGroupCount,
    formationMeshCount: sample.formationMeshCount,
    visibleFormationMeshCount: sample.visibleFormationMeshCount,
    particleMeshCount: sample.particleMeshCount,
    activeParticleTransitionCount: sample.activeParticleTransitionCount,
    selectedId: sample.selectedId,
    selectedFullRingCount: sample.selectedFullRingCount,
    selectedIsFull: sample.selectedFullIds.includes(selectedId),
    resources: sample.resources,
    selector: {
      readyCount: selector.readyCount,
      residentCount: selector.residentCount,
      placeholderCount: selector.webglPlaceholderIds.length,
      selectedReason: selector.selectedReason,
      visibleMainCount: selector.visibleMainCount,
    },
  };
}

function assertSelector(selector, targetX) {
  assert.equal(selector.readyCount, entityCount);
  assert.equal(selector.residentCount, residentCap);
  assert.equal(selector.selectedReason, "resident-selected");
  assert.ok(selector.webglResidentIds.includes(selectedId));
  assert.ok(selector.softwareResidentIds.includes(selectedId));
  assert.ok(selector.visibleMainCount >= (targetX === outerX ? 30 : 48));
}

function assertWebGLState(sample, selector, { expectNoReplay = true } = {}) {
  assert.equal(sample.available, true);
  assert.equal(sample.projectEntityCount, entityCount);
  assert.equal(sample.fullFormationCount, residentCap);
  assert.equal(sample.proxyGroupCount, entityCount - residentCap);
  assert.equal(sample.formationMeshCount, residentCap);
  assert.equal(sample.visibleFormationMeshCount, residentCap);
  assert.equal(sample.selectedId, selectedId);
  assert.equal(sample.selectedFullRingCount, 1);
  assert.ok(sample.selectedFullIds.includes(selectedId));
  assertSelector(selector, selector.targetX);
  if (expectNoReplay) assert.equal(sample.activeParticleTransitionCount, 0);
}

function summarizeSoftware(review, selector, paint, targetX) {
  return {
    targetX,
    review: {
      fixtureReady: review?.fixtureReady,
      mounted: review?.mounted,
      transitionSettled: review?.transitionSettled,
      renderedRevision: review?.renderedRevision,
      errors: review?.errors,
    },
    paint: {
      frames: paint.frames,
      proxyArcCount: paint.proxyArcCount,
    },
    selector: {
      readyCount: selector.readyCount,
      residentCount: selector.residentCount,
      placeholderCount: selector.softwareProxyIds.length,
      selectedReason: selector.selectedReason,
      selectedIsResident: selector.softwareResidentIds.includes(selectedId),
      visibleMainCount: selector.visibleMainCount,
    },
  };
}

function assertSoftwareReady(review, selector, paint, targetX) {
  assert.equal(review?.fixtureReady, true);
  assert.equal(review?.mounted, true);
  assert.equal(review?.transitionSettled, true);
  assert.equal(review?.renderedRevision, 0);
  assert.deepEqual(review?.errors, []);
  assert.ok(paint.frames > 0);
  assertSelector(selector, targetX);
}

async function waitForSoftwareReview(page, targetX) {
  let consecutiveReadyFrames = 0;
  let lastSample;
  for (let attempt = 0; attempt < 120; attempt++) {
    lastSample = await page.evaluate(async (target) => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const fixture = window.formationResidencyFixture;
      const review = fixture.renderer();
      return {
        review: { ...review, fixtureReady: fixture.ready() },
        paint: fixture.paint(),
        navigation: fixture.navigation(),
        selector: fixture.expectedAt(target, "outer-visible-00"),
      };
    }, targetX);
    const ready =
      lastSample.review.fixtureReady &&
      lastSample.review.mounted &&
      lastSample.review.transitionSettled &&
      lastSample.review.renderedRevision === 0 &&
      lastSample.paint.frames > 0 &&
      Math.abs(lastSample.navigation.target[0] - targetX) < 0.1;
    consecutiveReadyFrames = ready ? consecutiveReadyFrames + 1 : 0;
    if (consecutiveReadyFrames >= 2) return lastSample;
  }
  throw new Error(
    `SoftwareWorld review did not stay ready at ${targetX}; last sample: ${JSON.stringify(lastSample)}`,
  );
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

function frameProbeScript() {
  return `(() => {
    const probe = { running: false, last: null, intervals: [] };
    const tick = (time) => {
      if (!probe.running) return;
      if (probe.last !== null) probe.intervals.push(time - probe.last);
      probe.last = time;
      requestAnimationFrame(tick);
    };
    window.__growingWorldFrameProbe = {
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
  })();`;
}

async function readCDPMetrics() {
  if (!cdp) return null;
  try {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const values = Object.fromEntries(
      metrics.map(({ name, value }) => [name, value]),
    );
    return {
      jsHeapUsedBytes: values.JSHeapUsedSize ?? null,
      jsHeapTotalBytes: values.JSHeapTotalSize ?? null,
      taskDurationSeconds: values.TaskDuration ?? null,
    };
  } catch (error) {
    report.webgl.heap.supported = false;
    report.webgl.heap.error =
      error instanceof Error ? error.message : String(error);
    return null;
  }
}

async function verifyHeapSupport() {
  report.webgl.heap = { supported: false, samples: [] };
  try {
    cdp = await contexts[0].newCDPSession(pages[0]);
    await cdp.send("Performance.enable");
    const sample = await readCDPMetrics();
    report.webgl.heap.supported = Boolean(
      sample && sample.jsHeapUsedBytes !== null,
    );
    if (sample)
      report.webgl.heap.samples.push({ phase: "warm-baseline", ...sample });
  } catch (error) {
    report.webgl.heap.error =
      error instanceof Error ? error.message : String(error);
  }
}

function assertResourceBound(samples, baseline) {
  const maximum = Object.fromEntries(
    Object.keys(resourceTolerance).map((name) => [
      name,
      Math.max(...samples.map((sample) => sample.resources[name])),
    ]),
  );
  const growth = Object.fromEntries(
    Object.keys(resourceTolerance).map((name) => [
      name,
      maximum[name] - baseline[name],
    ]),
  );
  for (const [name, tolerance] of Object.entries(resourceTolerance))
    assert.ok(
      growth[name] <= tolerance,
      `WebGL ${name} grew ${growth[name]} beyond the warm baseline (tolerance ${tolerance}).`,
    );
  return {
    baseline,
    maximum,
    maximumGrowth: growth,
    tolerance: resourceTolerance,
  };
}

try {
  await mkdir(evidenceDirectory, { recursive: true });
  const fixtureBundle = join(temporaryDirectory, "fixture.js");
  await build({
    entryPoints: [
      join(repoRoot, "scripts/formation-residency-browser-fixture.tsx"),
    ],
    bundle: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    outfile: fixtureBundle,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const bundle = await readFile(fixtureBundle);
  server = createServer((request, response) => {
    if (request.url?.startsWith("/fixture.js")) {
      response.setHeader("Content-Type", "text/javascript");
      response.end(bundle);
    } else if (request.url?.startsWith("/")) {
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Growing world runtime probe</title>
<style>
html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#07100f}
canvas{display:block;width:100%;height:100%}
.world-navigation-controls{position:fixed;z-index:5;left:12px;top:12px;display:flex;gap:4px}
.software-fixture,.software-world{position:relative;width:100%;height:100%}
.software-world-status{display:none}
</style></head><body><div id="root"></div><script>${frameProbeScript()}</script><script type="module" src="/fixture.js"></script></body></html>`);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });

  const webglContext = await browserContext(origin, {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const webglPage = trackPage(await webglContext.newPage());
  await webglPage.goto(`${origin}/?renderer=webgl&entities=160`, {
    waitUntil: "domcontentloaded",
  });
  await webglPage.waitForFunction(
    () =>
      ["webgl", "software", "software-fallback"].includes(
        window.__formationResidencyRenderer,
      ),
    { timeout: 60000 },
  );
  report.runtime = {
    browser: { name: "Chromium", version: browser.version() },
    node: process.version,
    platform: `${platform()} ${release()}`,
    architecture: process.arch,
    hardware: {
      cpuModel: cpus()[0]?.model ?? "unavailable",
      logicalCpuCount: cpus().length,
      hostVisibleMemoryGiB: Number((totalmem() / 1024 ** 3).toFixed(2)),
    },
    browserPage: await webglPage.evaluate(() => ({
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: navigator.deviceMemory ?? null,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      renderer: window.__formationResidencyRenderer,
    })),
  };
  report.webgl = {
    renderer: report.runtime.browserPage.renderer,
    cycles: [],
    heap: { supported: false, samples: [] },
  };
  assert.equal(
    report.webgl.renderer,
    "webgl",
    "The shared WebGL World did not initialize.",
  );
  await webglPage.waitForFunction(
    () => window.formationResidencyFixture?.ready(),
    { timeout: 90000 },
  );
  await webglPage.evaluate(() =>
    window.formationResidencyFixture.select("outer-visible-00"),
  );

  const warmOuter = await travelTo(webglPage, outerX);
  const firstOuter = await waitForCompletedFormations(webglPage);
  const warmOuterSelector = await webglPage.evaluate(
    (target) =>
      window.formationResidencyFixture.expectedAt(target, "outer-visible-00"),
    outerX,
  );
  assertWebGLState(
    firstOuter,
    { ...warmOuterSelector, targetX: outerX },
    { expectNoReplay: false },
  );
  const warmHome = await travelTo(webglPage, homeX);
  const firstHome = await waitForCompletedFormations(webglPage);
  const warmHomeSelector = await webglPage.evaluate(
    (target) =>
      window.formationResidencyFixture.expectedAt(target, "outer-visible-00"),
    homeX,
  );
  assertWebGLState(firstHome, { ...warmHomeSelector, targetX: homeX });
  report.webgl.rendererDetails = {
    contextVersion: firstHome.contextVersion,
    debugRenderer: firstHome.debugRenderer,
  };
  report.warmup = {
    outer: {
      travel: warmOuter,
      renderer: summarizeWebGL(firstOuter, {
        ...warmOuterSelector,
        targetX: outerX,
      }),
    },
    home: {
      travel: warmHome,
      renderer: summarizeWebGL(firstHome, {
        ...warmHomeSelector,
        targetX: homeX,
      }),
    },
    explanation:
      "The outer cluster was visited once so its first formation completes before any measured return-to-home no-replay assertion.",
  };
  await webglPage.screenshot({
    path: join(evidenceDirectory, "webgl-warm-home.png"),
    animations: "disabled",
  });

  const baselineResources = firstHome.resources;
  await verifyHeapSupport();
  await webglPage.evaluate(() => window.__growingWorldFrameProbe.start());
  for (let cycle = 1; cycle <= cycleCount; cycle++) {
    const outboundTravel = await travelTo(webglPage, outerX);
    const outbound = await waitForCompletedFormations(webglPage);
    const outboundSelector = await webglPage.evaluate(
      (target) =>
        window.formationResidencyFixture.expectedAt(target, "outer-visible-00"),
      outerX,
    );
    assertWebGLState(outbound, { ...outboundSelector, targetX: outerX });
    const outboundHeap = await readCDPMetrics();

    const returnTravel = await travelTo(webglPage, homeX);
    const returned = await waitForFullResidents(webglPage);
    const returnSelector = await webglPage.evaluate(
      (target) =>
        window.formationResidencyFixture.expectedAt(target, "outer-visible-00"),
      homeX,
    );
    assertWebGLState(returned, { ...returnSelector, targetX: homeX });
    const returnHeap = await readCDPMetrics();
    const cycleResult = {
      cycle,
      outboundTravel,
      outer: summarizeWebGL(outbound, { ...outboundSelector, targetX: outerX }),
      outerHeap: outboundHeap?.jsHeapUsedBytes ?? null,
      returnTravel,
      homeReentry: summarizeWebGL(returned, {
        ...returnSelector,
        targetX: homeX,
      }),
      homeHeap: returnHeap?.jsHeapUsedBytes ?? null,
      noFormationReplayOnReturn: returned.activeParticleTransitionCount === 0,
    };
    report.cycles.push(cycleResult);
    report.webgl.cycles.push({
      cycle,
      outerResources: outbound.resources,
      homeResources: returned.resources,
    });
    for (const [phase, sample] of [
      ["outer", outboundHeap],
      ["home", returnHeap],
    ])
      if (sample) report.webgl.heap.samples.push({ cycle, phase, ...sample });
    if (cycle === cycleCount)
      await webglPage.screenshot({
        path: join(evidenceDirectory, "webgl-final-home-reentry.png"),
        animations: "disabled",
      });
  }
  const frameIntervals = await webglPage.evaluate(() =>
    window.__growingWorldFrameProbe.stop(),
  );
  report.webgl.frameIntervals = {
    unit: "milliseconds between requestAnimationFrame callbacks",
    sampleCount: frameIntervals.length,
    p50: percentile(frameIntervals, 0.5),
    p95: percentile(frameIntervals, 0.95),
    p99: percentile(frameIntervals, 0.99),
    max: frameIntervals.length ? Math.max(...frameIntervals) : null,
  };
  const allResourceSamples = [
    ...report.cycles.flatMap((cycle) => [cycle.outer, cycle.homeReentry]),
  ];
  report.webgl.resourceStability = assertResourceBound(
    allResourceSamples,
    baselineResources,
  );
  report.webgl.warmBaselineResources = baselineResources;
  assert.equal(report.cycles.length, cycleCount);
  assert.ok(report.cycles.every((cycle) => cycle.noFormationReplayOnReturn));
  assert.ok(report.webgl.frameIntervals.sampleCount > 100);

  const softwareContext = await browserContext(origin, {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const softwarePage = trackPage(await softwareContext.newPage());
  await softwarePage.goto(`${origin}/?renderer=software&entities=160`, {
    waitUntil: "domcontentloaded",
  });
  await softwarePage.waitForFunction(
    () => window.formationResidencyFixture?.ready(),
    { timeout: 90000 },
  );
  await softwarePage.evaluate(() =>
    window.formationResidencyFixture.resetPaint(),
  );
  await softwarePage.evaluate(
    ({ target, id }) => {
      window.formationResidencyFixture.select(id);
      window.formationResidencyFixture.focus(target);
    },
    { target: outerX, id: selectedId },
  );
  const softwareOuter = await waitForSoftwareReview(softwarePage, outerX);
  report.software = {
    renderer: "direct SoftwareWorld canvas path",
    entityCount: entityCount,
    outer: summarizeSoftware(
      softwareOuter.review,
      softwareOuter.selector,
      softwareOuter.paint,
      outerX,
    ),
  };
  assertSoftwareReady(
    softwareOuter.review,
    softwareOuter.selector,
    softwareOuter.paint,
    outerX,
  );
  await softwarePage.screenshot({
    path: join(evidenceDirectory, "software-outer-review-ready.png"),
    animations: "disabled",
  });

  await softwarePage.evaluate((target) => {
    window.formationResidencyFixture.resetPaint();
    window.formationResidencyFixture.focus(target);
  }, homeX);
  const softwareHome = await waitForSoftwareReview(softwarePage, homeX);
  report.software.homeReentry = summarizeSoftware(
    softwareHome.review,
    softwareHome.selector,
    softwareHome.paint,
    homeX,
  );
  assertSoftwareReady(
    softwareHome.review,
    softwareHome.selector,
    softwareHome.paint,
    homeX,
  );

  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.stack = error instanceof Error ? error.stack : undefined;
  process.exitCode = 1;
} finally {
  for (const context of contexts.reverse())
    await context.close().catch(() => {});
  await cdp?.detach().catch(() => {});
  await browser?.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temporaryDirectory, { recursive: true, force: true });
  report.evidenceDirectory = evidenceDirectory.replace(`${repoRoot}/`, "");
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    join(evidenceDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    join(evidenceDirectory, "README.md"),
    `# Growing world runtime probe\n\n` +
      `Result: **${report.passed ? "passed" : "incomplete/failed"}**. This no-model-call fixture appended 40 entities to the existing 120-entity scene, then measured six outer-cluster travel and home reentry cycles in the shared WebGL World and checked the direct software canvas path.\n\n` +
      `Provider calls: 0. External requests: ${report.externalRequests.length}. Ready entities: ${report.entities}. Full formation cap: ${report.residentCap}.\n\n` +
      `The report records SwiftShader renderer identity, settled WebGL geometry/texture/program counts, requestAnimationFrame p50/p95/p99, and CDP JS heap metrics when available. SwiftShader and browser viewport measurements do not establish native GPU speed, 60 fps, physical mobile performance, or device behavior. See [report.json](./report.json) and the retained PNG captures.\n`,
  );
  console.log(
    JSON.stringify({
      passed: report.passed,
      evidence: report.evidenceDirectory,
      cycles: report.cycles.length,
      renderer: report.webgl?.renderer,
      frameIntervals: report.webgl?.frameIntervals ?? null,
      resourceStability: report.webgl?.resourceStability ?? null,
      heapSupported: report.webgl?.heap?.supported ?? false,
      softwareReady:
        report.software?.homeReentry?.review?.transitionSettled ?? false,
      externalRequests: report.externalRequests.length,
      pageErrors: report.pageErrors.length,
      ...(report.error ? { error: report.error } : {}),
    }),
  );
}
