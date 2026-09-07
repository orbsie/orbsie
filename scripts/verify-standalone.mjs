import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [],
  requests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => requests.push(r.url()));
await page.goto("http://localhost:3010");
await page.waitForTimeout(6000);
await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
await expect(page.locator(".score")).toContainText("/ 5");
await page.screenshot({ path: "docs/evidence/standalone.png" });
const external = requests.filter(
  (u) => !u.startsWith("http://localhost:3010") && !u.startsWith("data:"),
);
const result = {
  errors,
  externalRequests: external,
  projectFetch: requests.some((u) => u.endsWith("project.json")),
  result: "Source rebuild, Vite build and standalone browser playback passed",
};
await writeFile(
  "docs/evidence/export-report.json",
  JSON.stringify(result, null, 2),
);
console.log(result);
await browser.close();
if (errors.length || external.length) process.exitCode = 1;
