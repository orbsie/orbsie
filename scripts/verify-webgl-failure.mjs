/**
 * Deterministic browser check for renderer availability and generation gates.
 * The failure half forces WebGL context construction to fail; the normal half
 * uses SwiftShader. All provider and generation responses are synthetic. The
 * active callback injection uses React's fixture-only fiber tree to exercise a
 * timing-sensitive parent error path without adding a product test hook.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, expect } from "@playwright/test";

const TEST_URL = process.env.TEST_URL ?? "http://127.0.0.1:3035";
const EVIDENCE_DIR =
  process.env.ORBSIE_WEBGL_EVIDENCE_DIR ??
  `docs/evidence/webgl-failure-${Date.now()}`;
const origin = new URL(TEST_URL).origin;
const report = {
  passed: false,
  scope:
    "One local browser run covers forced WebGL construction failure with a playable Canvas2D fallback, explicit retry failure and recovery, both-renderer gating, active-generation callbacks, and normal readiness with synthetic allowance/provider responses; no live inference.",
  url: TEST_URL,
  generationRequests: 0,
  pageErrors: [],
  expectedFailureErrors: [],
  externalRequests: [],
  checks: {},
};

await mkdir(dirname(EVIDENCE_DIR), { recursive: true });
await mkdir(EVIDENCE_DIR);

const generationBody =
  JSON.stringify({
    type: "commit_revision",
    message: "Synthetic generation completed.",
  }) + "\n";

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function newContext(
  browser,
  forceFailure,
  {
    holdTrial = false,
    holdGeneration = false,
    recoverOnRetry = false,
    forceSoftwareFailure = false,
    userAgent,
  } = {},
) {
  const trialStarted = deferred();
  const trialRelease = deferred();
  const generationStarted = deferred();
  const generationRelease = deferred();
  let trialRequestCount = 0;
  let trialResponseCount = 0;
  const routeFixture = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      report.externalRequests.push(url.href);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    if (url.pathname === "/api/config") {
      await route.fulfill({ json: { accounts: false, publishing: false } });
      return;
    }
    if (url.pathname === "/api/trial") {
      trialRequestCount += 1;
      trialStarted.resolve();
      if (holdTrial) await trialRelease.promise;
      await route.fulfill({ json: { enabled: true, remaining: 2, limit: 2 } });
      trialResponseCount += 1;
      return;
    }
    if (url.pathname === "/api/generate") {
      report.generationRequests += 1;
      generationStarted.resolve();
      if (holdGeneration) await generationRelease.promise;
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: generationBody,
      });
      return;
    }
    await route.fulfill({ json: {} });
  };
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
    ...(userAgent ? { userAgent } : {}),
  });
  if (forceFailure)
    await context.addInitScript((allowRetry) => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, attributes) {
        if (
          kind === "webgl2" ||
          kind === "webgl" ||
          kind === "experimental-webgl"
        )
          if (!allowRetry || !window.__orbsieTestAllowWebGLRetry) return null;
        return getContext.call(this, kind, attributes);
      };
    }, recoverOnRetry);
  if (forceSoftwareFailure)
    await context.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, attributes) {
        if (kind === "2d") return null;
        return getContext.call(this, kind, attributes);
      };
    });
  await context.route("**/*", routeFixture);
  return {
    context,
    trialStarted: trialStarted.promise,
    releaseTrial: () => trialRelease.resolve(),
    trialRequestCount: () => trialRequestCount,
    trialResponseCount: () => trialResponseCount,
    generationStarted: generationStarted.promise,
    releaseGeneration: () => generationRelease.resolve(),
  };
}

async function triggerRendererError(page, message) {
  return page.evaluate((errorMessage) => {
    const scene = document.querySelector(".scene");
    if (!scene) return { success: false, reason: "scene" };
    const fiberKey = Object.keys(scene).find((key) =>
      key.startsWith("__reactFiber$"),
    );
    if (!fiberKey) return { success: false, reason: "fiber" };
    let matched = false;
    const visit = (fiber) => {
      if (!fiber || matched) return;
      const props = fiber.memoizedProps;
      if (
        props &&
        typeof props.onError === "function" &&
        typeof props.onRendererReady === "function"
      ) {
        props.onError(errorMessage);
        matched = true;
        return;
      }
      visit(fiber.child);
      visit(fiber.sibling);
    };
    visit(scene[fiberKey]);
    return matched ? { success: true } : { success: false, reason: "callback" };
  }, message);
}

async function openGraphicsOptions(page) {
  const summary = page.locator(".graphics-guidance details summary");
  if (await summary.count()) await summary.click();
}

async function inspectSoftwareLandingPlanet(page) {
  return page.locator(".software-world canvas").evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) return null;
    const { data, width, height } = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    let pixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = Math.floor(height * 0.18); y < height * 0.88; y++) {
      for (let x = Math.floor(width * 0.12); x < width * 0.88; x++) {
        const offset = (y * width + x) * 4;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        if (
          red < 145 &&
          green > 100 &&
          blue > 105 &&
          green - red > 35 &&
          blue - red > 35
        ) {
          pixels += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    return {
      canvas: { width, height },
      pixelSignature:
        "R<145, G>100, B>105, G-R>35 and B-R>35 within the central landing viewport",
      pixels,
      bounds: pixels > 0 ? { minX, minY, maxX, maxY } : undefined,
    };
  });
}

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
let failureContext;
let recoveryContext;
let fatalContext;
let normalContext;
try {
  const failureFixture = await newContext(browser, true);
  failureContext = failureFixture.context;
  const failurePage = await failureContext.newPage();
  failurePage.on("pageerror", (error) => {
    if (error.message.includes("Error creating WebGL context"))
      report.expectedFailureErrors.push(error.message);
    else report.pageErrors.push(error.message);
  });
  await failurePage.goto(TEST_URL, { waitUntil: "domcontentloaded" });
  await expect(
    failurePage.locator('main[data-renderer-availability="ready"]'),
  ).toBeVisible({ timeout: 20000 });
  await expect(failurePage.locator(".software-world")).toBeVisible({
    timeout: 20000,
  });
  await expect(failurePage.locator(".graphics-error")).toContainText(
    "Your world is playable",
  );
  let softwarePlanet;
  await expect
    .poll(
      async () => {
        softwarePlanet = await inspectSoftwareLandingPlanet(failurePage);
        return softwarePlanet?.pixels ?? 0;
      },
      { timeout: 20000 },
    )
    .toBeGreaterThan(5000);
  const failurePrompt = failurePage.locator("#prompt");
  await failurePrompt.fill("Keep this draft while graphics recover");
  const failureCreate = failurePage.getByRole("button", {
    name: "Create",
    exact: true,
  });
  await expect(failureCreate).toBeEnabled();
  await openGraphicsOptions(failurePage);
  await failurePage.getByRole("button", { name: "Check again" }).click();
  await expect(failurePage.locator(".software-world")).toBeVisible({
    timeout: 20000,
  });
  await expect(failurePrompt).toHaveValue(
    "Keep this draft while graphics recover",
  );
  await expect(
    failurePage.getByRole("button", { name: "Connections" }),
  ).toBeVisible();
  await failurePage
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await expect(
    failurePage.getByRole("heading", { name: "A little creative power" }),
  ).toBeVisible();
  report.checks.forcedFailure = {
    visibleAccessibleMessage: true,
    softwareFallbackVisible: true,
    softwarePlanet,
    createRemainsEnabled: true,
    retryStillUsesSoftwareFallback: true,
    draftRetained: true,
    connectionsAccessible: true,
  };
  assert.equal(report.generationRequests, 0);

  const fatalFixture = await newContext(browser, true, {
    forceSoftwareFailure: true,
  });
  fatalContext = fatalFixture.context;
  const fatalPage = await fatalContext.newPage();
  fatalPage.on("pageerror", (error) => {
    if (error.message.includes("Error creating WebGL context"))
      report.expectedFailureErrors.push(error.message);
    else report.pageErrors.push(error.message);
  });
  await fatalPage.goto(TEST_URL, { waitUntil: "domcontentloaded" });
  await expect(
    fatalPage.locator('main[data-renderer-availability="unavailable"]'),
  ).toBeVisible({ timeout: 20000 });
  await expect(fatalPage.locator(".graphics-error")).toContainText(
    "Neither WebGL2 nor the software canvas renderer could initialize",
  );
  await expect(
    fatalPage.getByRole("button", { name: "Create", exact: true }),
  ).toBeDisabled();
  report.checks.bothRenderersUnavailable = {
    fatalGuidanceVisible: true,
    createBlocked: true,
  };
  await fatalContext.close();
  fatalContext = undefined;

  const recoveryFixture = await newContext(browser, true, {
    recoverOnRetry: true,
  });
  recoveryContext = recoveryFixture.context;
  const recoveryPage = await recoveryContext.newPage();
  recoveryPage.on("pageerror", (error) => {
    if (error.message.includes("Error creating WebGL context"))
      report.expectedFailureErrors.push(error.message);
    else report.pageErrors.push(error.message);
  });
  await recoveryPage.goto(TEST_URL, { waitUntil: "domcontentloaded" });
  await expect(recoveryPage.locator(".software-world")).toBeVisible({
    timeout: 20000,
  });
  const recoveryPrompt = recoveryPage.locator("#prompt");
  await recoveryPrompt.fill("Keep this retry draft and connection");
  await recoveryPage
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await expect(
    recoveryPage.getByRole("heading", { name: "A little creative power" }),
  ).toBeVisible();
  await recoveryPage
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await recoveryPage.evaluate(() => {
    window.__orbsieTestAllowWebGLRetry = true;
  });
  await openGraphicsOptions(recoveryPage);
  await recoveryPage.getByRole("button", { name: "Check again" }).click();
  await expect(
    recoveryPage.locator('main[data-renderer-availability="ready"]'),
  ).toBeVisible({ timeout: 20000 });
  await expect(recoveryPage.locator(".software-world")).toHaveCount(0);
  await expect(recoveryPage.locator(".graphics-error")).toHaveCount(0);
  await expect(recoveryPrompt).toHaveValue(
    "Keep this retry draft and connection",
  );
  await recoveryPage
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await expect(
    recoveryPage.getByRole("heading", { name: "A little creative power" }),
  ).toBeVisible();
  report.checks.retryRecovery = {
    failedAttemptStayedPlayable: true,
    realWebglReadyAfterExplicitRetry: true,
    draftAndConnectionRetained: true,
  };
  await recoveryContext.close();
  recoveryContext = undefined;

  const preflightFixture = await newContext(browser, false, {
    holdTrial: true,
  });
  const preflightContext = preflightFixture.context;
  const preflightPage = await preflightContext.newPage();
  preflightPage.on("pageerror", (error) =>
    report.pageErrors.push(error.message),
  );
  await preflightPage.goto(TEST_URL, { waitUntil: "domcontentloaded" });
  await expect(
    preflightPage.locator('main[data-renderer-availability="ready"]'),
  ).toBeVisible({ timeout: 20000 });
  const preflightPrompt = preflightPage.locator("#prompt");
  await preflightPrompt.fill("Keep this allowance preflight draft");
  await preflightPage
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await expect
    .poll(preflightFixture.trialRequestCount, { timeout: 20000 })
    .toBeGreaterThanOrEqual(2);
  const preflightInjected = await triggerRendererError(
    preflightPage,
    "Synthetic renderer failure during allowance preflight.",
  );
  assert.equal(preflightInjected.success, true);
  await expect(preflightPage.locator(".graphics-error")).toContainText(
    "Synthetic renderer failure during allowance preflight.",
  );
  await expect(preflightPrompt).toHaveValue(
    "Keep this allowance preflight draft",
  );
  const heldTrialRequests = preflightFixture.trialRequestCount();
  preflightFixture.releaseTrial();
  await expect
    .poll(preflightFixture.trialResponseCount, { timeout: 20000 })
    .toBeGreaterThanOrEqual(heldTrialRequests);
  await preflightPage
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await expect(
    preflightPage.getByRole("heading", { name: "A little creative power" }),
  ).toBeVisible();
  await preflightPage
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(
    preflightPage.getByRole("heading", { name: "A little creative power" }),
  ).toHaveCount(0);
  await preflightPage.waitForTimeout(250);
  assert.equal(report.generationRequests, 0);
  report.checks.allowancePreflightFailure = {
    rendererFailureDuringAwait: true,
    generationBlocked: true,
    draftRetained: true,
  };
  await preflightContext.close();

  const activeFixture = await newContext(browser, false, {
    holdGeneration: true,
  });
  const activeContext = activeFixture.context;
  const activePage = await activeContext.newPage();
  activePage.on("pageerror", (error) => report.pageErrors.push(error.message));
  await activePage.goto(TEST_URL, { waitUntil: "domcontentloaded" });
  await expect(
    activePage.locator('main[data-renderer-availability="ready"]'),
  ).toBeVisible({ timeout: 20000 });
  const activePrompt = activePage.locator("#prompt");
  await activePrompt.fill("Keep this active generation draft");
  await activePage.getByRole("button", { name: "Create", exact: true }).click();
  await activeFixture.generationStarted;
  const activeActivity = activePage.locator(
    '.authoring-activity-message[role="status"]',
  );
  await expect(activeActivity).toBeVisible();
  await expect(activeActivity).toContainText("Waiting for a response");
  const injected = await triggerRendererError(
    activePage,
    "Synthetic renderer failure during generation.",
  );
  assert.equal(injected.success, true, JSON.stringify(injected));
  await expect(activePage.locator(".graphics-error")).toContainText(
    "Synthetic renderer failure during generation.",
  );
  const cancelledActivity = activePage.locator(
    '.authoring-activity-message[role="status"].is-cancelled',
  );
  await expect(cancelledActivity).toContainText(
    "Stopped. Finished objects are safe.",
  );
  await expect(cancelledActivity).toBeVisible();
  await expect(
    activePage.locator(
      '.authoring-activity-message[role="status"].is-waiting, .authoring-activity-message[role="status"].is-constructing, .authoring-activity-message[role="status"].is-preparing',
    ),
  ).toHaveCount(0);
  await expect(
    activePage.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await expect(activePrompt).toHaveValue("Keep this active generation draft");
  activeFixture.releaseGeneration();
  report.checks.activeGenerationFailure = {
    activeStatusAppeared: true,
    activeStatusClearedAfterRendererFailure: true,
    cancellationStatusVisible: true,
    stopsGeneration: true,
    persistentMessage: true,
    draftRetained: true,
  };
  await activeContext.close();

  normalContext = (await newContext(browser, false)).context;
  const normalPage = await normalContext.newPage();
  normalPage.on("pageerror", (error) => report.pageErrors.push(error.message));
  await normalPage.goto(TEST_URL, { waitUntil: "domcontentloaded" });
  await expect(
    normalPage.locator('main[data-renderer-availability="ready"]'),
  ).toBeVisible({ timeout: 20000 });
  const normalPrompt = normalPage.locator("#prompt");
  await normalPrompt.fill("Create a synthetic world");
  const normalCreate = normalPage.getByRole("button", {
    name: "Create",
    exact: true,
  });
  await expect(normalCreate).toBeEnabled();
  const beforeGenerationRequests = report.generationRequests;
  await normalCreate.click();
  await expect
    .poll(() => report.generationRequests, { timeout: 20000 })
    .toBe(beforeGenerationRequests + 1);
  await expect(
    normalPage.getByText("Synthetic generation completed.", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  report.checks.normalRenderer = {
    reachesReady: true,
    createEnabled: true,
    interceptedGenerationAllowed: true,
  };
  assert.equal(report.externalRequests.length, 0);
  assert.equal(report.generationRequests, 2);
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
} catch (error) {
  report.failure = String(error);
  process.exitCode = 1;
} finally {
  await failureContext?.close().catch(() => {});
  await recoveryContext?.close().catch(() => {});
  await fatalContext?.close().catch(() => {});
  await normalContext?.close().catch(() => {});
  await browser.close();
  await writeFile(
    `${EVIDENCE_DIR}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}
