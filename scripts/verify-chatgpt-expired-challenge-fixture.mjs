// Synthetic browser fixture for expired ChatGPT challenge recovery UI only.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.TEST_URL || "http://127.0.0.1:3000";
const origin = new URL(base).origin;
const output =
  process.env.UI_EVIDENCE_DIR ||
  "docs/evidence/chatgpt-expired-challenge-recovery-20260922";
await mkdir(output, { recursive: true });

const checks = {};
const unexpected = [];
const apiRequests = [];
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
let challengeIssued = false;
let startCount = 0;
const challenge = {
  loginId: "synthetic-login-id",
  userCode: "ABCD-EFGH",
  verificationUrl: "https://auth.openai.com/codex/device",
  expiresAt: Date.now() + 60_000,
};
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) {
    unexpected.push(url.origin);
    return route.abort();
  }
  if (!url.pathname.startsWith("/api/")) return route.continue();
  apiRequests.push({ path: url.pathname, method: route.request().method() });
  if (url.pathname === "/api/config")
    return route.fulfill({
      json: {
        accounts: true,
        publishing: false,
        google: false,
        chatgptHosted: true,
        chatgptGeneration: true,
      },
    });
  if (url.pathname === "/api/auth/get-session")
    return route.fulfill({
      json: {
        user: {
          id: "expired-challenge-fixture",
          name: "Fixture",
          isAnonymous: false,
        },
        session: { id: "expired-challenge-session" },
      },
    });
  if (url.pathname === "/api/trial")
    return route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } });
  if (url.pathname === "/api/models")
    return route.fulfill({ json: { models: [] } });
  if (url.pathname === "/api/projects")
    return route.fulfill({ json: { projects: [] } });
  if (url.pathname === "/api/chatgpt/status")
    return route.fulfill({
      json: challengeIssued
        ? { lifecycle: "pending", authStatus: "unknown", pending: challenge }
        : { lifecycle: "expired", authStatus: "disconnected" },
    });
  if (
    url.pathname === "/api/chatgpt/start" &&
    route.request().method() === "POST"
  ) {
    startCount++;
    challengeIssued = true;
    return route.fulfill({ json: challenge });
  }
  unexpected.push(url.pathname);
  return route.abort();
});

const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const report = {
  passed: false,
  syntheticApiOnly: true,
  providerRequests: 0,
  startCount: 0,
  checks,
  errors,
  unexpected,
  requests: apiRequests,
};
try {
  await page.goto(base);
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  const section = page.getByRole("region", { name: "ChatGPT subscription" });
  await expect(
    section.getByText("This sign-in code expired. Start again."),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Connect ChatGPT", exact: true }),
  ).toBeVisible();
  checks.expiredChallengeShowsSafeRestart = true;
  await page.screenshot({ path: `${output}/expired-disconnected.png` });

  await section
    .getByRole("button", { name: "Connect ChatGPT", exact: true })
    .click();
  await expect(section.getByText("ABCD-EFGH", { exact: true })).toBeVisible();
  await expect(
    section.getByRole("link", { name: /Open ChatGPT sign-in/ }),
  ).toHaveAttribute("href", "https://auth.openai.com/codex/device");
  expect(startCount).toBe(1);
  checks.restartDisplaysFreshCode = true;
  await page.screenshot({ path: `${output}/fresh-challenge.png` });
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
  report.passed = true;
} finally {
  report.startCount = startCount;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

if (!report.passed) process.exitCode = 1;
