#!/usr/bin/env node
// Actual Android emulator Chrome touch acceptance for the published Gateway
// input game. The software path is forced because this emulator's WebGL canvas
// does not composite reliably; this is not physical-device certification.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { chromium, expect } from "@playwright/test";

assert(process.env.ORBSIE_PUBLISHED_URL, "Set ORBSIE_PUBLISHED_URL.");
const deployment = new URL(process.env.ORBSIE_PUBLISHED_URL);
assert(
  deployment.protocol === "https:" &&
    deployment.hostname.endsWith(".vercel.app") &&
    deployment.pathname === "/" &&
    !deployment.username &&
    !deployment.password &&
    !deployment.search &&
    !deployment.hash,
  "ORBSIE_PUBLISHED_URL must be a published HTTPS Vercel deployment origin.",
);
const cdpUrl = process.env.ORBSIE_ANDROID_CDP_URL ?? "http://127.0.0.1:9222";
const cdp = new URL(cdpUrl);
assert(
  cdp.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(cdp.hostname) &&
    cdp.pathname === "/" &&
    !cdp.search &&
    !cdp.hash,
  "Android CDP must be forwarded on loopback.",
);
const device = process.env.ORBSIE_ANDROID_DEVICE ?? "emulator-5554";
assert(/^[A-Za-z0-9_.:-]{1,80}$/.test(device), "Invalid Android device ID.");
const evidenceRoot = resolve("docs/evidence/android-gateway-publication");
const evidenceDir = resolve(
  process.env.ORBSIE_ANDROID_PUBLICATION_EVIDENCE ??
    "docs/evidence/android-gateway-publication/current-runtime",
);
assert(
  relative(evidenceRoot, evidenceDir) &&
    !relative(evidenceRoot, evidenceDir).startsWith(".."),
  "Evidence must be a child of docs/evidence/android-gateway-publication.",
);

function adb(...args) {
  return execFileSync("adb", ["-s", device, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  }).trim();
}

async function tap(page, session, name) {
  const button = page.getByRole("button", {
    name,
    exact: typeof name === "string",
  });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  assert(
    box && box.width > 0 && box.height > 0,
    `Missing ${String(name)} control.`,
  );
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  await page.waitForTimeout(180);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

await mkdir(evidenceDir, { recursive: true });
const report = {
  status: "running",
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  deploymentUrl: deployment.origin,
  device: {
    id: device,
    android: adb("shell", "getprop", "ro.build.version.release"),
    model: adb("shell", "getprop", "ro.product.model"),
    size: adb("shell", "wm", "size"),
    density: adb("shell", "wm", "density"),
    chrome:
      adb("shell", "dumpsys", "package", "com.android.chrome").match(
        /versionName=([^\s]+)/,
      )?.[1] ?? "unknown",
  },
  renderer: "forced Canvas2D compatibility",
  providerCalls: 0,
  generationRequests: [],
  externalRequests: [],
  pageErrors: [],
  checks: {},
};
let browser;
let page;
try {
  browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  assert(context, "Android Chrome did not expose a browser context.");
  page = await context.newPage();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, options) {
      if (["webgl", "webgl2", "experimental-webgl"].includes(kind)) return null;
      return original.call(this, kind, options);
    };
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      ["/api/generate", "/api/chatgpt/generate", "/generate"].includes(
        url.pathname,
      )
    ) {
      report.generationRequests.push(url.pathname);
      await route.abort("blockedbyclient");
      return;
    }
    if (
      ["data:", "blob:"].includes(url.protocol) ||
      url.origin === deployment.origin
    ) {
      await route.continue();
      return;
    }
    report.externalRequests.push(url.origin || url.protocol);
    await route.abort("blockedbyclient");
  });
  page.on("pageerror", (error) =>
    report.pageErrors.push(error.message.slice(0, 300)),
  );
  report.cookiesBefore = (await context.cookies(deployment.origin)).length;
  assert.equal(
    report.cookiesBefore,
    0,
    "The published game has an existing cookie.",
  );
  const response = await page.goto(deployment.origin, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  assert.equal(
    response?.status(),
    200,
    "Published game did not return HTTP 200.",
  );
  await expect(page.locator('main[data-ready="true"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".software-world")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".score")).toHaveText("Score: 0");
  report.viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    touchPoints: navigator.maxTouchPoints,
    horizontalOverflow:
      Math.max(
        document.body.scrollWidth,
        document.documentElement.scrollWidth,
      ) >
      innerWidth + 1,
  }));
  assert(report.viewport.touchPoints > 0, "Chrome did not expose touch input.");
  assert(
    !report.viewport.horizontalOverflow,
    "Published game overflows horizontally.",
  );
  report.checks.ready = true;
  await page.screenshot({ path: `${evidenceDir}/ready.png` });

  const session = await context.newCDPSession(page);
  await tap(page, session, "Right");
  await expect(page.locator(".score")).toHaveText("Score: 7");
  report.checks.touchScore = 7;
  await page.screenshot({ path: `${evidenceDir}/scored.png` });
  await tap(page, session, /Restart/);
  await expect(page.locator(".score")).toHaveText("Score: 0");
  report.checks.restart = true;
  await tap(page, session, "Forward");
  await expect(page.locator(".win")).toContainText("Final score: 0");
  report.checks.win = true;
  await page.screenshot({ path: `${evidenceDir}/won.png` });
  await tap(page, session, /Restart/);
  await expect(page.locator(".score")).toHaveText("Score: 0");
  await tap(page, session, "Left");
  await expect(page.locator(".win")).toContainText("Try another adventure");
  report.checks.loss = true;
  await page.screenshot({ path: `${evidenceDir}/lost.png` });
  report.cookiesAfter = (await context.cookies(deployment.origin)).length;
  assert.equal(report.cookiesAfter, 0);
  assert.deepEqual(report.generationRequests, []);
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.pageErrors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error =
    error instanceof Error
      ? error.message.slice(0, 500)
      : "Android check failed.";
  process.exitCode = 1;
} finally {
  await page?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await writeFile(
    `${evidenceDir}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks,
      evidenceDir,
    }),
  );
}
