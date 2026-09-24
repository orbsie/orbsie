/** Deterministic model transport, actual catalog network/decode/render/export. */
import { chromium, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [];
  const externalRequests = [];
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
      const commands =
        generations === 1
          ? [
              reserve("subject", "Catalog model", [-2, 0, 0]),
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
  await expect(page.getByText(/scoped to original geometry/)).toBeVisible();
  await expect(page.getByText("Forbidden reuse.", { exact: true })).toHaveCount(
    0,
  );
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
    newOnlyReuseRejected: true,
    externalRequestCount: externalRequests.length,
    pageErrors: errors,
  };
  await writeFile(
    directory + "/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
