import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
await build({
  entryPoints: ["src/lib/export.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".vercel/browser-share-helper.mjs",
});
const { encodeWorld } = await import("../.vercel/browser-share-helper.mjs");
const evidence = JSON.parse(
  await readFile(
    process.env.LIVE_EVIDENCE || "/tmp/orbsie-live-evidence.json",
    "utf8",
  ),
);
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  catalogs = [],
  inference = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.url().includes("/api/generate")) inference.push(r.url());
});
page.on("response", async (r) => {
  if (r.url().includes("/api/models"))
    catalogs.push({ url: r.url(), status: r.status(), body: await r.json() });
});
const base = process.env.TEST_URL || "http://localhost:3001";
await page.goto(base);
await page.getByRole("button", { name: "Connections", exact: true }).click();
await page.getByRole("button", { name: /Your AI connection/ }).click();
await expect(page.getByRole("button", { name: /Quality/ })).toBeEnabled({
  timeout: 30000,
});
const selections = [];
await page.getByText("Advanced", { exact: true }).click();
for (const mode of ["Quality", "Balanced", "Budget"]) {
  await page.getByRole("button", { name: new RegExp(mode) }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(mode) }),
  ).toHaveAttribute("aria-pressed", "true");
  selections.push({
    mode,
    model: await page.locator(".advanced-models select").inputValue(),
  });
}
await page
  .getByLabel("API key", { exact: true })
  .fill("qa-sentinel-not-a-real-key");
await page.locator("select").first().selectOption("gateway");
await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
await expect(page.getByRole("button", { name: /Quality/ })).toBeEnabled({
  timeout: 30000,
});
await page.getByRole("button", { name: /Quality/ }).click();
await page.screenshot({ path: "docs/evidence/live-quality-desktop.png" });
const desktopOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: "docs/evidence/live-quality-mobile.png" });
const mobileOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
const snapshots = [];
for (const entry of evidence) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${base}/#orb=${encodeWorld(entry.project)}`);
  await expect(p.locator("canvas")).toBeVisible();
  await p.waitForTimeout(8000);
  await p.screenshot({ path: `docs/evidence/live-astra-${entry.kind}.png` });
  snapshots.push({
    kind: entry.kind,
    canvas: await p.locator("canvas").count(),
    text: await p.locator("body").innerText(),
  });
  await p.close();
}
const unchanged = evidence[0].project.entities
  .filter((e) => e.id !== "moon-tree")
  .every(
    (e) =>
      JSON.stringify(e) ===
      JSON.stringify(evidence[1].project.entities.find((x) => x.id === e.id)),
  );
const report = {
  selections,
  catalogs: catalogs.map((c) => ({
    ...c,
    body: undefined,
    modelCount: Array.isArray(c.body) ? c.body.length : c.body.models?.length,
  })),
  desktopOverflow,
  mobileOverflow,
  errors,
  inference,
  snapshots,
  unrelatedEntitiesUnchanged: unchanged,
};
await writeFile(
  "docs/evidence/live-browser-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
await browser.close();
expect(errors).toEqual([]);
expect(inference).toEqual([]);
expect(desktopOverflow).toBe(false);
expect(mobileOverflow).toBe(false);
expect(unchanged).toBe(true);
