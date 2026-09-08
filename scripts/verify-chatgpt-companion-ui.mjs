/** Browser-to-real-loopback-transport test with an injected model, no inference. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const base = process.env.TEST_URL ?? "http://127.0.0.1:3017";
const temp = await mkdtemp(join(tmpdir(), "orbsie-companion-ui-"));
let browser, companion;
try {
  const outfile = join(temp, "server.mjs");
  await build({
    entryPoints: ["scripts/chatgpt-companion.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
  });
  const { startChatGPTCompanion } = await import(pathToFileURL(outfile).href);
  let turns = 0;
  companion = await startChatGPTCompanion({
    origin: new URL(base).origin,
    model: "gpt-6-astra",
    client: {
      close() {},
      async generate(_instructions, input, onText) {
        turns++;
        expect(JSON.stringify(input)).not.toContain(companion.token);
        onText(
          JSON.stringify({
            type: "commit_revision",
            message: "Companion transport completed.",
          }) + "\n",
        );
      },
    },
  });
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage();
  let hostedGenerations = 0;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config")
      return route.fulfill({ json: { accounts: false } });
    if (path === "/api/trial")
      return route.fulfill({ json: { enabled: false, remaining: 0 } });
    if (path === "/api/models") return route.fulfill({ json: { models: [] } });
    if (path === "/api/generate") hostedGenerations++;
    return route.abort();
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    `${base}/#chatgpt=${encodeURIComponent(JSON.stringify({ url: companion.url, token: companion.token }))}`,
  );
  await expect(
    page.getByRole("button", { name: "ChatGPT on this computer" }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(
    page.getByText("ChatGPT · gpt-6-astra", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("API key", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Continue with this connection" })
    .click();
  await page.locator("#prompt").fill("Use the connected local account");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByText("Companion transport completed.", { exact: true }),
  ).toBeVisible();
  expect(turns).toBe(1);
  expect(hostedGenerations).toBe(0);
  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  expect(JSON.stringify(storage)).not.toContain(companion.token);
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByRole("button", { name: "Disconnect and clear key" }).click();
  await expect(page.getByLabel("API key", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ChatGPT on this computer" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  // A late handshake must not override a key entered by the user.
  {
    const context = await browser.newContext();
    const newer = await context.newPage();
    let releaseHealth;
    const healthGate = new Promise((resolve) => {
      releaseHealth = resolve;
    });
    await newer.route(`${companion.url}/health`, async (route) => {
      await healthGate;
      await route.fulfill({ response: await route.fetch() });
    });
    await newer.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/config")
        return route.fulfill({ json: { accounts: false } });
      if (path === "/api/trial")
        return route.fulfill({ json: { enabled: false, remaining: 0 } });
      if (path === "/api/models")
        return route.fulfill({ json: { models: [] } });
      return route.abort();
    });
    await newer.goto(
      `${base}/#chatgpt=${encodeURIComponent(JSON.stringify({ url: companion.url, token: companion.token }))}`,
    );
    await newer
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await newer
      .getByLabel("API key", { exact: true })
      .fill("manual-key-not-real");
    const settled = newer.waitForResponse(`${companion.url}/health`);
    releaseHealth();
    await settled;
    await newer.waitForTimeout(150);
    await expect(newer.getByLabel("API key", { exact: true })).toHaveValue(
      "manual-key-not-real",
    );
    await expect(
      newer.getByRole("button", { name: "ChatGPT on this computer" }),
    ).toHaveCount(0);
    await context.close();
  }
  // Connecting ChatGPT during free-allowance preflight must not consume free quota.
  {
    const context = await browser.newContext();
    const newer = await context.newPage();
    let releaseHealth,
      releaseAllowance,
      checks = 0,
      freeRequests = 0;
    const healthGate = new Promise((resolve) => {
      releaseHealth = resolve;
    });
    const allowanceGate = new Promise((resolve) => {
      releaseAllowance = resolve;
    });
    await newer.route(`${companion.url}/health`, async (route) => {
      await healthGate;
      await route.fulfill({ response: await route.fetch() });
    });
    await newer.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/config")
        return route.fulfill({ json: { accounts: false } });
      if (path === "/api/trial") {
        if (++checks > 1) await allowanceGate;
        return route.fulfill({ json: { enabled: true, remaining: 3 } });
      }
      if (path === "/api/generate") freeRequests++;
      return route.abort();
    });
    await newer.goto(
      `${base}/#chatgpt=${encodeURIComponent(JSON.stringify({ url: companion.url, token: companion.token }))}`,
    );
    await expect(
      newer.getByRole("button", { name: "3 free prompts" }),
    ).toBeVisible();
    await newer.locator("#prompt").fill("Preserve my request for ChatGPT");
    await newer.locator("#prompt").press("Enter");
    await expect.poll(() => checks).toBe(2);
    releaseHealth();
    await expect(
      newer.getByRole("button", { name: "ChatGPT on this computer" }),
    ).toBeVisible();
    releaseAllowance();
    await newer.waitForTimeout(150);
    expect(freeRequests).toBe(0);
    expect(turns).toBe(1);
    await expect(newer.locator("#prompt")).toHaveValue(
      "Preserve my request for ChatGPT",
    );
    await context.close();
  }
  await mkdir("docs/evidence/chatgpt-companion", { recursive: true });
  const report = {
    mode: "browser-with-mock-model-real-loopback-transport",
    passed: true,
    turns,
    hostedGenerations,
    realModelCalls: 0,
    hashRemoved: true,
    capabilityNotPersisted: true,
    disconnectVerified: true,
    delayedHandshakeAndAllowanceGuards: true,
  };
  await writeFile(
    "docs/evidence/chatgpt-companion/browser.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await companion?.close();
  await rm(temp, { recursive: true, force: true });
}
