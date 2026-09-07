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
await page.goto("http://localhost:3001");
await page.waitForSelector("canvas");
await page.waitForTimeout(2500);
await page.screenshot({ path: "docs/evidence/landing.png" });
await page
  .getByPlaceholder("What experience to build?")
  .fill("A tiny island treasure hunt");
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.waitForTimeout(1800);
await page.screenshot({ path: "docs/evidence/formation.png" });
await page.waitForTimeout(11000);
await page.screenshot({ path: "docs/evidence/workspace.png" });
console.log(
  JSON.stringify({
    errors,
    text: (await page.locator("body").innerText()).slice(0, 3000),
  }),
);
await context.close();
await browser.close();
