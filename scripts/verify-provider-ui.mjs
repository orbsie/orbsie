import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// Browser UI acceptance with synthetic API fixtures only. Never calls a provider.
const base = process.env.TEST_URL || "http://localhost:3013";
const output = process.env.UI_EVIDENCE_DIR || ".vercel/provider-ui";
await mkdir(output, { recursive: true });
const models = [
  {
    id: "openai/gpt-6-astra",
    name: "Astra fixture",
    qualityRank: 1,
    inputPrice: 5,
    cachedInputPrice: 0.5,
    outputPrice: 30,
  },
  {
    id: "openai/gpt-5.6-sol",
    name: "Sol fixture",
    qualityRank: 2,
    inputPrice: 1.2,
    cachedInputPrice: null,
    outputPrice: 6,
  },
  {
    id: "openai/gpt-5.6-luna",
    name: "Luna fixture",
    qualityRank: 3,
    inputPrice: 0.3,
    cachedInputPrice: 0,
    outputPrice: 0.9,
  },
  {
    id: "z-ai/glm-5.3-flash",
    name: "GLM fixture",
    qualityRank: 4,
    inputPrice: 0.1,
    cachedInputPrice: 0.05,
    outputPrice: 0.4,
  },
  {
    id: "test/unknown",
    name: "Other model with a longer name",
    qualityRank: null,
    inputPrice: null,
    cachedInputPrice: null,
    outputPrice: null,
  },
];
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
let generations = 0;
const checks = {};
const requests = [],
  errors = [];
await context.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  requests.push(path);
  if (path === "/api/config")
    return route.fulfill({
      json: { accounts: false, publishing: true, google: false },
    });
  if (path === "/api/trial")
    return route.fulfill({ json: { enabled: false, remaining: 0 } });
  if (path === "/api/models") return route.fulfill({ json: { models } });
  if (path === "/api/generate") {
    generations++;
    const request = route.request().postDataJSON();
    expect(request.key).toBe("synthetic-provider-key-not-real");
    expect(request.model).toBe(models[0].id);
    return route.fulfill({
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({
          type: "commit_revision",
          message: "Synthetic browser fixture completed.",
        }) + "\n",
    });
  }
  throw Error(`Unexpected API request: ${path}`);
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
const modeButtons = page
  .getByRole("group", { name: "Creation quality" })
  .getByRole("button");
try {
  await page.goto(base);
  await page
    .locator("#prompt")
    .fill("A world created without an Orbsie account");
  await expect(
    page.getByRole("button", { name: "Connect provider" }),
  ).toBeVisible();
  await page.screenshot({ path: `${output}/landing-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/landing-mobile-unconnected.png` });
  expect(
    await page
      .locator(".composer-bottom")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Connect provider" }).click();
  await expect(page.getByLabel("API key", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Connect your AI account or API key to create and edit your world.",
      {
        exact: false,
      },
    ),
  ).toBeVisible();
  await expect(modeButtons).toHaveText(["Quality", "Balanced", "Budget"]);
  await expect(
    page.getByRole("button", { name: "Continue with this connection" }),
  ).toBeDisabled();
  await expect(page.locator(".model-catalog")).not.toBeVisible();
  await page.getByText("Advanced", { exact: true }).click();
  await expect(page.locator(".model-catalog-row")).toHaveCount(5);
  expect(
    await page
      .locator(".model-catalog-row")
      .evaluateAll((rows) => rows.map((row) => row.dataset.modelId)),
  ).toEqual(models.map((model) => model.id));
  const sol = page.locator(`[data-model-id="${models[1].id}"]`);
  await expect(sol.locator(".model-token-price strong")).toHaveText([
    "$1.2",
    "—",
    "$6",
  ]);
  const luna = page.locator(`[data-model-id="${models[2].id}"]`);
  await expect(luna.locator(".model-token-price strong")).toHaveText([
    "$0.3",
    "$0",
    "$0.9",
  ]);
  await page.getByLabel("Find a model", { exact: true }).fill("other");
  await expect(page.locator(".model-catalog-row")).toHaveCount(1);
  await expect(page.locator(".model-catalog-row")).toContainText("Unranked");
  await page.locator(".model-catalog-row").click();
  await expect(page.locator(".model-catalog-row")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByLabel("Find a model", { exact: true }).fill("does-not-exist");
  await expect(page.getByText("No models match your search.")).toBeVisible();
  await page.getByLabel("Find a model", { exact: true }).fill("");
  await page.getByRole("button", { name: "Quality", exact: true }).click();
  await expect(
    page.locator(`[data-model-id="${models[0].id}"]`),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByLabel("API key", { exact: true })
    .fill("synthetic-provider-key-not-real");
  await page.getByLabel("Provider", { exact: true }).selectOption("gateway");
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Continue with this connection" }),
  ).toBeDisabled();
  await page.getByLabel("Provider", { exact: true }).selectOption("openrouter");
  await expect(
    page.getByRole("button", { name: "Quality", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Quality", exact: true }).click();
  await page
    .getByLabel("API key", { exact: true })
    .fill("synthetic-provider-key-not-real");
  await page.screenshot({ path: `${output}/advanced-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".advanced-models").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/advanced-mobile.png` });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  expect(
    await page
      .locator(".model-catalog")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Continue with this connection" })
    .click();
  await expect(page.locator("#prompt")).toHaveValue(
    "A world created without an Orbsie account",
  );
  checks.draftPreserved = true;
  const qualityTrigger = page.locator(".quality-selector-trigger");
  await expect(qualityTrigger).toContainText("OpenRouter");
  expect(await page.locator("dialog[open]").count()).toBe(0);
  checks.noDialogForDirectChoice = true;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await qualityTrigger.click();
  const qualityMenu = page.getByRole("menu", { name: "Creation quality" });
  await expect(qualityMenu).toBeVisible();
  expect(await qualityMenu.getByRole("menuitemradio").count()).toBe(3);
  await expect(qualityMenu.getByRole("menuitemradio")).toHaveText([
    "QualityMore room for complex worlds",
    "BalancedA capable everyday choice",
    "BudgetFaster, lower-cost creation",
  ]);
  const desktopMenuBounds = await qualityMenu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      withinViewport:
        box.left >= 0 &&
        box.right <= innerWidth &&
        box.top >= 0 &&
        box.bottom <= innerHeight,
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  expect(desktopMenuBounds.withinViewport).toBe(true);
  checks.desktopDirectDropdown = true;
  checks.desktopMenuBounds = desktopMenuBounds;
  await page.screenshot({ path: `${output}/quality-open-desktop.png` });
  await qualityMenu.getByRole("menuitemradio", { name: /Balanced/ }).click();
  await expect(qualityTrigger).toContainText("Balanced");
  await qualityTrigger.click();
  await page.keyboard.press("Escape");
  await expect(qualityMenu).not.toBeVisible();
  await expect(qualityTrigger).toBeFocused();
  checks.escapeReturnsFocus = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await qualityTrigger.click();
  await expect(qualityMenu).toBeVisible();
  const phoneMenuBounds = await qualityMenu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      withinViewport: box.left >= 0 && box.right <= innerWidth,
      viewport: { width: innerWidth, height: innerHeight },
      noDocumentOverflow: document.documentElement.scrollWidth <= innerWidth,
    };
  });
  expect(phoneMenuBounds.withinViewport).toBe(true);
  expect(phoneMenuBounds.noDocumentOverflow).toBe(true);
  checks.phoneDirectDropdown = true;
  checks.phoneMenuBounds = phoneMenuBounds;
  await page.screenshot({ path: `${output}/quality-open-phone.png` });
  await qualityMenu.getByRole("menuitemradio", { name: /Budget/ }).click();
  await expect(qualityTrigger).toContainText("Budget");
  await qualityTrigger.click();
  await qualityMenu.getByRole("menuitemradio", { name: /Quality/ }).click();
  await expect(qualityTrigger).toContainText("Quality");
  checks.choiceUpdatesTrigger = true;
  await page.screenshot({ path: `${output}/landing-mobile.png` });
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.locator(".saved")).toHaveText("Saved on this device", {
    timeout: 15000,
  });
  const activityRows = page.locator(
    ".chat-messages > .authoring-activity-message",
  );
  await expect(activityRows.last()).toContainText("Generation complete");
  expect(await page.locator(".chat-messages .authoring-activity").count()).toBe(
    0,
  );
  expect(await page.locator('.chat-messages [role="status"]').count()).toBe(1);
  checks.flatProductionActivity = await page
    .locator(".chat-messages")
    .evaluate((element) => {
      const rows = Array.from(element.children);
      const finalActivity = rows.findLastIndex((row) =>
        row.classList.contains("authoring-activity-message"),
      );
      const finalReply = rows.findLastIndex(
        (row) =>
          row.classList.contains("assistant") &&
          !row.classList.contains("authoring-activity-message"),
      );
      return {
        activityCount: element.querySelectorAll(
          ":scope > .authoring-activity-message",
        ).length,
        finalReplyAfterActivity: finalReply > finalActivity,
      };
    });
  expect(checks.flatProductionActivity.finalReplyAfterActivity).toBe(true);
  // This fixture commits immediately: intermediate applied events must be
  // coalesced away, leaving the initial wait and immediate terminal result.
  expect(checks.flatProductionActivity.activityCount).toBe(2);
  checks.immediateBurstCoalesced = true;
  await page.screenshot({ path: `${output}/flat-chat-phone.png` });
  expect(generations).toBe(1);
  expect(requests.some((path) => path.startsWith("/api/auth"))).toBe(false);
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in to publish" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  const report = {
    passed: true,
    appSourceCommit: process.env.ORBSIE_APP_SOURCE_COMMIT ?? "unverified",
    fixtureGenerations: generations,
    providerNetworkCalls: 0,
    authenticatedRequests: 0,
    errors,
    models: models.map(({ id }) => id),
    checks,
  };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
