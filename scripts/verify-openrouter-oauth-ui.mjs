import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const cancelled = process.env.ORBSIE_OAUTH_CANCEL === "1";
const draftPrompt = "Build a garden with a blue pond 🌷";
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const context = await browser.newContext();
  let exchanges = 0;
  const fakeKey = "sk-or-v1-" + "a".repeat(64);
  await context.route("https://fonts.googleapis.com/**", (r) =>
    r.fulfill({ contentType: "text/css", body: "" }),
  );
  await context.route("https://openrouter.ai/auth?**", async (r) => {
    const auth = new URL(r.request().url());
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
    assert.equal(auth.searchParams.get("code_challenge").length, 43);
    const callback = new URL(auth.searchParams.get("callback_url"));
    callback.searchParams.set(
      cancelled ? "error" : "code",
      cancelled ? "access_denied" : "test-authorization-code",
    );
    await r.fulfill({
      status: 302,
      headers: { location: callback.href },
      body: "",
    });
  });
  await context.route("https://openrouter.ai/api/v1/auth/keys", async (r) => {
    exchanges++;
    const data = r.request().postDataJSON();
    assert.equal(data.code, "test-authorization-code");
    assert.equal(data.code_verifier.length, 43);
    await r.fulfill({ json: { key: fakeKey } });
  });
  const page = await context.newPage();
  await page.goto(process.env.TEST_URL ?? "http://localhost:3047");
  await page.getByPlaceholder("What experience to build?").fill(draftPrompt);
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page
    .getByRole("button", { name: "Connect with OpenRouter", exact: true })
    .click();
  await expect(
    page.getByText(
      cancelled
        ? "OpenRouter sign-in expired or could not be completed. Try connecting again."
        : "OpenRouter connected. Choose a model to continue.",
    ),
  ).toBeVisible({ timeout: 30000 });
  assert.equal(exchanges, cancelled ? 0 : 1);
  await expect(page.locator("#prompt")).toHaveValue(draftPrompt);
  assert.equal(
    await page.evaluate(() =>
      sessionStorage.getItem("orbsie-openrouter-draft"),
    ),
    null,
  );
  assert.equal(new URL(page.url()).search, "");
  assert.equal(
    await page.evaluate(() =>
      sessionStorage.getItem("orbsie-openrouter-oauth"),
    ),
    null,
  );
  assert.equal(
    await page.evaluate(
      (key) =>
        JSON.stringify({ ...localStorage, ...sessionStorage }).includes(key),
      fakeKey,
    ),
    false,
  );
  console.log(
    `OAuth ${cancelled ? "cancellation" : "success"} UI passed; ${exchanges} exchanges, prompt restored, URL cleaned, no persisted key.`,
  );
} finally {
  await browser.close();
}
