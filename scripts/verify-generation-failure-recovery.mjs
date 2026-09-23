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
const successCommands = (color, message) => [
  { type: "set_material", id: treeId, color },
  { type: "commit_revision", message },
];
const safeGenerationFailure = {
  failure: "parser-failure",
  error:
    "The model returned an invalid scene update. Your last working scene is safe.",
  code: "INVALID_SCENE_UPDATE",
  diagnostic: {
    operation: 3,
    finishReason: "stop",
    issues: [
      {
        code: "invalid_type",
        path: ["geometry", "job", "recipe", "nodes", 2],
        reason: "unreachable_recipe_node",
      },
    ],
  },
};
const report = {
  mode: "fixture-generation-retry-feedback-real-editor",
  fixture: {
    transport: "window.fetch interception with /api/generate ReadableStreams",
    liveInference: false,
    serverFundedCalls: false,
    databaseMutations: false,
    viewports: {
      desktop: { width: 1280, height: 900 },
      android: { width: 390, height: 844 },
    },
    cases: [
      "initial clean EOF after provisional scene operations",
      "edit body read rejection after a provisional operation",
      "invalid final commit after a provisional operation",
      "split UTF-8 code point in an explicit retry",
    ],
    structuredFailure: {
      code: safeGenerationFailure.code,
      finishReason: safeGenerationFailure.diagnostic.finishReason,
      issueCode: safeGenerationFailure.diagnostic.issues[0].code,
      issuePath: safeGenerationFailure.diagnostic.issues[0].path,
      reason: safeGenerationFailure.diagnostic.issues[0].reason,
    },
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

const summarizeRequest = (body) => ({
  prompt: body.prompt,
  selected: body.selected,
  projectId: body.project?.id,
  projectRevision: body.project?.revision,
  entityIds: body.project?.entities?.map((entity) => entity.id),
  generationFeedback: body.generationFeedback
    ? {
        version: body.generationFeedback.version,
        projectId: body.generationFeedback.projectId,
        code: body.generationFeedback.code,
        finishReason: body.generationFeedback.finishReason,
        issues: body.generationFeedback.issues,
      }
    : undefined,
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
  await context.exposeBinding(
    "__orbsieRecordGenerationRequest",
    (_source, body) => {
      report.requests.push(summarizeRequest(body));
      return report.requests.length;
    },
  );
  await context.addInitScript(
    (fixture) => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const request = new Request(
          new URL(input.url ?? input, location.href),
          init,
        );
        const target = new URL(request.url);
        if (target.pathname !== "/api/generate" || request.method !== "POST")
          return nativeFetch(input, init);

        const body = await request.clone().json();
        const number = await window.__orbsieRecordGenerationRequest(body);
        const initialFailure = [
          { type: "set_environment", sky: "#123456" },
          {
            type: "reserve_entity",
            entity: {
              id: "initial-pending",
              label: "Unfinished initial object",
              position: [0, 0, 0],
              scale: [1, 1, 1],
              color: "#f0c4a6",
              assetPolicy: "new-only",
              stage: "seed",
            },
          },
        ];
        const create = fixture.createCommands;
        const failure = fixture.safeGenerationFailure;
        const pendingEntity = fixture.pendingEntity;
        const failedEdit = (color, includePending) => [
          { type: "set_material", id: fixture.treeId, color },
          ...(includePending
            ? [{ type: "reserve_entity", entity: pendingEntity }]
            : []),
          failure,
        ];
        let commands;
        if (number === 1) commands = initialFailure;
        else if (number === 2) commands = create;
        else if (number === 3) commands = failedEdit("#ff66aa", false);
        else if (number === 4) commands = fixture.successUnselected;
        else if (number === 5) {
          const encoder = new TextEncoder();
          const first = encoder.encode(
            JSON.stringify({
              type: "set_material",
              id: fixture.treeId,
              color: "#f5b56f",
            }) + "\n",
          );
          return new Response(
            new ReadableStream({
              async start(controller) {
                controller.enqueue(first);
                await new Promise((resolve) => setTimeout(resolve, 0));
                controller.error(new Error("private fixture reader detail"));
              },
            }),
            { headers: { "Content-Type": "application/x-ndjson" } },
          );
        } else if (number === 6)
          commands = [
            { type: "set_material", id: fixture.treeId, color: "#c982df" },
            { type: "commit_revision" },
          ];
        else if (number === 7) commands = failedEdit("#dd8a78", false);
        else if (number === 8) commands = fixture.successSelected;
        else
          throw new Error(
            "Unexpected generation request in the deterministic fixture.",
          );

        const encoder = new TextEncoder();
        const text =
          commands.map((command) => JSON.stringify(command)).join("\n") + "\n";
        const bytes = encoder.encode(text);
        const splitAt =
          number === 4 ? bytes.findIndex((byte) => byte === 0xc3) : -1;
        const stream = new ReadableStream({
          async start(controller) {
            if (splitAt >= 0) {
              controller.enqueue(bytes.slice(0, splitAt + 1));
              await new Promise((resolve) => setTimeout(resolve, 0));
              controller.enqueue(bytes.slice(splitAt + 1));
            } else {
              controller.enqueue(bytes);
            }
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "application/x-ndjson" },
        });
      };
    },
    {
      createCommands,
      safeGenerationFailure,
      pendingEntity: { ...pending, geometry: undefined },
      treeId,
      successUnselected: successCommands(
        "#8ac6dd",
        "The unselected retry succeeded: café.",
      ),
      successSelected: successCommands(
        "#a2d07f",
        "The selected retry succeeded.",
      ),
    },
  );
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
  await expect(page.locator(".toast.error")).toBeVisible();
  assert.equal(report.requests.length, 1);
  assert.equal(report.requests[0].selected, undefined);
  assert.equal(report.requests[0].generationFeedback, undefined);
  await expect(page.locator(".toast.error")).toContainText(
    "Your last working scene is safe.",
  );
  await page.screenshot({ path: `${output}/desktop-initial-recovery.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/android-initial-recovery.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Show objects", exact: true }).click();
  await expect(page.locator(".object-list button")).toHaveCount(0);
  await page.getByRole("button", { name: "Show objects", exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(report.requests.length, 1);
  report.checks.initialFailureRestored = {
    terminal: "clean-eof-without-commit",
    provisionalReservationDiscarded: true,
    noAutomaticRetry: true,
  };
  await page.getByRole("button", { name: "Try again", exact: true }).click();
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
  assert.equal(report.requests[1].prompt, report.requests[0].prompt);

  // No object was selected for this failed edit. Selecting another object
  // before retry must not change the original unselected request scope.
  await submitEdit(page, "Tint the tree blue");
  await expect(page.locator(".toast.error")).toBeVisible();
  const firstFailed = await getProject(page);
  assert.equal(report.requests[2].selected, undefined);
  assert.equal(report.requests[2].generationFeedback, undefined);
  assert.equal(firstFailed.entities.length, 2);
  assert.equal(
    firstFailed.entities.find((entity) => entity.id === treeId)?.color,
    tree.color,
  );
  assert.deepEqual(
    firstFailed.entities.find((entity) => entity.id === unrelatedId),
    originalUnrelated,
  );
  await page.screenshot({ path: `${output}/desktop-edit-recovery.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/android-edit-recovery.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await selectObject(page, "Unrelated rock");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await waitForProject(
    page,
    (project) =>
      project.entities.find((entity) => entity.id === treeId)?.color ===
        "#8ac6dd" && project.entities.length === 2,
  );
  assert.equal(report.requests[3].selected, undefined);
  assert.equal(report.requests[3].prompt, report.requests[2].prompt);
  assert.deepEqual(report.requests[3].generationFeedback, {
    version: 1,
    projectId: report.requests[2].projectId,
    code: "INVALID_SCENE_UPDATE",
    finishReason: "stop",
    issues: [
      {
        code: "invalid_type",
        path: ["geometry", "job", "recipe", "nodes", 2],
        reason: "unreachable_recipe_node",
      },
    ],
  });
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
    projectScopedFeedbackForwarded: true,
  };

  await selectObject(page, "Friendly tree");
  await submitEdit(page, "Make the selected tree amber");
  await expect(page.locator(".toast.error")).toBeVisible();
  const dismissed = await getProject(page);
  assert.equal(report.requests[4].selected, treeId);
  assert.equal(report.requests[4].generationFeedback, undefined);
  assert.equal(
    dismissed.entities.find((entity) => entity.id === treeId)?.color,
    "#8ac6dd",
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
  assert.equal(report.requests.length, 5);
  report.checks.dismissal = {
    requestCountAfterDismiss: report.requests.length,
    ordinaryPromptDidNotReuseFeedback: true,
  };

  await submitEdit(page, "Make the selected tree violet");
  await expect(page.locator(".toast.error")).toBeVisible();
  const latestCheckpoint = await getProject(page);
  assert.equal(report.requests[5].selected, treeId);
  assert.equal(report.requests[5].generationFeedback, undefined);
  assert.equal(
    latestCheckpoint.entities.find((entity) => entity.id === treeId)?.color,
    "#8ac6dd",
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
    "#8ac6dd",
  );
  assert.deepEqual(
    restored.entities.find((entity) => entity.id === unrelatedId),
    originalUnrelated,
  );
  assert.equal(report.requests.length, 6);
  report.checks.lastWorkingPreservedLatestIncrement = {
    treeColor: restored.entities.find((entity) => entity.id === treeId)?.color,
    unrelatedPreserved: true,
    requestCountAfterRestore: report.requests.length,
  };

  await submitEdit(page, "Make the selected tree green");
  await expect(page.locator(".toast.error")).toBeVisible();
  assert.equal(report.requests[6].selected, treeId);
  assert.equal(report.requests[6].generationFeedback, undefined);
  await selectObject(page, "Unrelated rock");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await waitForProject(
    page,
    (project) =>
      project.entities.find((entity) => entity.id === treeId)?.color ===
        "#a2d07f" && project.entities.length === 2,
  );
  assert.equal(report.requests[7].selected, treeId);
  assert.equal(report.requests[7].prompt, report.requests[6].prompt);
  assert.deepEqual(report.requests[7].generationFeedback, {
    version: 1,
    projectId: report.requests[6].projectId,
    code: "INVALID_SCENE_UPDATE",
    finishReason: "stop",
    issues: [
      {
        code: "invalid_type",
        path: ["geometry", "job", "recipe", "nodes", 2],
        reason: "unreachable_recipe_node",
      },
    ],
  });
  assert.deepEqual(
    (await getProject(page)).entities.find(
      (entity) => entity.id === unrelatedId,
    ),
    originalUnrelated,
  );
  await expect(page.locator(".toast.error")).toHaveCount(0);
  await page.waitForTimeout(350);
  assert.equal(report.requests.length, 8);
  assert.deepEqual(report.unexpectedApi, []);
  assert.deepEqual(report.blocked, []);
  assert.deepEqual(report.pageErrors, []);
  report.checks.selectedRetryPreserved = {
    failedRequestSelected: treeId,
    retryRequestSelected: treeId,
    changedSelectionBeforeRetry: unrelatedId,
    noAutomaticExtraRequest: true,
    projectScopedFeedbackForwarded: true,
  };
  report.checks.interceptedGenerationRequests = {
    fixtureRequests: report.requests.length,
    liveInferenceCalls: 0,
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
