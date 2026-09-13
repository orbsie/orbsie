#!/usr/bin/env node
// Deterministic visible-authoring fixture: real editor, worker, and IndexedDB.
// The generation stream is local and synthetic; no provider or model call is made.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const base = process.env.TEST_URL ?? "http://localhost:3047";
const origin = new URL(base).origin;
const output = process.argv[2];
if (!output || process.argv.length !== 3)
  throw Error(
    "Usage: node scripts/verify-visible-authoring.mjs NEW_EVIDENCE_DIRECTORY",
  );
await mkdir(output, { recursive: false });

const report = {
  passed: false,
  scope:
    "deterministic local authoring stream with real editor and geometry worker",
  liveModelCalls: 0,
  streamDelaysMs: [160, 160, 160],
  cancellationStreamDelayMs: 5_000,
  workerDelayMs: 260,
  requests: [],
  checks: {},
  pageErrors: [],
  consoleErrors: [],
  requestFailures: [],
  unexpectedRequests: [],
};

const source = {
  version: 1,
  language: "quickjs",
  seed: 73,
  code: '({version:1,revision:0,output:"body",nodes:[{id:"body",kind:"box",size:[1.3,1,1.3]}]})',
};
const streamFor = (body) => {
  if (body.project?.entities?.length) {
    const id = body.project.entities[0].id;
    return [
      { type: "set_material", id, color: "#e4c79b" },
      { type: "commit_revision", message: "Applied." },
    ];
  }
  return [
    {
      type: "reserve_entity",
      entity: {
        id: "lantern",
        label: "Lantern",
        position: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#e4c79b",
        stage: "seed",
      },
    },
    {
      type: "set_geometry",
      id: "lantern",
      geometry: {
        kind: "generated",
        detail: "refined",
        collision: "none",
        job: { backend: "browser-procedural", source },
      },
    },
    { type: "commit_revision", message: "Applied." },
  ];
};

let fixtureServer;
let browser;
try {
  fixtureServer = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/api/generate") {
      response.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    report.requests.push({
      projectId: body.project?.id,
      revision: body.project?.revision,
      prompt: body.prompt,
    });
    const commands = streamFor(body);
    response.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    const delays = body.project?.entities?.length
      ? commands.map(() => report.cancellationStreamDelayMs)
      : report.streamDelaysMs;
    for (const [index, command] of commands.entries()) {
      await new Promise((resolve) => setTimeout(resolve, delays[index]));
      if (response.destroyed) return;
      response.write(`${JSON.stringify(command)}\n`);
    }
    response.end();
  });
  await new Promise((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
  fixtureServer.unref();
  const fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}/api/generate`;

  browser = await chromium.launch({
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "no-preference",
  });
  await context.addInitScript((delay) => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(...args) {
        setTimeout(() => super.postMessage(...args), delay);
      }
    };
  }, report.workerDelayMs);
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") &&
      requestUrl.origin !== origin &&
      requestUrl.origin !== new URL(fixtureUrl).origin
    ) {
      report.unexpectedRequests.push(requestUrl.href);
      await route.abort();
      return;
    }
    await route.fallback();
  });
  await context.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        accounts: false,
        publishing: false,
        google: false,
        chatgptHosted: false,
        chatgptGeneration: false,
      },
    }),
  );
  await context.route("**/api/trial", (route) =>
    route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } }),
  );
  await context.route("**/api/models", (route) =>
    route.fulfill({ json: { models: [] } }),
  );
  await context.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [] } }),
  );
  await context.route("**/api/generate", (route) =>
    route.continue({ url: fixtureUrl }),
  );

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    report.requestFailures.push({
      url: request.url(),
      failure: request.failure()?.errorText ?? "unknown",
    }),
  );
  await page.goto(base);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(
    page.locator("[data-renderer-availability=ready]"),
  ).toBeVisible();
  await page
    .getByPlaceholder("What experience to build?")
    .fill("Build a lantern");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  const latest = page.locator(".authoring-activity-latest");
  await expect(latest).toHaveText("Waiting for a response…");
  report.checks.waitingBeforeEntity = true;
  await expect(
    page
      .locator(".authoring-activity li")
      .filter({ hasText: "Building Lantern…" }),
  ).toHaveCount(1);
  report.checks.namedConstruction = true;
  await expect(latest).toHaveText("Preparing Lantern geometry…");
  report.checks.geometryPreparation = true;
  await expect(latest).toHaveText("Generation complete. Changes are applied.");
  const saved = await storageSnapshot(page);
  assert.equal(saved.project.entities[0].id, "lantern");
  assert.equal(saved.project.entities[0].stage, "ready");
  report.checks.completed = true;
  report.checks.activityHistory = await page
    .locator(".authoring-activity li")
    .allTextContents();
  await page.screenshot({ path: `${output}/desktop-complete.png` });

  await expect
    .poll(
      () =>
        page.locator(".chat-panel").evaluate((element) => ({
          translate: element.style.translate,
          width: element.style.width,
        })),
      { timeout: 5000 },
    )
    .toEqual({ translate: "", width: "" });
  report.checks.workspaceTransitionSettled = true;
  await page.setViewportSize({ width: 390, height: 844 });
  const activityBox = page.locator(".authoring-activity");
  await expect(activityBox).toBeVisible();
  await expect
    .poll(
      async () => {
        const box = await activityBox.boundingBox();
        report.checks.narrowActivityBounds = box;
        return Boolean(box && box.x >= 0 && box.x + box.width <= 390);
      },
      { timeout: 5000 },
    )
    .toBe(true);
  const bounds = await activityBox.boundingBox();
  report.checks.narrowActivityBounds = bounds;
  assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.equal(
    await activityBox.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
    true,
  );
  report.checks.narrowPhone = { bounds, noHorizontalOverflow: true };
  await page.screenshot({ path: `${output}/narrow-phone-complete.png` });

  await page.locator("#prompt").fill("Warm the lantern");
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect(latest).toHaveText("Waiting for a response…");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(latest).toHaveText("Stopped. Finished objects are safe.");
  report.checks.cancelled = true;
  report.passed = true;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  await mkdir(output, { recursive: true }).catch(() => undefined);
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(report, null, 2),
  ).catch(() => undefined);
  throw error;
} finally {
  await browser?.close().catch(() => undefined);
  await new Promise((resolve) =>
    fixtureServer?.close(() => resolve(undefined)),
  );
}
