import { installFixtureGeneration } from "./fixture-generation.mjs";
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage();
await installFixtureGeneration(page.context());
const report = JSON.parse(
  await readFile("docs/evidence/browser-report.json", "utf8"),
);
await page.goto(
  report.shareUrl.replace("https://orbsie.vercel.app", "http://localhost:3002"),
);
await page.waitForTimeout(5000);
await page.getByRole("button", { name: "Orbsie home" }).click();
await page
  .getByPlaceholder("What experience to build?")
  .fill("A tiny island treasure hunt");
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.waitForTimeout(2000);
await page.getByRole("button", { name: "Share Orb" }).click();
const downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "Download your world" }).click();
const download = await downloadPromise;
await download.saveAs("/tmp/orbsie-world-final.zip");
await browser.close();
console.log("Updated standalone ZIP downloaded");
