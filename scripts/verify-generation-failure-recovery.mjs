#!/usr/bin/env node
// Deterministic editor acceptance for explicit generation recovery actions.
// The fixture owns only /api/generate; no provider or database traffic is used.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const url = process.env.TEST_URL ?? "http://127.0.0.1:3022";
const origin = new URL(url).origin;
const promptMaskStyle = `
  #prompt,
  .workspace-heading h2,
  .chat-messages .message.user,
  .chat-messages .message.assistant:not(.authoring-activity-message) {
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
    text-shadow: none !important;
    caret-color: transparent !important;
  }
`;
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
const providerErrorFailure = {
  failure: "provider-error",
  error: "The provider could not complete this generation.",
  code: "PROVIDER_STREAM_ERROR",
  diagnostic: {
    operation: 1,
    finishReason: "error",
    issues: [],
    providerStatus: null,
  },
};
const outputLimitFailure = {
  failure: "output-limit",
  error: "The model reached its output limit before finishing.",
  code: "TRUNCATED_SCENE_STREAM",
  diagnostic: { operation: 1, finishReason: "length", issues: [] },
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
      "provider-error NDJSON terminal after a provisional operation",
      "output-limit NDJSON terminal after a provisional operation",
      "mid-record EOF after a provisional operation",
      "late old command and commit after Stop and a newer saved edit",
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
const requestPrompts = [];
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
async function latestGenerationTerminal(page) {
  return page.evaluate(() => {
    try {
      const saved = localStorage.getItem("orbsie-generation-diagnostics-v1");
      const entries = JSON.parse(saved ?? "{}").entries;
      return Array.isArray(entries)
        ? [...entries].reverse().find((entry) => entry.kind === "generation")
            ?.terminal
        : undefined;
    } catch {
      return undefined;
    }
  });
}
async function generationDiagnostics(page) {
  return page.evaluate(() => {
    try {
      const saved = localStorage.getItem("orbsie-generation-diagnostics-v1");
      const entries = JSON.parse(saved ?? "{}").entries;
      return Array.isArray(entries)
        ? entries.filter((entry) => entry.kind === "generation")
        : [];
    } catch {
      return [];
    }
  });
}
async function savedProjectAndHistory(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const read = (key) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction("keyval", "readonly");
        const request = transaction.objectStore("keyval").get(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    const [library, histories, draft] = await Promise.all([
      read("orbsie-library"),
      read("orbsie-history"),
      read("orbsie-draft"),
    ]);
    database.close();
    const projectId = draft?.project?.id;
    return {
      project: library?.[projectId] ?? draft?.project,
      history: histories?.[projectId],
      draft: draft
        ? {
            project: draft.project,
            history: draft.history,
            future: draft.future,
          }
        : undefined,
    };
  });
}
async function selectObject(page, label) {
  await page.getByRole("button", { name: "Show objects", exact: true }).click();
  await page.locator(".object-list button").filter({ hasText: label }).click();
}
async function submitEdit(page, text) {
  await page.locator("#prompt").fill(text);
  await page.getByRole("button", { name: "Change this", exact: true }).click();
}

async function exerciseTerminalRecovery({
  name,
  prompt,
  failureRequest,
  successRequest,
  failureCopy,
  terminalClass,
  retryFeedback,
  successColor,
}) {
  let mobileViewportEvidence;
  await selectObject(page, "Friendly tree");
  const before = await getProject(page);
  const beforeIds = before.entities.map((entity) => entity.id);
  const unrelatedBefore = structuredClone(
    before.entities.find((entity) => entity.id === unrelatedId),
  );

  await submitEdit(page, prompt);
  await expect(page.locator(".toast.error")).toContainText(failureCopy);
  await expect(
    page.getByRole("button", { name: "Try again", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Try again", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Use last working", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use last working", exact: true }),
  ).toBeEnabled();

  const failed = await getProject(page);
  assert.deepEqual(failed, before);
  const terminal = await latestGenerationTerminal(page);
  assert.equal(terminal?.reason, terminalClass.reason);
  assert.equal(terminal?.failureCode, terminalClass.failureCode);
  assert.equal(terminal?.finishReason, terminalClass.finishReason);
  assert.equal(report.requests.length, failureRequest);
  assert.equal(requestPrompts[failureRequest - 1], prompt);
  assert.equal(report.requests[failureRequest - 1].selected, treeId);

  if (name === "outputLimitRecovery") {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".toast.error")).toBeVisible();
    const buttons = [
      page.getByRole("button", { name: "Try again", exact: true }),
      page.getByRole("button", { name: "Use last working", exact: true }),
    ];
    const boxes = [];
    for (const button of buttons) {
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      boxes.push(await button.boundingBox());
    }
    const dimensions = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    assert.ok(
      Math.max(dimensions.documentWidth, dimensions.bodyWidth) <=
        dimensions.width,
      "output-limit recovery view must not overflow horizontally",
    );
    assert.ok(
      boxes.every(
        (box) =>
          box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= dimensions.width &&
          box.y + box.height <= dimensions.height,
      ),
      "output-limit recovery buttons must stay inside the mobile viewport",
    );
    await page.locator(".toast.error").screenshot({
      path: `${output}/android-output-limit-recovery.png`,
    });
    mobileViewportEvidence = {
      width: dimensions.width,
      height: dimensions.height,
      horizontalOverflow: false,
      recoveryButtonsVisibleAndReachable: true,
      screenshot: "android-output-limit-recovery.png",
    };
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(buttons[0]).toBeVisible();
  }

  await page.waitForTimeout(350);
  assert.equal(report.requests.length, failureRequest);

  await page.getByRole("button", { name: "Try again", exact: true }).click();
  const retried = await waitForProject(
    page,
    (project) =>
      project.entities.find((entity) => entity.id === treeId)?.color ===
        successColor && project.entities.length === beforeIds.length,
  );
  assert.equal(report.requests.length, successRequest);
  assert.equal(requestPrompts[successRequest - 1], prompt);
  assert.equal(report.requests[successRequest - 1].selected, treeId);
  if (retryFeedback) {
    assert.equal(
      report.requests[successRequest - 1].generationFeedback?.code,
      retryFeedback.code,
    );
    assert.equal(
      report.requests[successRequest - 1].generationFeedback?.finishReason,
      retryFeedback.finishReason,
    );
  }
  assert.deepEqual(
    retried.entities.map((entity) => entity.id),
    beforeIds,
  );
  assert.deepEqual(
    retried.entities.find((entity) => entity.id === unrelatedId),
    unrelatedBefore,
  );
  await page.waitForTimeout(350);
  assert.equal(report.requests.length, successRequest);

  report.checks[name] = {
    terminalClass: terminal,
    failureCopy,
    savedBaselineUnchanged: true,
    tryAgainAvailable: true,
    useLastWorkingAvailable: true,
    noAutomaticRetry: true,
    explicitRetryRequest: successRequest,
    promptRestoredInMemory: true,
    stableEntityIds: true,
    unrelatedEntityPreserved: true,
    ...(mobileViewportEvidence
      ? { mobileViewport: mobileViewportEvidence }
      : {}),
  };
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
      requestPrompts.push(body.prompt);
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
        else if (number === 9)
          commands = [
            { type: "set_material", id: fixture.treeId, color: "#d84f5f" },
            fixture.providerErrorFailure,
          ];
        else if (number === 10) commands = fixture.successProviderErrorRecovery;
        else if (number === 11)
          commands = [
            { type: "set_material", id: fixture.treeId, color: "#d6aa42" },
            fixture.outputLimitFailure,
          ];
        else if (number === 12) commands = fixture.successOutputLimitRecovery;
        else if (number === 13) {
          const encoder = new TextEncoder();
          const bytes = encoder.encode(
            JSON.stringify({
              type: "set_material",
              id: fixture.treeId,
              color: "#7745bd",
            }) +
              "\n" +
              '{"type":"set_material","id":"tree-0","color":"#',
          );
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(bytes);
                controller.close();
              },
            }),
            { headers: { "Content-Type": "application/x-ndjson" } },
          );
        } else if (number === 14) commands = fixture.successMidRecordRecovery;
        else if (number === 15) {
          const encoder = new TextEncoder();
          const first = encoder.encode(
            JSON.stringify({
              type: "set_material",
              id: fixture.treeId,
              color: "#b450ce",
            }) + "\n",
          );
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(first);
                window.__orbsieLateStreamController = controller;
              },
              cancel() {
                window.__orbsieLateStreamCancelled = true;
              },
            }),
            { headers: { "Content-Type": "application/x-ndjson" } },
          );
        } else if (number === 16) commands = fixture.successLateStreamRecovery;
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
      providerErrorFailure,
      outputLimitFailure,
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
      successProviderErrorRecovery: successCommands(
        "#c57bd7",
        "The provider-error retry succeeded.",
      ),
      successOutputLimitRecovery: successCommands(
        "#71bfd1",
        "The output-limit retry succeeded.",
      ),
      successMidRecordRecovery: successCommands(
        "#e08b55",
        "The interrupted-stream retry succeeded.",
      ),
      successLateStreamRecovery: successCommands(
        "#449fc1",
        "The newer edit succeeded after stopping the earlier edit.",
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
  page.on("pageerror", (error) => report.pageErrors.push(error.name));
  page.setDefaultTimeout(30_000);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-renderer-availability=ready]")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("canvas")).toBeVisible();

  await page
    .getByPlaceholder("What experience to build?")
    .fill("Build the recovery fixture");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.locator(".toast.error")).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  assert.equal(report.requests.length, 1);
  assert.equal(report.requests[0].selected, undefined);
  assert.equal(report.requests[0].generationFeedback, undefined);
  await expect(page.locator(".toast.error")).toContainText(
    "Your last working scene is safe.",
  );
  await page.screenshot({
    path: `${output}/desktop-initial-recovery.png`,
    style: promptMaskStyle,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${output}/android-initial-recovery.png`,
    style: promptMaskStyle,
  });
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
  assert.equal(requestPrompts[1], requestPrompts[0]);

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
  await page.screenshot({
    path: `${output}/desktop-edit-recovery.png`,
    style: promptMaskStyle,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${output}/android-edit-recovery.png`,
    style: promptMaskStyle,
  });
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
  assert.equal(requestPrompts[3], requestPrompts[2]);
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
  assert.equal(requestPrompts[7], requestPrompts[6]);
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
  await exerciseTerminalRecovery({
    name: "providerErrorRecovery",
    prompt: "Polish the selected tree",
    failureRequest: 9,
    successRequest: 10,
    failureCopy:
      "Your AI provider could not complete this request. Check its connection or try again.",
    terminalClass: {
      reason: "provider-error",
      failureCode: "provider-rejected",
      finishReason: "error",
    },
    retryFeedback: { code: "PROVIDER_STREAM_ERROR", finishReason: "error" },
    successColor: "#c57bd7",
  });
  await exerciseTerminalRecovery({
    name: "outputLimitRecovery",
    prompt: "Give the selected tree a brighter finish",
    failureRequest: 11,
    successRequest: 12,
    failureCopy:
      "The model reached its output limit before finishing. Your last working scene is safe.",
    terminalClass: {
      reason: "output-limit",
      failureCode: "output-limit",
      finishReason: "length",
    },
    retryFeedback: { code: "TRUNCATED_SCENE_STREAM", finishReason: "length" },
    successColor: "#71bfd1",
  });
  await exerciseTerminalRecovery({
    name: "midRecordEOFRecovery",
    prompt: "Make the selected tree warm colored",
    failureRequest: 13,
    successRequest: 14,
    failureCopy:
      "The model returned a scene change that could not be applied. Your last working scene is safe.",
    terminalClass: {
      reason: "parser-failure",
      failureCode: "parser",
    },
    successColor: "#e08b55",
  });
  await selectObject(page, "Friendly tree");
  const beforeLateStream = await getProject(page);
  const beforeLateUnrelated = structuredClone(
    beforeLateStream.entities.find((entity) => entity.id === unrelatedId),
  );
  await submitEdit(page, "Start an edit that I will stop");
  await expect.poll(() => report.requests.length).toBe(15);
  assert.equal(report.requests[14].selected, treeId);
  await expect
    .poll(async () => {
      const entries = await generationDiagnostics(page);
      return entries.at(-1)?.commandCounts?.set_material ?? 0;
    })
    .toBe(1);
  const stoppedRun = (await generationDiagnostics(page)).at(-1);
  assert.ok(stoppedRun?.runId);
  assert.equal(stoppedRun.terminal, undefined);
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Change this", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".toast").last()).toContainText(
    "Stopped. Finished objects are safe.",
  );
  await expect(
    page.getByRole("button", { name: "Try again", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Use last working", exact: true }),
  ).toHaveCount(0);
  const stoppedDiagnostics = await generationDiagnostics(page);
  const stoppedEntry = stoppedDiagnostics.find(
    (entry) => entry.runId === stoppedRun.runId,
  );
  assert.deepEqual(stoppedEntry?.terminal, {
    reason: "client-abort",
    failureCode: "cancelled",
    abortSource: "client",
  });

  await submitEdit(page, "Make the selected tree blue-green");
  const newerProject = await waitForProject(
    page,
    (project) =>
      project.entities.find((entity) => entity.id === treeId)?.color ===
      "#449fc1",
  );
  assert.equal(report.requests.length, 16);
  assert.equal(report.requests[15].selected, treeId);
  assert.ok(newerProject.revision > beforeLateStream.revision);
  await expect(page.locator(".toast.error")).toHaveCount(0);
  await expect(page.locator(".saved")).toContainText("Saved on this device");
  await expect(page.locator(".selection-chip")).toContainText("Friendly tree");
  const beforeLateBytes = await getProject(page);
  const beforeLatePersistence = await savedProjectAndHistory(page);
  assert.equal(beforeLateBytes.revision, newerProject.revision);
  assert.deepEqual(
    beforeLateBytes.entities.find((entity) => entity.id === unrelatedId),
    beforeLateUnrelated,
  );
  assert.deepEqual(
    beforeLatePersistence.history?.history?.at(-1),
    beforeLateStream,
  );
  assert.deepEqual(beforeLatePersistence.history?.future, []);

  await page.evaluate(() => {
    const controller = window.__orbsieLateStreamController;
    if (!controller) throw new Error("The stopped stream was not held open.");
    const encoder = new TextEncoder();
    controller.enqueue(
      encoder.encode(
        JSON.stringify({
          type: "set_material",
          id: "tree-0",
          color: "#f04a69",
        }) +
          "\n" +
          JSON.stringify({
            type: "commit_revision",
            message: "Late old commit",
          }) +
          "\n",
      ),
    );
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.__orbsieLateStreamCancelled === true),
    )
    .toBe(true);
  await page.waitForTimeout(350);
  assert.equal(report.requests.length, 16);
  assert.deepEqual(await getProject(page), beforeLateBytes);
  assert.deepEqual(await savedProjectAndHistory(page), beforeLatePersistence);
  await expect(page.locator(".selection-chip")).toContainText("Friendly tree");
  const afterLateDiagnostics = await generationDiagnostics(page);
  const lateRunAfterBytes = afterLateDiagnostics.find(
    (entry) => entry.runId === stoppedRun.runId,
  );
  assert.deepEqual(lateRunAfterBytes, stoppedEntry);
  assert.equal(afterLateDiagnostics.at(-1)?.terminal?.reason, "completed");
  assert.deepEqual(report.unexpectedApi, []);
  assert.deepEqual(report.blocked, []);
  report.checks.lateAbandonedStream = {
    stoppedTerminal: stoppedEntry.terminal,
    newerCommittedRevision: beforeLateBytes.revision,
    savedProjectUnchangedAfterLateBytes: true,
    undoBaselineUnchangedAfterLateBytes: true,
    selectedIdPreserved: treeId,
    unrelatedEntityPreserved: true,
    noAutomaticExtraGenerationRequest: true,
    noProviderCalls: true,
  };
  report.checks.interceptedGenerationRequests = {
    fixtureRequests: report.requests.length,
    liveInferenceCalls: 0,
  };
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error =
    error instanceof Error
      ? `${error.name}: fixture assertion failed`
      : "Fixture assertion failed";
  if (page) {
    report.transientErrors = await page
      .evaluate(() => window.__orbsieFixtureErrors ?? [])
      .catch(() => []);
  }
  throw error;
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
