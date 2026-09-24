/** Deterministic model transport, actual catalog network/decode/render/export. */
import { chromium, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { unzipSync, strFromU8 } from "fflate";
const base = process.env.TEST_URL ?? "http://127.0.0.1:3017";
const directory =
  process.env.ORBSIE_CATALOG_EVIDENCE_DIR ?? "docs/evidence/catalog-browser";
const manifest = JSON.parse(
  await readFile("assets/catalog/manifest.json", "utf8"),
);
const assetId =
  process.env.ORBSIE_TEST_ASSET_ID ?? "kenney.nature.tree-default";
const asset = manifest.assets.find((candidate) => candidate.id === assetId);
if (!asset) throw Error(`Unknown catalog test asset ${assetId}`);
const source = manifest.sources.find(
  (candidate) => candidate.sourceId === asset.sourceId,
);
if (!source) throw Error(`Missing catalog source for ${assetId}`);
const assetFile = asset.path.slice(1);
const licenseFile = source.license.textFile;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
let standaloneServer;
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [];
  const externalRequests = [];
  const generationRequests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 300));
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === new URL(base).origin ||
      url.protocol === "data:" ||
      url.protocol === "blob:"
    )
      return route.continue();
    externalRequests.push(url.origin);
    return route.abort();
  });
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
      const submitted = route.request().postDataJSON();
      generationRequests.push({
        selected: submitted?.selected ?? null,
        prompt: submitted?.prompt ?? null,
      });
      const commands =
        generations === 1
          ? [
              reserve("subject", "Catalog model", [0, 0, 0]),
              {
                type: "set_geometry",
                id: "subject",
                geometry: {
                  kind: "asset",
                  assetId,
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
                id: "subject",
                geometry: {
                  kind: "asset",
                  assetId,
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
    r.url().endsWith(asset.path),
  );
  await page
    .locator("#prompt")
    .fill(`A ${asset.label} from the collection beside a newly made crystal`);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByText("Mixed world ready.", { exact: true }),
  ).toBeVisible();
  const model = await modelResponse;
  expect(model.status()).toBe(200);
  await model.finished();
  expect(sha256(await model.body())).toBe(asset.sha256);
  await page.waitForTimeout(1800); // allow decoded geometry's formation animation to settle
  await page.screenshot({ path: directory + "/mixed.png" });
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download your world/ }).click();
  const download = await downloaded;
  await download.saveAs(directory + "/mixed.zip");
  const files = unzipSync(await readFile(directory + "/mixed.zip"));
  expect(sha256(files[assetFile])).toBe(asset.sha256);
  expect(sha256(files[licenseFile])).toBe(source.license.textSha256);
  const usedAssets = JSON.parse(
    strFromU8(files["assets/catalog/used-assets.json"]),
  );
  expect(usedAssets.assets).toHaveLength(1);
  expect(usedAssets.assets[0].id).toBe(assetId);

  standaloneServer = createServer((request, response) => {
    const path =
      new URL(request.url, "http://localhost").pathname.slice(1) ||
      "index.html";
    const bytes = files[path];
    if (!bytes) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader(
      "Content-Type",
      {
        html: "text/html",
        js: "text/javascript",
        css: "text/css",
        json: "application/json",
        glb: "model/gltf-binary",
      }[path.split(".").at(-1)] ?? "application/octet-stream",
    );
    response.end(bytes);
  });
  await new Promise((resolve) =>
    standaloneServer.listen(0, "127.0.0.1", resolve),
  );
  const standaloneOrigin = `http://127.0.0.1:${standaloneServer.address().port}`;
  const standalone = await browser.newPage({ reducedMotion: "reduce" });
  const standaloneExternal = [];
  await standalone.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.__catalogWorkerResults = [];
    window.Worker = class extends OriginalWorker {
      constructor(...args) {
        super(...args);
        if (String(args[0]).includes("asset-geometry-worker"))
          this.addEventListener("message", ({ data }) => {
            window.__catalogWorkerResults.push({
              error: data.error ?? null,
              vertices:
                (data.decoded?.attributes?.position?.array?.length ?? 0) / 3,
            });
          });
      }
    };
  });
  standalone.on("pageerror", (error) => errors.push(error.message));
  await standalone.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === standaloneOrigin ||
      url.protocol === "data:" ||
      url.protocol === "blob:"
    )
      return route.continue();
    standaloneExternal.push(url.origin);
    return route.abort();
  });
  await standalone.goto(standaloneOrigin);
  await expect(standalone.locator("main[data-ready=true]")).toBeVisible();
  await standalone.waitForFunction(() =>
    window.__catalogWorkerResults.some(
      (result) => !result.error && result.vertices > 0,
    ),
  );
  const standaloneWorkerResults = await standalone.evaluate(
    () => window.__catalogWorkerResults,
  );
  expect(standaloneWorkerResults.every((result) => !result.error)).toBe(true);
  expect(standaloneExternal).toEqual([]);
  await standalone.waitForTimeout(1800); // allow the standalone formation to settle
  await standalone.screenshot({ path: directory + "/standalone.png" });

  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Show objects", exact: true }).click();
  await page
    .locator(".object-list button")
    .filter({ hasText: "Catalog model" })
    .click();
  await page
    .locator("#prompt")
    .fill("Build this model from scratch with original geometry");
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect(
    page.getByText(/scene change that could not be applied/),
  ).toBeVisible();
  expect(generationRequests.at(-1)).toEqual({
    selected: "subject",
    prompt: "Build this model from scratch with original geometry",
  });
  await expect(page.getByText("Forbidden reuse.", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Use last working" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
  const report = {
    mode: "mock-generation-real-catalog-render-export",
    passed: true,
    generations,
    realModelCalls: 0,
    assetId,
    assetSha256: asset.sha256,
    licenseSha256: source.license.textSha256,
    assetHTTPStatus: model.status(),
    mixedExport: true,
    standalonePlayback: true,
    standaloneWorkerResults,
    newOnlyReuseRejected: true,
    externalRequestCount: externalRequests.length + standaloneExternal.length,
    pageErrors: errors,
  };
  await writeFile(
    directory + "/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  if (standaloneServer)
    await new Promise((resolve) => standaloneServer.close(resolve));
}
