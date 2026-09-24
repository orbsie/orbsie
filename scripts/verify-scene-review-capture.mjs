#!/usr/bin/env node
// Local renderer fixture for the revision-bound capture bridge.
// The generation stream is synthetic and no provider/model request is made.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";

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

const blueBerry = (position) => ({
  shape: "lathe",
  position,
  scale: [1, 1, 1],
  color: "#167de8",
  // Broad at the stem and pointed at the lower tip, unlike a round fruit.
  profile: [
    [0, -0.42],
    [0.13, -0.28],
    [0.25, -0.1],
    [0.3, 0.08],
    [0.28, 0.24],
    [0.16, 0.32],
    [0, 0.34],
  ],
});

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
        {
          type: "reserve_entity",
          entity: {
            id: "fruit-tree",
            label: "Blue-fruited tree",
            position: [-2, 0, 0],
            scale: [1, 1, 1],
            color: "#43864c",
            stage: "seed",
          },
        },
        {
          type: "set_geometry",
          id: "fruit-tree",
          geometry: {
            kind: "tree",
            detail: "refined",
            parts: [
              blueBerry([-0.42, 2.32, 1.16]),
              blueBerry([0.08, 2.48, 1.18]),
              blueBerry([0.48, 2.24, 1.13]),
            ],
          },
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
    await expect(page.locator(".authoring-activity-latest")).toContainText(
      "Generation complete. Changes are applied.",
      { timeout: 15_000 },
    );
    const captureReview = () =>
      page.evaluate(async (expectedRenderer) => {
        const fixture = window.__orbsieSceneReviewFixture?.[expectedRenderer];
        if (!fixture)
          throw new Error(`Missing ${expectedRenderer} capture source.`);
        const state = fixture.read();
        try {
          return await fixture.capture({
            projectId: state.projectId,
            revision: state.revision,
            renderer: expectedRenderer,
            timeoutMs: 10000,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new Error(
            `${message} State: ${JSON.stringify(fixture.read())}`,
          );
        }
      }, renderer);
    const initial = await captureReview();
    assert.equal(initial.renderer, renderer);
    const assertCameraView = (capture) => {
      const view = capture.cameraView;
      assert.ok(view, `Missing ${renderer} camera evidence.`);
      assert.ok(view.position.every(Number.isFinite));
      assert.ok(view.forward.every(Number.isFinite));
      assert.ok(Math.abs(Math.hypot(...view.forward) - 1) < 0.01);
      assert.ok(view.position[2] > 0 && view.forward[2] < 0);
    };
    assertCameraView(initial);
    assert.ok(initial.width > 0 && initial.height > 0);
    assert.ok(Math.max(initial.width, initial.height) <= 768);
    assert.ok(initial.byteLength > 0 && initial.byteLength <= 128 * 1024);
    assert.match(initial.image, /^data:image\/png;base64,/);
    assert.equal(initial.readiness.pendingAssetIds.length, 0);
    assert.equal(initial.readiness.failedAssetIds.length, 0);
    assert.deepEqual(initial.errors, []);
    const countBluePixels = async (image) => {
      const { data, info } = await sharp(
        Buffer.from(image.slice("data:image/png;base64,".length), "base64"),
      )
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let count = 0;
      for (let offset = 0; offset < data.length; offset += info.channels) {
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        if (blue >= 90 && blue - red >= 45 && blue >= green * 1.4) count++;
      }
      return count;
    };
    const initialBluePixels = await countBluePixels(initial.image);
    assert.ok(
      initialBluePixels >= 30,
      `Expected visible blue fruit pixels in ${renderer} initial capture; found ${initialBluePixels}.`,
    );
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
    await expect(page.locator(".authoring-activity-latest")).toContainText(
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
    assert.deepEqual(
      duringReplacement.readyAssetIds,
      renderer === "webgl" ? ["pebble", "fruit-tree"] : [],
    );
    await expect
      .poll(
        () =>
          page.evaluate((expectedRenderer) => {
            const state =
              window.__orbsieSceneReviewFixture?.[expectedRenderer]?.read();
            return state &&
              state.revision > 0 &&
              state.renderedRevision === state.revision &&
              state.pendingAssetIds.length === 0 &&
              state.readyAssetIds.includes("lantern")
              ? state.revision
              : null;
          }, renderer),
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(duringReplacement.revision);
    const replacement = await captureReview();
    assert.equal(replacement.renderer, renderer);
    assertCameraView(replacement);
    assert.ok(
      replacement.byteLength > 0 && replacement.byteLength <= 128 * 1024,
    );
    assert.equal(replacement.readiness.pendingAssetIds.length, 0);
    assert.equal(replacement.readiness.failedAssetIds.length, 0);
    assert.deepEqual(
      replacement.readiness.readyAssetIds,
      renderer === "webgl" ? ["lantern", "pebble", "fruit-tree"] : ["lantern"],
    );
    assert.deepEqual(replacement.errors, []);
    const replacementBluePixels = await countBluePixels(replacement.image);
    assert.ok(
      replacementBluePixels >= 30,
      `Expected visible blue fruit pixels in ${renderer} replacement capture; found ${replacementBluePixels}.`,
    );
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
      cameraViewPresent: true,
      initial: {
        dimensions: { width: initial.width, height: initial.height },
        byteLength: initial.byteLength,
        readiness: initial.readiness,
        blueFruitPixels: initialBluePixels,
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
        blueFruitPixels: replacementBluePixels,
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
