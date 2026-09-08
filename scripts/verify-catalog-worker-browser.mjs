/** Deterministic model transport, actual catalog network/decode/render/export. */
import sharp from "sharp";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { createServer } from "node:http";
import { chromium, expect } from "@playwright/test";
import {
  readFile,
  mkdir,
  writeFile,
  mkdtemp,
  symlink,
  rm,
} from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
const base = process.env.TEST_URL ?? "http://127.0.0.1:3017";
const directory = "docs/evidence/catalog-worker-browser";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const execFile = promisify(execFileCallback);
let server;
let buildRoot;
async function observeWorker(page) {
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.__catalogResults = [];
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        if (String(args[0]).includes("asset-geometry-worker")) {
          this.addEventListener("message", ({ data }) => {
            window.__catalogResults.push({
              error: data.error ?? null,
              vertices:
                (data.decoded?.attributes?.position?.array?.length ?? 0) / 3,
            });
          });
        }
      }
    };
  });
}
async function checkVisibleTree(page) {
  let pixels = 0;
  await expect
    .poll(
      async () => {
        const { data, info } = await sharp(await page.screenshot())
          .raw()
          .toBuffer({ resolveWithObject: true });
        pixels = 0;
        // The fixture tree has a cyan crown in this fixed camera; ground and crystal do not.
        for (let y = 280; y < 390; y++)
          for (let x = 610; x < 705; x++) {
            const i = (y * info.width + x) * info.channels;
            const [r, g, b] = data.subarray(i, i + 3);
            if (r < 160 && g > r + 25 && b > r + 25 && g > 130) pixels++;
          }
        return pixels;
      },
      { timeout: 15000 },
    )
    .toBeGreaterThan(30);
  return pixels;
}
async function checkWorker(page) {
  await page.waitForFunction(() =>
    window.__catalogResults.some(
      (result) => !result.error && result.vertices > 0,
    ),
  );
  const results = await page.evaluate(() => window.__catalogResults);
  expect(results.every((result) => !result.error)).toBe(true);
  return results;
}
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await observeWorker(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let generations = 0;
  const reserve = (id, label, position) => ({
    type: "reserve_entity",
    entity: {
      id,
      label,
      position,
      scale: [1, 1, 1],
      color: "#6ead60",
      stage: "seed",
    },
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config")
      return route.fulfill({ json: { accounts: false } });
    if (path === "/api/trial")
      return route.fulfill({ json: { enabled: true, remaining: 3 } });
    if (path === "/api/generate") {
      generations++;
      const commands =
        generations === 1
          ? [
              reserve("tree", "Catalog tree", [-2, 0, 0]),
              {
                type: "set_geometry",
                id: "tree",
                geometry: {
                  kind: "asset",
                  assetId: "kenney.nature.tree-default",
                  detail: "refined",
                },
              },
              reserve("crystal", "New crystal", [2, 0, 0]),
              {
                type: "set_geometry",
                id: "crystal",
                geometry: { kind: "crystal", detail: "refined" },
              },
              { type: "commit_revision", message: "Mixed world ready." },
            ]
          : [
              {
                type: "set_geometry",
                id: "tree",
                geometry: {
                  kind: "asset",
                  assetId: "kenney.nature.tree-default",
                  detail: "refined",
                },
              },
              { type: "commit_revision", message: "Forbidden reuse." },
            ];
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: commands.map((c) => JSON.stringify(c)).join("\n") + "\n",
      });
    }
    return route.fulfill({ json: { models: [] } });
  });
  await page.goto(base);
  const modelResponse = page.waitForResponse((r) =>
    r.url().endsWith("/models/kenney/nature-kit/tree_default.glb"),
  );
  await page
    .locator("#prompt")
    .fill("A tree from the collection beside a newly made crystal");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByText("Mixed world ready.", { exact: true }),
  ).toBeVisible();
  const model = await modelResponse;
  expect(model.status()).toBe(200);
  await model.finished();
  const editorWorker = await checkWorker(page);
  const editorTreePixels = await checkVisibleTree(page);
  await page.waitForTimeout(1800); // allow decoded geometry's formation animation to settle
  await page.screenshot({ path: directory + "/mixed.png" });
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download your world/ }).click();
  const download = await downloaded;
  await download.saveAs(directory + "/mixed.zip");
  const files = unzipSync(await readFile(directory + "/mixed.zip"));
  expect(files["models/kenney/nature-kit/tree_default.glb"]).toBeDefined();
  expect(
    files["assets/catalog/licenses/kenney-nature-kit-License.txt"],
  ).toBeDefined();
  expect(
    JSON.parse(strFromU8(files["assets/catalog/used-assets.json"])).assets,
  ).toHaveLength(1);
  expect(files["asset-geometry-worker.js"]).toBeDefined();
  expect(files["src/lib/asset-geometry-worker.ts"]).toBeDefined();
  server = createServer((req, res) => {
    const path =
      new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
    if (!files[path]) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      {
        js: "text/javascript",
        css: "text/css",
        html: "text/html",
        json: "application/json",
      }[path.split(".").pop()] ?? "application/octet-stream",
    );
    res.end(files[path]);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const standalone = await browser.newPage({ reducedMotion: "reduce" });
  await observeWorker(standalone);
  const externalRequests = [];
  standalone.on("pageerror", (error) => errors.push(error.message));
  standalone.on("request", (request) => {
    if (!request.url().startsWith(origin) && !request.url().startsWith("data:"))
      externalRequests.push(request.url());
  });
  await standalone.goto(origin);
  const standaloneWorker = await checkWorker(standalone);
  await expect(standalone.locator("main[data-ready=true]")).toBeVisible();
  await checkVisibleTree(standalone);
  await standalone.screenshot({ path: directory + "/standalone.png" });
  expect(externalRequests).toEqual([]);
  buildRoot = await mkdtemp(join(tmpdir(), "orbsie-catalog-export-"));
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(buildRoot, path)), { recursive: true });
    await writeFile(join(buildRoot, path), bytes);
  }
  await symlink(
    resolve("node_modules"),
    join(buildRoot, "node_modules"),
    "dir",
  );
  await execFile(process.execPath, ["build-source.mjs"], {
    cwd: buildRoot,
    timeout: 60000,
  });
  await execFile(process.execPath, ["build.mjs"], {
    cwd: buildRoot,
    timeout: 60000,
  });
  for (const path of [
    "index.html",
    "generated-geometry-worker.js",
    "asset-geometry-worker.js",
  ])
    expect(
      (await readFile(join(buildRoot, "dist", path))).byteLength,
    ).toBeGreaterThan(0);
  // Vite rewrites HTML and the main runtime; serve its complete actual output.
  const { readdir } = await import("node:fs/promises");
  for (const key of Object.keys(files)) delete files[key];
  async function collect(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const key = prefix + entry.name;
      if (entry.isDirectory())
        await collect(join(directory, entry.name), key + "/");
      else
        files[key] = new Uint8Array(
          await readFile(join(directory, entry.name)),
        );
    }
  }
  await collect(join(buildRoot, "dist"));
  await standalone.reload();
  const builtStandaloneWorker = await checkWorker(standalone);
  await checkVisibleTree(standalone);
  await standalone.screenshot({ path: directory + "/built-standalone.png" });
  await expect(standalone.locator("main[data-ready=true]")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Show objects", exact: true }).click();
  await page
    .locator(".object-list button")
    .filter({ hasText: "Catalog tree" })
    .click();
  await page
    .locator("#prompt")
    .fill("Build this model from scratch with original geometry");
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect(page.getByText(/scoped to original geometry/)).toBeVisible();
  await expect(page.getByText("Forbidden reuse.", { exact: true })).toHaveCount(
    0,
  );
  const catalog = JSON.parse(
    await readFile("assets/catalog/manifest.json", "utf8"),
  );
  const allCatalog = await browser.newPage({ reducedMotion: "reduce" });
  await observeWorker(allCatalog);
  allCatalog.on("pageerror", (error) => errors.push(error.message));
  await allCatalog.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config")
      return route.fulfill({ json: { accounts: false } });
    if (path === "/api/trial")
      return route.fulfill({ json: { enabled: true, remaining: 3 } });
    if (path === "/api/generate") {
      const commands = catalog.assets.flatMap((asset, i) => [
        reserve(`asset-${i}`, `Catalog ${i}`, [
          ((i % 5) - 2) * 2.4,
          0,
          Math.floor(i / 5) * 3 - 1.5,
        ]),
        {
          type: "set_geometry",
          id: `asset-${i}`,
          geometry: { kind: "asset", assetId: asset.id, detail: "refined" },
        },
      ]);
      commands.push({
        type: "commit_revision",
        message: "Full catalog ready.",
      });
      return route.fulfill({
        contentType: "application/x-ndjson",
        body:
          commands.map((command) => JSON.stringify(command)).join("\n") + "\n",
      });
    }
    return route.fulfill({ json: { models: [] } });
  });
  await allCatalog.goto(base);
  await allCatalog
    .locator("#prompt")
    .fill("Use one of every model in the collection");
  await allCatalog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    allCatalog.getByText("Full catalog ready.", { exact: true }),
  ).toBeVisible();
  await allCatalog.waitForFunction(
    (count) => window.__catalogResults.length === count,
    catalog.assets.length,
  );
  const fullCatalogResults = await allCatalog.evaluate(
    () => window.__catalogResults,
  );
  expect(
    fullCatalogResults.every((result) => !result.error && result.vertices > 0),
  ).toBe(true);
  await expect(
    allCatalog.getByText(/This model could not be loaded/),
  ).toHaveCount(0);
  await allCatalog.waitForTimeout(3000);
  await allCatalog.screenshot({ path: directory + "/full-catalog.png" });
  expect(errors).toEqual([]);
  const report = {
    mode: "mock-generation-real-catalog-render-export",
    passed: true,
    generations,
    realModelCalls: 0,
    fullCatalogResults,
    fullCatalogFixtureGenerations: 1,
    editorWorker,
    editorTreePixels,
    directAndBuiltTreePixelsVerified: true,
    standaloneWorker,
    builtStandaloneWorker,
    externalRequests,
    assetHTTPStatus: model.status(),
    mixedExport: true,
    newOnlyReuseRejected: true,
    pageErrors: errors,
  };
  await writeFile(
    directory + "/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  if (buildRoot) await rm(buildRoot, { recursive: true, force: true });
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
