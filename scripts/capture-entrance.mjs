import { chromium } from "@playwright/test";
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
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.TEST_URL ?? "http://localhost:3001");
await page.waitForSelector("canvas");
await page.waitForTimeout(2500);
await page.screenshot({ path: "docs/evidence/landing-space.png" });
console.log({ errors, text: await page.locator("body").innerText() });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1500);
await page.screenshot({ path: "docs/evidence/mobile-space.png" });
await browser.close();
