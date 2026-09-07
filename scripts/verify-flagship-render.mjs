import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { encodeWorld } from "../.vercel/browser-share-helper.mjs";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const report = { errors: [], inference: [], worlds: [] };
for (const kind of ["creation", "edited"]) {
  const project = JSON.parse(
    await readFile(`/tmp/orbsie-flagship-${kind}.json`, "utf8"),
  );
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/generate")) report.inference.push(r.url());
  });
  await page.goto(`http://localhost:3001/#orb=${encodeWorld(project)}`);
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `docs/evidence/flagship-${kind}.png` });
  const before = await page.locator("body").innerText();
  await page.keyboard.down("w");
  await page.waitForTimeout(1200);
  await page.keyboard.up("w");
  await page.keyboard.press("Space");
  await page.waitForTimeout(600);
  await page.screenshot({
    path: `docs/evidence/flagship-${kind}-keyboard.png`,
  });
  report.worlds.push({
    kind,
    entities: project.entities.length,
    collectibles: project.entities.filter((e) => e.behavior?.type === "collect")
      .length,
    movingPlatforms: project.entities.filter((e) => e.behavior?.type === "move")
      .length,
    portals: project.entities.filter((e) => e.behavior?.type === "portal")
      .length,
    before,
    after: await page.locator("body").innerText(),
    keyboard:
      "W held 1.2s, Space jump; representative input only, not a winning run",
  });
  await page.close();
}
await browser.close();
await writeFile(
  "docs/evidence/flagship-browser-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
expect(report.errors).toEqual([]);
expect(report.inference).toEqual([]);
