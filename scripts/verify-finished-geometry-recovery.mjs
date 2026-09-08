/** Real development DB/UI recovery of finished geometry; no model calls. */
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";
const origin = "http://127.0.0.1:3017";
const directory = "docs/evidence/finished-geometry-recovery";
const privateFile = ".vercel/dev-generated-cloud-state.json";
assert.equal((await stat(privateFile)).mode & 0o777, 0o600);
const fixture = JSON.parse(await readFile(privateFile, "utf8"));
assert.equal(fixture.baseURL, origin);
const project = {
  version: 1,
  id: randomUUID(),
  title: `Finished geometry ${randomUUID().slice(0, 8)}`,
  seed: 42,
  revision: 0,
  messages: [],
  environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
  entities: [
    {
      id: "tree",
      label: "Original tree",
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#ff44aa",
      geometry: { kind: "tree", detail: "refined" },
      stage: "ready",
      behavior: { type: "static" },
    },
  ],
};
const report = {
  passed: false,
  scope:
    "Actual development PostgreSQL and account recovery UI; fixture operations, zero inference",
  projectId: project.id,
  requests: 0,
  generationRequests: 0,
  errors: [],
  checks: [],
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
  async function call(method, path, data) {
    assert(++report.requests <= 20);
    const response = await context.request.fetch(origin + path, {
      method,
      data,
      headers: { Origin: origin },
      maxRedirects: 0,
    });
    assert.equal(
      response.status(),
      200,
      `${method} ${path} failed with ${response.status()}`,
    );
    return response.json();
  }
  await call("POST", "/api/auth/sign-in/email", fixture.credentials);
  await call("PUT", "/api/projects", { project, baseRevision: null });
  const instruction =
    "Replace only the selected tree with a mushroom. Preserve everything else.";
  let run = (
    await call("POST", "/api/generation-runs", {
      project,
      runId: randomUUID(),
      prompt: instruction,
      selected: "tree",
    })
  ).run;
  async function geometry(kind, detail) {
    run = (
      await call("PUT", "/api/generation-runs", {
        runId: run.id,
        envelope: {
          version: 1,
          projectId: project.id,
          runId: run.id,
          operationId: randomUUID(),
          sequence: run.sequence + 1,
          baseRevision: run.checkpoint.revision,
          command: {
            type: "set_geometry",
            id: "tree",
            geometry: { kind, detail },
          },
        },
      })
    ).run;
  }
  await geometry("mushroom", "coarse");
  assert.deepEqual(run.recoveryCheckpoint.entities, project.entities);
  report.checks.push("baseline-ready-geometry-retained");
  await geometry("mushroom", "refined");
  const finished = run.checkpoint.entities;
  await geometry("tree", "coarse");
  assert.deepEqual(run.recoveryCheckpoint.entities, finished);
  report.checks.push("latest-finished-geometry-retained");
  run = (await call("PATCH", "/api/generation-runs", { runId: run.id })).run;
  assert.equal(run.state, "cancelled");
  await context.route("**/api/generate", (route) => {
    report.generationRequests++;
    return route.abort();
  });
  page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.goto(origin);
  await page
    .getByRole("button", {
      name: /^(Your worlds|Your account and cloud worlds)$/,
    })
    .click();
  await page
    .getByRole("button", {
      name: new RegExp(`${project.title}.*Revision 0 · Cloud`),
    })
    .click();
  await expect(page.locator(".workspace-heading h2")).toHaveText(project.title);
  await page
    .getByRole("button", {
      name: /^(Your worlds|Your account and cloud worlds)$/,
    })
    .click();
  await page
    .getByRole("button", { name: "Recover latest generation", exact: true })
    .click();
  await expect(
    page.getByText(
      "Recovered finished work. Send the continuation to start a new generation request.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect
    .poll(async () =>
      JSON.parse(JSON.stringify((await storageSnapshot(page)).project)),
    )
    .toEqual(run.recoveryCheckpoint);
  await expect(page.locator("#prompt")).toHaveValue(
    new RegExp(instruction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  await expect(page.locator(".selection-chip")).toContainText("Original tree");
  report.checks.push(
    "account-ui-installs-full-recovery-snapshot",
    "original-prompt-and-selection-restored",
  );
  assert.equal(report.generationRequests, 0);
  assert.deepEqual(report.errors, []);
  await page.waitForTimeout(2500);
  report.passed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await mkdir(directory, { recursive: true });
  await page
    ?.screenshot({ path: `${directory}/recovered.png` })
    .catch(() => {});
  await browser.close();
  await writeFile(
    `${directory}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
