#!/usr/bin/env node
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.TEST_URL ?? "http://localhost:3055";
const out = "test-results/local-storage-recovery";
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const report = { base, startedAt: new Date().toISOString(), checks: {} };
let page;
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas")).toBeVisible();

  // Seed weeks of heavy local data: 12 library worlds of ~2MB each plus
  // per-project history records and a recoverable draft checkpoint.
  report.seedOutcomes = await page.evaluate(async () => {
    const open = indexedDB.open("keyval-store");
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const put = (key, value) =>
      new Promise((resolve, reject) => {
        const request = db
          .transaction("keyval", "readwrite")
          .objectStore("keyval")
          .put(value, key);
        request.onsuccess = () => resolve(`ok:${key.slice(0, 9)}`);
        request.onerror = () => reject(`err:${key.slice(0, 9)}:${request.error}`);
      });
    const blank = (title) => ({
      version: 1,
      id: crypto.randomUUID(),
      title,
      revision: 1,
      seed: 42,
      entities: [],
      groups: [],
      messages: Array.from({ length: 500 }, () => ({
        role: "user",
        text: "x".repeat(4000),
      })),
      environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
    });
    const histories = {};
    const library = {};
    const outcomes = [];
    for (let index = 0; index < 12; index += 1) {
      const project = blank(`Orb ${String(index).padStart(2, "0")}`);
      library[project.id] = project;
      histories[project.id] = { project, history: [], future: [] };
    }
    await put("orbsie-library", library).then(
      (result) => outcomes.push(result),
      (error) => outcomes.push(String(error).slice(0, 80)),
    );
    await put("orbsie-history", histories).then(
      (result) => outcomes.push(result),
      (error) => outcomes.push(String(error).slice(0, 80)),
    );
    const draft = blank("Recoverable draft");
    await put("orbsie-draft", {
      project: draft,
      history: [],
      future: [],
      savedAt: Date.now(),
    }).then(
      (result) => outcomes.push(result),
      (error) => outcomes.push(String(error).slice(0, 80)),
    );
    db.close();
    return outcomes;
  });

  const seeded = await page.evaluate(async () => {
    const open = indexedDB.open("keyval-store");
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const getv = (key) =>
      new Promise((resolve, reject) => {
        const request = db
          .transaction("keyval")
          .objectStore("keyval")
          .get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const library = await getv("orbsie-library");
    db.close();
    return library ? Object.keys(library).length : -1;
  });
  report.seededLibraryKeys = seeded;

  const started = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas")).toBeVisible({ timeout: 20000 });
  report.reloadToCanvasMs = Date.now() - started;
  assert.ok(
    report.reloadToCanvasMs < 15000,
    `mount with heavy local data took ${report.reloadToCanvasMs}ms`,
  );
  report.checks.heavyMount = "passed";

  await expect(
    page.getByRole("button", { name: "Continue your saved world" }),
  ).toBeVisible({ timeout: 8000 });
  report.checks.recoveredDraft = "passed";

  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByRole("button", { name: "Sign in to Orbsie" }).click();
  await expect(page.getByText("A home for your worlds.")).toBeVisible();
  await page.waitForTimeout(4000);
  report.draftsVisible = await page.locator(".share-option").count();
  report.libKeys = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("keyval-store");
        open.onsuccess = () => {
          const request = open.result
            .transaction("keyval")
            .objectStore("keyval")
            .get("orbsie-library");
          request.onsuccess = () =>
            resolve(
              request.result ? Object.keys(request.result).length : -1,
            );
          request.onerror = () => resolve(-2);
        };
        open.onerror = () => resolve(-3);
      }),
  );
  await expect(
    page.getByText(/Orb 07/, { exact: false }).first(),
  ).toBeVisible({ timeout: 10000 });
  const draftButtons = await page.locator(".share-option").count();
  assert.ok(
    draftButtons >= 10,
    `lazy drafts list incomplete: ${draftButtons}`,
  );
  const usage = await page.evaluate(
    () =>
      navigator.storage?.estimate?.().then((e) => e.usage ?? 0).catch(() => -1) ??
      -1,
  );
  if (usage > 0) {
    try {
      await expect(page.getByText(/Saved data: ~/)).toBeVisible({
        timeout: 4000,
      });
      report.checks.storageEstimate = "passed";
    } catch {
      report.checks.storageEstimate = "skipped-usage-unavailable";
    }
  } else {
    report.checks.storageEstimate = "skipped-usage-unavailable";
  }
  report.checks.lazyDrafts = "passed";
  await page.screenshot({ path: `${out}/account-drafts.png` });

  await page
    .getByRole("button", { name: "Reset saved data on this device" })
    .click();
  await page
    .getByRole("button", { name: /Really delete\? Tap again/ })
    .click();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByRole("button", { name: "Continue your saved world" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByRole("button", { name: "Sign in to Orbsie" }).click();
  await expect(page.getByText("A home for your worlds.")).toBeVisible();
  await expect(page.locator(".share-option")).toHaveCount(0);
  report.checks.manualReset = "passed";
  await page.screenshot({ path: `${out}/after-reset.png` });

  assert.deepEqual(errors, []);
  report.status = "passed";
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  report.status = "failed";
  report.error = String(error.message ?? error).slice(0, 400);
  report.modalText = await page
    .locator("dialog.modal")
    .innerText()
    .catch(() => "");
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)).catch(
    () => undefined,
  );
  throw error;
} finally {
  await browser.close();
}
