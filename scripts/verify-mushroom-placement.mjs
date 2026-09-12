/** Compare the saved and bounds-grounded mushroom poses through the real World renderer. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const directory = join(root, "docs/evidence/mushroom-placement-comparison");
const temporary = await mkdtemp(join(tmpdir(), "orbsie-mushroom-placement-"));
const assetId = "kenney.nature.mushroom-red";
const assetPath = "/models/kenney/nature-kit/mushroom_red.glb";
const assetBytes = await readFile(join(root, "public", assetPath));
const manifest = JSON.parse(
  await readFile(join(root, "assets/catalog/manifest.json"), "utf8"),
);
const asset = manifest.assets.find((candidate) => candidate.id === assetId);
if (!asset) throw new Error(`Catalog asset ${assetId} is missing.`);
const sourceHash = createHash("sha256").update(assetBytes).digest("hex");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const fixtureSha256 = createHash("sha256")
  .update(await readFile(join(root, "scripts/mushroom-placement-fixture.tsx")))
  .digest("hex");
const verifierSha256 = createHash("sha256")
  .update(await readFile(join(root, "scripts/verify-mushroom-placement.mjs")))
  .digest("hex");
const output = {
  schemaVersion: "orbsie.mushroom-placement-comparison/v1",
  checkedAt: new Date().toISOString(),
  sourceCommit,
  harness: { fixtureSha256, verifierSha256 },
  passed: false,
  scope:
    "One bounded local browser comparison through the shared World renderer; no provider, model, account, or external calls.",
  browserAttemptsUsed: 1,
  providerCalls: 0,
  modelCalls: 0,
  accountCalls: 0,
  externalRequests: [],
  sourceAsset: {
    id: assetId,
    path: assetPath,
    bytes: assetBytes.byteLength,
    sha256: sourceHash,
    manifestBytes: asset.sizeBytes,
    manifestSha256: asset.sha256,
    manifestBounds: asset.bounds,
    sourceToRuntime: asset.scale,
  },
  targetTransform: {
    positionXZ: [-5, -1.8],
    scale: [14, 14, 14],
    rotation: [0, 0, 0],
    parent: null,
    tint: "#ff69b4",
    savedY: 0,
    groundedY: -asset.bounds.min[1] * 14,
    savedExpectedMinY: asset.bounds.min[1] * 14,
    groundedExpectedMinY: 0,
    groundingRule:
      "y = -bounds.minY * scaleY; root Y-up, no rotation or parent",
  },
  conditions: [],
};

let server;
let browser;
let page;
const contextExternalRequests = [];
const workerStarts = [];
const assetResponses = [];
const pageErrors = [];
try {
  if (sourceHash !== asset.sha256)
    throw new Error(
      "Checked-in mushroom GLB does not match its manifest SHA-256.",
    );
  if (assetBytes.byteLength !== asset.sizeBytes)
    throw new Error(
      "Checked-in mushroom GLB does not match its manifest size.",
    );
  await mkdir(directory, { recursive: true });
  await build({
    entryPoints: [join(root, "scripts/mushroom-placement-fixture.tsx")],
    bundle: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    outfile: join(temporary, "fixture.js"),
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await build({
    entryPoints: [join(root, "src/lib/asset-geometry-worker.ts")],
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
    } else if (path === assetPath) {
      response.setHeader("Content-Type", "model/gltf-binary");
      response.setHeader("Content-Length", String(assetBytes.byteLength));
      response.end(assetBytes);
    } else if (path === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<!doctype html><title>Mushroom placement comparison</title><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#07100f}</style><div id="root"></div><script type="module" src="/fixture.js"></script>',
      );
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolveServer) =>
    server.listen(0, "127.0.0.1", resolveServer),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) => {
    const requestOrigin = new URL(route.request().url()).origin;
    if (requestOrigin === origin) return route.continue();
    contextExternalRequests.push(route.request().url());
    return route.abort();
  });
  page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      pageErrors.push(message.text().slice(0, 500));
  });
  page.on("worker", (worker) => workerStarts.push(worker.url()));
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === assetPath)
      assetResponses.push(response);
  });
  await page.goto(`${origin}/`);
  await expect
    .poll(
      () =>
        page.evaluate(() => window.mushroomPlacementFixture?.ready() ?? false),
      { timeout: 30_000, intervals: [100, 250, 500] },
    )
    .toBe(true);

  async function captureCondition(label, y, expectedMinY, screenshot) {
    await page.evaluate(
      (nextY) => window.mushroomPlacementFixture.setY(nextY),
      y,
    );
    await expect
      .poll(
        () => page.evaluate(() => window.mushroomPlacementFixture.status()),
        { timeout: 10_000, intervals: [100, 250, 500] },
      )
      .toMatchObject({
        assetReady: true,
        projectPosition: [-5, y, -1.8],
        mesh: {
          visible: true,
          parentVisible: true,
          settled: true,
        },
        islandTransition: { settled: true },
      });
    await expect
      .poll(
        async () => {
          const current = await page.evaluate(() =>
            window.mushroomPlacementFixture.status(),
          );
          return current.mesh?.worldBounds?.min?.[1] ?? Number.NaN;
        },
        { timeout: 10_000, intervals: [100, 250, 500] },
      )
      .toBeCloseTo(expectedMinY, 3);
    const status = await page.evaluate(() =>
      window.mushroomPlacementFixture.status(),
    );
    const worldBounds = status.mesh?.worldBounds;
    const runtimeBounds = status.mesh?.runtimeBounds;
    if (!worldBounds || !runtimeBounds)
      throw new Error(`${label} did not expose rendered and runtime bounds.`);
    const boundsDelta = Math.max(
      ...[0, 1, 2].flatMap((axis) => [
        Math.abs(worldBounds.min[axis] - runtimeBounds.min[axis]),
        Math.abs(worldBounds.max[axis] - runtimeBounds.max[axis]),
      ]),
    );
    if (boundsDelta > 1e-3)
      throw new Error(
        `${label} presentation bounds differ from runtime bounds by ${boundsDelta}.`,
      );
    status.mesh.presentationBoundsDelta = boundsDelta;
    status.mesh.actualRenderedMinY = worldBounds.min[1];
    status.mesh.actualRuntimeMinY = runtimeBounds.min[1];
    await page.screenshot({
      path: join(directory, screenshot),
      animations: "disabled",
    });
    output.conditions.push({
      label,
      targetY: y,
      expectedMinY,
      screenshot,
      status,
    });
    return status;
  }

  const saved = await captureCondition(
    "saved y=0",
    0,
    output.targetTransform.savedExpectedMinY,
    "saved-y.png",
  );
  const grounded = await captureCondition(
    "bounds-grounded y=0.7",
    output.targetTransform.groundedY,
    output.targetTransform.groundedExpectedMinY,
    "grounded-y.png",
  );
  const cameraSavedPosition = saved.camera?.position ?? [];
  const cameraGroundedPosition = grounded.camera?.position ?? [];
  const cameraSavedQuaternion = saved.camera?.quaternion ?? [];
  const cameraGroundedQuaternion = grounded.camera?.quaternion ?? [];
  const sameCameraPosition =
    cameraSavedPosition.length === 3 &&
    cameraGroundedPosition.length === 3 &&
    cameraSavedPosition.every(
      (value, index) => Math.abs(value - cameraGroundedPosition[index]) <= 1e-6,
    );
  const sameCameraQuaternion =
    cameraSavedQuaternion.length === 4 &&
    cameraGroundedQuaternion.length === 4 &&
    cameraSavedQuaternion.every(
      (value, index) =>
        Math.abs(value - cameraGroundedQuaternion[index]) <= 1e-6,
    );
  output.sameCamera = sameCameraPosition && sameCameraQuaternion;
  output.cameraComparison = { sameCameraPosition, sameCameraQuaternion };
  output.renderer = grounded.renderer;
  output.browser = grounded.browser;
  output.worker = {
    starts: workerStarts,
    assetResponseCount: assetResponses.length,
    decodedAssetReady: grounded.assetReady,
  };
  output.externalRequests = [
    ...contextExternalRequests,
    ...(await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => !url.startsWith(location.origin)),
    )),
  ];
  const responseChecks = await Promise.all(
    assetResponses.map(async (response) => {
      const body = await response.body();
      return {
        status: response.status(),
        bytes: body.byteLength,
        sha256: createHash("sha256").update(body).digest("hex"),
        exactSourceBytes: body.equals(assetBytes),
      };
    }),
  );
  output.worker.responses = responseChecks;
  output.pageErrors = pageErrors;
  if (!output.sameCamera)
    throw new Error("Camera changed between placement captures.");
  if (output.externalRequests.length)
    throw new Error("Placement fixture made an external request.");
  if (pageErrors.length)
    throw new Error(`Browser errors: ${pageErrors.join("; ")}`);
  if (
    responseChecks.length !== 1 ||
    !responseChecks.every(
      (response) =>
        response.status === 200 &&
        response.bytes === assetBytes.byteLength &&
        response.sha256 === asset.sha256 &&
        response.exactSourceBytes,
    )
  )
    throw new Error(
      "Browser did not decode the exact checked-in mushroom GLB.",
    );
  output.passed = true;
  await context.close();
} catch (error) {
  output.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (page) {
    const resourceExternalRequests = await page
      .evaluate(() =>
        performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => !url.startsWith(location.origin)),
      )
      .catch(() => []);
    output.externalRequests = [
      ...contextExternalRequests,
      ...resourceExternalRequests,
    ];
    output.networkAuditCompleted = true;
    output.pageErrors = pageErrors;
    output.worker = {
      ...(output.worker ?? {}),
      starts: workerStarts,
      assetResponseCount: assetResponses.length,
    };
  }
  await browser?.close();
  if (server) await new Promise((resolveServer) => server.close(resolveServer));
  await rm(temporary, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "report.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      passed: output.passed,
      sourceCommit: output.sourceCommit,
      conditions: output.conditions.map((condition) => ({
        label: condition.label,
        worldMinY: condition.status?.mesh?.worldBounds?.min?.[1],
        screenshot: condition.screenshot,
      })),
      error: output.error,
    }),
  );
}
