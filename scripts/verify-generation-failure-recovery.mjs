#!/usr/bin/env node
// Deterministic editor acceptance for explicit generation recovery actions.
// The fixture owns only /api/generate; no provider or database traffic is used.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const url = process.env.TEST_URL ?? "http://127.0.0.1:3022";
const origin = new URL(url).origin;
const output =
  process.argv[2] ??
  process.env.ORBSIE_FAILURE_RECOVERY_EVIDENCE_DIR ??
  "docs/evidence/generation-failure-recovery";
await mkdir(output, { recursive: true });

const treeId = "tree-0";
const unrelatedId = "rock-0";
const pendingId = "pending-0";
const tree = {
  id: treeId,
  label: "Friendly tree",
  position: [-4.5, 0, 1],
  scale: [1.25, 1.35, 1.25],
  color: "#6d9d58",
  assetPolicy: "new-only",
  stage: "seed",
};
const unrelated = {
  id: unrelatedId,
  label: "Unrelated rock",
  position: [3, 0, 2],
  scale: [1.1, 0.8, 1],
  color: "#bed0bc",
  assetPolicy: "new-only",
  stage: "seed",
};
const pending = {
  id: pendingId,
  label: "Unfinished object",
  position: [0, 0, -2],
  scale: [1, 1, 1],
  color: "#f0c4a6",
  assetPolicy: "new-only",
  stage: "seed",
};

const createCommands = [
  { type: "reserve_entity", entity: { ...tree, geometry: undefined } },
  {
    type: "set_geometry",
    id: treeId,
    geometry: { kind: "tree", detail: "refined" },
  },
  { type: "reserve_entity", entity: { ...unrelated, geometry: undefined } },
  {
    type: "set_geometry",
    id: unrelatedId,
    geometry: { kind: "rock", detail: "refined" },
  },
  { type: "commit_revision", message: "The recovery fixture is ready." },
];
const failureCommands = (color, message) => [
  { type: "set_material", id: treeId, color },
  { type: "reserve_entity", entity: { ...pending, geometry: undefined } },
  { type: "set_material", id: "missing-object", color: "#ffffff" },
  { type: "commit_revision", message },
];
const successCommands = (color, message) => [
  { type: "set_material", id: treeId, color },
  { type: "commit_revision", message },
];

const report = {
  mode: "fixture-generation-failure-recovery-real-editor",
  fixture: {
    transport: "intercepted /api/generate NDJSON",
    liveInference: false,
    serverFundedCalls: false,
    databaseMutations: false,
    treeId,
    unrelatedId,
    pendingId,
  },
  requests: [],
  api: [],
  blocked: [],
  unexpectedApi: [],
  pageErrors: [],
  checks: {},
};

const stream = (commands) =>
  commands.map((command) => JSON.stringify(command)).join("\n") + "\n";
const summarizeRequest = (body) => ({
  prompt: body.prompt,
  selected: body.selected,
  projectId: body.project?.id,
  projectRevision: body.project?.revision,
  entityIds: body.project?.entities?.map((entity) => entity.id),
});
const getProject = (page) =>
  storageSnapshot(page).then((value) => value.project);
async function waitForProject(page, predicate) {
  let project;
  await expect
    .poll(
      async () => {
        project = await getProject(page);
        return Boolean(project && predicate(project));
      },
      { timeout: 45_000 },
    )
    .toBe(true);
  return project;
}
async function selectObject(page, label) {
  await page.getByRole("button", { name: "Show objects", exact: true }).click();
  await page.locator(".object-list button").filter({ hasText: label }).click();
}
async function submitEdit(page, text) {
  await page.locator("#prompt").fill(text);
  await page.getByRole("button", { name: "Change this", exact: true }).click();
}

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
let page;
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (target.origin !== origin && /^https?:$/.test(target.protocol)) {
      report.blocked.push(target.href);
      await route.abort();
      return;
    }
    if (target.origin !== origin || !target.pathname.startsWith("/api/")) {
      await route.fallback();
      return;
    }

    const method = request.method();
    const path = target.pathname;
    report.api.push({ method, path });
    if (path === "/api/config" && method === "GET")
      return route.fulfill({
        json: {
          generationMaxTokens: 512,
          accounts: false,
          publishing: false,
          google: false,
          isAdmin: false,
        },
      });
    if (path === "/api/auth/get-session" && method === "GET")
      return route.fulfill({ json: null });
    if (path === "/api/projects" && method === "GET")
      return route.fulfill({ json: { projects: [] } });
    if (path === "/api/models" && method === "GET")
      return route.fulfill({ json: { models: [] } });
    if (path === "/api/trial" && method === "GET")
      return route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } });
    if (path === "/api/generate" && method === "POST") {
      const body = request.postDataJSON();
      const number = report.requests.length + 1;
      report.requests.push(summarizeRequest(body));
      assert.equal(body.provider, "free");
      assert.equal(body.key, "");
      assert.equal(body.model, "");
      const commands =
        number === 1
          ? createCommands
          : number === 2
            ? failureCommands("#ff66aa", "The first failed edit.")
            : number === 3
              ? successCommands("#8ac6dd", "The unselected retry succeeded.")
              : number === 4
                ? failureCommands("#f5b56f", "The dismissed failed edit.")
                : number === 5
                  ? failureCommands("#c982df", "The latest valid checkpoint.")
                  : number === 6
                    ? failureCommands("#dd8a78", "The selected retry failure.")
                    : successCommands(
                        "#a2d07f",
                        "The selected retry succeeded.",
                      );
      return route.fulfill({
        contentType: "application/x-ndjson",
        headers: { "Cache-Control": "no-store" },
        body: stream(commands),
      });
    }
    report.unexpectedApi.push({ method, path });
    await route.abort();
  });
  await context.addInitScript(() => {
    const errors = [];
    window.__orbsieFixtureErrors = errors;
    new MutationObserver(() => {
      const message = document
        .querySelector(".toast.error")
        ?.textContent?.trim();
      if (message && errors.at(-1) !== message)
        errors.push(message.slice(0, 1000));
    }).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  page = await context.newPage();
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.setDefaultTimeout(30_000);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas")).toBeVisible();

  await page
    .getByPlaceholder("What experience to build?")
    .fill("Build the recovery fixture");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const first = await waitForProject(
    page,
    (project) =>
      project.entities.length === 2 &&
      project.entities.every((entity) => entity.stage === "ready"),
  );
  const originalUnrelated = structuredClone(
    first.entities.find((entity) => entity.id === unrelatedId),
  );
  report.checks.created = {
    projectId: first.id,
    revision: first.revision,
    entityIds: first.entities.map((entity) => entity.id),
  };

  // No object was selected for this failed edit. Selecting another object
  // before retry must not change the original unselected request scope.
  await submitEdit(page, "Tint the tree blue");
  await expect(page.locator(".toast.error")).toBeVisible();
  const firstFailed = await getProject(page);
  assert.equal(report.requests[1].selected, undefined);
  assert.equal(firstFailed.entities.length, 2);
  assert.equal(
    firstFailed.entities.find((entity) => entity.id === treeId)?.color,
    "#ff66aa",
  );
  assert.deepEqual(
    firstFailed.entities.find((entity) => entity.id === unrelatedId),
    originalUnrelated,
  );
  await page.screenshot({ path: `${output}/recovery-actions.png` });
  await selectObject(page, "Unrelated rock");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await waitForProject(
    page,
    (project) =>
      project.entities.find((entity) => entity.id === treeId)?.color ===
        "#8ac6dd" && project.entities.length === 2,
  );
  assert.equal(report.requests[2].selected, undefined);
  assert.equal(report.requests[2].prompt, report.requests[1].prompt);
  await expect(page.locator(".toast.error")).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText(
    "Your world is saved on this device.",
  );
  await page.locator('.toast button[aria-label="Dismiss message"]').click();
  await expect(page.locator(".toast")).toHaveCount(0);
  report.checks.unselectedRetryPreserved = {
    failedRequestSelected: null,
    retryRequestSelected: null,
    promptRestoredExactly: true,
    unrelatedPreserved: true,
  };

  await selectObject(page, "Friendly tree");
  await submitEdit(page, "Make the selected tree amber");
  await expect(page.locator(".toast.error")).toBeVisible();
  const dismissed = await getProject(page);
  assert.equal(report.requests[3].selected, treeId);
  assert.equal(
    dismissed.entities.find((entity) => entity.id === treeId)?.color,
    "#f5b56f",
  );
  assert.deepEqual(
    dismissed.entities.find((entity) => entity.id === unrelatedId),
    originalUnrelated,
  );
  await page
    .locator('.toast.error button[aria-label="Dismiss message"]')
    .click();
  await expect(page.locator(".toast.error")).toHaveCount(0);
  await page.waitForTimeout(250);
  assert.equal(report.requests.length, 4);
  report.checks.dismissal = {
    requestCountAfterDismiss: report.requests.length,
  };

  await submitEdit(page, "Make the selected tree violet");
  await expect(page.locator(".toast.error")).toBeVisible();
  const latestCheckpoint = await getProject(page);
  assert.equal(report.requests[4].selected, treeId);
  assert.equal(
    latestCheckpoint.entities.find((entity) => entity.id === treeId)?.color,
    "#c982df",
  );
  await page
    .getByRole("button", { name: "Use last working", exact: true })
    .click();
  await expect(
    page.getByText("Last working world restored.", { exact: true }),
  ).toBeVisible();
  const restored = await getProject(page);
  assert.equal(
    restored.entities.find((entity) => entity.id === treeId)?.color,
    "#c982df",
  );
  assert.deepEqual(
    restored.entities.find((entity) => entity.id === unrelatedId),
    originalUnrelated,
  );
  assert.equal(report.requests.length, 5);
  report.checks.lastWorkingPreservedLatestIncrement = {
    treeColor: restored.entities.find((entity) => entity.id === treeId)?.color,
    unrelatedPreserved: true,
    requestCountAfterRestore: report.requests.length,
  };

  await submitEdit(page, "Make the selected tree green");
  await expect(page.locator(".toast.error")).toBeVisible();
  assert.equal(report.requests[5].selected, treeId);
  await selectObject(page, "Unrelated rock");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await waitForProject(
    page,
    (project) =>
      project.entities.find((entity) => entity.id === treeId)?.color ===
        "#a2d07f" && project.entities.length === 2,
  );
  assert.equal(report.requests[6].selected, treeId);
  assert.equal(report.requests[6].prompt, report.requests[5].prompt);
  assert.deepEqual(
    (await getProject(page)).entities.find(
      (entity) => entity.id === unrelatedId,
    ),
    originalUnrelated,
  );
  await expect(page.locator(".toast.error")).toHaveCount(0);
  await page.waitForTimeout(350);
  assert.equal(report.requests.length, 7);
  assert.deepEqual(report.unexpectedApi, []);
  assert.deepEqual(report.blocked, []);
  assert.deepEqual(report.pageErrors, []);
  report.checks.selectedRetryPreserved = {
    failedRequestSelected: treeId,
    retryRequestSelected: treeId,
    changedSelectionBeforeRetry: unrelatedId,
    noAutomaticExtraRequest: true,
  };
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  if (page) {
    report.transientErrors = await page
      .evaluate(() => window.__orbsieFixtureErrors ?? [])
      .catch(() => []);
    report.visibleText = await page
      .locator("body")
      .innerText()
      .catch(() => "unavailable");
    await page
      .screenshot({ path: `${output}/failure.png` })
      .catch(() => undefined);
  }
  throw error;
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
