#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve, sep } from "node:path";
import { expect, webkit } from "@playwright/test";
import { unzipSync } from "fflate";

const FIXTURE_ZIP =
  "docs/evidence/provider-e2e/gateway-reload-recovery/gateway/world.zip";
const PLAYER_DIRECTORY = "public/player";
const PLAYER_FILES = [
  "runtime.js",
  "runtime.css",
  "generated-geometry-worker.js",
  "asset-geometry-worker.js",
];
const EVIDENCE_DIRECTORY = resolve(
  "docs/evidence/webkit-mobile-smoke-20260924",
);
const VIEWPORT = { width: 390, height: 844 };
const EDITOR_URL = process.env.ORBSIE_EDITOR_URL ?? "http://127.0.0.1:3001/";
const GENERATION_PATHS = new Set([
  "/api/generate",
  "/api/generate/review",
  "/api/chatgpt/generate",
  "/api/chatgpt/review",
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
  ".wasm": "application/wasm",
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateEditorUrl(value) {
  const url = new URL(value);
  assert(
    url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      !url.username &&
      !url.password,
    "Editor URL must use HTTP on loopback so the smoke cannot contact a remote host.",
  );
  return url;
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

async function writeFixture(artifactDirectory, zipBytes) {
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

  const currentPlayerFiles = {};
  for (const name of PLAYER_FILES) {
    const bytes = await readFile(join(PLAYER_DIRECTORY, name));
    await writeFile(join(artifactDirectory, name), bytes);
    currentPlayerFiles[name] = {
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    };
  }
  return currentPlayerFiles;
}

function contentType(path) {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function createReadOnlyServer(root) {
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

function urlLabel(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function observePage(page, label, report) {
  page.on("pageerror", (error) =>
    report.errors.page.push({ page: label, message: error.message }),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      report.errors.console.push({ page: label, message: message.text() });
  });
  page.on("requestfailed", (request) =>
    report.errors.failedRequests.push({
      page: label,
      request: urlLabel(request.url()),
      method: request.method(),
      error: request.failure()?.errorText ?? "unknown network error",
    }),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      report.errors.httpResponses.push({
        page: label,
        request: urlLabel(response.url()),
        status: response.status(),
      });
  });
}

async function installNetworkPolicy(context, origins, label, report) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (["data:", "blob:", "about:"].includes(url.protocol)) {
      await route.continue();
      return;
    }
    const path = url.pathname;
    if (
      GENERATION_PATHS.has(path) ||
      path.startsWith("/api/generation-runs/")
    ) {
      report.network.generationRequests.push({
        page: label,
        request: urlLabel(url.href),
        method: request.method(),
      });
      await route.abort("blockedbyclient");
      return;
    }
    if (!origins.has(url.origin)) {
      report.network.externalRequests.push({
        page: label,
        request: urlLabel(url.href),
      });
      await route.abort("blockedbyclient");
      return;
    }
    if (!["GET", "HEAD"].includes(request.method())) {
      report.network.blockedWrites.push({
        page: label,
        request: urlLabel(url.href),
        method: request.method(),
      });
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

async function addRendererObserver(context) {
  await context.addInitScript(() => {
    const state = { contexts: [] };
    window.__webkitMobileSmokeRenderer = state;
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, options) {
      const context = originalGetContext.call(this, kind, options);
      if (context && ["webgl", "webgl2", "experimental-webgl"].includes(kind)) {
        const debug = context.getExtension("WEBGL_debug_renderer_info");
        state.contexts.push({
          type: kind,
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
      } else if (context && kind === "2d") {
        state.contexts.push({ type: "2d" });
      }
      return context;
    };
  });
}

async function viewportState(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      maxTouchPoints: navigator.maxTouchPoints,
      pointerCoarse: matchMedia("(pointer: coarse)").matches,
      anyPointerCoarse: matchMedia("(any-pointer: coarse)").matches,
      touchEventApi: "ontouchstart" in window,
      horizontalOverflow:
        Math.max(root.scrollWidth, body?.scrollWidth ?? 0) > innerWidth + 1,
      verticalOverflow:
        Math.max(root.scrollHeight, body?.scrollHeight ?? 0) > innerHeight + 1,
    };
  });
}

async function tap(page, name) {
  const button = page.getByRole("button", {
    name,
    exact: typeof name === "string",
  });
  await expect(button).toBeVisible({ timeout: 15_000 });
  const box = await button.boundingBox();
  assert(box && box.width > 0 && box.height > 0, `Missing ${name} control.`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function assertNoOverflow(page, label) {
  const value = await viewportState(page);
  assert.equal(value.width, VIEWPORT.width, `${label} width changed.`);
  assert.equal(value.height, VIEWPORT.height, `${label} height changed.`);
  assert(
    value.pointerCoarse || value.anyPointerCoarse,
    `${label} did not expose a coarse pointer: ${JSON.stringify(value)}`,
  );
  assert(value.touchEventApi, `${label} did not expose touch event support.`);
  assert(
    !value.horizontalOverflow && !value.verticalOverflow,
    `${label} overflows the mobile viewport: ${JSON.stringify(value)}`,
  );
  return value;
}

const editor = validateEditorUrl(EDITOR_URL);
const report = {
  status: "running",
  startedAt: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  evidenceClass: "Playwright WebKit touch emulation; not physical iOS Safari",
  physicalIosSafari: false,
  viewport: { ...VIEWPORT, deviceScaleFactor: 3, touchEmulation: true },
  browser: {
    engine: "WebKit",
    engineVersion: "pending launch",
    executable: webkit.executablePath(),
  },
  editor: {
    url: editor.href,
    buildSourceCommit: process.env.ORBSIE_EDITOR_BUILD_COMMIT ?? null,
    status: "not-started",
    signedOut: false,
    signedOutEvidence: null,
    rendererAvailability: null,
    rendererContexts: [],
    layout: null,
  },
  player: {
    status: "not-started",
    fixture: FIXTURE_ZIP,
    fixtureSha256: null,
    rendererContexts: [],
    renderer: null,
    layout: {},
    checks: {},
  },
  network: {
    generationRequests: [],
    externalRequests: [],
    blockedWrites: [],
  },
  errors: {
    page: [],
    console: [],
    failedRequests: [],
    httpResponses: [],
  },
  cleanup: {},
};

const temporaryRoot = await mkdtemp(join(tmpdir(), "orbsie-webkit-mobile-"));
const artifactDirectory = join(temporaryRoot, "artifact");
let server;
let browser;
let currentPage;
let webkitLaunchAttempted = false;

try {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await mkdir(artifactDirectory, { recursive: true });
  const zipBytes = await readFile(FIXTURE_ZIP);
  report.player.fixtureSha256 = sha256(zipBytes);
  report.player.currentPlayerFiles = await writeFixture(
    artifactDirectory,
    zipBytes,
  );
  server = createReadOnlyServer(artifactDirectory);
  const serverPort = await listen(server);
  const playerOrigin = `http://127.0.0.1:${serverPort}`;

  webkitLaunchAttempted = true;
  browser = await webkit.launch({ headless: true });
  report.browser.engineVersion = browser.version();
  const playwrightPackage = JSON.parse(
    await readFile(
      new URL("../node_modules/playwright/package.json", import.meta.url),
      "utf8",
    ),
  );
  report.browser.playwrightVersion = playwrightPackage.version;

  const mobileOptions = {
    viewport: VIEWPORT,
    screen: VIEWPORT,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  };

  const editorContext = await browser.newContext(mobileOptions);
  await addRendererObserver(editorContext);
  await installNetworkPolicy(
    editorContext,
    new Set([editor.origin]),
    "editor",
    report,
  );
  const editorPage = await editorContext.newPage();
  currentPage = editorPage;
  observePage(editorPage, "editor", report);
  report.editor.initialCookies = (await editorContext.cookies()).length;
  await editorPage.goto(editor.href, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await expect(editorPage.locator("main.app.is-landing")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    editorPage.locator('section[aria-label="Create a world"]'),
  ).toBeVisible();
  await expect(editorPage.locator("#prompt")).toBeVisible();
  await expect(
    editorPage.getByRole("button", { name: "Create", exact: true }),
  ).toBeVisible();
  await expect(
    editorPage.getByRole("button", { name: "Your worlds", exact: true }),
  ).toBeVisible();
  await expect(
    editorPage.getByRole("button", { name: "Connections", exact: true }),
  ).toBeVisible();
  await expect(
    editorPage.locator('main.app[data-renderer-availability="ready"]'),
  ).toBeVisible({ timeout: 60_000 });
  report.editor.rendererAvailability = await editorPage
    .locator("main.app")
    .getAttribute("data-renderer-availability");
  report.editor.rendererContexts = await editorPage.evaluate(
    () => window.__webkitMobileSmokeRenderer.contexts,
  );
  report.editor.layout = await assertNoOverflow(editorPage, "Editor landing");
  await editorPage.screenshot({
    path: join(EVIDENCE_DIRECTORY, "editor-landing.png"),
  });

  await tap(editorPage, "Your worlds");
  const accountDialog = editorPage.locator("dialog.modal");
  await expect(accountDialog).toBeVisible();
  await expect(
    accountDialog.getByRole("heading", {
      name: "A home for your worlds.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(accountDialog).toContainText(
    "Cloud accounts are not connected yet.",
  );
  report.editor.signedOut = true;
  report.editor.signedOutEvidence =
    "zero initial cookies; anonymous account dialog and local-only account notice";
  await tap(editorPage, "Close dialog");
  report.editor.status = "passed";
  await editorContext.close();

  const playerContext = await browser.newContext(mobileOptions);
  await addRendererObserver(playerContext);
  await installNetworkPolicy(
    playerContext,
    new Set([playerOrigin]),
    "player",
    report,
  );
  const playerPage = await playerContext.newPage();
  currentPage = playerPage;
  observePage(playerPage, "player", report);
  await playerPage.goto(`${playerOrigin}/`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await expect(playerPage.locator('main[data-ready="true"]')).toBeVisible({
    timeout: 60_000,
  });
  await expect(playerPage.locator("canvas")).toBeVisible();
  await expect(playerPage.locator(".score")).toHaveText("Score: 0");
  for (const name of ["Forward", "Left", "Back", "Right", "Jump"]) {
    const control = playerPage.getByRole("button", { name, exact: true });
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    assert(box && box.width > 0 && box.height > 0, `Missing ${name} control.`);
  }
  await expect(
    playerPage.getByRole("button", { name: /Restart/ }),
  ).toBeVisible();
  report.player.layout = await assertNoOverflow(playerPage, "Fixture player");
  report.player.rendererContexts = await playerPage.evaluate(
    () => window.__webkitMobileSmokeRenderer.contexts,
  );
  report.player.renderer = (await playerPage.locator(".software-world").count())
    ? "Canvas2D software fallback"
    : report.player.rendererContexts.some((context) =>
          context.type.startsWith("webgl"),
        )
      ? "WebGL"
      : "canvas visible; context type not observed";
  await playerPage.screenshot({
    path: join(EVIDENCE_DIRECTORY, "player-ready.png"),
  });
  report.player.checks.ready = true;

  await tap(playerPage, "Right");
  await expect(playerPage.locator(".score")).toHaveText("Score: 7");
  report.player.checks.touchScore = 7;
  await playerPage.screenshot({
    path: join(EVIDENCE_DIRECTORY, "player-score-7.png"),
  });
  report.player.layout.afterScore = await assertNoOverflow(
    playerPage,
    "Fixture player after touch score",
  );

  await tap(playerPage, /Restart/);
  await expect(playerPage.locator(".score")).toHaveText("Score: 0");
  report.player.checks.restart = true;
  report.player.layout.afterRestart = await assertNoOverflow(
    playerPage,
    "Fixture player after restart",
  );
  await tap(playerPage, "Forward");
  await expect(playerPage.locator(".win")).toContainText("Final score: 0");
  report.player.checks.win = true;
  await playerPage.screenshot({
    path: join(EVIDENCE_DIRECTORY, "player-won.png"),
  });
  report.player.layout.afterWin = await assertNoOverflow(
    playerPage,
    "Fixture player after win",
  );
  await tap(playerPage, /Restart/);
  await expect(playerPage.locator(".score")).toHaveText("Score: 0");
  report.player.layout.afterSecondRestart = await assertNoOverflow(
    playerPage,
    "Fixture player after second restart",
  );
  await tap(playerPage, "Left");
  await expect(playerPage.locator(".win")).toContainText(
    "Try another adventure",
  );
  report.player.checks.loss = true;
  await playerPage.screenshot({
    path: join(EVIDENCE_DIRECTORY, "player-lost.png"),
  });
  report.player.layout.afterLoss = await assertNoOverflow(
    playerPage,
    "Fixture player after loss",
  );
  report.player.status = "passed";
  assert.deepEqual(report.network.generationRequests, []);
  assert.deepEqual(report.network.externalRequests, []);
  assert.deepEqual(report.network.blockedWrites, []);
  assert.deepEqual(report.errors.page, []);
  report.status = "passed";
} catch (error) {
  const message =
    error instanceof Error
      ? error.message.slice(0, 800)
      : "WebKit smoke failed.";
  if (webkitLaunchAttempted && !browser) {
    report.status = "blocked";
    report.blocker = message;
  } else {
    report.status = "failed";
    report.error = message;
  }
  if (currentPage)
    await currentPage
      .screenshot({
        path: join(EVIDENCE_DIRECTORY, "failure.png"),
      })
      .catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser?.close().then(
    () => (report.cleanup.browserClosed = true),
    () => (report.cleanup.browserClosed = false),
  );
  await closeServer(server).then(
    () => (report.cleanup.localServerClosed = true),
    () => (report.cleanup.localServerClosed = false),
  );
  await rm(temporaryRoot, { recursive: true, force: true }).then(
    () => (report.cleanup.temporaryFilesRemoved = true),
    () => (report.cleanup.temporaryFilesRemoved = false),
  );
  report.finishedAt = new Date().toISOString();
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await writeFile(
    join(EVIDENCE_DIRECTORY, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
