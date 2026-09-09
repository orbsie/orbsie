/** Focused browser fixture for OpenRouter OAuth storage and lifecycle races. */
import { chromium, expect } from "@playwright/test";

const base = process.env.TEST_URL ?? "http://localhost:3047";
const fakeKey = "sk-or-v1-" + "a".repeat(64);

function installRoutes(context, { holdExchange = false } = {}) {
  let releaseExchange;
  const exchangeGate = new Promise((resolve) => {
    releaseExchange = resolve;
  });
  const stats = {
    exchangeStarted: 0,
    exchangeAborted: 0,
    holdExchange,
  };
  context.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ contentType: "text/css", body: "" }),
  );
  context.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config")
      return route.fulfill({
        json: { accounts: false, publishing: false, google: false },
      });
    if (path === "/api/trial")
      return route.fulfill({ json: { enabled: false, remaining: 0 } });
    if (path === "/api/models")
      return route.fulfill({
        json: {
          models: [
            {
              id: "openai/gpt-6-astra",
              name: "Astra fixture",
              qualityRank: 1,
              inputPrice: 1,
              cachedInputPrice: 0,
              outputPrice: 1,
            },
          ],
        },
      });
    return route.abort();
  });
  context.route("https://openrouter.ai/auth?**", async (route) => {
    const auth = new URL(route.request().url());
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    const callback = new URL(auth.searchParams.get("callback_url"));
    callback.searchParams.set("code", "fixture-authorization-code");
    await route.fulfill({
      status: 302,
      headers: { location: callback.href },
      body: "",
    });
  });
  context.route("https://openrouter.ai/api/v1/auth/keys", async (route) => {
    stats.exchangeStarted++;
    try {
      if (stats.holdExchange) await exchangeGate;
      await route.fulfill({ json: { key: fakeKey } });
    } catch {
      stats.exchangeAborted++;
    }
  });
  return { stats, releaseExchange };
}

async function openConnection(page) {
  await page.goto(base);
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page
    .getByRole("button", { name: "Connect with OpenRouter", exact: true })
    .click();
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const blockedContext = await browser.newContext();
  installRoutes(blockedContext);
  await blockedContext.addInitScript(() => {
    const original = Storage.prototype.getItem;
    Object.defineProperty(Storage.prototype, "getItem", {
      configurable: true,
      value(key) {
        if (key === "orbsie-openrouter-oauth")
          throw new DOMException("blocked", "SecurityError");
        return original.call(this, key);
      },
    });
  });
  const blockedPage = await blockedContext.newPage();
  const blockedErrors = [];
  blockedPage.on("pageerror", (error) => blockedErrors.push(error.message));
  await blockedPage.goto(
    `${base}/?orbsie_oauth=openrouter&state=fixture&code=fixture`,
  );
  await expect(
    blockedPage.getByText(
      "OpenRouter sign-in needs browser storage. Enable site storage and try again.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(new URL(blockedPage.url()).search).toBe("");
  expect(blockedErrors).toEqual([]);
  await blockedContext.close();

  const context = await browser.newContext();
  const normal = installRoutes(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openConnection(page);
  await expect(
    page.getByText("OpenRouter connected. Choose a model to continue.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(normal.stats.exchangeStarted).toBe(1);
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("orbsie-openrouter-oauth"),
    ),
  ).toBeNull();
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await expect(
    page.getByText("OpenRouter sign-in was interrupted. Try again.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await context.close();

  const abortContext = await browser.newContext();
  const pending = installRoutes(abortContext, { holdExchange: true });
  const pendingPage = await abortContext.newPage();
  let browserAbort = false;
  await pendingPage.exposeFunction("__orbsieOAuthAbort", () => {
    browserAbort = true;
  });
  await pendingPage.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "https://openrouter.ai/api/v1/auth/keys" && init?.signal)
        init.signal.addEventListener("abort", () => {
          void window.__orbsieOAuthAbort();
        });
      return nativeFetch(input, init);
    };
  });
  let requestFailed = false;
  pendingPage.on("requestfailed", (request) => {
    if (request.url() === "https://openrouter.ai/api/v1/auth/keys")
      requestFailed = true;
  });
  await openConnection(pendingPage);
  await expect.poll(() => pending.stats.exchangeStarted).toBe(1);
  await pendingPage.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await expect(
    pendingPage.getByText("OpenRouter sign-in was interrupted. Try again.", {
      exact: true,
    }),
  ).toBeVisible();
  // Keep the page alive while navigation fires pagehide so the harness can
  // observe the browser-side abort before starting a fresh transaction.
  await pendingPage.goto("about:blank");
  pending.releaseExchange();
  await expect
    .poll(
      () => browserAbort || pending.stats.exchangeAborted > 0 || requestFailed,
    )
    .toBe(true);

  pending.stats.holdExchange = false;
  await openConnection(pendingPage);
  await expect(
    pendingPage.getByText("OpenRouter connected. Choose a model to continue.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(pending.stats.exchangeStarted).toBe(2);
  await abortContext.close();
  console.log(
    JSON.stringify({
      blockedStorage: "scrubbed-and-recoverable",
      strictModeExchangeCount: normal.stats.exchangeStarted,
      pendingNavigation: "aborted",
      recoveryAfterAbort: "connected",
    }),
  );
} finally {
  await browser.close();
}
