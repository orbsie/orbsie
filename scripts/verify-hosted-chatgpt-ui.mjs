import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.TEST_URL || "http://localhost:3047";
const origin = new URL(base).origin;
const out =
  process.env.ORBSIE_CHATGPT_UI_EVIDENCE_DIR ||
  "test-results/hosted-chatgpt-ui";
await mkdir(out, { recursive: true });
const scenarios = [
  "disabled",
  "signed-out",
  "cancel",
  "connected",
  "expired",
  "failed-completion",
  "malformed",
  "malformed-logout",
  "stale-status",
  "stale-models",
  "stale-logout-failure",
  "reopen",
  "mobile",
];
const selectedScenario = process.env.ORBSIE_CHATGPT_UI_SCENARIO;
if (selectedScenario && !scenarios.includes(selectedScenario))
  throw new Error(`Unknown ChatGPT UI scenario: ${selectedScenario}`);
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const report = [];
try {
  for (const scenario of selectedScenario ? [selectedScenario] : scenarios) {
    const context = await browser.newContext({
      viewport:
        scenario === "mobile"
          ? { width: 390, height: 844 }
          : { width: 1280, height: 900 },
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin,
    });
    let phase = "idle",
      starts = 0,
      cancels = 0,
      logouts = 0,
      polls = 0,
      providerSessions = 0;
    const controlEvents = [];
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
            chatgptGeneration: scenario === "stale-models",
          },
        });
      if (p === "/api/auth/get-session")
        return route.fulfill({
          json:
            scenario === "signed-out"
              ? null
              : {
                  user: {
                    id: "fixture-user",
                    name: "Fixture",
                    isAnonymous: false,
                  },
                  session: { id: "fixture-session" },
                },
        });
      if (p === "/api/provider-session") {
        providerSessions++;
        return route.fulfill({
          json: {
            user: {
              id: "fixture-provider-user",
              name: "Fixture",
              isAnonymous: true,
            },
          },
        });
      }
      if (p === "/api/trial")
        return route.fulfill({ json: { enabled: false, remaining: 0 } });
      if (p === "/api/projects")
        return route.fulfill({ json: { projects: [] } });
      if (p === "/api/models") return route.fulfill({ json: { models: [] } });
      if (p === "/api/chatgpt/start") {
        starts++;
        controlEvents.push("start");
        assert.equal(route.request().postData(), null);
        phase = "pending";
        return route.fulfill({
          json: scenario === "malformed" ? { bad: "data" } : challenge(),
        });
      }
      if (p === "/api/chatgpt/status") {
        polls++;
        if (["stale-status", "stale-logout-failure"].includes(scenario))
          return route.fulfill({
            status: 409,
            json: {
              code: "CHATGPT_CONNECTION_STALE",
              error:
                "Your ChatGPT connection needs an update. Reconnect to continue.",
            },
          });
        if (scenario === "stale-models")
          return route.fulfill({
            json: { lifecycle: "completed", authStatus: "connected" },
          });
        if (scenario === "failed-completion" && phase === "pending") {
          phase = "failed";
          return route.fulfill({
            json: {
              lifecycle: "failed",
              authStatus: "disconnected",
              failureCode: "other",
              error:
                "access_token=fixture-private-token user_id=fixture-private-user",
            },
          });
        }
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
      if (p === "/api/chatgpt/models") {
        if (scenario === "stale-models")
          return route.fulfill({
            status: 409,
            json: {
              code: "CHATGPT_CONNECTION_STALE",
              error:
                "Your ChatGPT connection needs an update. Reconnect to continue.",
            },
          });
        return route.fulfill({ json: { models: [] } });
      }
      if (p === "/api/chatgpt/cancel" || p === "/api/chatgpt/logout") {
        assert.equal(route.request().postData(), null);
        if (p.endsWith("cancel")) cancels++;
        else {
          logouts++;
          controlEvents.push("logout");
        }
        await new Promise((r) => setTimeout(r, 250));
        if (scenario === "stale-logout-failure")
          return route.fulfill({
            status: 502,
            json: { error: "ChatGPT request could not be completed." },
          });
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
    if (scenario !== "disabled")
      await expect(section).toHaveCount(1, { timeout: 10000 });
    if (scenario === "disabled") {
      await expect(section).toHaveCount(0);
      assert.equal(starts, 0);
    } else if (scenario === "signed-out") {
      await expect(
        section.getByRole("button", { name: "Connect ChatGPT" }),
      ).toBeVisible();
      assert.equal(starts, 0);
      assert.equal(polls, 0);
      await section.getByRole("button", { name: "Connect ChatGPT" }).click();
      await expect(section.locator("code")).toHaveText("SYNTH-CODE");
      assert.equal(providerSessions, 1);
      assert.equal(starts, 1);
    } else {
      const staleScenario = [
        "stale-status",
        "stale-models",
        "stale-logout-failure",
      ].includes(scenario);
      if (staleScenario) {
        await expect(
          section.getByRole("button", {
            name: "Reconnect ChatGPT",
            exact: true,
          }),
        ).toBeVisible({ timeout: 10000 });
        await expect(
          section.getByText(
            "Your ChatGPT connection needs an update. Reconnect to continue.",
          ),
        ).toBeVisible();
        assert.equal(starts, 0);
        assert.equal(logouts, 0);
        assert.deepEqual(controlEvents, []);
        await page.screenshot({ path: `${out}/${scenario}-before-click.png` });
        await section
          .getByRole("button", { name: "Reconnect ChatGPT", exact: true })
          .click();
        if (scenario === "stale-logout-failure") {
          await expect(section.getByRole("alert")).toBeVisible();
          await expect(section.locator("code")).toHaveCount(0);
          assert.deepEqual(controlEvents, ["logout"]);
          assert.equal(starts, 0);
        } else {
          await expect(section.locator("code")).toHaveText("SYNTH-CODE");
          assert.deepEqual(controlEvents, ["logout", "start"]);
        }
        await page.screenshot({ path: `${out}/${scenario}-after-click.png` });
      } else {
        await expect(
          section.getByRole("button", { name: "Connect ChatGPT", exact: true }),
        ).toBeVisible();
        assert.equal(starts, 0);
        await section
          .getByRole("button", { name: "Connect ChatGPT", exact: true })
          .click();
        if (scenario === "malformed") {
          await expect(
            section.getByText(/could not be completed/),
          ).toBeVisible();
        } else {
          await expect(section.locator("code")).toHaveText("SYNTH-CODE");
          await expect(
            section.getByRole("link", { name: "Open ChatGPT sign-in" }),
          ).toHaveAttribute("href", "https://auth.openai.com/codex/device");
          await section
            .getByRole("button", { name: "Copy one-time code" })
            .click();
          await expect
            .poll(
              () =>
                page.evaluate(() =>
                  navigator.clipboard
                    .readText()
                    .catch(() => "clipboard-unavailable"),
                ),
              { timeout: 3000 },
            )
            .toBe("SYNTH-CODE");
          await page.screenshot({ path: `${out}/${scenario}.png` });
          if (scenario === "cancel") {
            await section
              .getByRole("button", { name: "Cancel sign-in" })
              .click();
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
            await expect(section.getByText(/Signed in to ChatGPT/)).toBeVisible(
              {
                timeout: 10000,
              },
            );
            await expect(
              section.getByText(
                /Generation is not available in this environment yet/,
              ),
            ).toBeVisible();
            await section
              .getByRole("button", { name: "Disconnect ChatGPT" })
              .click();
            if (scenario === "malformed-logout") {
              await expect(section.getByRole("alert")).toBeVisible();
              await expect(
                section.getByText(/Signed in to ChatGPT/),
              ).toHaveCount(0);
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
          } else if (scenario === "failed-completion") {
            await expect(
              section.getByText("ChatGPT sign-in failed. Try again."),
            ).toBeVisible({ timeout: 10000 });
            const failureText = await section.innerText();
            assert(!failureText.includes("fixture-private-token"));
            assert(!failureText.includes("fixture-private-user"));
            await expect(
              section.getByRole("button", { name: "Try again", exact: true }),
            ).toBeVisible();
            assert.equal(starts, 1);
            assert.deepEqual(controlEvents, ["start"]);
            await page.screenshot({
              path: `${out}/${scenario}-failed.png`,
            });
            await section
              .getByRole("button", { name: "Try again", exact: true })
              .click();
            await expect(section.locator("code")).toHaveText("SYNTH-CODE");
            await expect.poll(() => starts).toBe(2);
            assert.deepEqual(controlEvents, ["start", "start"]);
            await page.screenshot({
              path: `${out}/${scenario}-retried.png`,
            });
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
      providerSessions,
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
