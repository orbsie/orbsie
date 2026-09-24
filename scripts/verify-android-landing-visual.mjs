#!/usr/bin/env node
// Read-only visual check against Android Chrome's actual rendering path.
// Usage: node scripts/verify-android-landing-visual.mjs ORIGIN EVIDENCE_DIR
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const [originArgument, directoryArgument] = process.argv.slice(2);
if (!originArgument || !directoryArgument)
  throw new Error("Expected origin and evidence directory.");
const origin = new URL(originArgument);
if (
  !["https:", "http:"].includes(origin.protocol) ||
  (origin.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
)
  throw new Error("Expected an HTTPS or loopback root origin.");
const directory = resolve(directoryArgument);

async function planetPixelCount(png) {
  const { data, info } = await sharp(png)
    .resize(412, 786)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let count = 0;
  for (
    let y = Math.floor(info.height * 0.2);
    y < Math.floor(info.height * 0.44);
    y++
  ) {
    for (
      let x = Math.floor(info.width * 0.18);
      x < Math.floor(info.width * 0.82);
      x++
    ) {
      const offset = (y * info.width + x) * 3;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      if (green > 90 && blue > 85 && green - red > 15) count++;
    }
  }
  return count;
}

await mkdir(directory, { recursive: true });
const browser = await chromium.connectOverCDP(
  process.env.ORBSIE_ANDROID_CDP_URL ?? "http://127.0.0.1:9222",
);
let page;
try {
  const context = browser.contexts()[0];
  if (!context) throw new Error("Android Chrome has no browser context.");
  page = await context.newPage();
  const pageErrors = [];
  const blockedRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 200)));
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      ["GET", "HEAD"].includes(request.method()) &&
      url.origin === origin.origin
    )
      return route.continue();
    blockedRequests.push({ method: request.method(), origin: url.origin });
    return route.abort();
  });
  await page.goto(origin.href, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.bringToFront();
  await page.waitForTimeout(12000);
  const state = await page.evaluate(() => ({
    android: /Android/i.test(navigator.userAgent),
    landing: Boolean(document.querySelector(".app.is-landing")),
    rendererAvailability: document
      .querySelector("[data-renderer-availability]")
      ?.getAttribute("data-renderer-availability"),
    renderer: document.querySelector(".software-world") ? "software" : "webgl",
    canvasVisible: [...document.querySelectorAll("canvas")].some((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      return (
        rect.width > 0 && rect.height > 0 && style.visibility === "visible"
      );
    }),
    horizontalOverflow:
      document.documentElement.scrollWidth > window.innerWidth + 1,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  }));
  const png = await page.screenshot();
  await writeFile(resolve(directory, "landing.png"), png);
  const visiblePlanetPixels = await planetPixelCount(png);
  const report = {
    checkedAt: new Date().toISOString(),
    origin: origin.origin,
    state,
    visiblePlanetPixels,
    pageErrors,
    blockedRequests,
    status:
      state.android &&
      state.landing &&
      state.rendererAvailability === "ready" &&
      state.canvasVisible &&
      !state.horizontalOverflow &&
      visiblePlanetPixels >= 1000 &&
      pageErrors.length === 0 &&
      blockedRequests.length === 0
        ? "passed"
        : "failed",
  };
  await writeFile(
    resolve(directory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report));
  if (report.status !== "passed") process.exitCode = 1;
} finally {
  await page?.close();
  await browser.close();
}
