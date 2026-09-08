import { installFixtureGeneration } from "./fixture-generation.mjs";
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";

// Use only the synthetic account produced by verify-cloud.mjs. Never log it.
const statePath = process.env.CLOUD_TEST_STATE;
if (!statePath)
  throw Error("Set CLOUD_TEST_STATE to the synthetic credential file.");
const state = JSON.parse(await readFile(statePath, "utf8"));
const base = process.env.TEST_URL || "https://orbsie.com";
const credentials =
  state.users?.[0] ?? (state.baseURL === base ? state.credentials : undefined);
if (!credentials)
  throw Error("Synthetic account does not match the test origin.");
const output = process.env.UI_EVIDENCE_DIR || ".vercel/account-ui";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
await installFixtureGeneration(page.context());
const errors = [],
  checks = [],
  saves = [];
let fixtureGenerations = 0;
let passed = false;
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (request.url().includes("/api/generate")) fixtureGenerations++;
});
page.on("response", async (response) => {
  if (
    response.url().endsWith("/api/projects") &&
    response.request().method() === "PUT"
  )
    saves.push({ status: response.status(), ...(await response.json()) });
});
const account = () =>
  page
    .getByRole("button", {
      name: /^(Your worlds|Your account and cloud worlds)$/,
    })
    .click();
const close = () => page.getByRole("button", { name: "Close dialog" }).click();
const signIn = async () => {
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("dialog")).not.toBeVisible({ timeout: 30000 });
};
const draft = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("keyval-store");
        open.onerror = () => reject(Error("Could not open draft database"));
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction("keyval")
            .objectStore("keyval")
            .get("orbsie-draft");
          request.onsuccess = () => {
            resolve(request.result?.project);
            db.close();
          };
          request.onerror = () => reject(Error("Could not read draft"));
        };
      }),
  );
const save = async (status) => {
  await page.waitForTimeout(2000);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/projects") && r.request().method() === "PUT",
  );
  await page
    .getByRole("button", { name: "Save current world to cloud" })
    .click();
  expect((await response).status()).toBe(status);
  await expect(
    page.getByRole("button", { name: "Save current world to cloud" }),
  ).toBeEnabled();
};
try {
  await page.goto(base);
  const prompt = "A tiny island treasure hunt for account UI acceptance";
  await page.locator("#prompt").fill(prompt);
  await account();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await signIn();
  await expect(page.locator("#prompt")).toHaveValue(prompt);
  checks.push("Sign-in preserves unsubmitted landing prompt");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Share Orb", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".building-message")).not.toBeVisible({
    timeout: 60000,
  });
  await expect(page.locator(".saved")).toHaveText("Saved on this device");
  const original = await draft();
  expect(original.entities.length).toBeGreaterThan(0);
  await writeFile(`${output}/project.json`, JSON.stringify(original, null, 2));
  await page
    .locator("#prompt")
    .fill("An unsubmitted edit that must survive sign-in");
  await account();
  await save(200);
  checks.push("UI saves generated local draft to configured cloud");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn();
  await expect(page.locator("#prompt")).toHaveValue(
    "An unsubmitted edit that must survive sign-in",
  );
  expect(await draft()).toEqual(original);
  checks.push("Sign-out/sign-in preserves active local draft and pending edit");

  // Simulate another device updating this test's own project, then save the stale UI copy.
  const remote = {
    ...original,
    title: `UI acceptance cloud update ${original.id}`,
    revision: original.revision,
  };
  await page.waitForTimeout(2000);
  const remoteBaseline = await context.request.get(
    `${base}/api/projects?id=${encodeURIComponent(original.id)}`,
  );
  expect(remoteBaseline.status()).toBe(200);
  const remoteToken = (await remoteBaseline.json()).project.snapshotToken;
  const updated = await context.request.put(`${base}/api/projects`, {
    headers: { Origin: base },
    data: {
      project: remote,
      baseRevision: original.revision,
      baseSnapshotToken: remoteToken,
    },
  });
  expect(updated.status()).toBe(200);
  await account();
  await save(409);
  await expect(
    page.getByText(
      `A newer cloud copy exists at revision ${remote.revision}.`,
      { exact: false },
    ),
  ).toBeVisible();
  expect(await draft()).toEqual(original);
  await page.screenshot({ path: `${output}/conflict.png` });
  checks.push(
    "Same-revision cloud change exposes conflict and preserves local draft",
  );
  await page
    .getByRole("button", { name: "Open cloud copy", exact: true })
    .click();
  await expect(page.locator(".workspace-heading h2")).toHaveText(remote.title);
  await expect.poll(draft).toEqual(remote);
  await account();
  await expect(
    page
      .getByRole("button", {
        name: new RegExp(`${original.title}.*local recovery`),
      })
      .first(),
  ).toBeVisible();
  await save(200);
  checks.push(
    "Conflict resolution opens cloud revision, preserves recovery copy, and saves with new baseline",
  );
  await close();
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  const capabilityResponse = await context.request.get(`${base}/api/config`);
  expect(capabilityResponse.status()).toBe(200);
  const capabilities = await capabilityResponse.json();
  if (capabilities.publishing) {
    await expect(
      page.getByRole("button", { name: "Publish Orb", exact: true }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByText(
        "Dedicated publishing needs cloud storage and deployment credentials.",
        { exact: false },
      ),
    ).toBeVisible();
  }
  checks.push(
    "Share dialog accurately reflects configured publishing capability; no deployment requested",
  );
  await page.screenshot({ path: `${output}/share.png` });
  await close();

  await page.reload();
  await account();
  await expect(
    page.getByRole("button", {
      name: new RegExp(`${remote.title}.*Revision ${remote.revision} · Cloud`),
    }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("button", {
      name: new RegExp(`${remote.title}.*Revision ${remote.revision} · Cloud`),
    })
    .click();
  await expect(page.locator(".workspace-heading h2")).toHaveText(remote.title);
  checks.push(
    "Reload restores session and cloud library; cloud UI opens saved world",
  );
  await account();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({ path: `${output}/account-mobile.png` });
  checks.push("Account dialog has no horizontal overflow at 390px");
  expect(fixtureGenerations).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  passed = true;
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        passed,
        base,
        checks,
        saves: saves.map(({ status, revision }) => ({ status, revision })),
        errors,
        fixtureGenerations,
        realProviderCalls: 0,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      checks,
      saveStatuses: saves.map((s) => s.status),
      errors,
      fixtureGenerations,
      realProviderCalls: 0,
    }),
  );
  await context.close();
  await browser.close();
}
