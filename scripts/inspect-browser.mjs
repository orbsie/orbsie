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
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning")
    console.log(m.type(), m.text().slice(0, 1800));
});
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto("http://localhost:3001");
await page.waitForTimeout(3000);
await page.getByRole("button", { name: "An island adventure" }).click();
await page.waitForTimeout(14000);
console.log(
  await page.evaluate(() => ({
    canvas: [...document.querySelectorAll("canvas")].map((c) => ({
      width: c.width,
      height: c.height,
      rect: c.getBoundingClientRect().toJSON(),
      lost: c.getContext("webgl2")?.isContextLost(),
    })),
    app: document.querySelector("main")?.className,
    background: getComputedStyle(document.querySelector("main")).background,
    body: document.body.innerText.slice(-500),
  })),
);
await page.screenshot({ path: "docs/evidence/workspace-debug.png" });
await browser.close();
