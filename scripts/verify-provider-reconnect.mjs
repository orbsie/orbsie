import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  for (const provider of ["openrouter", "gateway"])
    for (const status of [401, 403]) {
      const context = await browser.newContext();
      let calls = 0;
      await context.route("https://fonts.googleapis.com/**", (r) =>
        r.fulfill({ contentType: "text/css", body: "" }),
      );
      await context.route("**/api/**", (r) => {
        const path = new URL(r.request().url()).pathname;
        if (path === "/api/config")
          return r.fulfill({ json: { accounts: false, publishing: false } });
        if (path === "/api/trial")
          return r.fulfill({ json: { enabled: false, remaining: 0 } });
        if (path === "/api/models")
          return r.fulfill({
            json: {
              models: [
                {
                  id: "openai/gpt-5.6-luna",
                  name: "Luna fixture",
                  qualityRank: 1,
                },
              ],
            },
          });
        if (path === "/api/generate") {
          calls++;
          assert.equal(r.request().postDataJSON().provider, provider);
          return r.fulfill({
            status,
            json: {
              error: "Provider rejected this request.",
              code:
                status === 401
                  ? "PROVIDER_AUTH_REJECTED"
                  : "PROVIDER_ACCESS_DENIED",
            },
          });
        }
        return r.abort();
      });
      const page = await context.newPage();
      await page.goto(process.env.TEST_URL ?? "http://localhost:3047");
      await page
        .getByRole("button", { name: "Connections", exact: true })
        .click();
      await page.getByLabel("Provider", { exact: true }).selectOption(provider);
      await page
        .getByLabel("API key", { exact: true })
        .fill("synthetic-provider-key");
      await page.locator("summary").filter({ hasText: "Advanced" }).click();
      await page.locator('[data-model-id="openai/gpt-5.6-luna"]').click();
      await page
        .getByRole("button", { name: "Continue with this connection" })
        .click();
      const prompt = "Build a blue garden";
      await page.locator("#prompt").fill(prompt);
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "A little creative power" }),
      ).toBeVisible();
      await expect(page.locator("#prompt")).toHaveValue(prompt);
      await expect(page.getByLabel("API key", { exact: true })).toHaveValue(
        status === 401 ? "" : "synthetic-provider-key",
      );
      if (status === 401)
        await expect(
          page.getByRole("button", { name: "Continue with this connection" }),
        ).toBeDisabled();
      await expect(page.getByText("AI connected", { exact: true })).toHaveCount(
        0,
      );
      assert.equal(calls, 1);
      await context.close();
      console.log(
        JSON.stringify({
          provider,
          status,
          promptRestored: true,
          reconnectOffered: true,
          liveCalls: 0,
        }),
      );
    }
} finally {
  await browser.close();
}
