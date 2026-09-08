/** Existing local dev journal checkpoint; real recovery UI, no inference. */
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = "http://127.0.0.1:3017";
const directory =
  process.env.ORBSIE_JOURNAL_EVIDENCE_DIRECTORY ??
  "docs/evidence/generation-journal";
const fixture = JSON.parse(
  await readFile(".vercel/dev-generated-cloud-state.json", "utf8"),
);
assert.equal(fixture.baseURL, origin);
const evidence = JSON.parse(await readFile(`${directory}/report.json`, "utf8"));
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const auth = await context.request.post(origin + "/api/auth/sign-in/email", {
    headers: { Origin: origin },
    data: fixture.credentials,
  });
  assert.equal(auth.status(), 200);
  let inference = 0;
  await context.route("**/api/generate", (route) => {
    inference++;
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const listed = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/projects" &&
      r.request().method() === "GET",
  );
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  const rows = (await (await listed).json()).projects;
  const target = rows.find((row) => row.id === evidence.projectId);
  assert(target);
  await page.getByRole("button", { name: "Your worlds", exact: true }).click();
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = rows.filter(
    (row) => row.title === target.title && row.revision === target.revision,
  );
  await page
    .getByRole("button", {
      name: new RegExp(
        escape(target.title) + ".*Revision " + target.revision + " · Cloud",
      ),
    })
    .nth(matches.findIndex((row) => row.id === target.id))
    .click();
  await page
    .locator(".workspace-heading h2")
    .filter({ hasText: target.title })
    .waitFor();
  await page
    .getByRole("button", { name: /Your account and cloud worlds|Your worlds/ })
    .click();
  const checkpoint = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/generation-runs" &&
      r.request().method() === "GET",
  );
  await page
    .getByRole("button", { name: "Recover latest generation", exact: true })
    .click();
  const response = await checkpoint;
  assert.equal(response.status(), 200);
  const run = (await response.json()).run;
  await page
    .getByText(
      "Recovered the completed generation. Save it to your account when ready.",
      { exact: true },
    )
    .waitFor();
  await page.waitForTimeout(5000);
  const saved = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onerror = () => reject(Error("IDB open failed"));
        request.onsuccess = () => {
          const db = request.result;
          const read = db
            .transaction("keyval", "readonly")
            .objectStore("keyval")
            .get("orbsie-draft");
          read.onsuccess = () => {
            db.close();
            resolve(read.result?.project);
          };
          read.onerror = () => reject(Error("IDB read failed"));
        };
      }),
  );
  assert.equal(saved.id, run.projectId);
  assert.equal(saved.revision, run.checkpoint.revision);
  assert.deepEqual(saved.entities, run.checkpoint.entities);
  assert.equal(inference, 0);
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: `${directory}/recovered-browser.png`,
  });
  const report = {
    scope:
      "Actual signed-in recovery UI from existing dev cloud checkpoint; no inference",
    projectId: run.projectId,
    runId: run.id,
    sequence: run.sequence,
    revision: saved.revision,
    entities: saved.entities.length,
    checkpointStatus: response.status(),
    inferenceRequests: inference,
    errors,
    status: "passed",
  };
  await writeFile(
    `${directory}/browser.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
