#!/usr/bin/env node

/**
 * Verify that the real editor keeps its input node and focus while it moves
 * from the landing composer into the chat composer.
 *
 * This is one deterministic browser run. The fixture /api/generate response
 * is held until the test has observed the building workspace and entered a
 * follow-up draft without refocusing the textarea. It does not exercise
 * partial-stream gameplay or a live provider.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const TEST_URL = process.env.TEST_URL ?? "http://localhost:3030";
const EVIDENCE_DIR =
  process.env.ORBSIE_COMPOSER_EVIDENCE_DIR ??
  "docs/evidence/composer-continuity";
const APP_SOURCE_COMMIT = process.env.ORBSIE_APP_SOURCE_COMMIT ?? "unverified";
const INITIAL_PROMPT =
  "Make a sunny little island game where I collect five glowing crystals, bounce across three moving platforms, and reach a portal. Add friendly trees and a pond.";
const FOLLOW_UP_DRAFT = " Keep the follow-up idea ready for later.";
const WAIT_TIMEOUT = 45000;
const VIEWPORT = { width: 1440, height: 1000 };
const REDUCED_MOTION = "no-preference";

function sourceCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unavailable";
  }
}

function summarizeContinuity(state) {
  const samples = state.samples ?? [];
  return {
    sampleCount: samples.length,
    sampleOverflow: state.sampleOverflow === true,
    blurEvents: state.blurEvents ?? null,
    focusoutEvents: state.focusoutEvents ?? null,
    firstSample: samples[0] ?? null,
    heldSample:
      samples.find((sample) => sample.label === "held-response") ?? null,
    lastSample: samples.at(-1) ?? null,
    continuityViolations: samples
      .filter(
        (sample) => !sample.connected || !sample.active || !sample.sameCanvas,
      )
      .map((sample) => ({
        label: sample.label,
        connected: sample.connected,
        active: sample.active,
        sameCanvas: sample.sameCanvas,
      })),
  };
}

async function fixtureBody() {
  const bundled = await build({
    entryPoints: ["src/lib/fixtures.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
  });
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(
      bundled.outputFiles[0].contents,
    ).toString("base64")}`
  );
  return `${[...module.fixtureCommands(false)]
    .map((command) => JSON.stringify(command))
    .join("\n")}\n`;
}

const report = {
  status: "running",
  mode: "deterministic-fixture-browser",
  scope:
    "One normal-motion actual-editor keyboard run checks the landing-to-chat composer transition, held-response building workspace, textarea DOM/focus/canvas continuity, and follow-up draft persistence. It does not cover partial-stream gameplay or live provider behavior.",
  url: TEST_URL,
  appSourceCommit: APP_SOURCE_COMMIT,
  repositoryCommit: sourceCommit(),
  fixtureTransport: true,
  fixtureResponseHeldUntilRelease: true,
  fixtureServerRequestCount: 0,
  viewport: VIEWPORT,
  reducedMotion: REDUCED_MOTION,
  generationRequestCount: 0,
  generationLifecycle: [],
  blockedExternalHttpRequests: [],
  fixtureFontStylesheets: [],
  pageErrors: [],
  consoleErrors: [],
  requestFailures: [],
  checks: {},
};

const testOrigin = new URL(TEST_URL).origin;
await mkdir(EVIDENCE_DIR, { recursive: true });

let browser;
let context;
let page;
let fixtureServer;
let releaseGeneration;
const generationReleased = new Promise((resolve) => {
  releaseGeneration = resolve;
});

try {
  const body = await fixtureBody();
  fixtureServer = createServer(async (request, response) => {
    if (request.url !== "/api/generate" || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    report.fixtureServerRequestCount += 1;
    for await (const _chunk of request) {
      // Read the request before releasing the held response, as a real
      // generation endpoint would do. The fixture does not need its payload.
    }
    await generationReleased;
    response.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    });
    response.end(body);
  });
  await new Promise((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
  fixtureServer.unref();
  const fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}/api/generate`;
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  context = await browser.newContext({
    viewport: VIEWPORT,
    reducedMotion: REDUCED_MOTION,
  });

  await context.addInitScript(() => {
    const state = {
      textarea: null,
      canvas: null,
      samples: [],
      sampleOverflow: false,
      nativeSubmitEvents: 0,
      blurEvents: 0,
      focusoutEvents: 0,
      sampling: false,
    };
    window.__orbsieComposerContinuity = state;
    document.addEventListener(
      "submit",
      (event) => {
        if (event.target instanceof HTMLFormElement)
          state.nativeSubmitEvents += 1;
      },
      true,
    );
    document.addEventListener(
      "blur",
      (event) => {
        if (event.target === state.textarea) state.blurEvents += 1;
      },
      true,
    );
    document.addEventListener(
      "focusout",
      (event) => {
        if (event.target === state.textarea) state.focusoutEvents += 1;
      },
      true,
    );
    state.capture = (label) => {
      if (state.samples.length >= 600) {
        state.sampleOverflow = true;
        state.sampling = false;
        return;
      }
      const textarea = state.textarea;
      const canvas = state.canvas;
      state.samples.push({
        label,
        at: performance.now(),
        connected: Boolean(textarea?.isConnected),
        active: document.activeElement === textarea,
        sameCanvas: document.querySelector("canvas") === canvas,
        value: textarea?.value ?? null,
      });
    };
    state.start = () => {
      state.sampling = true;
      const frame = () => {
        if (!state.sampling) return;
        state.capture("animation-frame");
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    };
    state.stop = () => {
      state.sampling = false;
    };
  });

  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      requestUrl.origin === "https://fonts.googleapis.com" &&
      requestUrl.pathname === "/css2"
    ) {
      report.fixtureFontStylesheets.push(requestUrl.href);
      await route.fulfill({
        contentType: "text/css",
        body: "/* Deterministic fixture: use fallback fonts. */",
      });
      return;
    }
    if (
      (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") &&
      requestUrl.origin !== testOrigin
    ) {
      report.blockedExternalHttpRequests.push({
        method: route.request().method(),
        url: route.request().url(),
      });
      await route.abort();
      return;
    }
    await route.fallback();
  });
  await context.route("**/api/trial", (route) =>
    route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } }),
  );
  await context.route("**/api/generate", async (route) => {
    report.generationRequestCount += 1;
    await route.continue({ url: fixtureUrl });
  });

  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/generate"))
      report.generationLifecycle.push({
        event: "requestfailed",
        url: request.url(),
        failure: request.failure()?.errorText ?? "unknown",
      });
    report.requestFailures.push({
      method: request.method(),
      url: request.url(),
      failure: request.failure()?.errorText ?? "unknown",
    });
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/generate"))
      report.generationLifecycle.push({
        event: "response",
        url: response.url(),
        status: response.status(),
      });
  });
  page.on("requestfinished", (request) => {
    if (request.url().includes("/api/generate"))
      report.generationLifecycle.push({
        event: "requestfinished",
        url: request.url(),
      });
  });

  await page.goto(TEST_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas")).toBeVisible();
  const textarea = page.getByPlaceholder("What experience to build?");
  await textarea.fill(INITIAL_PROMPT);
  await page.evaluate(() => {
    const state = window.__orbsieComposerContinuity;
    state.textarea = document.querySelector("#prompt");
    state.canvas = document.querySelector("canvas");
    state.capture("typed");
    state.start();
  });
  await expect(textarea).toBeFocused();

  // The editor handles Enter itself and calls submit() directly. This is the
  // actual keyboard path, so no native form submit event should be observed.
  await page.keyboard.press("Enter");
  await expect
    .poll(() => report.generationRequestCount, {
      timeout: WAIT_TIMEOUT,
      message: "Timed out waiting for the held fixture generation request.",
    })
    .toBe(1);
  await expect(page.locator(".app.is-workspace")).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });
  await expect(page.locator(".building-message")).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });
  const holdState = await page.evaluate(() => {
    const state = window.__orbsieComposerContinuity;
    state.capture("held-response");
    return {
      nativeSubmitEvents: state.nativeSubmitEvents,
      samples: state.samples.slice(),
      sampleOverflow: state.sampleOverflow,
      blurEvents: state.blurEvents,
      focusoutEvents: state.focusoutEvents,
      textareaValue: state.textarea?.value ?? null,
      textareaConnected: Boolean(state.textarea?.isConnected),
      active: document.activeElement === state.textarea,
      sameCanvas: document.querySelector("canvas") === state.canvas,
      workspace: Boolean(document.querySelector(".app.is-workspace")),
      building: Boolean(document.querySelector(".building-message")),
    };
  });
  assert.equal(holdState.nativeSubmitEvents, 0);
  assert.equal(holdState.textareaValue, "");
  assert.equal(holdState.textareaConnected, true);
  assert.equal(holdState.active, true);
  assert.equal(holdState.sameCanvas, true);
  assert.equal(holdState.workspace, true);
  assert.equal(holdState.building, true);
  assert.ok(holdState.samples.length > 0);
  assert.ok(
    holdState.samples.every(
      (sample) => sample.connected && sample.active && sample.sameCanvas,
    ),
    "textarea and canvas stayed attached while the held response was building",
  );
  assert.equal(holdState.sampleOverflow, false);
  report.checks = {
    actualEditorKeyboardEnter: true,
    nativeSubmitEventAbsent: true,
    heldGenerationRequestObserved: true,
    buildingWorkspaceObserved: true,
    textareaAndCanvasContinuousWhileHeld: true,
  };

  await expect(page.locator(".scene-caption")).toHaveText(
    "Click an object to make it your own.",
    { timeout: WAIT_TIMEOUT },
  );
  const settledHoldState = await page.evaluate(() => {
    const state = window.__orbsieComposerContinuity;
    state.capture("motion-settled-while-held");
    return {
      nativeSubmitEvents: state.nativeSubmitEvents,
      samples: state.samples.slice(),
      sampleOverflow: state.sampleOverflow,
      blurEvents: state.blurEvents,
      focusoutEvents: state.focusoutEvents,
      textareaConnected: Boolean(state.textarea?.isConnected),
      active: document.activeElement === state.textarea,
      sameCanvas: document.querySelector("canvas") === state.canvas,
      workspace: Boolean(document.querySelector(".app.is-workspace")),
      building: Boolean(document.querySelector(".building-message")),
    };
  });
  assert.equal(settledHoldState.nativeSubmitEvents, 0);
  assert.equal(settledHoldState.sampleOverflow, false);
  assert.equal(settledHoldState.blurEvents, 0);
  assert.equal(settledHoldState.focusoutEvents, 0);
  assert.equal(settledHoldState.textareaConnected, true);
  assert.equal(settledHoldState.active, true);
  assert.equal(settledHoldState.sameCanvas, true);
  assert.equal(settledHoldState.workspace, true);
  assert.equal(settledHoldState.building, true);
  assert.ok(
    settledHoldState.samples.every(
      (sample) => sample.connected && sample.active && sample.sameCanvas,
    ),
    "textarea and canvas stayed attached and focused through normal descent",
  );
  report.checks.normalMotionDescentSettledWhileHeld = true;

  // The active textarea is used directly. There is deliberately no click,
  // locator.focus(), or other refocusing operation before this typing.
  await page.keyboard.type(FOLLOW_UP_DRAFT);
  const draftState = await page.evaluate(() => ({
    value: window.__orbsieComposerContinuity.textarea?.value ?? null,
    active:
      document.activeElement === window.__orbsieComposerContinuity.textarea,
  }));
  assert.equal(draftState.value, FOLLOW_UP_DRAFT);
  assert.equal(draftState.active, true);
  report.checks.followUpTypedWithoutRefocus = true;

  releaseGeneration();
  await expect(
    page.getByText("Your island is alive!", { exact: false }),
  ).toBeVisible({ timeout: WAIT_TIMEOUT });
  await expect(page.locator(".building-message")).toHaveCount(0, {
    timeout: WAIT_TIMEOUT,
  });
  await expect
    .poll(
      () =>
        page
          .locator(".message.user p")
          .evaluateAll(
            (nodes, prompt) =>
              nodes.filter((node) => node.textContent === prompt).length,
            INITIAL_PROMPT,
          ),
      { timeout: WAIT_TIMEOUT },
    )
    .toBe(1);
  await page.waitForTimeout(1200);
  const finalState = await page.evaluate((prompt) => {
    const state = window.__orbsieComposerContinuity;
    state.stop();
    state.capture("settled");
    const userMessages = [...document.querySelectorAll(".message.user p")].map(
      (node) => node.textContent,
    );
    return {
      nativeSubmitEvents: state.nativeSubmitEvents,
      samples: state.samples.slice(),
      sampleOverflow: state.sampleOverflow,
      blurEvents: state.blurEvents,
      focusoutEvents: state.focusoutEvents,
      textareaValue: state.textarea?.value ?? null,
      textareaConnected: Boolean(state.textarea?.isConnected),
      active: document.activeElement === state.textarea,
      sameCanvas: document.querySelector("canvas") === state.canvas,
      exactPromptCount: userMessages.filter((text) => text === prompt).length,
      userMessages,
    };
  }, INITIAL_PROMPT);
  assert.equal(finalState.nativeSubmitEvents, 0);
  assert.equal(finalState.blurEvents, 0);
  assert.equal(finalState.focusoutEvents, 0);
  assert.equal(finalState.sampleOverflow, false);
  assert.equal(finalState.textareaValue, FOLLOW_UP_DRAFT);
  assert.equal(finalState.textareaConnected, true);
  assert.equal(finalState.active, true);
  assert.equal(finalState.sameCanvas, true);
  assert.equal(finalState.exactPromptCount, 1);
  assert.ok(
    finalState.samples.every(
      (sample) => sample.connected && sample.active && sample.sameCanvas,
    ),
    "textarea and canvas stayed attached and focused through settled transition",
  );
  report.checks.followUpSurvivedResponse = true;
  report.checks.originalPromptAppearsExactlyOnce = true;
  report.checks.textareaAndCanvasContinuousAfterSettledTransition = true;
  report.observations = {
    hold: summarizeContinuity(holdState),
    settledWhileHeld: summarizeContinuity(settledHoldState),
    draft: draftState,
    final: summarizeContinuity(finalState),
    finalUserMessages: finalState.userMessages,
  };
  assert.equal(report.generationRequestCount, 1);
  assert.equal(report.fixtureServerRequestCount, 1);
  assert.deepEqual(report.blockedExternalHttpRequests, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  const unexpectedFailures = report.requestFailures.filter(
    (failure) =>
      failure.method !== "POST" ||
      failure.url !== fixtureUrl ||
      failure.failure !== "net::ERR_ABORTED",
  );
  assert.deepEqual(unexpectedFailures, []);
  assert.ok(report.requestFailures.length <= 1);
  report.checks.oneFixtureServerRequest = true;
  report.requestFailureNote =
    "Chromium reports net::ERR_ABORTED for the rewritten localhost fixture request after the committed response was consumed; this is the existing deterministic fixture transport behavior. No provider request was made.";
  report.status = "passed";
  await page.screenshot({ path: `${EVIDENCE_DIR}/final.png` });
  report.screenshot = "final.png";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  if (page) {
    await page
      .screenshot({ path: `${EVIDENCE_DIR}/failure.png` })
      .catch(() => undefined);
    report.screenshot = "failure.png";
  }
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(
    `${EVIDENCE_DIR}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  releaseGeneration?.();
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  if (fixtureServer)
    await new Promise((resolve) => fixtureServer.close(resolve));
  console.log(JSON.stringify(report, null, 2));
}
