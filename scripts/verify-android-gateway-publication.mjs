#!/usr/bin/env node
// Signed-out Android Chrome touch acceptance for a pinned published input game.
// Gateway keeps its historical forced Canvas2D default; auto records the
// renderer selected by the page without changing context creation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
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
let signedOutShareUrl = null;
let signedOutIframeOrigin = null;
let expectedProject = null;
let expectedCatalogAssets = [];
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
    sourceReport.provider ??
    sourceReport.source?.provider ??
    sourceReport.acceptance?.sourceProvider ??
    "gateway";
  const revision =
    sourceReport.cloud?.revision ??
    sourceReport.source?.revision ??
    sourceReport.acceptance?.revision ??
    sourceReport.publicArtifacts?.revision;
  const publicationState =
    sourceReport.publication?.state ??
    sourceReport.publication?.readyState ??
    (sourceReport.publication?.status === "ready" ? "READY" : undefined);
  const publicationRevision =
    sourceReport.publication?.servedRevision ??
    sourceReport.publication?.revision;
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
  assert.equal(publicationState, "READY");
  assert(
    Number.isSafeInteger(revision) && revision > 0,
    "Source report has no pinned revision.",
  );
  if (publicationRevision !== undefined)
    assert.equal(publicationRevision, revision);
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
  signedOutShareUrl = sourceReport.signedOut?.url ?? null;
  signedOutIframeOrigin = sourceReport.signedOut?.iframeOrigin ?? null;
  const projectId =
    sourceReport.cloud?.projectId ??
    sourceReport.acceptance?.projectId ??
    sourceReport.source?.projectId ??
    null;
  if (provider === "openrouter") {
    assert.equal(
      sourceProvider,
      "openrouter",
      "OpenRouter checks require an OpenRouter source publication report.",
    );
    assert(
      typeof projectId === "string" && projectId.length > 0,
      "OpenRouter source report has no pinned project ID.",
    );
    assert(
      typeof signedOutShareUrl === "string",
      "OpenRouter source report has no signed-out public URL.",
    );
    const share = new URL(signedOutShareUrl);
    assert(
      share.protocol === "https:" &&
        share.pathname === `/o/${encodeURIComponent(projectId)}` &&
        !share.search &&
        !share.hash,
      "OpenRouter source report has an invalid public share URL.",
    );
    assert.equal(
      signedOutIframeOrigin,
      new URL(pinnedDeploymentUrl).origin,
      "Signed-out iframe origin does not match the pinned deployment.",
    );
    const projectPath = resolve(
      dirname(absoluteSourceReportPath),
      "project.json",
    );
    expectedProject = JSON.parse(readFileSync(projectPath, "utf8"));
    assert.equal(expectedProject.id, projectId);
    assert.equal(expectedProject.revision, revision);
    const catalogAssetPaths = {
      "kenney.nature.rock-large-a":
        "public/models/kenney/nature-kit/rock_largeA.glb",
      "kenney.nature.tree-default":
        "public/models/kenney/nature-kit/tree_default.glb",
    };
    expectedCatalogAssets = expectedProject.entities
      .filter((entity) => entity.geometry?.kind === "asset")
      .map((entity) => {
        const localPath = catalogAssetPaths[entity.geometry.assetId];
        assert(
          localPath,
          `No checked-in asset fixture for ${entity.geometry.assetId}.`,
        );
        const bytes = readFileSync(resolve(localPath));
        return {
          assetId: entity.geometry.assetId,
          path: `/${localPath.replace(/^public\//, "")}`,
          localPath,
          bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      });
  }
  publicationEvidence = {
    path: relative(process.cwd(), absoluteSourceReportPath),
    provider,
    pinned: true,
    model:
      sourceReport.model ??
      sourceReport.source?.originModel ??
      sourceReport.acceptance?.model ??
      null,
    projectId,
    revision,
    digest: sourceReport.source?.digest ?? null,
    exportedProjectSha256: sourceReport.cloud?.exportedProjectSha256 ?? null,
    deploymentId: sourceReport.publication.deploymentId ?? null,
    deploymentUrl: pinnedDeploymentUrl,
    signedOutShareUrl,
    signedOutIframeOrigin,
    expectedCatalogAssets,
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
const publicUrl =
  provider === "openrouter" && signedOutShareUrl
    ? new URL(signedOutShareUrl)
    : deployment;
const allowedOrigins = new Set([deployment.origin, publicUrl.origin]);

const rendererMode =
  process.env.ORBSIE_ANDROID_RENDERER ??
  (provider === "openrouter" ? "auto" : "canvas2d");
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function authoredWorld(project) {
  return {
    id: project.id,
    revision: project.revision,
    seed: project.seed,
    entities: project.entities,
    environment: project.environment,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  return value;
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
  publicUrl: publicUrl.href,
  assetResponses: [],
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
  editorProviderRequests: [],
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
  let game = page;
  const expectedAssetByPath = new Map(
    expectedCatalogAssets.map((asset) => [asset.path, asset]),
  );
  const responseTasks = [];
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
  if (provider === "openrouter") {
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (
        url.origin !== deployment.origin ||
        (url.pathname !== "/project.json" &&
          !expectedAssetByPath.has(url.pathname))
      )
        return;
      const task = (async () => {
        const body = await response.body();
        const record = {
          origin: url.origin,
          path: url.pathname,
          status: response.status(),
          contentType: response.headers()["content-type"] ?? null,
          bytes: body.byteLength,
          sha256: sha256(body),
        };
        if (url.pathname === "/project.json") {
          const servedProject = JSON.parse(body.toString("utf8"));
          record.projectId = servedProject.id ?? null;
          record.revision = servedProject.revision ?? null;
          record.expectedWorldMatch =
            JSON.stringify(canonicalize(authoredWorld(servedProject))) ===
            JSON.stringify(canonicalize(authoredWorld(expectedProject)));
        } else {
          const expected = expectedAssetByPath.get(url.pathname);
          record.assetId = expected.assetId;
          record.expectedSha256 = expected.sha256;
          record.exactBytesMatch = record.sha256 === expected.sha256;
        }
        report.assetResponses.push(record);
      })().catch((error) => {
        report.assetResponses.push({
          path: url.pathname,
          error:
            error instanceof Error
              ? error.message.slice(0, 300)
              : "Response inspection failed.",
        });
      });
      responseTasks.push(task);
    });
  }
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
      provider === "openrouter" &&
      (url.pathname === "/api" || url.pathname.startsWith("/api/"))
    ) {
      report.editorProviderRequests.push(record);
      report.requests.push({ ...record, blocked: true });
      await route.abort("blockedbyclient");
      return;
    }
    if (
      ["data:", "blob:"].includes(url.protocol) ||
      allowedOrigins.has(url.origin)
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
  report.cookiesBefore = (await context.cookies([...allowedOrigins])).length;
  assert.equal(
    report.cookiesBefore,
    0,
    "Android Chrome is not signed out of the publication origins.",
  );
  const iframeDocumentResponse =
    provider === "openrouter"
      ? page.waitForResponse(
          (candidate) =>
            candidate.request().resourceType() === "document" &&
            new URL(candidate.url()).origin === deployment.origin &&
            new URL(candidate.url()).pathname === "/",
          { timeout: 45_000 },
        )
      : null;
  const expectedResponsePromises =
    provider === "openrouter"
      ? [
          page.waitForResponse(
            (candidate) =>
              new URL(candidate.url()).origin === deployment.origin &&
              new URL(candidate.url()).pathname === "/project.json",
            { timeout: 45_000 },
          ),
          ...expectedCatalogAssets.map((asset) =>
            page.waitForResponse(
              (candidate) =>
                new URL(candidate.url()).origin === deployment.origin &&
                new URL(candidate.url()).pathname === asset.path,
              { timeout: 45_000 },
            ),
          ),
        ]
      : [];
  const response = await page.goto(publicUrl.href, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  assert.equal(
    response?.status(),
    200,
    "Published game did not return HTTP 200.",
  );
  let gameFrame = page.mainFrame();
  if (provider === "openrouter") {
    const iframe = page.locator("iframe");
    await expect(iframe).toBeVisible({ timeout: 30_000 });
    const iframeSrc = await iframe.getAttribute("src");
    assert.equal(new URL(iframeSrc).origin, deployment.origin);
    assert.equal(new URL(iframeSrc).pathname, "/");
    const iframeResponse = await iframeDocumentResponse;
    assert.equal(iframeResponse?.status(), 200);
    gameFrame = page.frames().find((frame) => {
      try {
        return new URL(frame.url()).origin === deployment.origin;
      } catch {
        return false;
      }
    });
    assert(gameFrame, "Pinned publication iframe did not load.");
    game = page.frameLocator("iframe");
    const exactResponses = await Promise.all(expectedResponsePromises);
    assert(
      exactResponses.every((candidate) => candidate.status() === 200),
      "A pinned project or catalog asset did not return HTTP 200.",
    );
  }
  await expect(game.locator('main[data-ready="true"]')).toBeVisible({
    timeout: 30_000,
  });
  if (rendererMode === "canvas2d")
    await expect(game.locator(".software-world")).toBeVisible({
      timeout: 30_000,
    });
  await expect(game.locator("canvas:visible").first()).toBeVisible();
  if (provider === "gateway")
    await expect(game.locator(".score")).toHaveText("Score: 0");
  if (rendererMode === "auto")
    await gameFrame.waitForFunction(
      () =>
        window.__orbsieCanvasContexts?.some(
          (observation) => observation.actual,
        ),
      null,
      { timeout: 10_000 },
    );
  report.renderer.contexts = await gameFrame.evaluate(
    () => window.__orbsieCanvasContexts ?? [],
  );
  const successfulContexts = report.renderer.contexts.filter(
    (observation) => observation.actual,
  );
  const softwareWorldVisible = await game
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
  report.viewport = await gameFrame.evaluate(() => ({
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
  if (provider === "openrouter") {
    const projectResponse = await Promise.all(expectedResponsePromises);
    assert.equal(projectResponse.length, expectedCatalogAssets.length + 1);
    await Promise.all(responseTasks);
    for (const expected of expectedCatalogAssets) {
      const actual = report.assetResponses.find(
        (entry) => entry.path === expected.path,
      );
      assert.equal(
        actual?.status,
        200,
        `Missing ${expected.assetId} response.`,
      );
      assert.equal(
        actual?.exactBytesMatch,
        true,
        `${expected.assetId} bytes differ from the checked-in catalog asset.`,
      );
    }
    const servedProject = report.assetResponses.find(
      (entry) => entry.path === "/project.json",
    );
    assert.equal(servedProject?.status, 200);
    assert.equal(servedProject?.projectId, publicationEvidence.projectId);
    assert.equal(servedProject?.revision, publicationEvidence.revision);
    assert.equal(
      servedProject?.expectedWorldMatch,
      true,
      "Served project differs from the sanitized revision snapshot.",
    );
    report.checks.exactRevision = true;
    report.checks.exactCatalogAssets = expectedCatalogAssets.map(
      ({ assetId, path, bytes, sha256: expectedSha256 }) => ({
        assetId,
        path,
        bytes,
        sha256: expectedSha256,
        responseStatus: 200,
      }),
    );
    await page.waitForTimeout(10_000);
    await page.screenshot({ path: `${evidenceDir}/assets-rendered.png` });
    const canvas = game.locator("canvas:visible").first();
    const canvasBefore = await canvas.screenshot({
      path: `${evidenceDir}/scene-before-touch.png`,
    });
    const box = await canvas.boundingBox();
    assert(box && box.width > 0 && box.height > 0);
    const start = {
      x: box.x + box.width * 0.92,
      y: box.y + box.height * 0.45,
      id: 1,
    };
    const end = { ...start, x: start.x - Math.min(112, box.width * 0.35) };
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [start],
    });
    for (let step = 1; step <= 4; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            ...start,
            x: start.x + ((end.x - start.x) * step) / 4,
            y: start.y + ((end.y - start.y) * step) / 4,
          },
        ],
      });
      await page.waitForTimeout(80);
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    touchActions.push("one-finger canvas drag to pan the world camera");
    await page.waitForTimeout(500);
    const canvasAfter = await canvas.screenshot({
      path: `${evidenceDir}/scene-after-touch.png`,
    });
    report.touchInput.drag = {
      start: { x: Math.round(start.x), y: Math.round(start.y) },
      end: { x: Math.round(end.x), y: Math.round(end.y) },
      canvasBeforeSha256: sha256(canvasBefore),
      canvasAfterSha256: sha256(canvasAfter),
      renderedCanvasChanged: sha256(canvasBefore) !== sha256(canvasAfter),
    };
    assert(
      report.touchInput.drag.renderedCanvasChanged,
      "Touch drag did not change the rendered canvas.",
    );
    await expect(game.locator('main[data-ready="true"]')).toBeVisible();
    report.checks.touchCameraMovement = true;
    await page.screenshot({ path: `${evidenceDir}/touched.png` });
    await Promise.all(responseTasks);
  } else {
    await tap(game, session, "Right");
    await expect(game.locator(".score")).toHaveText("Score: 7");
    report.checks.touchScore = 7;
    await page.screenshot({ path: `${evidenceDir}/scored.png` });
    await tap(game, session, /Restart/);
    await expect(game.locator(".score")).toHaveText("Score: 0");
    report.checks.restart = true;
    await tap(game, session, "Forward");
    await expect(game.locator(".win")).toContainText("Final score: 0");
    report.checks.win = true;
    await page.screenshot({ path: `${evidenceDir}/won.png` });
    await tap(game, session, /Restart/);
    await expect(game.locator(".score")).toHaveText("Score: 0");
    await tap(game, session, "Left");
    await expect(game.locator(".win")).toContainText("Try another adventure");
    report.checks.loss = true;
    await page.screenshot({ path: `${evidenceDir}/lost.png` });
  }
  report.cookiesAfter = (await context.cookies([...allowedOrigins])).length;
  assert.equal(report.cookiesAfter, 0);
  assert.deepEqual(report.generationRequests, []);
  assert.deepEqual(report.editorProviderRequests, []);
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
