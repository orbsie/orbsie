#!/usr/bin/env node
// Signed-out Android Chrome touch acceptance for a pinned published input game.
// Gateway keeps its historical forced Canvas2D default; auto records the
// renderer selected by the page without changing context creation.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { chromium, expect } from "@playwright/test";

const provider = process.env.ORBSIE_PUBLICATION_PROVIDER ?? "gateway";
assert(
  ["gateway", "openrouter"].includes(provider),
  "ORBSIE_PUBLICATION_PROVIDER must be gateway or openrouter.",
);
const sourceReportPath = process.env.ORBSIE_PUBLICATION_SOURCE_REPORT;
assert(
  provider !== "openrouter" || sourceReportPath,
  "OpenRouter checks require ORBSIE_PUBLICATION_SOURCE_REPORT.",
);

let publicationEvidence = null;
let pinnedDeploymentUrl = null;
if (sourceReportPath) {
  const absoluteSourceReportPath = resolve(sourceReportPath);
  const sourceEvidenceRoot = resolve("docs/evidence");
  const relativeSourceReportPath = relative(
    sourceEvidenceRoot,
    absoluteSourceReportPath,
  );
  assert(
    relativeSourceReportPath &&
      relativeSourceReportPath !== ".." &&
      !relativeSourceReportPath.startsWith(
        `..${process.platform === "win32" ? "\\" : "/"}`,
      ),
    "Publication source report must be under docs/evidence.",
  );
  const sourceReport = JSON.parse(
    readFileSync(absoluteSourceReportPath, "utf8"),
  );
  const sourceProvider =
    sourceReport.source?.provider ??
    sourceReport.acceptance?.sourceProvider ??
    "gateway";
  const revision = sourceReport.source?.revision;
  assert.equal(
    sourceReport.status,
    "passed",
    "Source publication did not pass.",
  );
  assert.equal(
    sourceProvider,
    provider,
    "Source report provider does not match selection.",
  );
  assert.equal(sourceReport.publication?.status, "ready");
  assert.equal(sourceReport.publication?.readyState, "READY");
  assert(
    Number.isSafeInteger(revision) && revision > 0,
    "Source report has no pinned revision.",
  );
  assert.equal(sourceReport.publication.revision, revision);
  if (sourceReport.acceptance?.revision !== undefined)
    assert.equal(sourceReport.acceptance.revision, revision);
  if (sourceReport.publicArtifacts?.revision !== undefined)
    assert.equal(sourceReport.publicArtifacts.revision, revision);
  if (sourceReport.publication.servedRevision !== undefined)
    assert.equal(sourceReport.publication.servedRevision, revision);
  assert(
    typeof sourceReport.publication.deploymentUrl === "string",
    "Source report has no deployment URL.",
  );
  pinnedDeploymentUrl = sourceReport.publication.deploymentUrl;
  publicationEvidence = {
    path: relative(process.cwd(), absoluteSourceReportPath),
    provider,
    pinned: true,
    model: sourceReport.source?.originModel ?? null,
    projectId:
      sourceReport.acceptance?.projectId ??
      sourceReport.source?.projectId ??
      null,
    revision,
    digest: sourceReport.source?.digest ?? null,
    deploymentId: sourceReport.publication.deploymentId ?? null,
    deploymentUrl: pinnedDeploymentUrl,
  };
}

const suppliedDeploymentUrl = process.env.ORBSIE_PUBLISHED_URL;
assert(
  suppliedDeploymentUrl || pinnedDeploymentUrl,
  "Set ORBSIE_PUBLISHED_URL or select a publication source report.",
);
if (pinnedDeploymentUrl && suppliedDeploymentUrl)
  assert.equal(
    new URL(suppliedDeploymentUrl).origin,
    new URL(pinnedDeploymentUrl).origin,
    "ORBSIE_PUBLISHED_URL does not match the pinned source report.",
  );
const deployment = new URL(suppliedDeploymentUrl ?? pinnedDeploymentUrl);
assert(
  deployment.protocol === "https:" &&
    deployment.hostname.endsWith(".vercel.app") &&
    deployment.pathname === "/" &&
    !deployment.username &&
    !deployment.password &&
    !deployment.search &&
    !deployment.hash,
  "Published URL must be a published HTTPS Vercel deployment origin.",
);

const rendererMode = process.env.ORBSIE_ANDROID_RENDERER ?? "canvas2d";
assert(
  ["canvas2d", "auto"].includes(rendererMode),
  "ORBSIE_ANDROID_RENDERER must be canvas2d or auto.",
);
const cdpUrl = process.env.ORBSIE_ANDROID_CDP_URL ?? "http://127.0.0.1:9222";
const cdp = new URL(cdpUrl);
assert(
  cdp.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(cdp.hostname) &&
    cdp.pathname === "/" &&
    !cdp.search &&
    !cdp.hash,
  "Android CDP must be forwarded on loopback.",
);
const device = process.env.ORBSIE_ANDROID_DEVICE ?? "emulator-5554";
assert(/^[A-Za-z0-9_.:-]{1,80}$/.test(device), "Invalid Android device ID.");
const evidenceRoot = resolve(`docs/evidence/android-${provider}-publication`);
const defaultEvidenceDirectory =
  provider === "openrouter"
    ? "docs/evidence/android-openrouter-publication/current-runtime-20260925"
    : "docs/evidence/android-gateway-publication/current-runtime";
const evidenceDir = resolve(
  process.env.ORBSIE_ANDROID_PUBLICATION_EVIDENCE ?? defaultEvidenceDirectory,
);
const relativeEvidenceDir = relative(evidenceRoot, evidenceDir);
assert(
  relativeEvidenceDir &&
    relativeEvidenceDir !== ".." &&
    !relativeEvidenceDir.startsWith(
      `..${process.platform === "win32" ? "\\" : "/"}`,
    ),
  `Evidence must be a child of ${relative(process.cwd(), evidenceRoot)}.`,
);

function adb(...args) {
  return execFileSync("adb", ["-s", device, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  }).trim();
}

const touchActions = [];
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
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  await page.waitForTimeout(180);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  touchActions.push(String(name));
}

await mkdir(evidenceDir, { recursive: true });
const report = {
  status: "running",
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  publication: publicationEvidence ?? {
    provider,
    pinned: false,
    selection: "legacy Gateway URL input",
  },
  deploymentUrl: deployment.origin,
  device: {
    id: device,
    android: adb("shell", "getprop", "ro.build.version.release"),
    model: adb("shell", "getprop", "ro.product.model"),
    size: adb("shell", "wm", "size"),
    density: adb("shell", "wm", "density"),
    chrome:
      adb("shell", "dumpsys", "package", "com.android.chrome").match(
        /versionName=([^\s]+)/,
      )?.[1] ?? "unknown",
    evidenceClass: "Android emulator Chrome",
    physicalDevice: false,
  },
  renderer: {
    mode: rendererMode,
    selection:
      rendererMode === "auto" ? "automatic" : "forced Canvas2D compatibility",
    actual: "not observed",
    contexts: [],
  },
  touchInput: {
    method: "Chrome DevTools Protocol Input.dispatchTouchEvent",
    actions: touchActions,
  },
  providerCalls: 0,
  requests: [],
  generationRequests: [],
  externalRequests: [],
  pageErrors: [],
  consoleErrors: [],
  expectedWebglInitializationErrors: 0,
  checks: {},
};
let browser;
let page;
try {
  browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  assert(context, "Android Chrome did not expose a browser context.");
  page = await context.newPage();
  await page.addInitScript((mode) => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      const isWebgl = ["webgl", "webgl2", "experimental-webgl"].includes(kind);
      if (mode === "canvas2d" && isWebgl) {
        window.__orbsieCanvasContexts ??= [];
        window.__orbsieCanvasContexts.push({
          requested: kind,
          actual: null,
          forcedUnavailable: true,
        });
        return null;
      }
      const context = original.call(this, kind, ...args);
      window.__orbsieCanvasContexts ??= [];
      const observation = {
        requested: kind,
        actual: context
          ? isWebgl
            ? kind === "experimental-webgl"
              ? "webgl"
              : kind
            : kind === "experimental-webgl"
              ? "webgl"
              : kind
          : null,
        forcedUnavailable: false,
        canvasId: this.id || null,
        canvasClass: typeof this.className === "string" ? this.className : null,
      };
      if (context && isWebgl) {
        try {
          const extension = context.getExtension("WEBGL_debug_renderer_info");
          observation.vendor = context.getParameter(
            extension?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR,
          );
          observation.renderer = context.getParameter(
            extension?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER,
          );
        } catch {
          // Context identity remains useful when the browser hides debug info.
        }
      }
      window.__orbsieCanvasContexts.push(observation);
      return context;
    };
  }, rendererMode);
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const record = {
      method: request.method(),
      url: `${url.origin}${url.pathname}`,
      resourceType: request.resourceType(),
    };
    if (
      ["/api/generate", "/api/chatgpt/generate", "/generate"].includes(
        url.pathname,
      )
    ) {
      report.generationRequests.push(record);
      report.requests.push({ ...record, blocked: true });
      await route.abort("blockedbyclient");
      return;
    }
    if (
      ["/api/generation-runs", "/api/generated-models"].includes(url.pathname)
    ) {
      report.generationRequests.push(record);
      report.requests.push({ ...record, blocked: true });
      await route.abort("blockedbyclient");
      return;
    }
    if (
      ["data:", "blob:"].includes(url.protocol) ||
      url.origin === deployment.origin
    ) {
      report.requests.push({ ...record, blocked: false });
      await route.continue();
      return;
    }
    report.externalRequests.push(url.origin || url.protocol);
    report.requests.push({ ...record, blocked: true });
    await route.abort("blockedbyclient");
  });
  page.on("pageerror", (error) => {
    if (/Error creating WebGL context/i.test(error.message)) {
      report.expectedWebglInitializationErrors++;
      return;
    }
    report.pageErrors.push(error.message.slice(0, 300));
  });
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Error creating WebGL context/i.test(message.text())
    )
      report.expectedWebglInitializationErrors++;
    else if (message.type() === "error")
      report.consoleErrors.push(message.text().slice(0, 300));
  });
  report.cookiesBefore = (await context.cookies(deployment.origin)).length;
  assert.equal(
    report.cookiesBefore,
    0,
    "The published game has an existing cookie.",
  );
  const response = await page.goto(deployment.origin, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  assert.equal(
    response?.status(),
    200,
    "Published game did not return HTTP 200.",
  );
  await expect(page.locator('main[data-ready="true"]')).toBeVisible({
    timeout: 30_000,
  });
  if (rendererMode === "canvas2d")
    await expect(page.locator(".software-world")).toBeVisible({
      timeout: 30_000,
    });
  await expect(page.locator("canvas:visible").first()).toBeVisible();
  await expect(page.locator(".score")).toHaveText("Score: 0");
  if (rendererMode === "auto")
    await page.waitForFunction(
      () =>
        window.__orbsieCanvasContexts?.some(
          (observation) => observation.actual,
        ),
      null,
      { timeout: 10_000 },
    );
  report.renderer.contexts = await page.evaluate(
    () => window.__orbsieCanvasContexts ?? [],
  );
  const successfulContexts = report.renderer.contexts.filter(
    (observation) => observation.actual,
  );
  const softwareWorldVisible = await page
    .locator(".software-world")
    .isVisible()
    .catch(() => false);
  if (softwareWorldVisible) {
    assert(
      successfulContexts.some((observation) => observation.actual === "2d"),
      "The visible software renderer did not create a 2D context.",
    );
    report.renderer.actual = "Canvas2D";
    report.renderer.activeEvidence =
      "Visible .software-world and successful 2d context.";
  } else if (
    successfulContexts.some((observation) =>
      observation.actual.startsWith("webgl"),
    )
  ) {
    report.renderer.actual = "WebGL";
    report.renderer.activeEvidence =
      "No visible .software-world; successful WebGL context observed.";
  } else if (
    successfulContexts.some((observation) => observation.actual === "2d")
  ) {
    report.renderer.actual = "Canvas2D";
    report.renderer.activeEvidence =
      "No visible .software-world; successful 2d context observed.";
  }
  assert.notEqual(
    report.renderer.actual,
    "not observed",
    "The game renderer was not established.",
  );
  if (rendererMode === "auto") {
    assert(
      successfulContexts.length > 0,
      "Automatic mode did not create a successful canvas context.",
    );
  }
  report.viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    touchPoints: navigator.maxTouchPoints,
    horizontalOverflow:
      Math.max(
        document.body.scrollWidth,
        document.documentElement.scrollWidth,
      ) >
      innerWidth + 1,
  }));
  assert(report.viewport.touchPoints > 0, "Chrome did not expose touch input.");
  assert(
    !report.viewport.horizontalOverflow,
    "Published game overflows horizontally.",
  );
  report.checks.ready = true;
  await page.screenshot({ path: `${evidenceDir}/ready.png` });

  const session = await context.newCDPSession(page);
  await tap(page, session, "Right");
  await expect(page.locator(".score")).toHaveText("Score: 7");
  report.checks.touchScore = 7;
  await page.screenshot({ path: `${evidenceDir}/scored.png` });
  await tap(page, session, /Restart/);
  await expect(page.locator(".score")).toHaveText("Score: 0");
  report.checks.restart = true;
  await tap(page, session, "Forward");
  await expect(page.locator(".win")).toContainText("Final score: 0");
  report.checks.win = true;
  await page.screenshot({ path: `${evidenceDir}/won.png` });
  await tap(page, session, /Restart/);
  await expect(page.locator(".score")).toHaveText("Score: 0");
  await tap(page, session, "Left");
  await expect(page.locator(".win")).toContainText("Try another adventure");
  report.checks.loss = true;
  await page.screenshot({ path: `${evidenceDir}/lost.png` });
  report.cookiesAfter = (await context.cookies(deployment.origin)).length;
  assert.equal(report.cookiesAfter, 0);
  assert.deepEqual(report.generationRequests, []);
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error =
    error instanceof Error
      ? error.message.slice(0, 500)
      : "Android check failed.";
  if (page)
    await page
      .screenshot({ path: `${evidenceDir}/failure.png` })
      .catch(() => undefined);
  process.exitCode = 1;
} finally {
  await page?.close().catch(() => {});
  await browser?.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  await writeFile(
    `${evidenceDir}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks,
      evidenceDir,
    }),
  );
}
