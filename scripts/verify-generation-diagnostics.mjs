import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// Synthetic browser acceptance. Never forward an API request to a provider.
const base = process.env.TEST_URL || "http://localhost:3013";
const output =
  process.env.DIAGNOSTICS_EVIDENCE_DIR || ".vercel/diagnostics-browser";
const requestId = "14c2fb72-1e28-4587-982a-cb50650f6855";
const promptSentinel = "PRIVATE_PROMPT_SENTINEL blue strawberry tree";
const outputSentinel = "PRIVATE_OUTPUT_SENTINEL";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const report = { passed: false, providerCalls: 0, checks: [] };
let activePage;
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      acceptDownloads: true,
    });
    let generationCalls = 0;
    let clientRunId;
    await context.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/config")
        return route.fulfill({
          json: {
            accounts: false,
            publishing: false,
            google: false,
            chatgptHosted: false,
            chatgptGeneration: false,
          },
        });
      if (path === "/api/trial")
        return route.fulfill({ json: { enabled: true, remaining: 2 } });
      if (path === "/api/auth/get-session")
        return route.fulfill({ json: null });
      if (path === "/api/models")
        return route.fulfill({ json: { models: [] } });
      if (path === "/api/generate") {
        generationCalls++;
        clientRunId = route.request().headers()["x-orbsie-client-run-id"];
        return route.fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          headers: { "X-Orbsie-Request-Id": requestId },
          body:
            JSON.stringify({ type: "set_environment", sky: "#765432" }) +
            "\n" +
            (viewport.width < 500 ? outputSentinel + "\n" : ""),
        });
      }
      return route.fulfill({
        status: 404,
        json: { error: "Synthetic endpoint unavailable" },
      });
    });
    const page = await context.newPage();
    activePage = page;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.locator("#prompt").fill(promptSentinel);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const downloadButton = page
      .locator(".toast-actions")
      .getByRole("button", { name: "Download diagnostics", exact: true });
    await expect(downloadButton).toBeVisible({ timeout: 20000 });
    expect(generationCalls).toBe(1);
    expect(clientRunId).toMatch(/^[a-f0-9-]{36}$/);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      downloadButton.click(),
    ]);
    const contents = await readFile(await download.path(), "utf8");
    const document = JSON.parse(contents);
    const run = document.entries.find(
      (entry) => entry.kind === "generation" && entry.runId === clientRunId,
    );
    expect(run).toBeTruthy();
    if (process.env.DIAGNOSTICS_EXPECTED_BUILD_ID) {
      expect(document.buildId).toBe(process.env.DIAGNOSTICS_EXPECTED_BUILD_ID);
      expect(run.buildId).toBe(process.env.DIAGNOSTICS_EXPECTED_BUILD_ID);
    }
    expect(run.terminal.reason).toBe(
      viewport.width < 500 ? "parser-failure" : "clean-eof-without-commit",
    );
    expect(run.commandCount).toBe(1);
    expect(Buffer.byteLength(contents)).toBeLessThanOrEqual(64 * 1024);
    expect(contents).toContain(requestId);
    expect(contents).toContain(clientRunId);
    expect(contents).not.toContain(promptSentinel);
    expect(contents).not.toContain(outputSentinel);
    await page.screenshot({ path: `${output}/recovery-${viewport.width}.png` });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.reload();
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    const settings = page.locator("dialog[open]");
    await expect(
      settings.getByRole("button", {
        name: "Download diagnostics",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await settings.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `${output}/settings-${viewport.width}.png` });
    const [afterReload] = await Promise.all([
      page.waitForEvent("download"),
      settings
        .getByRole("button", { name: "Download diagnostics", exact: true })
        .click(),
    ]);
    const retained = await readFile(await afterReload.path(), "utf8");
    expect(retained).toContain(clientRunId);
    await settings
      .getByRole("button", {
        name: "Reset saved data on this device",
        exact: true,
      })
      .click();
    await Promise.all([
      page.waitForEvent("load"),
      settings
        .getByRole("button", {
          name: "Really delete? Tap again to erase local drafts",
          exact: true,
        })
        .click(),
    ]);
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    const [afterReset] = await Promise.all([
      page.waitForEvent("download"),
      page
        .locator("dialog[open]")
        .getByRole("button", { name: "Download diagnostics", exact: true })
        .click(),
    ]);
    expect(await readFile(await afterReset.path(), "utf8")).not.toContain(
      clientRunId,
    );
    expect(errors).toEqual([]);
    report.checks.push({
      width: viewport.width,
      syntheticGenerationCalls: generationCalls,
      requestCorrelation: true,
      terminalReason: run.terminal.reason,
      privateContentAbsent: true,
      downloadBytes: Buffer.byteLength(contents),
      noHorizontalOverflow: true,
      retainedAfterReload: true,
      clearedByReset: true,
      pageErrors: 0,
    });
    await context.close();
  }
  report.passed = true;
} catch (error) {
  report.failure = {
    message: String(error.message).slice(0, 1000),
    text: activePage
      ? (
          await activePage
            .locator("body")
            .innerText()
            .catch(() => "")
        ).slice(-2500)
      : "",
  };
  await activePage
    ?.screenshot({ path: `${output}/failure.png` })
    .catch(() => undefined);
  throw error;
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
