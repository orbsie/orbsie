#!/usr/bin/env node
// Local renderer fixture for the revision-bound capture bridge.
// The generation stream is synthetic and no provider/model request is made.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const base = process.env.TEST_URL ?? "http://localhost:3091";
const appOrigin = new URL(base).origin;
const output = process.argv[2];
if (!output || process.argv.length !== 3)
  throw Error(
    "Usage: node scripts/verify-scene-review-capture.mjs NEW_EVIDENCE_DIRECTORY",
  );
await mkdir(output, { recursive: false });

const report = {
  passed: false,
  scope:
    "local revision-bound game-canvas capture in WebGL and software renderers",
  liveModelCalls: 0,
  externalRequests: [],
  rendererResults: {},
  pageErrors: {},
  consoleErrors: {},
  requestFailures: {},
};

const streamServer = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/api/generate") {
    response.writeHead(404).end();
    return;
  }
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  const commands = body.project?.entities?.length
    ? [{ type: "commit_revision", message: "Applied." }]
    : [
        {
          type: "reserve_entity",
          entity: {
            id: "lantern",
            label: "Lantern",
            position: [0, 0, 0],
            scale: [1, 1, 1],
            color: "#e4c79b",
            stage: "seed",
          },
        },
        {
          type: "set_geometry",
          id: "lantern",
          geometry: { kind: "platform", detail: "refined", tint: "#e4c79b" },
        },
        {
          type: "reserve_entity",
          entity: {
            id: "pebble",
            label: "Pebble",
            position: [2, 0, 0],
            scale: [0.7, 0.7, 0.7],
            color: "#7b9b83",
            stage: "seed",
          },
        },
        {
          type: "set_geometry",
          id: "pebble",
          geometry: { kind: "rock", detail: "refined", tint: "#7b9b83" },
        },
        { type: "commit_revision", message: "Applied." },
      ];
  if (body.project?.entities?.length)
    commands.splice(
      0,
      commands.length,
      {
        type: "set_geometry",
        id: "lantern",
        geometry: {
          kind: "asset",
          assetId: "kenney.nature.tree-default",
          detail: "refined",
        },
      },
      { type: "commit_revision", message: "Applied." },
    );
  response.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  for (const command of commands) {
    await new Promise((resolve) => setTimeout(resolve, 45));
    if (response.destroyed) return;
    response.write(`${JSON.stringify(command)}\n`);
  }
  response.end();
});
await new Promise((resolve) => streamServer.listen(0, "127.0.0.1", resolve));
streamServer.unref();
const streamOrigin = `http://127.0.0.1:${streamServer.address().port}`;

async function runRenderer(renderer) {
  const args =
    renderer === "software"
      ? ["--disable-gpu"]
      : [
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
        ];
  const browser = await chromium.launch({ args: ["--no-sandbox", ...args] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript(() => {
    window.__orbsieSceneReviewFixture = {};
  });
  if (renderer === "software")
    await context.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, attributes) {
        if (
          kind === "webgl2" ||
          kind === "webgl" ||
          kind === "experimental-webgl"
        )
          return null;
        return getContext.call(this, kind, attributes);
      };
    });
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  const unexpectedRequests = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    requestFailures.push({
      url: request.url(),
      failure: request.failure()?.errorText ?? "unknown",
    }),
  );
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.protocol.startsWith("http") &&
      url.origin !== appOrigin &&
      url.origin !== streamOrigin
    ) {
      unexpectedRequests.push(url.href);
      await route.abort();
      return;
    }
    await route.fallback();
  });
  await context.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        accounts: false,
        publishing: false,
        google: false,
        chatgptHosted: false,
        chatgptGeneration: false,
      },
    }),
  );
  await context.route("**/api/trial", (route) =>
    route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } }),
  );
  await context.route("**/api/models", (route) =>
    route.fulfill({ json: { models: [] } }),
  );
  await context.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [] } }),
  );
  await context.route("**/api/generate", (route) =>
    route.continue({ url: `${streamOrigin}/api/generate` }),
  );
  await context.route(
    "**/models/kenney/nature-kit/tree_default.glb",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 650));
      await route.continue();
    },
  );
  try {
    await page.goto(`${base}/?sceneReviewFixture=1`);
    await expect(page.locator("canvas")).toBeVisible();
    await expect(
      page.locator("[data-renderer-availability=ready]"),
    ).toBeVisible();
    await page
      .getByPlaceholder("What experience to build?")
      .fill("Build a lantern");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator(".authoring-activity-latest")).toHaveText(
      "Generation complete. Changes are applied.",
      { timeout: 15_000 },
    );
    const captureReview = () =>
      page.evaluate(async (expectedRenderer) => {
        const fixture = window.__orbsieSceneReviewFixture?.[expectedRenderer];
        if (!fixture)
          throw new Error(`Missing ${expectedRenderer} capture source.`);
        const state = fixture.read();
        return fixture.capture({
          projectId: state.projectId,
          revision: state.revision,
          renderer: expectedRenderer,
          timeoutMs: 5000,
        });
      }, renderer);
    const initial = await captureReview();
    assert.equal(initial.renderer, renderer);
    assert.ok(initial.width > 0 && initial.height > 0);
    assert.ok(Math.max(initial.width, initial.height) <= 512);
    assert.ok(initial.byteLength > 0 && initial.byteLength <= 128 * 1024);
    assert.match(initial.image, /^data:image\/png;base64,/);
    assert.equal(initial.readiness.pendingAssetIds.length, 0);
    assert.equal(initial.readiness.failedAssetIds.length, 0);
    assert.deepEqual(initial.errors, []);
    const initialState = await page.evaluate((expectedRenderer) => {
      const fixture = window.__orbsieSceneReviewFixture?.[expectedRenderer];
      if (!fixture)
        throw new Error(`Missing ${expectedRenderer} capture source.`);
      return fixture.read();
    }, renderer);
    await page.locator("#prompt").fill("Replace the lantern");
    await page
      .getByRole("button", { name: "Change this", exact: true })
      .click();
    await expect(page.locator(".authoring-activity-latest")).toHaveText(
      "Generation complete. Changes are applied.",
      { timeout: 15_000 },
    );
    await expect
      .poll(
        () =>
          page.evaluate((expectedRenderer) => {
            const fixture =
              window.__orbsieSceneReviewFixture?.[expectedRenderer];
            return fixture?.read() ?? null;
          }, renderer),
        { timeout: 5000 },
      )
      .toMatchObject({
        projectId: initialState.projectId,
        pendingAssetIds: ["lantern"],
      });
    const duringReplacement = await page.evaluate((expectedRenderer) => {
      const fixture = window.__orbsieSceneReviewFixture?.[expectedRenderer];
      if (!fixture)
        throw new Error(`Missing ${expectedRenderer} capture source.`);
      return fixture.read();
    }, renderer);
    assert.equal(duringReplacement.projectId, initialState.projectId);
    assert.ok(duringReplacement.revision > initialState.revision);
    assert.deepEqual(duringReplacement.readyAssetIds, ["pebble"]);
    const replacement = await captureReview();
    assert.equal(replacement.renderer, renderer);
    assert.ok(
      replacement.byteLength > 0 && replacement.byteLength <= 128 * 1024,
    );
    assert.equal(replacement.readiness.pendingAssetIds.length, 0);
    assert.equal(replacement.readiness.failedAssetIds.length, 0);
    assert.deepEqual(replacement.readiness.readyAssetIds, [
      "lantern",
      "pebble",
    ]);
    assert.deepEqual(replacement.errors, []);
    assert.deepEqual(unexpectedRequests, []);
    const expectedPageErrors =
      renderer === "software"
        ? pageErrors.filter(
            (message) =>
              message === "THREE.WebGLRenderer: Error creating WebGL context.",
          )
        : [];
    assert.deepEqual(
      pageErrors.filter((message) => !expectedPageErrors.includes(message)),
      [],
    );
    report.rendererResults[renderer] = {
      projectId: replacement.projectId,
      initialRevision: initial.revision,
      replacementRevision: replacement.revision,
      renderer: replacement.renderer,
      initial: {
        dimensions: { width: initial.width, height: initial.height },
        byteLength: initial.byteLength,
        readiness: initial.readiness,
      },
      duringReplacement: {
        revision: duringReplacement.revision,
        readyAssetIds: duringReplacement.readyAssetIds,
        pendingAssetIds: duringReplacement.pendingAssetIds,
        failedAssetIds: duringReplacement.failedAssetIds,
      },
      replacement: {
        dimensions: { width: replacement.width, height: replacement.height },
        byteLength: replacement.byteLength,
        readiness: replacement.readiness,
      },
      pngDataUrl: true,
      unexpectedRequests,
    };
    await writeFile(
      `${output}/${renderer}-initial-review.png`,
      Buffer.from(
        initial.image.slice("data:image/png;base64,".length),
        "base64",
      ),
    );
    await writeFile(
      `${output}/${renderer}-replacement-review.png`,
      Buffer.from(
        replacement.image.slice("data:image/png;base64,".length),
        "base64",
      ),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.locator("canvas").evaluate(canvas => canvas.clientWidth / canvas.clientHeight)).toBeLessThan(0.8);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const portrait = await captureReview();
    const canvasSize = await page.locator("canvas").evaluate(canvas => ({ width: canvas.width, height: canvas.height }));
    assert.ok(portrait.width < portrait.height);
    assert.ok(Math.abs(portrait.width / portrait.height - canvasSize.width / canvasSize.height) < 0.01);
    assert.ok(portrait.byteLength <= 128 * 1024);
    assert.equal(portrait.projectId, replacement.projectId);
    assert.equal(portrait.revision, replacement.revision);
    report.rendererResults[renderer].portrait = { width: portrait.width, height: portrait.height, byteLength: portrait.byteLength, canvasSize, projectId: portrait.projectId, revision: portrait.revision };
    await writeFile(`${output}/${renderer}-portrait-review.png`, Buffer.from(portrait.image.split(",")[1], "base64"));
    await page.screenshot({ path: `${output}/${renderer}-page.png` });
  } finally {
    report.pageErrors[renderer] = pageErrors;
    report.consoleErrors[renderer] = consoleErrors;
    report.requestFailures[renderer] = requestFailures;
    await browser.close();
  }
}

try {
  await runRenderer("webgl");
  await runRenderer("software");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
}
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
