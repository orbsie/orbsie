import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.TEST_URL || "http://localhost:3047";
const origin = new URL(base).origin;
const out = "test-results/hosted-chatgpt-ui";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const report = [];
try {
  for (const scenario of [
    "disabled",
    "signed-out",
    "cancel",
    "connected",
    "expired",
    "malformed",
    "malformed-logout",
    "reopen",
    "mobile",
  ]) {
    const context = await browser.newContext({
      viewport:
        scenario === "mobile"
          ? { width: 390, height: 844 }
          : { width: 1280, height: 900 },
    });
    let phase = "idle",
      starts = 0,
      cancels = 0,
      logouts = 0,
      polls = 0;
    const unexpected = [],
      errors = [];
    const expiresAt = Date.now() + (scenario === "expired" ? 4000 : 60000);
    const challenge = () => ({
      userCode: "SYNTH-CODE",
      verificationUrl: "https://auth.openai.com/codex/device",
      expiresAt,
    });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        unexpected.push(url.origin);
        return route.abort();
      }
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const p = url.pathname;
      if (p === "/api/config")
        return route.fulfill({
          json: {
            accounts: true,
            publishing: false,
            google: false,
            chatgptHosted: scenario !== "disabled",
          },
        });
      if (p === "/api/auth/get-session")
        return route.fulfill({
          json:
            scenario === "signed-out"
              ? null
              : {
                  user: { id: "fixture-user", name: "Fixture" },
                  session: { id: "fixture-session" },
                },
        });
      if (p === "/api/trial")
        return route.fulfill({ json: { enabled: false, remaining: 0 } });
      if (p === "/api/projects")
        return route.fulfill({ json: { projects: [] } });
      if (p === "/api/models") return route.fulfill({ json: { models: [] } });
      if (p === "/api/chatgpt/start") {
        starts++;
        assert.equal(route.request().postData(), null);
        phase = "pending";
        return route.fulfill({
          json: scenario === "malformed" ? { bad: "data" } : challenge(),
        });
      }
      if (p === "/api/chatgpt/status") {
        polls++;
        if (
          phase === "pending" &&
          ["connected", "mobile", "malformed-logout"].includes(scenario)
        )
          phase = "connected";
        return route.fulfill({
          json: {
            lifecycle:
              phase === "pending"
                ? "pending"
                : phase === "connected"
                  ? "completed"
                  : "idle",
            authStatus: phase === "connected" ? "connected" : "disconnected",
            ...(phase === "pending" ? { pending: challenge() } : {}),
          },
        });
      }
      if (p === "/api/chatgpt/cancel" || p === "/api/chatgpt/logout") {
        assert.equal(route.request().postData(), null);
        if (p.endsWith("cancel")) cancels++;
        else logouts++;
        await new Promise((r) => setTimeout(r, 250));
        phase = "idle";
        if (scenario === "malformed-logout")
          return route.fulfill({ json: { bad: "data" } });
        return route.fulfill({
          json: { lifecycle: "idle", authStatus: "disconnected" },
        });
      }
      unexpected.push(p);
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    const section = page.getByRole("region", { name: "ChatGPT subscription" });
    if (scenario === "disabled") {
      await expect(section).toHaveCount(0);
      assert.equal(starts, 0);
    } else if (scenario === "signed-out") {
      await expect(
        section.getByRole("button", { name: "Sign in to Orbsie" }),
      ).toBeVisible();
      assert.equal(starts, 0);
      assert.equal(polls, 0);
    } else {
      await expect(
        section.getByRole("button", { name: "Connect ChatGPT", exact: true }),
      ).toBeVisible();
      assert.equal(starts, 0);
      await section
        .getByRole("button", { name: "Connect ChatGPT", exact: true })
        .click();
      if (scenario === "malformed") {
        await expect(section.getByText(/could not be completed/)).toBeVisible();
      } else {
        await expect(section.locator("code")).toHaveText("SYNTH-CODE");
        await expect(
          section.getByRole("link", { name: "Open ChatGPT sign-in" }),
        ).toHaveAttribute("href", "https://auth.openai.com/codex/device");
        await page.screenshot({ path: `${out}/${scenario}.png` });
        if (scenario === "cancel") {
          await section.getByRole("button", { name: "Cancel sign-in" }).click();
          await expect(
            section.getByRole("button", {
              name: "Connect ChatGPT",
              exact: true,
            }),
          ).toBeVisible();
          assert.equal(cancels, 1);
        } else if (
          ["connected", "mobile", "malformed-logout"].includes(scenario)
        ) {
          await expect(section.getByText(/Signed in to ChatGPT/)).toBeVisible({
            timeout: 10000,
          });
          await expect(
            section.getByText(/Model access is being connected/),
          ).toBeVisible();
          await section
            .getByRole("button", { name: "Disconnect ChatGPT" })
            .click();
          if (scenario === "malformed-logout") {
            await expect(section.getByRole("alert")).toBeVisible();
            await expect(section.getByText(/Signed in to ChatGPT/)).toHaveCount(
              0,
            );
            await section.getByRole("button", { name: "Try again" }).click();
          }
          await expect(
            section.getByRole("button", {
              name: "Connect ChatGPT",
              exact: true,
            }),
          ).toBeVisible();
          assert.equal(logouts, 1);
        } else if (scenario === "expired") {
          await expect(section.getByText(/code expired/)).toBeVisible({
            timeout: 5000,
          });
          await expect(section.locator("code")).toHaveCount(0);
        } else if (scenario === "reopen") {
          await page.getByRole("button", { name: "Close dialog" }).click();
          const before = polls;
          await page.waitForTimeout(3500);
          assert.equal(polls, before);
          await page
            .getByRole("button", { name: "Connections", exact: true })
            .click();
          await expect(section.locator("code")).toHaveText("SYNTH-CODE");
          assert.equal(starts, 1);
        }
      }
      const storage = await page.evaluate(() =>
        JSON.stringify([
          Object.entries(localStorage),
          Object.entries(sessionStorage),
        ]),
      );
      assert(!storage.includes("SYNTH-CODE"));
    }
    assert.deepEqual(unexpected, []);
    assert.deepEqual(errors, []);
    report.push({
      scenario,
      passed: true,
      starts,
      cancels,
      logouts,
      polls,
      externalRequests: 0,
    });
    await context.close();
  }
  console.log(
    JSON.stringify(
      {
        passed: true,
        syntheticAuthorization: true,
        liveLogin: false,
        scenarios: report,
      },
      null,
      2,
    ),
  );
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
