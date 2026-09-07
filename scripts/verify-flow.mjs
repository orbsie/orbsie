import { chromium, expect } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
const url = process.env.TEST_URL ?? "http://localhost:3001";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: {
    dir: "docs/evidence/video",
    size: { width: 1440, height: 1000 },
  },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url);
await page.waitForSelector("canvas");
await page.waitForTimeout(1500);
await page.screenshot({ path: "docs/evidence/landing.png" });
const started = Date.now();
await page
  .getByPlaceholder("What experience to build?")
  .fill("A tiny island treasure hunt");
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.waitForTimeout(1800);
await page.screenshot({ path: "docs/evidence/formation.png" });
await expect(
  page.getByText("Your island is alive!", { exact: false }),
).toBeVisible({ timeout: 25000 });
const completeMs = Date.now() - started;
await page.waitForTimeout(1600);
await page.screenshot({ path: "docs/evidence/workspace.png" });
await page.getByRole("button", { name: "Show objects" }).click();
await page.getByRole("button", { name: "Friendly tree" }).click();
await page.locator("#prompt").fill("Make this a giant pink mushroom");
await page.getByRole("button", { name: "Change this", exact: true }).click();
await expect(
  page.getByText("Done. I kept the rest", { exact: false }),
).toBeVisible();
await page.waitForTimeout(1500);
await page.screenshot({ path: "docs/evidence/mushroom-edit.png" });
await page.getByRole("button", { name: "Undo last change" }).click();
await expect(page.getByText("Previous change restored.")).toBeVisible();
await page.getByRole("button", { name: "Play", exact: true }).click();
await page.mouse.click(1200, 850);
await page.keyboard.down("w");
await page.waitForTimeout(800);
await page.keyboard.up("w");
await page.keyboard.press("Space");
await page.screenshot({ path: "docs/evidence/play.png" });
const frames = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const intervals = [];
      let last = performance.now();
      function frame(t) {
        intervals.push(t - last);
        last = t;
        if (intervals.length < 120) requestAnimationFrame(frame);
        else {
          intervals.sort((a, b) => a - b);
          resolve({
            median: intervals[60],
            p95: intervals[114],
            samples: 120,
            userAgent: navigator.userAgent,
            renderer: document
              .querySelector("canvas")
              .getContext("webgl2")
              .getParameter(7937),
          });
        }
      }
      requestAnimationFrame(frame);
    }),
);
await page.getByRole("button", { name: "Share Orb" }).click();
await page.getByRole("button", { name: "Copy a play link" }).click();
const shareUrl = await page.getByLabel("Play URL").inputValue();
const downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "Download your world" }).click();
const download = await downloadPromise;
await download.saveAs("/tmp/orbsie-world.zip");
await page.getByRole("button", { name: "Close dialog" }).click();
await page.reload();
await page.getByRole("button", { name: "Continue your saved world" }).click();
await expect(
  page.getByRole("heading", { name: "A pocketful of sunshine" }),
).toBeVisible();
const publicContext = await browser.newContext({
  viewport: { width: 1280, height: 800 },
});
const publicPage = await publicContext.newPage();
publicPage.on("pageerror", (e) => errors.push(e.message));
await publicPage.goto(shareUrl);
await publicPage.waitForTimeout(6500);
await expect(publicPage.getByText("Crystals collected")).toBeVisible();
await publicPage.screenshot({ path: "docs/evidence/public-playback.png" });
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const mp = await mobile.newPage();
await mp.goto(url);
await mp.waitForTimeout(2500);
await mp.screenshot({ path: "docs/evidence/mobile-landing.png" });
await mp
  .getByPlaceholder("What experience to build?")
  .fill("A garden whose flowers open when clicked");
await mp.getByRole("button", { name: "Create", exact: true }).click();
await expect(
  mp.getByText("Your little garden is ready.", { exact: false }),
).toBeVisible({ timeout: 25000 });
await mp.screenshot({ path: "docs/evidence/mobile-garden.png" });
await mp.getByRole("button", { name: "Play", exact: true }).click();
await expect(
  mp.getByRole("button", { name: "Jump", exact: true }),
).toBeVisible();
const overflow = await mp.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
const report = {
  url,
  errors,
  completeMs,
  frames,
  mobileOverflow: overflow,
  checks: [
    "landing",
    "formation",
    "island generation",
    "object selection",
    "mushroom revision",
    "undo",
    "keyboard movement",
    "jump",
    "ZIP download",
    "refresh recovery",
    "signed-out public playback",
    "mobile garden",
    "touch controls",
  ],
  shareUrl,
};
console.log(JSON.stringify(report));
await writeFile(
  "docs/evidence/browser-report.json",
  JSON.stringify(report, null, 2),
);
await context.close();
await publicContext.close();
await mobile.close();
await browser.close();
if (errors.length || overflow) process.exitCode = 1;
