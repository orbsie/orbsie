import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const evidenceDirectory = "docs/evidence/formation-residency-browser";
const temporaryDirectory = await import("node:fs/promises").then(
  ({ mkdtemp }) => mkdtemp(join(tmpdir(), "orbsie-formation-residency-")),
);
const report = {
  passed: false,
  scope:
    "120 ready-stage entities through the shared World and direct software renderer fixture",
  cap: 48,
  providerCalls: 0,
  externalRequests: [],
  pageErrors: [],
  consoleErrors: [],
  assumptions: [
    "Each renderer fixture uses 120 ready-stage procedural box entities with matching completed recipe identities for the selector expectation.",
    "The mobile capture is a Chromium 390x844 viewport; it does not represent a physical phone.",
  ],
  limitations: [
    "The WebGL context runs under Chromium SwiftShader, so it does not measure native GPU performance.",
    "The software canvas keeps resident/proxy IDs private; its live proxy count is inferred from the renderer's proxy marker arcs, while exact selection reasons come from the shared selectors.",
  ],
};

let server;
let browser;
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

async function waitForFixture(page, mode) {
  await page.waitForFunction(
    (expectedMode) => {
      const fixture = window.formationResidencyFixture;
      if (!fixture || window.__formationResidencyBootError) return false;
      return fixture.ready();
    },
    mode,
    { timeout: 90000 },
  );
}

async function zoomIn(page, steps) {
  const button = page.locator('button[aria-label^="Zoom in"]');
  for (let index = 0; index < steps; index++) await button.click();
}

async function panWithMouse(page, plan) {
  await page.mouse.move(plan.start.x, plan.start.y);
  await page.mouse.down();
  await page.mouse.move(plan.end.x, plan.end.y, { steps: 5 });
  await page.mouse.up();
}

function assertSelectorExpectation(sample, selectedId, visiblePrefix) {
  assert.equal(sample.readyCount, 120);
  assert.equal(sample.residentCount, 48);
  assert.equal(sample.selectedReason, "resident-selected");
  assert.ok(
    sample.visibleMainCount >= 48,
    "Expected more visible entities than the resident cap",
  );
  assert.ok(sample.webglResidentIds.includes(selectedId));
  assert.ok(sample.softwareResidentIds.includes(selectedId));
  assert.equal(sample.webglResidentIds.length, 48);
  assert.equal(sample.softwareResidentIds.length, 48);
  const residentNearIds = sample.webglResidentIds.filter(
    (id) => id.startsWith(visiblePrefix) && id.includes("-near-"),
  );
  assert.deepEqual(residentNearIds, []);
}

try {
  await mkdir(evidenceDirectory, { recursive: true });
  await build({
    entryPoints: ["scripts/formation-residency-browser-fixture.tsx"],
    bundle: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    outfile: join(temporaryDirectory, "fixture.js"),
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const bundle = await readFile(join(temporaryDirectory, "fixture.js"));
  server = createServer((request, response) => {
    if (request.url?.startsWith("/fixture.js")) {
      response.setHeader("Content-Type", "text/javascript");
      response.end(bundle);
    } else if (request.url?.startsWith("/")) {
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Formation residency fixture</title>
<style>
html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#07100f}
canvas{display:block;width:100%;height:100%}
.world-navigation-controls{position:fixed;z-index:5;left:12px;top:12px;display:flex;gap:4px}
.software-fixture,.software-world{position:relative;width:100%;height:100%}
.software-world-status{display:none}
</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
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

  const desktopContext = await browserContext(origin, {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const webglPage = trackPage(await desktopContext.newPage());
  await webglPage.goto(`${origin}/?renderer=webgl`, {
    waitUntil: "domcontentloaded",
  });
  await webglPage.waitForFunction(
    () => ["webgl", "software"].includes(window.__formationResidencyRenderer),
    { timeout: 60000 },
  );
  report.webgl = {
    attempted: true,
    renderer: await webglPage.evaluate(
      () => window.__formationResidencyRenderer,
    ),
  };

  if (report.webgl.renderer === "webgl") {
    await waitForFixture(webglPage, "webgl");
    report.webgl.defaultView = await webglPage.evaluate(() =>
      window.formationResidencyFixture.renderer(),
    );
    await webglPage.getByRole("button", { name: "Frame content" }).click();
    const framed = await webglPage.evaluate(() =>
      window.formationResidencyFixture.afterFrameContent(),
    );
    report.webgl.framedDistance = framed.distance;
    const capReached = await webglPage
      .waitForFunction(
        () =>
          window.formationResidencyFixture.renderer().fullFormationCount === 48,
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);
    const initial = await webglPage.evaluate(() =>
      window.formationResidencyFixture.renderer(),
    );
    report.webgl.initial = initial;
    report.webgl.residencyStatus = capReached
      ? "capped-at-48"
      : "did-not-reach-48-during-observation";

    if (!capReached) {
      report.webgl.initial = await webglPage.evaluate(() =>
        window.formationResidencyFixture.renderer(),
      );
      await webglPage.screenshot({
        path: `${evidenceDirectory}/webgl-attempt-desktop.png`,
        animations: "disabled",
      });
    } else {
      assert.equal(initial.projectEntityCount, 120);
      assert.equal(initial.fullFormationCount, 48);
      assert.ok(initial.formationMeshCount >= 48);
      assert.ok(initial.particleMeshCount >= 48);

      await webglPage.evaluate(() =>
        window.formationResidencyFixture.select("home-visible-00"),
      );
      const distantPlan = await webglPage.evaluate(() =>
        window.formationResidencyFixture.panPlanTo(600),
      );
      await panWithMouse(webglPage, distantPlan);
      const distantZoomSteps = await webglPage.evaluate(() =>
        window.formationResidencyFixture.zoomInSteps(100),
      );
      await zoomIn(webglPage, distantZoomSteps);
      const distantExpected = await webglPage.evaluate(() =>
        window.formationResidencyFixture.expectedAt(600, "home-visible-00"),
      );
      assertSelectorExpectation(distantExpected, "home-visible-00", "distant");
      await webglPage.waitForFunction(
        () => {
          const sample = window.formationResidencyFixture.renderer();
          return (
            sample.fullFormationCount === 48 &&
            sample.selectedFullRingCount === 1
          );
        },
        { timeout: 30000 },
      );
      const distant = await webglPage.evaluate(() =>
        window.formationResidencyFixture.renderer(),
      );
      assert.equal(distant.fullFormationCount, 48);
      assert.equal(distant.selectedFullRingCount, 1);
      report.webgl.distant = {
        target: distantPlan.expectedNavigation.target,
        selectedId: distant.selectedId,
        selector: distantExpected,
        renderer: distant,
        zoomInSteps: distantZoomSteps,
      };
      await webglPage.screenshot({
        path: `${evidenceDirectory}/webgl-distant-desktop.png`,
        animations: "disabled",
      });

      await webglPage.getByRole("button", { name: "Frame content" }).click();
      const returnFrame = await webglPage.evaluate(() =>
        window.formationResidencyFixture.afterFrameContent(),
      );
      const homePlan = await webglPage.evaluate(() =>
        window.formationResidencyFixture.panPlanTo(-600),
      );
      await panWithMouse(webglPage, homePlan);
      const homeZoomSteps = await webglPage.evaluate(() =>
        window.formationResidencyFixture.zoomInSteps(100),
      );
      await zoomIn(webglPage, homeZoomSteps);
      const homeExpected = await webglPage.evaluate(() =>
        window.formationResidencyFixture.expectedAt(-600, "home-visible-00"),
      );
      assertSelectorExpectation(homeExpected, "home-visible-00", "home");
      await webglPage.waitForFunction(
        () => {
          const sample = window.formationResidencyFixture.renderer();
          return (
            sample.fullFormationCount === 48 &&
            sample.selectedFullRingCount === 1
          );
        },
        { timeout: 30000 },
      );
      await webglPage.setViewportSize({ width: 390, height: 844 });
      await webglPage.waitForTimeout(350);
      const reentry = await webglPage.evaluate(() =>
        window.formationResidencyFixture.renderer(),
      );
      report.webgl.reentry = {
        target: homePlan.expectedNavigation.target,
        frameDistance: returnFrame.distance,
        selector: homeExpected,
        renderer: reentry,
        screenshotViewport: { width: 390, height: 844 },
      };
      assert.equal(reentry.fullFormationCount, 48);
      assert.equal(reentry.selectedFullRingCount, 1);
      await webglPage.screenshot({
        path: `${evidenceDirectory}/webgl-home-mobile-390x844.png`,
        animations: "disabled",
      });
    }
    report.webgl.available = true;
  } else {
    report.webgl.available = false;
    report.webgl.fallback = await webglPage.evaluate(() => ({
      reason:
        window.__formationResidencyError ??
        "World selected the software fallback.",
      sceneReview:
        window.__orbsieSceneReviewFixture?.software?.read?.() ?? null,
    }));
    await webglPage.screenshot({
      path: `${evidenceDirectory}/webgl-attempt-fallback-desktop.png`,
      animations: "disabled",
    });
  }

  const softwareContext = await browserContext(origin, {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const softwarePage = trackPage(await softwareContext.newPage());
  await softwarePage.goto(`${origin}/?renderer=software`, {
    waitUntil: "domcontentloaded",
  });
  await waitForFixture(softwarePage, "software");
  await softwarePage.evaluate(() =>
    window.formationResidencyFixture.select("distant-visible-00"),
  );
  await softwarePage.waitForFunction(
    () => window.formationResidencyFixture.paint().proxyArcCount > 0,
    { timeout: 90000 },
  );
  const softwareHomeExpected = await softwarePage.evaluate(() =>
    window.formationResidencyFixture.expectedAt(-600, "distant-visible-00"),
  );
  assertSelectorExpectation(softwareHomeExpected, "distant-visible-00", "home");
  report.software = {
    renderer: "direct SoftwareWorld canvas path",
    projectEntityCount: 120,
    home: {
      target: -600,
      selectedId: "distant-visible-00",
      selector: softwareHomeExpected,
      painted: await softwarePage.evaluate(() =>
        window.formationResidencyFixture.paint(),
      ),
      review: await softwarePage.evaluate(() =>
        window.formationResidencyFixture.renderer(),
      ),
    },
  };

  await softwarePage.evaluate(() => {
    window.formationResidencyFixture.resetPaint();
    window.formationResidencyFixture.focus(600);
    window.formationResidencyFixture.select("home-visible-00");
  });
  await softwarePage.waitForFunction(
    () => window.formationResidencyFixture.paint().proxyArcCount > 0,
    { timeout: 30000 },
  );
  const softwareDistantExpected = await softwarePage.evaluate(() =>
    window.formationResidencyFixture.expectedAt(600, "home-visible-00"),
  );
  assertSelectorExpectation(
    softwareDistantExpected,
    "home-visible-00",
    "distant",
  );
  const softwareDistantPaint = await softwarePage.evaluate(() =>
    window.formationResidencyFixture.paint(),
  );
  assert.equal(softwareDistantPaint.proxyArcCount, 3);
  report.software.distant = {
    target: 600,
    selectedId: "home-visible-00",
    selector: softwareDistantExpected,
    painted: softwareDistantPaint,
    review: await softwarePage.evaluate(() =>
      window.formationResidencyFixture.renderer(),
    ),
  };
  await softwarePage.screenshot({
    path: `${evidenceDirectory}/software-distant-desktop.png`,
    animations: "disabled",
  });

  await softwarePage.evaluate(() => {
    window.formationResidencyFixture.resetPaint();
    window.formationResidencyFixture.focus(-600);
    window.formationResidencyFixture.select("distant-visible-00");
  });
  await softwarePage.waitForFunction(
    () => window.formationResidencyFixture.paint().proxyArcCount > 0,
    { timeout: 30000 },
  );
  await softwarePage.setViewportSize({ width: 390, height: 844 });
  await softwarePage.waitForTimeout(300);
  const softwareReentry = await softwarePage.evaluate(() => ({
    navigation: window.formationResidencyFixture.navigation(),
    paint: window.formationResidencyFixture.paint(),
    review: window.formationResidencyFixture.renderer(),
    expected: window.formationResidencyFixture.expectedAt(
      -600,
      "distant-visible-00",
    ),
  }));
  assertSelectorExpectation(
    softwareReentry.expected,
    "distant-visible-00",
    "home",
  );
  assert.equal(softwareReentry.paint.proxyArcCount, 3);
  report.software.reentry = {
    ...softwareReentry,
    screenshotViewport: { width: 390, height: 844 },
  };
  await softwarePage.screenshot({
    path: `${evidenceDirectory}/software-home-mobile-390x844.png`,
    animations: "disabled",
  });

  for (const stage of [
    report.software.home,
    report.software.distant,
    report.software.reentry,
  ]) {
    assert.equal(stage.review?.mounted, true);
    assert.equal(stage.review?.transitionSettled, true);
    assert.equal(stage.review?.renderedRevision, 0);
    assert.deepEqual(stage.review?.errors, []);
  }
  assert.equal(report.webgl.available, true, "WebGL renderer was unavailable");
  assert.equal(
    report.webgl.residencyStatus,
    "capped-at-48",
    "WebGL formation residency did not reach its capped state",
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
  await browser?.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temporaryDirectory, { recursive: true, force: true });
  await writeFile(
    `${evidenceDirectory}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    `${evidenceDirectory}/README.md`,
    `# Formation residency browser evidence\n\n` +
      `Result: **${report.passed ? "passed" : "incomplete/failed"}**.\n\n` +
      `The fixture ran 120 ready-stage procedural entities through the shared World when WebGL was available, and directly through the software canvas renderer. It checks the 48 resident limit, selected residency, visible-versus-near priority, navigation to the distant cluster and reentry, and captures desktop/mobile viewport screenshots.\n\n` +
      `WebGL renderer: ${report.webgl?.renderer ?? "not reached"}. Software proxy arcs on the distant view: ${report.software?.distant?.painted?.proxyArcCount ?? "not reached"}. Provider calls: 0. External requests: ${report.externalRequests.length}.\n\n` +
      `The WebGL run uses SwiftShader. The 390x844 captures are browser viewport emulation. Neither run measures native GPU or physical mobile performance. See [report.json](./report.json) for assertions and renderer snapshots.\n`,
  );
  console.log(
    JSON.stringify({
      passed: report.passed,
      webgl: report.webgl?.residencyStatus ?? report.webgl?.renderer,
      softwareProxyArcs: report.software?.distant?.painted?.proxyArcCount,
      externalRequests: report.externalRequests.length,
      pageErrors: report.pageErrors.length,
      consoleErrors: report.consoleErrors.length,
      ...(report.error ? { error: report.error } : {}),
    }),
  );
}
