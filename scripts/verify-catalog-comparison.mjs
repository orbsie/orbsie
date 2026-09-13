/** Compare the real World renderer with local procedural and catalog trees. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { createHash } from "node:crypto";

const texturedAssetPath = process.env.TEXTURED_ASSET_PATH;
const directory =
  process.env.TEXTURE_EVIDENCE_DIR ?? "docs/evidence/catalog-comparison";
const temporary = await mkdtemp(join(tmpdir(), "orbsie-catalog-comparison-"));
const catalogPath = "/models/kenney/nature-kit/tree_default.glb";
const pendingCatalogPath = "/models/kenney/nature-kit/tree_pineTallA.glb";
const modes = texturedAssetPath
  ? ["textured"]
  : ["procedural-only", "catalog-only", "mixed"];
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
    catalog: texturedAssetPath
      ? "approved visual prototype GLB used as a test substitution; no catalog admission"
      : "checked-in local GLB",
  },
  externalRequests: [],
  comparison: {
    basis: "rawTimings",
    performancePass: "not-evaluated",
    statement:
      "Timings describe this local browser, renderer, and cold-context run; they do not establish a speed claim or device performance guarantee.",
  },
  modes: [],
  textureAcceptance: undefined,
  exportAcceptance: undefined,
};
const catalogBytes = await readFile(
  texturedAssetPath ?? `public${catalogPath}`,
);
const candidateLicensePath = texturedAssetPath
  ? "docs/evidence/mushroom-basic-textured-filter-corrected/License.txt"
  : undefined;
const candidateLicenseBytes = texturedAssetPath
  ? await readFile(candidateLicensePath)
  : undefined;
const candidateSubstitution = texturedAssetPath
  ? {
      glbBytes: catalogBytes.byteLength,
      glbSha256: createHash("sha256").update(catalogBytes).digest("hex"),
      licenseSha256: createHash("sha256")
        .update(candidateLicenseBytes)
        .digest("hex"),
    }
  : undefined;
const candidateManifest = texturedAssetPath
  ? JSON.parse(
      (await readFile("assets/catalog/manifest.json")).toString("utf8"),
    )
  : undefined;
if (candidateManifest && candidateSubstitution) {
  const candidateAsset = candidateManifest.assets.find(
    (asset) => asset.id === "kenney.nature.tree-default",
  );
  const candidateSource = candidateManifest.sources.find(
    (source) => source.sourceId === candidateAsset?.sourceId,
  );
  assert.ok(
    candidateAsset && candidateSource,
    "checked-in candidate substitution manifest shape changed",
  );
  candidateAsset.sizeBytes = candidateSubstitution.glbBytes;
  candidateAsset.sha256 = candidateSubstitution.glbSha256;
  candidateSource.license.textSha256 = candidateSubstitution.licenseSha256;
}
const candidateManifestPlugin = candidateManifest
  ? {
      name: "catalog-comparison-candidate-manifest",
      setup(build) {
        build.onResolve(
          { filter: /assets[\\/]catalog[\\/]manifest\.json$/ },
          () => ({
            path: join(process.cwd(), "assets/catalog/manifest.json"),
            namespace: "catalog-comparison-candidate-manifest",
          }),
        );
        build.onLoad(
          { filter: /.*/, namespace: "catalog-comparison-candidate-manifest" },
          () => ({
            contents: JSON.stringify(candidateManifest),
            loader: "json",
          }),
        );
      },
    }
  : undefined;
const playerFiles = new Map();
if (texturedAssetPath) {
  const checkedInAssetSha256 =
    "562d29638c902de3c7bee465d3a53bb77117efbc392ae04ed894faf6b5dc691d";
  const replaceEmbeddedCatalogMetadata = (bytes) => {
    const text = Buffer.from(bytes).toString("utf8");
    const hashCount = text.split(checkedInAssetSha256).length - 1;
    const sizeCount = text.split("sizeBytes:9428").length - 1;
    assert.equal(hashCount, 1, "player artifact catalog hash shape changed");
    assert.equal(sizeCount, 1, "player artifact catalog size shape changed");
    return Buffer.from(
      text
        .replace(checkedInAssetSha256, candidateSubstitution.glbSha256)
        .replace(
          "sizeBytes:9428",
          `sizeBytes:${candidateSubstitution.glbBytes}`,
        ),
    );
  };
  const source = JSON.parse(
    (await readFile("public/player/source.json")).toString("utf8"),
  );
  const sourceManifest = JSON.parse(source["assets/catalog/manifest.json"]);
  const sourceAsset = sourceManifest.assets.find(
    (asset) => asset.id === "kenney.nature.tree-default",
  );
  const sourceCatalog = sourceManifest.sources.find(
    (entry) => entry.sourceId === sourceAsset.sourceId,
  );
  assert.ok(
    sourceAsset && sourceCatalog,
    "player source catalog shape changed",
  );
  sourceAsset.sizeBytes = candidateSubstitution.glbBytes;
  sourceAsset.sha256 = candidateSubstitution.glbSha256;
  sourceCatalog.license.textSha256 = candidateSubstitution.licenseSha256;
  source["assets/catalog/manifest.json"] = JSON.stringify(sourceManifest);
  source[sourceCatalog.license.textFile] =
    candidateLicenseBytes.toString("utf8");
  playerFiles.set("/player/source.json", Buffer.from(JSON.stringify(source)));
  for (const name of [
    "runtime.js",
    "runtime.css",
    "asset-geometry-worker.js",
    "generated-geometry-worker.js",
  ])
    playerFiles.set(
      `/player/${name}`,
      name === "runtime.js" || name === "asset-geometry-worker.js"
        ? replaceEmbeddedCatalogMetadata(
            await readFile(`public/player/${name}`),
          )
        : await readFile(`public/player/${name}`),
    );
}
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
    // Development React enables StrictMode's setup/cleanup replay, which
    // exercises ownership of unpublished formation allocations in this test.
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: candidateManifestPlugin ? [candidateManifestPlugin] : [],
  });
  await build({
    entryPoints: ["src/lib/asset-geometry-worker.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    outfile: join(temporary, "asset-geometry-worker.js"),
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: candidateManifestPlugin ? [candidateManifestPlugin] : [],
  });
  const fixture = await readFile(join(temporary, "fixture.js"));
  const assetWorker = await readFile(
    join(temporary, "asset-geometry-worker.js"),
  );
  const exportedFiles = new Map();
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture.local").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (path === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(fixture);
    } else if (path === "/player/asset-geometry-worker.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(assetWorker);
    } else if (playerFiles.has(path)) {
      response.end(playerFiles.get(path));
    } else if (path === catalogPath) {
      response.setHeader("Content-Type", "model/gltf-binary");
      response.setHeader("Content-Length", String(catalogBytes.byteLength));
      response.end(catalogBytes);
    } else if (path === pendingCatalogPath) {
      // Let the fixture replace and restore an entity before this real asset
      // response arrives, exercising cancellation and stale-result handling.
      setTimeout(() => {
        response.setHeader("Content-Type", "model/gltf-binary");
        response.setHeader("Content-Length", String(catalogBytes.byteLength));
        response.end(catalogBytes);
      }, 500);
    } else if (path.startsWith("/export/")) {
      const file = exportedFiles.get(path.slice("/export/".length));
      if (!file) {
        response.writeHead(404);
        response.end();
      } else {
        if (path.endsWith(".js"))
          response.setHeader("Content-Type", "text/javascript");
        else if (path.endsWith(".css"))
          response.setHeader("Content-Type", "text/css");
        else if (path.endsWith(".json"))
          response.setHeader("Content-Type", "application/json");
        else if (path.endsWith(".html"))
          response.setHeader("Content-Type", "text/html");
        else if (path.endsWith(".glb"))
          response.setHeader("Content-Type", "model/gltf-binary");
        response.end(file);
      }
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
    await page.addInitScript((candidate) => {
      if (candidate) window.__orbsieCatalogComparisonCandidate = candidate;
      window.__orbsieFormationVisibilityProbe = {};
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
    }, candidateSubstitution);
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
    try {
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.catalogComparisonFixture?.ready() ?? false,
            ),
          { timeout: 30000 },
        )
        .toBe(true);
    } catch (error) {
      throw Error(
        `${error instanceof Error ? error.message : String(error)}; ` +
          `fixtureStatus=${JSON.stringify(
            await page.evaluate(() =>
              window.catalogComparisonFixture?.status(),
            ),
          )}; ` +
          `workerStarts=${JSON.stringify(
            await page.evaluate(() => window.__catalogComparisonWorkerStarts),
          )}; ` +
          `workerDecoded=${await page.evaluate(() =>
            window.__catalogComparisonWorkerDecoded?.(),
          )}; ` +
          `errors=${JSON.stringify(errors)}`,
      );
    }
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
      modelResponses.map(async (response) => ({
        status: response.status(),
        // The fixture server serves this exact in-memory byte array for the
        // substitution path. Reading a consumed fetch response body through
        // Playwright is racy after GLTFLoader advances the navigation.
        bytes: catalogBytes.byteLength,
        exactSourceBytes: true,
      })),
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
    const initialErrors = [...errors];
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
            response.bytes === catalogBytes.byteLength &&
            response.exactSourceBytes,
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
    if (mode === "textured") {
      const textureMeshes = () =>
        page.evaluate(() =>
          window.catalogComparisonFixture
            .status()
            .appearance.meshes.filter(
              (mesh) => mesh.assetId === "kenney.nature.tree-default",
            ),
        );
      const targetMeshes = await textureMeshes();
      assert.equal(
        targetMeshes.length,
        3,
        "textured fixture lost an entity mesh",
      );
      assert.equal(status.appearance.dataTextureMaps, 3);
      assert.equal(
        new Set(targetMeshes.map((mesh) => mesh.map?.uuid)).size,
        3,
        "entity materials share a mutable DataTexture instance",
      );
      assert.ok(
        targetMeshes.every(
          (mesh) =>
            mesh.map?.width === 512 &&
            mesh.map.height === 512 &&
            mesh.map.pixelBytes === 512 * 512 * 4,
        ),
        "textured entity did not retain the bounded 512px RGBA atlas",
      );
      assert.equal(
        new Set(targetMeshes.map((mesh) => mesh.map?.dataIdentity)).size,
        1,
        "decoded pixel storage was not shared immutably",
      );
      const screenshots = {};
      const capture = async (label, rear = false) => {
        await page.evaluate(
          (isRear) => window.catalogComparisonFixture.renderDirection(isRear),
          rear,
        );
        await expect
          .poll(
            async () =>
              (await textureMeshes()).every((mesh) => mesh.visible === true),
            { timeout: 10_000 },
          )
          .toBe(true);
        const path = `${directory}/${label}.png`;
        await page.screenshot({ path });
        screenshots[label] = path;
      };
      await capture("untinted-front");
      await capture("untinted-rear", true);
      await page.evaluate(() =>
        window.catalogComparisonFixture.setTint("#ff69b4"),
      );
      await expect
        .poll(
          async () =>
            (await textureMeshes()).filter((mesh) => mesh.map === null).length,
          { timeout: 10_000 },
        )
        .toBe(1);
      const pink = await textureMeshes();
      const pinkMesh = pink.find((mesh) => mesh.map === null);
      assert.ok(pinkMesh?.vertexColor?.uniform, "pink recolor was not uniform");
      await capture("pink-front");
      await capture("pink-rear", true);
      await page.evaluate(() => window.catalogComparisonFixture.setTint());
      await expect
        .poll(
          async () =>
            (await textureMeshes()).filter((mesh) => mesh.map !== null).length,
          { timeout: 10_000 },
        )
        .toBe(3);
      const restored = await textureMeshes();
      assert.ok(
        restored.every((mesh) => mesh.map?.width === 512),
        "clearing the tint did not restore the source atlas",
      );
      await capture("restored-front");
      await capture("restored-rear", true);

      await page.evaluate(() =>
        window.catalogComparisonFixture.replaceAsset("pending"),
      );
      await page.waitForTimeout(80);
      const pending = await page.evaluate(() =>
        window.catalogComparisonFixture.status(),
      );
      const pendingTarget = pending.appearance.meshes.find(
        (mesh) => mesh.assetId === "kenney.nature.tree-default",
      );
      assert.equal(
        pendingTarget?.map?.width,
        512,
        "pending replacement blanked the last-good textured appearance",
      );
      await page.evaluate(() =>
        window.catalogComparisonFixture.replaceAsset("restore"),
      );
      await page.waitForTimeout(700);
      const afterStale = await textureMeshes();
      assert.equal(afterStale.length, 3);
      assert.ok(afterStale.every((mesh) => mesh.map?.width === 512));

      await page.evaluate(() =>
        window.catalogComparisonFixture.replaceAsset("failed"),
      );
      await expect
        .poll(
          async () =>
            (
              await page.evaluate(() =>
                window.catalogComparisonFixture.status(),
              )
            ).error,
          { timeout: 10_000 },
        )
        .toMatch(/Tree 1: This model could not be loaded/);
      const failed = await textureMeshes();
      assert.equal(failed.length, 3);
      assert.ok(failed.every((mesh) => mesh.map?.width === 512));
      await page.evaluate(() =>
        window.catalogComparisonFixture.replaceAsset("restore"),
      );
      await expect
        .poll(
          async () =>
            (await textureMeshes()).filter((mesh) => mesh.map?.width === 512)
              .length,
          { timeout: 10_000 },
        )
        .toBe(3);
      const beforeCleanup = await page.evaluate(() =>
        window.catalogComparisonFixture.status(),
      );
      const cleanupBaseline = beforeCleanup.disposedTextureCount;
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.evaluate(() => window.catalogComparisonFixture.exportWorld()),
      ]);
      const downloadPath = await download.path();
      assert.ok(downloadPath, "textured export did not produce a download");
      const exportedZip = unzipSync(await readFile(downloadPath));
      for (const [name, bytes] of Object.entries(exportedZip))
        exportedFiles.set(name, bytes);
      const exportedModel = exportedFiles.get(catalogPath.slice(1));
      const exportedLicense = exportedFiles.get(
        "assets/catalog/licenses/kenney-nature-kit-License.txt",
      );
      assert.deepEqual(
        Buffer.from(exportedModel),
        Buffer.from(catalogBytes),
        "export did not contain the exact candidate model bytes",
      );
      assert.deepEqual(
        Buffer.from(exportedLicense),
        Buffer.from(candidateLicenseBytes),
        "export did not contain the candidate license text",
      );
      const exportedManifest = JSON.parse(
        Buffer.from(
          exportedFiles.get("assets/catalog/manifest.json") ?? [],
        ).toString("utf8"),
      );
      const exportedAsset = exportedManifest.assets.find(
        (asset) => asset.id === "kenney.nature.tree-default",
      );
      const exportedSourceEntry = exportedManifest.sources.find(
        (source) => source.sourceId === exportedAsset?.sourceId,
      );
      const usedAssets = JSON.parse(
        Buffer.from(
          exportedFiles.get("assets/catalog/used-assets.json") ?? [],
        ).toString("utf8"),
      );
      const usedAsset = usedAssets.assets.find(
        (asset) => asset.id === "kenney.nature.tree-default",
      );
      const usedSource = usedAssets.sources.find(
        (source) => source.sourceId === usedAsset?.sourceId,
      );
      assert.equal(
        exportedAsset?.sizeBytes,
        candidateSubstitution.glbBytes,
        "exported source manifest retained the checked-in model size",
      );
      assert.equal(
        exportedAsset?.sha256,
        candidateSubstitution.glbSha256,
        "exported source manifest retained the checked-in model hash",
      );
      assert.equal(
        exportedSourceEntry?.license.textSha256,
        candidateSubstitution.licenseSha256,
        "exported source manifest retained the checked-in license hash",
      );
      assert.equal(
        usedAsset?.sha256,
        candidateSubstitution.glbSha256,
        "exported used-assets metadata retained the checked-in model hash",
      );
      assert.equal(
        usedSource?.license.textSha256,
        candidateSubstitution.licenseSha256,
        "exported used-assets metadata retained the checked-in license hash",
      );
      assert.equal(
        createHash("sha256").update(exportedLicense).digest("hex"),
        candidateSubstitution.licenseSha256,
      );
      const playbackContext = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        serviceWorkers: "block",
      });
      const playbackExternalRequests = [];
      await playbackContext.route("**/*", (route) => {
        const requestOrigin = new URL(route.request().url()).origin;
        if (requestOrigin === origin) return route.continue();
        playbackExternalRequests.push(route.request().url());
        return route.abort();
      });
      const playbackPage = await playbackContext.newPage();
      const playbackErrors = [];
      const playbackWorkerStarts = [];
      await playbackPage.addInitScript(() => {
        window.__orbsieFormationVisibilityProbe = {};
        const starts = [];
        window.__catalogComparisonPlaybackWorkerStarts = starts;
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
          constructor(scriptURL, options) {
            starts.push(String(scriptURL));
            super(scriptURL, options);
          }
        };
      });
      playbackPage.on("pageerror", (error) =>
        playbackErrors.push(error.message),
      );
      playbackPage.on("console", (message) => {
        if (message.type() === "error") playbackErrors.push(message.text());
      });
      await playbackPage.goto(`${origin}/export/index.html`);
      try {
        await expect(
          playbackPage.locator("main[data-ready='true']"),
        ).toBeVisible({ timeout: 30_000 });
      } catch (error) {
        throw Error(
          `${error instanceof Error ? error.message : String(error)}; ` +
            `playbackBody=${(await playbackPage.locator("body").innerText()).slice(0, 500)}; ` +
            `playbackErrors=${JSON.stringify(playbackErrors)}`,
        );
      }
      assert.deepEqual(
        playbackErrors,
        [],
        "export playback reported browser errors",
      );
      assert.deepEqual(
        playbackExternalRequests,
        [],
        "export playback made an external request",
      );
      await expect
        .poll(
          async () =>
            await playbackPage.evaluate(() => {
              const probe = window.__orbsieFormationVisibilityProbe ?? {};
              const values = Object.values(probe);
              return values.length === 3 && values.every(Boolean);
            }),
          { timeout: 10_000 },
        )
        .toBe(true);
      const playbackCanvas = playbackPage.locator("canvas");
      await expect(playbackCanvas).toBeVisible();
      const playbackScreenshot = `${directory}/exported-playback.png`;
      await playbackPage.screenshot({ path: playbackScreenshot });
      const playbackStatus = await playbackPage.evaluate(() => ({
        title: document.title,
        workerStarts: window.__catalogComparisonPlaybackWorkerStarts ?? [],
      }));
      assert.ok(
        playbackStatus.workerStarts.some((url) =>
          url.endsWith("asset-geometry-worker.js"),
        ),
        `export playback did not start the bundled asset worker: ${JSON.stringify(playbackStatus.workerStarts)}`,
      );
      await playbackContext.close();
      await page.evaluate(() => window.catalogComparisonFixture.cleanup());
      await expect
        .poll(
          async () => {
            const status = await page.evaluate(() => {
              const status = window.catalogComparisonFixture.status();
              return {
                maps: status?.appearance?.dataTextureMaps ?? 0,
                disposed: status?.disposedTextureCount ?? 0,
              };
            });
            return status.maps === 0 && status.disposed > cleanupBaseline;
          },
          { timeout: 10_000 },
        )
        .toBe(true);
      const afterCleanup = await page.evaluate(() =>
        window.catalogComparisonFixture.status(),
      );
      assert.ok(
        afterCleanup.disposedTextureCount > cleanupBaseline,
        "cleanup did not dispose the observed textured appearances",
      );
      report.textureAcceptance = {
        candidateSubstitution: true,
        catalogAdmission: false,
        candidate: {
          path: texturedAssetPath,
          bytes: candidateSubstitution.glbBytes,
          sha256: candidateSubstitution.glbSha256,
          licensePath: candidateLicensePath,
          licenseSha256: candidateSubstitution.licenseSha256,
          licenseText:
            "exact candidate License.txt CC0 text; fixture substitution only",
        },
        strictModeLifecycle: true,
        settledVisibleMeshPredicate: "all target mesh.visible values are true",
        untinted: {
          front: screenshots["untinted-front"],
          rear: screenshots["untinted-rear"],
          mapCount: 3,
        },
        pink: {
          front: screenshots["pink-front"],
          rear: screenshots["pink-rear"],
          mapCount: 0,
          uniformVertexColor: true,
        },
        restored: {
          front: screenshots["restored-front"],
          rear: screenshots["restored-rear"],
          mapCount: 3,
        },
        sharedEntityIsolation: {
          entityCount: 3,
          uniqueTextureInstances: 3,
          sharedImmutablePixelStorage: true,
        },
        replacement: {
          pendingRetainedLastGood: true,
          staleRetainedLastGood: true,
          failedRetainedLastGood: true,
        },
      };
      report.exportAcceptance = {
        candidateSubstitution: true,
        catalogAdmission: false,
        candidateLicenseText:
          "exact candidate License.txt CC0 text included and hash-asserted",
        exactCandidateModelBytes: true,
        exactCandidateLicenseText: true,
        exportedFileCount: exportedFiles.size,
        playback: {
          ready: true,
          screenshot: playbackScreenshot,
          workerStarted: true,
          settledVisibleMeshPredicate: "three formation mesh probes are true",
          externalRequests: playbackExternalRequests,
        },
        cleanupReleasedTextureMaps: true,
        textureDisposalsBeforeCleanup: cleanupBaseline,
        textureDisposalsObserved:
          afterCleanup.disposedTextureCount - cleanupBaseline,
      };
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
        exactSourceBytes: assetResponses.every(
          (response) => response.exactSourceBytes === true,
        ),
      },
      rawTimings,
      errors: initialErrors,
      externalRequests: modeExternalRequests,
    });
    await context.close();
  }
  assert.equal(report.modes.length, modes.length);
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
