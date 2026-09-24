#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const base = new URL(process.env.ORBSIE_TEST_URL ?? "http://127.0.0.1:3108/");
assert(
  base.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(base.hostname),
  "Run this intercepted check against an isolated local app.",
);
const output = resolve(
  process.env.ORBSIE_EVIDENCE_DIR ??
    "docs/evidence/free-unavailable-browser-20260924",
);
const cases = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, mobile: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true },
];
const report = {
  startedAt: new Date().toISOString(),
  base: base.origin,
  source: "intercepted local production build; no provider call",
  cases: [],
  status: "running",
};
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  for (const entry of cases) {
    const result = {
      name: entry.name,
      viewport: entry.viewport,
      interceptedGenerate: 0,
      unexpectedApi: [],
      external: [],
      pageErrors: [],
      failedRequests: [],
      status: "running",
    };
    report.cases.push(result);
    const context = await browser.newContext({
      viewport: entry.viewport,
      deviceScaleFactor: entry.mobile ? 3 : 1,
      isMobile: entry.mobile,
      hasTouch: entry.mobile,
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (["data:", "blob:", "about:"].includes(url.protocol)) {
        await route.continue();
        return;
      }
      if (url.origin !== base.origin) {
        result.external.push(
          `${request.method()} ${url.origin}${url.pathname}`,
        );
        await route.abort("blockedbyclient");
        return;
      }
      if (url.pathname === "/api/generate" && request.method() === "POST") {
        result.interceptedGenerate += 1;
        await route.fulfill({
          status: 402,
          contentType: "application/json",
          headers: { "X-Orbsie-Trial-Remaining": "2" },
          body: JSON.stringify({
            error:
              "Free generation is temporarily unavailable. Connect your provider to continue.",
            code: "FREE_PROVIDER_UNAVAILABLE",
          }),
        });
        return;
      }
      const fixture =
        url.pathname === "/api/config"
          ? {
              generationMaxTokens: 10000,
              accounts: true,
              publishing: true,
              google: false,
              authoringReview: false,
              isAdmin: false,
              chatgptHosted: true,
              chatgptGeneration: true,
            }
          : url.pathname === "/api/trial"
            ? { enabled: true, remaining: 2, limit: 3 }
            : url.pathname === "/api/auth/get-session"
              ? null
              : url.pathname === "/api/projects"
                ? { projects: [] }
                : url.pathname === "/api/models"
                  ? { models: [] }
                  : url.pathname === "/api/chatgpt/status"
                    ? { lifecycle: "idle", authStatus: "disconnected" }
                    : undefined;
      if (url.pathname.startsWith("/api/")) {
        if (fixture === undefined || request.method() !== "GET") {
          result.unexpectedApi.push(`${request.method()} ${url.pathname}`);
          await route.abort("blockedbyclient");
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(fixture),
          });
        }
        return;
      }
      if (!["GET", "HEAD"].includes(request.method())) {
        result.unexpectedApi.push(`${request.method()} ${url.pathname}`);
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => result.pageErrors.push(error.message));
    page.on("requestfailed", (request) =>
      result.failedRequests.push(
        `${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`,
      ),
    );
    await page.goto(base.href, { waitUntil: "domcontentloaded" });
    const prompt = "A small blue tree with strawberries";
    const composer = page.getByPlaceholder("What experience to build?");
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill(prompt);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const dialog = page.locator("dialog.modal");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(
      dialog.getByText(/The free provider couldn't complete this request/),
    ).toBeVisible();
    await expect(dialog.getByLabel("Provider", { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Connect with OpenRouter" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /Use 2 free prompts/ }),
    ).toHaveCount(0);
    assert.equal(await page.locator("#prompt").inputValue(), prompt);
    const metrics = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dialogWidth: document
        .querySelector("dialog.modal")
        ?.getBoundingClientRect().width,
    }));
    assert(
      metrics.scrollWidth <= metrics.width + 1,
      `${entry.name} overflows horizontally: ${JSON.stringify(metrics)}`,
    );
    assert.equal(result.interceptedGenerate, 1);
    assert.deepEqual(result.unexpectedApi, []);
    assert.deepEqual(result.external, []);
    assert.deepEqual(result.pageErrors, []);
    assert.deepEqual(result.failedRequests, []);
    result.layout = metrics;
    result.promptPreserved = true;
    result.providerSettingsVisible = true;
    result.status = "passed";
    await page.screenshot({ path: `${output}/${entry.name}.png` });
    await context.close();
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error =
    error instanceof Error ? error.message.slice(0, 1200) : String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(
    `${output}/report.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
