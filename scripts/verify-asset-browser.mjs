/** Deterministic model transport, actual catalog network/decode/render/export. */
import { chromium, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
const base = process.env.TEST_URL ?? "http://127.0.0.1:3017";
const directory = "docs/evidence/catalog-browser";
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
  expect(errors).toEqual([]);
  const report = {
    mode: "mock-generation-real-catalog-render-export",
    passed: true,
    generations,
    realModelCalls: 0,
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
}
