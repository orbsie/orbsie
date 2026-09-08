/** Compare the real World renderer with local procedural and catalog trees. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const directory = "docs/evidence/catalog-comparison";
const temporary = await mkdtemp(join(tmpdir(), "orbsie-catalog-comparison-"));
const catalogPath = "/models/kenney/nature-kit/tree_default.glb";
const modes = ["procedural-only", "catalog-only", "mixed"];
const report = {
  schemaVersion: "orbsie.catalog-comparison/v1",
  checkedAt: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  passed: false,
  scope:
    "Deterministic local WebGL rendering and asset preparation comparison using the shared World renderer.",
  providerCalls: 0,
  dataSources: {
    modelProvider: "none",
    externalStorage: "none",
    catalog: "checked-in local GLB",
  },
  externalRequests: [],
  comparison: {
    basis: "rawTimings",
    performancePass: "not-evaluated",
    statement:
      "Timings describe this local browser, renderer, and cold-context run; they do not establish a speed claim or device performance guarantee.",
  },
  modes: [],
};
const catalogBytes = await readFile(`public${catalogPath}`);
let server;
let browser;
try {
  await mkdir(directory, { recursive: true });
  await build({
    entryPoints: ["scripts/catalog-comparison-fixture.tsx"],
    bundle: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    outfile: join(temporary, "fixture.js"),
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await build({
    entryPoints: ["src/lib/asset-geometry-worker.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    outfile: join(temporary, "asset-geometry-worker.js"),
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const fixture = await readFile(join(temporary, "fixture.js"));
  const assetWorker = await readFile(
    join(temporary, "asset-geometry-worker.js"),
  );
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture.local").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (path === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(fixture);
    } else if (path === "/player/asset-geometry-worker.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(assetWorker);
    } else if (path === catalogPath) {
      response.setHeader("Content-Type", "model/gltf-binary");
      response.setHeader("Content-Length", String(catalogBytes.byteLength));
      response.end(catalogBytes);
    } else if (path === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<!doctype html><title>Catalog comparison fixture</title><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#07100f}</style><div id="root"></div><script type="module" src="/fixture.js"></script>',
      );
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

  for (const mode of modes) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      serviceWorkers: "block",
    });
    const contextExternalRequests = [];
    await context.route("**/*", (route) => {
      const requestOrigin = new URL(route.request().url()).origin;
      if (requestOrigin === origin) return route.continue();
      contextExternalRequests.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const starts = [];
      let decoded = 0;
      window.__catalogComparisonWorkerStarts = starts;
      window.__catalogComparisonWorkerDecoded = () => decoded;
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(scriptURL, options) {
          starts.push(String(scriptURL));
          super(scriptURL, options);
          this.addEventListener("message", (event) => {
            if (event.data?.decoded) decoded++;
          });
        }
      };
    });
    const errors = [];
    const modelResponses = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 500));
    });
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === catalogPath)
        modelResponses.push(response);
    });
    await page.goto(`${origin}/?mode=${mode}`);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.catalogComparisonFixture?.ready() ?? false,
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    const status = await page.evaluate(() =>
      window.catalogComparisonFixture.status(),
    );
    const workerStarts = await page.evaluate(
      () => window.__catalogComparisonWorkerStarts ?? [],
    );
    const workerDecoded = await page.evaluate(
      () => window.__catalogComparisonWorkerDecoded?.() ?? 0,
    );
    const assetResponses = await Promise.all(
      modelResponses.map(async (response) => {
        const body = await response.body();
        assert.ok(
          body.equals(catalogBytes),
          `${mode} catalog response differs from the checked-in GLB`,
        );
        return { status: response.status(), bytes: body.byteLength };
      }),
    );
    const modeExternalRequests = [
      ...contextExternalRequests,
      ...(await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => !url.startsWith(location.origin)),
      )),
    ];
    report.externalRequests.push(...modeExternalRequests);
    const updates = status.metrics?.sceneUpdates ?? [];
    assert.equal(status.mode, mode);
    assert.equal(updates.length, 3);
    assert.ok(updates.every((sample) => Number.isFinite(sample.acceptedAt)));
    assert.ok(
      updates.every(
        (sample) =>
          Number.isFinite(sample.drawnAt) &&
          Number.isFinite(sample.latencyMs) &&
          sample.drawnAt >= sample.acceptedAt &&
          sample.latencyMs >= 0,
      ),
      `${mode} has an incomplete or nonfinite entity draw sample`,
    );
    assert.deepEqual(errors, [], `${mode} reported browser errors`);
    assert.deepEqual(
      modeExternalRequests,
      [],
      `${mode} made an external request`,
    );
    const assetMode = mode !== "procedural-only";
    if (assetMode) {
      assert.ok(
        assetResponses.length > 0,
        `${mode} did not request the catalog GLB`,
      );
      assert.ok(
        assetResponses.every(
          (response) =>
            response.status === 200 &&
            response.bytes === catalogBytes.byteLength,
        ),
        `${mode} did not receive the expected catalog bytes`,
      );
      assert.ok(
        workerStarts.some((url) =>
          url.endsWith("/player/asset-geometry-worker.js"),
        ),
        `${mode} did not start the built catalog asset worker`,
      );
      assert.ok(
        workerDecoded > 0,
        `${mode} asset worker returned no decoded geometry`,
      );
    } else {
      assert.equal(assetResponses.length, 0);
      assert.equal(workerStarts.length, 0);
      assert.equal(workerDecoded, 0);
    }
    const drawnAt = updates.map((sample) => sample.drawnAt);
    const frameIntervals = status.frameIntervals.filter(
      (interval) => Number.isFinite(interval) && interval >= 0,
    );
    assert.equal(frameIntervals.length, status.frameIntervals.length);
    const rawTimings = {
      submissionToFirstEntityDrawMs: Math.min(...drawnAt),
      submissionToAllThreeDrawsMs: Math.max(...drawnAt),
      entityDraws: updates.map((sample) => ({
        entityId: sample.entityId,
        acceptedAtMs: sample.acceptedAt,
        drawnAtMs: sample.drawnAt,
        drawLatencyMs: sample.latencyMs,
      })),
      preparationFrameIntervalsMs: frameIntervals,
      preparationFrameIntervalSampleCount: frameIntervals.length,
      preparationFrameIntervalSampleLimit: 120,
      preparationFrameIntervalSampleOverflow: status.frameIntervalOverflow,
      preparationFrameIntervalSamplesTooFew: frameIntervals.length < 3,
      preparationFrameIntervalSampleNote:
        frameIntervals.length < 3
          ? "Fewer than three intervals were observed before readiness; retained as an explicit raw sample limitation."
          : undefined,
    };
    report.modes.push({
      mode,
      project: status.project,
      renderer: status.renderer,
      browser: status.browser,
      sceneComplexity: status.sceneComplexity,
      coldCache: {
        freshBrowserContext: true,
        cacheControl: "no-store",
        serviceWorkers: "blocked",
      },
      catalog: {
        assetPath: catalogPath,
        bytesExpected: catalogBytes.byteLength,
        bytesRequested: assetResponses.reduce(
          (total, response) => total + response.bytes,
          0,
        ),
        requestCount: assetResponses.length,
        workerStarts,
        workerDecoded,
      },
      rawTimings,
      errors,
      externalRequests: modeExternalRequests,
    });
    await context.close();
  }
  assert.equal(report.modes.length, 3);
  assert.deepEqual(report.externalRequests, []);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await writeFile(
    `${directory}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
