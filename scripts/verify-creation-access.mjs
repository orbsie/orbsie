import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.TEST_URL ?? "http://127.0.0.1:3017";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const checks = [];
try {
  for (const scenario of ["free", "unavailable", "quota-race"]) {
    const context = await browser.newContext();
    let remaining = scenario === "unavailable" ? 0 : 1;
    const generations = [];
    await context.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/config")
        return route.fulfill({
          json: { accounts: true, publishing: false, google: false },
        });
      if (path === "/api/auth/get-session")
        return route.fulfill({ json: null });
      if (path === "/api/trial")
        return route.fulfill({ json: { enabled: true, remaining, limit: 3 } });
      if (path === "/api/generate") {
        const body = route.request().postDataJSON();
        generations.push(body);
        expect(body.provider).toBe("free");
        expect(body.key).toBe("");
        remaining = 0;
        if (scenario === "quota-race")
          return route.fulfill({
            status: 429,
            json: {
              error: "Your free prompts are used.",
              code: "FREE_LIMIT_REACHED",
            },
          });
        return route.fulfill({
          contentType: "application/x-ndjson",
          body:
            JSON.stringify({
              type: "commit_revision",
              message: "Free request completed.",
            }) + "\n",
        });
      }
      throw Error(`Unexpected API path ${path}`);
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await expect(page.getByText(/interactive demo|scripted demo/i)).toHaveCount(
      0,
    );
    const prompt = `Original request for ${scenario}`;
    await page.locator("#prompt").fill(prompt);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    if (scenario === "free") {
      await expect(
        page.getByText("Free request completed.", { exact: true }),
      ).toBeVisible();
      expect(generations).toHaveLength(1);
      await page.locator("#prompt").fill("Keep this follow-up while I sign in");
      await page
        .getByRole("button", { name: "Change this", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
      await expect(page.locator("#prompt")).toHaveValue(
        "Keep this follow-up while I sign in",
      );
      expect(generations).toHaveLength(1);
    } else {
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
      await expect(page.locator("#prompt")).toHaveValue(prompt);
      expect(generations).toHaveLength(scenario === "quota-race" ? 1 : 0);
    }
    expect(errors).toEqual([]);
    checks.push({
      scenario,
      generationRequests: generations.length,
      passed: true,
    });
    await context.close();
  }
  // Hold the allowance response while the user submits twice, then revises the prompt.
  {
    const context = await browser.newContext();
    let trialRequests = 0,
      generationRequests = 0,
      release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    await context.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/config")
        return route.fulfill({ json: { accounts: false } });
      if (path === "/api/trial") {
        if (++trialRequests > 1) await pending;
        return route.fulfill({ json: { enabled: true, remaining: 3 } });
      }
      if (path === "/api/generate") {
        generationRequests++;
        return route.fulfill({
          status: 500,
          json: { error: "Unexpected generation" },
        });
      }
      throw Error(`Unexpected API path ${path}`);
    });
    const page = await context.newPage();
    await page.goto(base);
    await expect(
      page.getByRole("button", { name: "3 free prompts" }),
    ).toBeVisible();
    await page.locator("#prompt").fill("Original pending prompt");
    await page.locator("#prompt").press("Enter");
    await expect.poll(() => trialRequests).toBe(2);
    await page.locator("#prompt").press("Enter");
    await page.locator("#prompt").fill("Newer text must survive");
    release();
    await page.waitForTimeout(300);
    expect(trialRequests).toBe(2);
    expect(generationRequests).toBe(0);
    await expect(page.locator("#prompt")).toHaveValue(
      "Newer text must survive",
    );
    checks.push({ scenario: "pending-allowance-intent", passed: true });
    await context.close();
  }
  await mkdir("docs/evidence/creation-access", { recursive: true });
  await writeFile(
    "docs/evidence/creation-access/report.json",
    JSON.stringify({ checks, realProviderCalls: 0 }, null, 2),
  );
  console.log(JSON.stringify({ checks, realProviderCalls: 0 }));
} finally {
  await browser.close();
}
