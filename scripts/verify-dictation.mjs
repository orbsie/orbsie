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
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
await context.addInitScript(() => {
  class SpeechMock {
    constructor() {
      window.__speech = this;
      this.stopped = false;
      this.aborted = false;
    }
    start() {
      this.started = true;
    }
    stop() {
      this.stopped = true;
      this.onend?.();
    }
    abort() {
      this.aborted = true;
    }
    emit(transcript, isFinal = false) {
      this.onresult?.({ results: [{ isFinal, 0: { transcript } }] });
    }
    fail(error) {
      this.onerror?.({ error });
    }
  }
  Object.defineProperty(window, "SpeechRecognition", {
    value: SpeechMock,
    configurable: true,
  });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.TEST_URL ?? "http://localhost:3001";
const response = await page.goto(base);
await expect(page.getByPlaceholder("What experience to build?")).toBeVisible();
await expect(
  page.getByRole("button", { name: "Island", exact: true }),
).toHaveCount(0);
await expect(
  page.getByRole("button", { name: "Garden", exact: true }),
).toHaveCount(0);
const centered = await page.locator(".landing-composer").evaluate((el) => {
  const r = el.getBoundingClientRect();
  return {
    x: Math.abs(r.x + r.width / 2 - innerWidth / 2),
    y: Math.abs(r.y + r.height / 2 - innerHeight / 2),
  };
});
expect(centered.x).toBeLessThan(2);
expect(centered.y).toBeLessThan(2);
await page.locator("#prompt").fill("Create");
await page.getByRole("button", { name: "Dictate prompt" }).click();
await expect(
  page.getByRole("button", { name: "Stop dictation" }),
).toHaveAttribute("aria-pressed", "true");
await page.evaluate(() => window.__speech.emit("a sunny"));
await expect(page.locator("#prompt")).toHaveValue("Create a sunny");
await page.evaluate(() => window.__speech.emit("a sunny garden", true));
await expect(page.locator("#prompt")).toHaveValue("Create a sunny garden");
await page.getByRole("button", { name: "Stop dictation" }).click();
await expect(
  page.getByRole("button", { name: "Dictate prompt" }),
).toHaveAttribute("aria-pressed", "false");
await page.getByRole("button", { name: "Dictate prompt" }).click();
await page.locator("#prompt").fill("Edited by hand");
await page.evaluate(() => window.__speech.emit("late transcript"));
await expect(page.locator("#prompt")).toHaveValue("Edited by hand");
await page.getByRole("button", { name: "Dictate prompt" }).click();
await page.evaluate(() => window.__speech.fail("not-allowed"));
await expect(page.getByRole("status")).toContainText(
  "Microphone access was denied",
);
await expect(page.locator("#prompt")).toHaveValue("Edited by hand");
await page.getByRole("button", { name: "Dismiss message" }).click();
await page.locator("#prompt").fill("");
await page.waitForTimeout(1000);
await page.screenshot({ path: "docs/evidence/centered-prompt.png" });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1000);
const mobile = await page.locator(".landing-composer").evaluate((el) => {
  const r = el.getBoundingClientRect();
  return {
    x: Math.abs(r.x + r.width / 2 - innerWidth / 2),
    y: Math.abs(r.y + r.height / 2 - innerHeight / 2),
    overflow: document.documentElement.scrollWidth > innerWidth,
  };
});
expect(mobile.x).toBeLessThan(2);
expect(mobile.y).toBeLessThan(2);
expect(mobile.overflow).toBe(false);
await page.screenshot({ path: "docs/evidence/mobile-centered-prompt.png" });
const fallback = await browser.newContext();
await fallback.addInitScript(() => {
  Object.defineProperty(window, "SpeechRecognition", {
    value: undefined,
    configurable: true,
  });
  Object.defineProperty(window, "webkitSpeechRecognition", {
    value: undefined,
    configurable: true,
  });
});
const unavailable = await fallback.newPage();
await unavailable.goto(base);
await unavailable.getByRole("button", { name: "Dictate prompt" }).click();
await expect(unavailable.getByRole("status")).toContainText(
  "isn’t available in this browser",
);
const report = {
  url: base,
  errors,
  centered,
  mobile,
  permissionPolicy: response.headers()["permissions-policy"],
  checks: [
    "exact placeholder",
    "selectors removed",
    "desktop and mobile centered",
    "interim transcript",
    "final correction without duplication",
    "preserved typed prefix",
    "stop",
    "manual edit cancels recognition",
    "late result ignored",
    "permission denial preserves text",
    "unsupported browser fallback",
  ],
  speechEngine:
    "Mocked Web Speech API events; no real microphone audio or browser transcription service tested.",
};
await writeFile(
  "docs/evidence/dictation-report.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
await browser.close();
if (errors.length) process.exitCode = 1;
