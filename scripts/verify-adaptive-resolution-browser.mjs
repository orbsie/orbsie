/** Deterministic slow-frame stimulus; real editor DPR persistence regression, not a benchmark. */
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.TEST_URL ?? "http://127.0.0.1:3035";
const directory = "docs/evidence/adaptive-resolution-editing";
const report = {
  passed: false,
  realProviderCalls: 0,
  scope:
    "Artificial slow-frame stimulus verifies actual Canvas resolution survives typing and selection; this is not a performance benchmark.",
  pageErrors: [],
};
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
let page;
try {
  page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config")
      return route.fulfill({ json: { accounts: false } });
    if (path === "/api/trial")
      return route.fulfill({ json: { enabled: true, remaining: 1 } });
    if (path === "/api/generate")
      return route.fulfill({
        contentType: "application/x-ndjson",
        body:
          [
            {
              type: "reserve_entity",
              entity: {
                id: "tree",
                label: "Tree",
                position: [0, 0, 0],
                scale: [1, 1, 1],
                color: "#79b5a0",
                stage: "seed",
              },
            },
            {
              type: "set_geometry",
              id: "tree",
              geometry: { kind: "tree", detail: "refined" },
            },
            { type: "commit_revision", message: "Ready." },
          ]
            .map(JSON.stringify)
            .join("\n") + "\n",
      });
    return route.fulfill({ json: { models: [] } });
  });
  await page.goto(origin);
  await page.locator("#prompt").fill("A tree");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Ready.", { exact: true })).toBeVisible();
  report.initial = await page
    .locator("canvas")
    .evaluate((c) => ({ width: c.width, height: c.height }));
  await page.evaluate(() => {
    window.__slowFrameStimulus = true;
    function slow() {
      if (!window.__slowFrameStimulus) return;
      const until = performance.now() + 40;
      while (performance.now() < until) {}
      requestAnimationFrame(slow);
    }
    requestAnimationFrame(slow);
  });
  await page.waitForFunction(
    (initial) => document.querySelector("canvas").width < initial,
    report.initial.width,
    { timeout: 20000 },
  );
  report.adapted = await page
    .locator("canvas")
    .evaluate((c) => ({ width: c.width, height: c.height }));
  await page.evaluate(() => {
    window.__slowFrameStimulus = false;
  });
  await page
    .locator("#prompt")
    .fill("Typing must preserve adaptive resolution");
  await page.waitForTimeout(250);
  report.afterTyping = await page
    .locator("canvas")
    .evaluate((c) => ({ width: c.width, height: c.height }));
  expect(report.afterTyping).toEqual(report.adapted);
  await page.getByRole("button", { name: "Show objects", exact: true }).click();
  await page.locator(".object-list button").filter({ hasText: "Tree" }).click();
  await expect(
    page.getByRole("button", { name: "Clear selected object" }),
  ).toBeVisible();
  report.afterSelection = await page
    .locator("canvas")
    .evaluate((c) => ({ width: c.width, height: c.height }));
  expect(report.afterSelection).toEqual(report.adapted);
  await page.screenshot({ path: directory + "/editing.png" });
  expect(report.pageErrors).toEqual([]);
  report.passed = true;
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
  await page?.screenshot({ path: directory + "/failure.png" }).catch(() => {});
} finally {
  await browser.close();
  await writeFile(
    directory + "/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
