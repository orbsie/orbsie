#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const BASE = process.env.ORBSIE_TEST_URL ?? "http://localhost:3058";
const OUTPUT =
  process.env.ORBSIE_NOTICE_EVIDENCE_DIR ?? "docs/evidence/connection-notices";

const report = {
  status: "running",
  base: BASE,
  startedAt: new Date().toISOString(),
  checks: {},
};
await mkdir(OUTPUT, { recursive: true });
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await context.route("**/api/trial", (route) =>
    route.fulfill({ json: { enabled: true, remaining: 0, limit: 3 } }),
  );
  await context.route("**/api/generate", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Generation must not run in this check." }),
    }),
  );
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas")).toBeVisible();
  await page
    .getByPlaceholder("What experience to build?")
    .fill("A farm full of pigs");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.locator("dialog.modal")).toBeVisible({ timeout: 30000 });
  try {
    await expect(
      page.getByText(/You've used today's free prompts/, { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New here? Create an account" }),
    ).toBeVisible();
  } catch (error) {
    report.modalState = {
      text: (await page.locator("dialog.modal").innerText().catch(() => "x")).slice(0, 400),
    };
    await page.screenshot({ path: `${OUTPUT}/modal-state.png` }).catch(() => undefined);
    throw error;
  }
  const promptValue = await page.locator("#prompt").inputValue();
  assert.equal(promptValue, "A farm full of pigs");
  report.checks.exhaustedModal = "passed";
  report.checks.promptPreserved = "passed";
  await page.screenshot({ path: `${OUTPUT}/exhausted-modal.png` });

  const offlineContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await offlineContext.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", { get: () => false });
  });
  await offlineContext.route("**/api/trial", (route) => route.abort());
  const offlinePage = await offlineContext.newPage();
  await offlinePage.goto(BASE, { waitUntil: "domcontentloaded" });
  await expect(offlinePage.locator("canvas")).toBeVisible();
  await offlinePage
    .getByPlaceholder("What experience to build?")
    .fill("A farm full of pigs");
  await offlinePage.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    offlinePage.getByText(/You're offline/, { exact: false }),
  ).toBeVisible({ timeout: 30000 });
  await expect(offlinePage.locator("dialog.modal")).not.toBeVisible();
  assert.equal(
    await offlinePage.locator("#prompt").inputValue(),
    "A farm full of pigs",
  );
  report.checks.offlineToast = "passed";
  await offlinePage.screenshot({ path: `${OUTPUT}/offline-toast.png` });

  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await adminContext.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        generationMaxTokens: 10000,
        accounts: true,
        publishing: false,
        google: false,
        isAdmin: true,
      },
    }),
  );
  let resetCalls = 0;
  await adminContext.route("**/api/trial/reset-recent", (route) => {
    resetCalls += 1;
    route.fulfill({ json: { cleared: 2, visitors: 1, networks: 1 } });
  });
  await adminContext.route("**/api/trial", (route) =>
    route.fulfill({ json: { enabled: true, remaining: 0, limit: 3 } }),
  );
  await adminContext.route("**/api/generate", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Generation must not run in this check." }),
    }),
  );
  await adminContext.route("**/api/auth/get-session", (route) =>
    route.fulfill({ json: { user: { name: "Owner" } } }),
  );
  await adminContext.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [] } }),
  );
  const adminPage = await adminContext.newPage();
  await adminPage.goto(BASE, { waitUntil: "domcontentloaded" });
  await expect(adminPage.locator("canvas")).toBeVisible();
  await adminPage
    .getByPlaceholder("What experience to build?")
    .fill("A farm full of pigs");
  await adminPage.getByRole("button", { name: "Create", exact: true }).click();
  await expect(adminPage.locator("dialog.modal")).toBeVisible({ timeout: 30000 });
  const resetButton = adminPage.getByRole("button", {
    name: /Reset free-prompt limits for visitors active in the last 5/,
  });
  await expect(resetButton).toBeVisible({ timeout: 15000 });
  await resetButton.click();
  await expect(
    adminPage.getByText(/Cleared 2 visitor limit rows/, { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  assert.equal(resetCalls, 1);
  report.checks.adminResetAction = "passed";
  await adminPage.screenshot({ path: `${OUTPUT}/admin-reset.png` });

  const plainContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await plainContext.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        generationMaxTokens: 10000,
        accounts: true,
        publishing: false,
        google: false,
        isAdmin: false,
      },
    }),
  );
  await plainContext.route("**/api/trial", (route) =>
    route.fulfill({ json: { enabled: true, remaining: 0, limit: 3 } }),
  );
  await plainContext.route("**/api/generate", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Generation must not run in this check." }),
    }),
  );
  const plainPage = await plainContext.newPage();
  await plainPage.goto(BASE, { waitUntil: "domcontentloaded" });
  await expect(plainPage.locator("canvas")).toBeVisible();
  await plainPage
    .getByPlaceholder("What experience to build?")
    .fill("A farm full of pigs");
  await plainPage.getByRole("button", { name: "Create", exact: true }).click();
  await expect(plainPage.locator("dialog.modal")).toBeVisible({
    timeout: 30000,
  });
  assert.equal(
    await plainPage
      .getByRole("button", {
        name: /Reset free-prompt limits/,
      })
      .count(),
    0,
  );
  report.checks.noAdminControl = "passed";

  assert.deepEqual(pageErrors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error).slice(0, 1200);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${OUTPUT}/report.json`, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
  console.log(JSON.stringify(report));
}
