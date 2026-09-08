/** Reopen the already-authored cloud artifact without any model request. */
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import assert from "node:assert/strict";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";
const origin = "http://127.0.0.1:3017";
const directory = "docs/evidence/provider-e2e/chatgpt-cloud-recovery";
const fixture = JSON.parse(
  await readFile(".vercel/dev-generated-cloud-state.json", "utf8"),
);
assert.equal(fixture.baseURL, origin);
const prior = JSON.parse(
  await readFile(`${directory}/chatgpt-local.json`, "utf8"),
);
const entries = unzipSync(
  await readFile(`${directory}/chatgpt-local/world.zip`),
);
const projectEntry = Object.keys(entries).find(
  (key) => key === "project.json" || key.endsWith("/project.json"),
);
assert(projectEntry);
const expected = JSON.parse(strFromU8(entries[projectEntry]));
assert.equal(expected.id, prior.cloudRecovery.projectId);
const report = {
  passed: false,
  realProviderCalls: 0,
  projectId: expected.id,
  errors: [],
  requestsBlocked: 0,
};
const browser = await chromium.launch({
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
let page;
try {
  const auth = await context.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { Origin: origin },
    data: fixture.credentials,
    maxRedirects: 0,
  });
  assert.equal(auth.status(), 200);
  await context.route("**/api/generate", (route) => {
    report.requestsBlocked++;
    return route.abort();
  });
  page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  const listed = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/projects" &&
      r.request().method() === "GET",
  );
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  assert.equal((await storageSnapshot(page)).project, null);
  report.freshStorageEmpty = true;
  const rows = (await (await listed).json()).projects;
  const matches = rows.filter(
    (row) => row.title === expected.title && row.revision === expected.revision,
  );
  const index = matches.findIndex((row) => row.id === expected.id);
  assert(index >= 0);
  const cloudSnapshot = matches[index].snapshot;
  assert.deepEqual({ ...cloudSnapshot, messages: [] }, expected);
  report.exportSnapshotMatches = true;
  report.cloudMessageCount = cloudSnapshot.messages.length;
  report.matchIndex = index;
  report.matchCount = matches.length;
  await page
    .getByRole("button", {
      name: /^(Your worlds|Your account and cloud worlds)$/,
    })
    .click();
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const option = page
    .getByRole("button", {
      name: new RegExp(
        `${escape(expected.title)}[\\s\\S]*Revision ${expected.revision} · Cloud`,
      ),
    })
    .nth(index);
  await option.click();
  await expect(page.locator(".workspace-heading h2")).toBeVisible({
    timeout: 30000,
  });
  await expect
    .poll(
      async () =>
        JSON.parse(JSON.stringify((await storageSnapshot(page)).project)),
      { timeout: 30000 },
    )
    .toEqual(cloudSnapshot);
  assert.deepEqual(report.errors, []);
  assert.equal(report.requestsBlocked, 0);
  // Let the entry/formation animation settle for the visual evidence.
  await page.waitForTimeout(2500);
  report.passed = true;
} catch (error) {
  report.error = error.message;
  report.dialog = await page
    ?.locator("dialog")
    .innerText()
    .catch(() => "");
  process.exitCode = 1;
} finally {
  await mkdir(directory, { recursive: true });
  await page
    ?.screenshot({ path: `${directory}/fresh-reopen.png` })
    .catch(() => {});
  await browser.close();
  await writeFile(
    `${directory}/fresh-reopen.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
