import { chromium, expect } from "@playwright/test";

// Deterministic account-boundary regression. API responses are synthetic;
// no accounts, worlds, publications, or inference requests are created.
const base = process.env.TEST_URL || "http://localhost:3001";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext();
const project = {
  version: 1,
  id: "account-switch-regression",
  title: "Account one world",
  seed: 42,
  revision: 1,
  entities: [],
  environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
  messages: [],
};
let user = { name: "Account one" };
let failSignOut = true;
const cloud = {
  id: project.id,
  title: project.title,
  revision: project.revision,
  snapshot: project,
};
const conflict = {
  ...cloud,
  revision: 2,
  snapshot: { ...project, revision: 2 },
};
await context.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  const method = route.request().method();
  let body,
    status = 200;
  if (path === "/api/config")
    body = { accounts: true, publishing: true, google: false };
  else if (path === "/api/auth/get-session") body = { user };
  else if (path === "/api/auth/sign-out") {
    if (failSignOut) {
      status = 503;
      body = { error: "Try again" };
    } else {
      user = null;
      body = { success: true };
    }
  } else if (path === "/api/auth/sign-in/email") {
    user = { name: "Account two" };
    body = { user };
  } else if (path === "/api/projects" && method === "GET")
    body = { projects: user?.name === "Account one" ? [cloud] : [] };
  else if (path === "/api/projects" && method === "PUT") {
    status = 409;
    body = { error: "A newer cloud revision exists.", conflict };
  } else if (path === "/api/publish") {
    if (user?.name === "Account one")
      body = {
        state: "READY",
        url: "https://example.com/account-one-world",
        servedRevision: 1,
      };
    else {
      status = 404;
      body = { error: "Publication not found" };
    }
  } else throw Error(`Unexpected API request: ${method} ${path}`);
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
});
const page = await context.newPage();
try {
  await page.goto(base);
  await page.getByRole("button", { name: "Your worlds", exact: true }).click();
  await page
    .getByRole("button", { name: /Account one world.*Revision 1 · Cloud/ })
    .click();
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Open published Orb" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Your account and cloud worlds" })
    .click();
  await page
    .getByRole("button", { name: "Save current world to cloud" })
    .click();
  await expect(
    page.getByRole("button", { name: "Open cloud copy" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Hello, Account one." }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Sign-out failed" }),
  ).toBeVisible();
  failSignOut = false;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Open published Orb" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in to publish" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Your account and cloud worlds" })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill("synthetic-two@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Your account and cloud worlds" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Hello, Account two." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open cloud copy" }),
  ).not.toBeVisible();
  console.log(
    "PASS: failed sign-out retains the session; successful sign-out clears publication; switching accounts clears the previous cloud conflict",
  );
  const delayed = await context.newPage();
  let releaseSession;
  const pendingSession = new Promise((resolve) => {
    releaseSession = resolve;
  });
  await delayed.route("**/api/auth/get-session", async (route) => {
    await pendingSession;
    await route.fulfill({ json: { user: { name: "Account one" } } });
  });
  await delayed.goto(base);
  await delayed
    .getByRole("button", { name: "Your worlds", exact: true })
    .click();
  await delayed
    .getByLabel("Email", { exact: true })
    .fill("synthetic-two@example.test");
  await delayed
    .getByLabel("Password", { exact: true })
    .fill("synthetic-test-password");
  await delayed.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(delayed.locator("dialog")).not.toBeVisible();
  const initialSession = delayed.waitForResponse("**/api/auth/get-session");
  releaseSession();
  await initialSession;
  await delayed.waitForTimeout(200);
  await delayed
    .getByRole("button", { name: "Your worlds", exact: true })
    .click();
  await expect(
    delayed.getByRole("heading", { name: "Hello, Account two." }),
  ).toBeVisible();
  console.log(
    "PASS: delayed startup session cannot replace a later explicit sign-in",
  );
} finally {
  await browser.close();
}
