import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// Browser-only startup fixture. All ChatGPT responses are local synthetic data;
// this script never opens a provider connection or sends a model request.
const base = process.env.TEST_URL || "http://localhost:3013";
const output =
  process.env.STARTUP_RESTORE_EVIDENCE_DIR || ".vercel/chatgpt-startup-restore";
const preferenceKey = "orbsie-chatgpt-startup-v1";
const preference = JSON.stringify({
  version: 1,
  provider: "chatgpt-hosted",
  tier: "Budget",
});
const models = [
  {
    id: "catalog-astra",
    model: "gpt-6-astra",
    displayName: "Astra",
    supportedReasoningEfforts: ["high", "low"],
    defaultReasoningEffort: "low",
  },
  {
    id: "catalog-luna",
    model: "gpt-5.6-luna",
    displayName: "Luna",
    supportedReasoningEfforts: ["medium", "low"],
    defaultReasoningEffort: "medium",
  },
];

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
const report = { passed: false, providerCalls: 0, checks: {}, diagnostics: [] };
const diagnostics = report.diagnostics;
let activePage = null;

function watchPage(page, label) {
  page.on("requestfinished", async (request) => {
    if (!new URL(request.url()).pathname.startsWith("/api/")) return;
    const response = await request.response().catch(() => null);
    diagnostics.push({
      label,
      kind: "requestfinished",
      method: request.method(),
      path: new URL(request.url()).pathname,
      status: response?.status() ?? null,
    });
  });
  page.on("requestfailed", (request) => {
    if (!new URL(request.url()).pathname.startsWith("/api/")) return;
    diagnostics.push({
      label,
      kind: "requestfailed",
      method: request.method(),
      path: new URL(request.url()).pathname,
      error: request.failure()?.errorText ?? "unknown",
    });
  });
  page.on("pageerror", (error) => {
    diagnostics.push({ label, kind: "pageerror", error: error.message });
  });
}

async function installCommonRoutes(
  context,
  {
    transientStatus = false,
    transientSession = false,
    malformedSession = false,
    missingSession = false,
    trialAvailable = false,
    delaySession = false,
    transientConfig = false,
    delayConfig = false,
  } = {},
) {
  let statusCalls = 0;
  let sessionCalls = 0;
  let configCalls = 0;
  let trialCalls = 0;
  let generationCalls = 0;
  const generationBodies = [];
  let releaseSessionGate = () => undefined;
  let sessionGate = Promise.resolve();
  if (delaySession) {
    sessionGate = new Promise((resolve) => {
      releaseSessionGate = resolve;
    });
  }
  let releaseConfigGate = () => undefined;
  let configGate = Promise.resolve();
  if (delayConfig) {
    configGate = new Promise((resolve) => {
      releaseConfigGate = resolve;
    });
  }
  const runs = new Map();
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/config") {
      configCalls++;
      if (delayConfig) await configGate;
      if (transientConfig)
        return route.fulfill({ status: 503, json: { error: "temporary" } });
      return route.fulfill({
        json: {
          accounts: true,
          publishing: false,
          google: false,
          chatgptHosted: true,
          chatgptGeneration: true,
        },
      });
    }
    if (path === "/api/auth/get-session") {
      sessionCalls++;
      if (delaySession) await sessionGate;
      if (missingSession)
        return route.fulfill({ contentType: "application/json", body: "null" });
      if (transientSession)
        return route.fulfill({ status: 503, json: { error: "temporary" } });
      if (malformedSession)
        return route.fulfill({ json: { user: { id: "fixture-user" } } });
      return route.fulfill({
        json: {
          user: { id: "fixture-user", name: "Fixture", isAnonymous: true },
          session: { id: "fixture-session" },
        },
      });
    }
    if (path === "/api/projects") {
      if (request.method() === "PUT")
        return route.fulfill({
          json: {
            revision: 0,
            snapshotToken: "fixture-snapshot",
            archivePending: false,
          },
        });
      return route.fulfill({ json: { projects: [] } });
    }
    if (path === "/api/generation-runs") {
      const body = request.postDataJSON();
      if (request.method() === "POST") {
        const run = {
          id: body.runId,
          projectId: body.project.id,
          sequence: 0,
          state: "running",
          checkpoint: body.project,
          prompt: body.prompt,
          ...(body.selected ? { selected: body.selected } : {}),
          baseRevision: body.project.revision,
          cloudBaselineCurrent: true,
        };
        runs.set(run.id, run);
        return route.fulfill({ json: { run } });
      }
      if (request.method() === "PUT") {
        const current = runs.get(body.runId);
        if (!current)
          return route.fulfill({ status: 404, json: { error: "missing" } });
        const command = body.envelope.command;
        const checkpoint = {
          ...current.checkpoint,
          revision: current.checkpoint.revision + 1,
          messages:
            command.type === "commit_revision"
              ? [
                  ...current.checkpoint.messages,
                  { role: "assistant", text: command.message },
                ]
              : current.checkpoint.messages,
        };
        const run = {
          ...current,
          sequence: body.envelope.sequence,
          checkpoint,
        };
        runs.set(run.id, run);
        return route.fulfill({ json: { run } });
      }
      if (request.method() === "PATCH") {
        const current = runs.get(body.runId);
        return route.fulfill({
          json: current
            ? { ...current, state: "cancelled" }
            : { error: "missing" },
        });
      }
    }
    if (path === "/api/trial") {
      trialCalls++;
      return route.fulfill({
        json: trialAvailable
          ? { enabled: true, remaining: 1 }
          : { enabled: false, remaining: 0 },
      });
    }
    if (path === "/api/chatgpt/status") {
      statusCalls++;
      if (transientStatus)
        return route.fulfill({
          status: 503,
          json: { error: "ChatGPT host is temporarily unavailable." },
        });
      return route.fulfill({
        json: { lifecycle: "idle", authStatus: "connected" },
      });
    }
    if (path === "/api/chatgpt/models")
      return route.fulfill({ json: { models } });
    if (path === "/api/models")
      return route.fulfill({
        json: {
          models: [
            {
              id: "gateway-balanced",
              name: "Gateway Balanced",
              context_length: 4096,
            },
          ],
        },
      });
    if (path === "/api/chatgpt/logout")
      return route.fulfill({
        json: { lifecycle: "idle", authStatus: "disconnected" },
      });
    if (path === "/api/chatgpt/generate") {
      generationCalls++;
      const body = request.postDataJSON();
      generationBodies.push({ model: body.model, effort: body.effort });
      if (body.model !== "gpt-5.6-luna" || body.effort !== "low")
        throw Error("startup restore did not submit the saved Budget choice");
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: `${JSON.stringify({ type: "commit_revision", message: "Fixture complete." })}\n`,
      });
    }
    throw Error(`Unexpected API request: ${path}`);
  });
  return {
    recover: () => {
      transientConfig = false;
      transientSession = false;
      malformedSession = false;
      transientStatus = false;
    },
    statusCalls: () => statusCalls,
    sessionCalls: () => sessionCalls,
    trialCalls: () => trialCalls,
    generationCalls: () => generationCalls,
    generationBodies: () => [...generationBodies],
    releaseSession: releaseSessionGate,
    configCalls: () => configCalls,
    releaseConfig: releaseConfigGate,
  };
}

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(
    ({ key, value }) => {
      const marker = `${key}:fixture-seeded`;
      if (sessionStorage.getItem(marker) === "1") return;
      localStorage.setItem(key, value);
      sessionStorage.setItem(marker, "1");
    },
    { key: preferenceKey, value: preference },
  );
  const routes = await installCommonRoutes(context);
  const page = await context.newPage();
  activePage = page;
  watchPage(page, "primary");
  await page.goto(base);
  const quality = page.locator(".quality-selector-trigger");
  await expect(quality).toContainText("ChatGPT · Budget", { timeout: 15000 });
  expect(await page.locator("dialog[open]").count()).toBe(0);
  report.checks.restoreWithoutSettings = true;
  await page.locator("#prompt").fill("Build a small lantern garden");
  await expect(
    page.getByRole("button", { name: "Create", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByText("Fixture complete.", { exact: true }),
  ).toBeVisible({
    timeout: 15000,
  });
  await expect.poll(() => routes.generationCalls()).toBe(1);
  report.checks.promptUsesSavedTier = true;
  report.checks.initialStatusCalls = routes.statusCalls();
  report.checks.generationCalls = routes.generationCalls();
  report.checks.generationBodies = routes.generationBodies();
  await page.reload();
  await expect(page.locator(".quality-selector-trigger")).toContainText(
    "ChatGPT · Budget",
    {
      timeout: 15000,
    },
  );
  expect(await page.locator("dialog[open]").count()).toBe(0);
  report.checks.reloadRestoresWithoutSettings = true;
  await page.screenshot({ path: `${output}/restored-desktop.png` });
  await page.getByRole("button", { name: "Connections" }).click();
  await expect(
    page.getByRole("button", { name: "Disconnect ChatGPT" }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Disconnect ChatGPT" }).click();
  await expect
    .poll(() =>
      page.evaluate((key) => localStorage.getItem(key), preferenceKey),
    )
    .toBeNull();
  await page.reload();
  await expect(
    page.locator('[data-testid="chatgpt-startup-restore"]'),
  ).toHaveCount(0);
  report.checks.disconnectClearsRestoreOnReload = true;
  await context.close();

  const transientContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await transientContext.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: preferenceKey, value: preference },
  );
  const transientRoutes = await installCommonRoutes(transientContext, {
    transientStatus: true,
    trialAvailable: true,
  });
  const transientPage = await transientContext.newPage();
  activePage = transientPage;
  watchPage(transientPage, "status-transient");
  await transientPage.goto(base);
  const restoreNotice = transientPage.locator(
    '[data-testid="chatgpt-startup-restore"]',
  );
  await expect(restoreNotice).toContainText("temporarily unavailable", {
    timeout: 15000,
  });
  await transientPage.locator("#prompt").fill("This must wait for ChatGPT");
  await expect(
    transientPage.getByRole("button", { name: "Create", exact: true }),
  ).toBeEnabled({ timeout: 15000 });
  const trialCallsBeforePendingSubmit = transientRoutes.trialCalls();
  await transientPage
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await transientPage.waitForTimeout(100);
  expect(transientRoutes.trialCalls()).toBe(trialCallsBeforePendingSubmit);
  expect(transientRoutes.generationCalls()).toBe(0);
  report.checks.pendingRestoreDoesNotSpendFreePrompt = true;
  transientRoutes.recover();
  await restoreNotice.getByRole("button", { name: "Retry" }).click();
  await expect(
    transientPage.locator(".quality-selector-trigger"),
  ).toContainText("ChatGPT · Budget", { timeout: 15000 });
  report.checks.transientRetry = true;
  await transientPage.screenshot({ path: `${output}/restored-phone.png` });
  await transientContext.close();

  const configContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await configContext.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: preferenceKey, value: preference },
  );
  const configRoutes = await installCommonRoutes(configContext, {
    transientConfig: true,
    delayConfig: true,
    trialAvailable: true,
  });
  const configPage = await configContext.newPage();
  activePage = configPage;
  watchPage(configPage, "config-transient");
  await configPage.goto(base);
  const configNotice = configPage.locator(
    '[data-testid="chatgpt-startup-restore"]',
  );
  await expect(configNotice).toContainText("Restoring", { timeout: 15000 });
  await configPage.locator("#prompt").fill("This must wait for config");
  await expect(
    configPage.getByRole("button", { name: "Create", exact: true }),
  ).toBeEnabled({ timeout: 15000 });
  const configTrialCalls = configRoutes.trialCalls();
  await configPage.getByRole("button", { name: "Create", exact: true }).click();
  await configPage.waitForTimeout(100);
  expect(configRoutes.trialCalls()).toBe(configTrialCalls);
  expect(configRoutes.generationCalls()).toBe(0);
  configRoutes.releaseConfig();
  await expect(configNotice).toContainText("temporarily unavailable", {
    timeout: 15000,
  });
  configRoutes.recover();
  await configNotice.getByRole("button", { name: "Retry" }).click();
  await expect(configPage.locator(".quality-selector-trigger")).toContainText(
    "ChatGPT · Budget",
    { timeout: 15000 },
  );
  expect(configRoutes.configCalls()).toBeGreaterThanOrEqual(2);
  report.checks.configFailureRetry = true;
  report.checks.delayedConfigDoesNotSpendFreePrompt = true;
  await configContext.close();

  const sessionContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await sessionContext.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: preferenceKey, value: preference },
  );
  const sessionRoutes = await installCommonRoutes(sessionContext, {
    transientSession: true,
  });
  const sessionPage = await sessionContext.newPage();
  activePage = sessionPage;
  watchPage(sessionPage, "session-transient");
  await sessionPage.goto(base);
  const sessionNotice = sessionPage.locator(
    '[data-testid="chatgpt-startup-restore"]',
  );
  await expect(sessionNotice).toContainText("temporarily unavailable", {
    timeout: 15000,
  });
  sessionRoutes.recover();
  await sessionNotice.getByRole("button", { name: "Retry" }).click();
  await expect(sessionPage.locator(".quality-selector-trigger")).toContainText(
    "ChatGPT · Budget",
    { timeout: 15000 },
  );
  expect(sessionRoutes.sessionCalls()).toBeGreaterThanOrEqual(2);
  report.checks.sessionFailureRetry = true;
  await sessionContext.close();

  const malformedContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await malformedContext.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: preferenceKey, value: preference },
  );
  const malformedRoutes = await installCommonRoutes(malformedContext, {
    malformedSession: true,
  });
  const malformedPage = await malformedContext.newPage();
  activePage = malformedPage;
  watchPage(malformedPage, "malformed-session");
  await malformedPage.goto(base);
  const malformedNotice = malformedPage.locator(
    '[data-testid="chatgpt-startup-restore"]',
  );
  await expect(malformedNotice).toContainText("temporarily unavailable", {
    timeout: 15000,
  });
  malformedRoutes.recover();
  await malformedNotice.getByRole("button", { name: "Retry" }).click();
  await expect(
    malformedPage.locator(".quality-selector-trigger"),
  ).toContainText("ChatGPT · Budget", { timeout: 15000 });
  expect(malformedRoutes.sessionCalls()).toBeGreaterThanOrEqual(2);
  report.checks.malformedSessionRetry = true;
  await malformedContext.close();

  const manualContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await manualContext.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: preferenceKey, value: preference },
  );
  const manualRoutes = await installCommonRoutes(manualContext, {
    delaySession: true,
  });
  const manualPage = await manualContext.newPage();
  activePage = manualPage;
  watchPage(manualPage, "manual-switch");
  await manualPage.goto(base);
  await expect(
    manualPage.locator('[data-testid="chatgpt-startup-restore"]'),
  ).toContainText("Restoring", { timeout: 15000 });
  await manualPage.getByRole("button", { name: "Connections" }).click();
  await manualPage
    .getByRole("combobox", { name: "Provider" })
    .selectOption("gateway");
  manualRoutes.releaseSession();
  await expect(
    manualPage.locator('[data-testid="chatgpt-startup-restore"]'),
  ).toHaveCount(0);
  expect(
    await manualPage.evaluate(
      (key) => localStorage.getItem(key),
      preferenceKey,
    ),
  ).toBeNull();
  report.checks.manualProviderSwitchCancelsRestore = true;
  await manualContext.close();

  const missingContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await missingContext.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: preferenceKey, value: preference },
  );
  await installCommonRoutes(missingContext, { missingSession: true });
  const missingPage = await missingContext.newPage();
  activePage = missingPage;
  watchPage(missingPage, "missing-session");
  await missingPage.goto(base);
  const reconnectNotice = missingPage.locator(
    '[data-testid="chatgpt-startup-restore"]',
  );
  await expect(reconnectNotice).toContainText("connected again", {
    timeout: 15000,
  });
  expect(await missingPage.locator("dialog[open]").count()).toBe(0);
  report.checks.missingSessionReconnect = true;
  await missingContext.close();

  report.passed = true;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  if (activePage) {
    try {
      report.ui = await activePage.evaluate(() => ({
        restoreNotice:
          document.querySelector('[data-testid="chatgpt-startup-restore"]')
            ?.textContent ?? null,
        restoreNoticeRole:
          document
            .querySelector('[data-testid="chatgpt-startup-restore"]')
            ?.getAttribute("role") ?? null,
        dialogs: document.querySelectorAll("dialog[open]").length,
        provider:
          document
            .querySelector(".quality-selector-trigger")
            ?.textContent?.trim() ?? null,
      }));
    } catch {
      report.ui = { error: "Could not inspect failed page." };
    }
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  throw error;
} finally {
  await browser.close();
}
