#!/usr/bin/env node
// Deterministic modeling-feedback acceptance with the real editor and worker.
// The fixture owns only /api/generate; no provider or database traffic is used.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const url = process.env.TEST_URL ?? "http://127.0.0.1:3077";
const origin = new URL(url).origin;
const output = process.argv[2];
if (!output) throw Error("Provide a new evidence directory.");
await mkdir(output, { recursive: false });

const targetId = "feedback-target";
const unrelatedId = "feedback-unrelated";

const originalRecipe = {
  version: 1,
  revision: 0,
  output: "original",
  nodes: [{ id: "original", kind: "box", size: [2, 2, 2] }],
};

const rejectedRecipe = {
  version: 1,
  revision: 1,
  output: "overlap",
  nodes: [
    { id: "base", kind: "box", size: [2, 2, 2] },
    { id: "piece", kind: "box", size: [1, 1, 1] },
    {
      id: "placed",
      kind: "transform",
      input: "piece",
      position: [0.5, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    { id: "overlap", kind: "compose", inputs: ["base", "placed"] },
  ],
};

const correctedRecipe = {
  version: 1,
  revision: 2,
  output: "union",
  nodes: [
    { id: "base", kind: "box", size: [2, 2, 2] },
    { id: "piece", kind: "box", size: [1, 1, 1] },
    {
      id: "placed",
      kind: "transform",
      input: "piece",
      position: [0.5, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    {
      id: "union",
      kind: "boolean",
      operation: "union",
      operands: ["base", "placed"],
    },
  ],
};

const generated = (recipe) => ({
  kind: "generated",
  detail: "refined",
  job: { backend: "browser-manifold", recipe },
});

const createCommands = [
  {
    type: "reserve_entity",
    entity: {
      id: targetId,
      label: "Feedback sculpture",
      position: [-1.8, 1, 0],
      scale: [1, 1, 1],
      color: "#e4c79b",
      assetPolicy: "new-only",
      stage: "seed",
    },
  },
  { type: "set_geometry", id: targetId, geometry: generated(originalRecipe) },
  {
    type: "reserve_entity",
    entity: {
      id: unrelatedId,
      label: "Unrelated sculpture",
      position: [2.2, 0.75, 0],
      scale: [1, 1, 1],
      color: "#9bc7e4",
      assetPolicy: "new-only",
      stage: "seed",
    },
  },
  {
    type: "set_geometry",
    id: unrelatedId,
    geometry: generated({
      version: 1,
      revision: 0,
      output: "unrelated",
      nodes: [
        {
          id: "unrelated",
          kind: "cylinder",
          radius: 0.6,
          depth: 1.5,
          axis: "y",
          segments: 24,
        },
      ],
    }),
  },
  { type: "commit_revision", message: "Original fixture sculptures created." },
];

const invalidCommands = [
  { type: "set_geometry", id: targetId, geometry: generated(rejectedRecipe) },
  { type: "commit_revision", message: "Invalid overlap fixture rejected." },
];

const correctedCommands = [
  { type: "set_geometry", id: targetId, geometry: generated(correctedRecipe) },
  { type: "commit_revision", message: "The overlapping parts were unioned." },
];

const followupCommands = [
  { type: "commit_revision", message: "The repaired sculpture remains ready." },
];

const report = {
  mode: "fixture-modeling-feedback-real-editor-worker",
  source: "33148de",
  sourceProvenance:
    "Application feedback changes under test were committed at 33148de; this run used the production build from checkout HEAD 54c09ec.",
  fixture: {
    transport: "intercepted /api/generate NDJSON",
    liveInference: false,
    serverFundedCalls: false,
    databaseMutations: false,
    geometryWorker: "/modeling/worker.js + /modeling/manifold.wasm",
    targetId,
    unrelatedId,
    rejectedNodeId: "overlap",
    correctedOperation: "boolean union",
  },
  requests: [],
  api: [],
  blocked: [],
  unexpectedApi: [],
  pageErrors: [],
  checks: {},
};

function summarizeRequest(request) {
  return {
    prompt: request.prompt,
    selected: request.selected,
    browserModeling: request.browserModeling,
    localModeling: request.localModeling,
    projectId: request.project?.id,
    projectRevision: request.project?.revision,
    entityIds: request.project?.entities?.map((entity) => entity.id),
    modelingFeedback: request.modelingFeedback,
  };
}

function stream(commands) {
  return commands.map((command) => JSON.stringify(command)).join("\n") + "\n";
}

async function storedModel(page, hash) {
  return page.evaluate(async (modelHash) => {
    const value = await new Promise((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onerror = () =>
        reject(request.error || Error("IndexedDB open failed"));
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("keyval")) {
          db.close();
          resolve(undefined);
          return;
        }
        const getRequest = db
          .transaction("keyval", "readonly")
          .objectStore("keyval")
          .get(`orbsie-model:${modelHash}`);
        getRequest.onerror = () =>
          reject(getRequest.error || Error("IndexedDB read failed"));
        getRequest.onsuccess = () => {
          const record = getRequest.result;
          db.close();
          resolve(record);
        };
      };
    });
    if (!value || typeof value !== "object") return null;
    const record = value;
    const glb =
      record.glb instanceof Uint8Array
        ? record.glb
        : new Uint8Array(record.glb);
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", glb)),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return {
      sha256: record.metadata?.sha256,
      bytes: record.metadata?.bytes,
      actualSha256: digest,
      glbBytes: glb.byteLength,
      source: record.metadata?.source,
      kernelVersion: record.metadata?.kernelVersion,
    };
  }, hash);
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
      const requestBody = request.postDataJSON();
      const requestNumber = report.requests.length + 1;
      report.requests.push(summarizeRequest(requestBody));
      assert.equal(requestBody.localModeling, false);
      assert.equal(requestBody.browserModeling, true);
      assert.equal(requestBody.provider, "free");
      assert.equal(requestBody.key, "");
      assert.equal(requestBody.model, "");
      const commands =
        requestNumber === 1
          ? createCommands
          : requestNumber === 2
            ? invalidCommands
            : requestNumber === 3
              ? correctedCommands
              : followupCommands;
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
  const entry = new URL(url);
  entry.hash = `builder=${encodeURIComponent(JSON.stringify({ url: "http://127.0.0.1:9999", token: "a".repeat(43) }))}`;
  await page.goto(entry.href);
  await expect(page.locator("canvas")).toBeVisible();

  const saved = async (recipeRevision, entityId = targetId) => {
    let project;
    await expect
      .poll(
        async () => {
          project = (await storageSnapshot(page)).project;
          const entity = project?.entities.find(
            (candidate) => candidate.id === entityId,
          );
          return entity?.geometry?.job?.recipe?.revision;
        },
        { timeout: 45_000 },
      )
      .toBe(recipeRevision);
    return project;
  };

  await page
    .getByPlaceholder("What experience to build?")
    .fill("Build an original boolean sculpture");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await saved(0);
  await expect
    .poll(
      async () => {
        const project = (await storageSnapshot(page)).project;
        return project?.entities.find((entity) => entity.id === unrelatedId)
          ?.geometry?.job?.recipe?.revision;
      },
      { timeout: 45_000 },
    )
    .toBe(0);
  const first = (await storageSnapshot(page)).project;
  assert.equal(first.entities.length, 2);
  const firstTarget = first.entities.find((entity) => entity.id === targetId);
  const firstUnrelated = first.entities.find(
    (entity) => entity.id === unrelatedId,
  );
  assert(firstTarget && firstUnrelated);
  assert.equal(firstTarget.stage, "ready");
  assert.equal(firstTarget.assetPolicy, "new-only");
  assert.equal(firstTarget.geometry.model.source, "browser-manifold");
  assert.match(firstTarget.geometry.model.sha256, /^[a-f0-9]{64}$/);
  assert.equal(firstUnrelated.stage, "ready");
  assert.equal(firstUnrelated.geometry.model.source, "browser-manifold");
  assert.notEqual(
    firstTarget.geometry.model.sha256,
    firstUnrelated.geometry.model.sha256,
  );
  const initialTargetHash = firstTarget.geometry.model.sha256;
  const initialUnrelated = structuredClone(firstUnrelated);
  const initialStored = await storedModel(page, initialTargetHash);
  assert.equal(initialStored?.sha256, initialTargetHash);
  assert.equal(initialStored?.actualSha256, initialTargetHash);
  assert.equal(initialStored?.glbBytes, initialStored?.bytes);
  assert.equal(initialStored?.source, "browser-manifold");
  report.checks.initialReady = {
    projectId: first.id,
    revision: first.revision,
    targetHash: initialTargetHash,
    unrelatedHash: initialUnrelated.geometry.model.sha256,
  };
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${output}/created.png` });

  await page.getByRole("button", { name: "Show objects", exact: true }).click();
  await page
    .locator(".object-list button")
    .filter({ hasText: "Feedback sculpture" })
    .click();
  await page.locator("#prompt").fill("Make the sculpture more open");
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect(page.locator(".toast.error")).toBeVisible({ timeout: 45_000 });
  const invalidState = (await storageSnapshot(page)).project;
  assert.deepEqual(invalidState.entities, first.entities);
  assert.equal(
    invalidState.entities.find((entity) => entity.id === targetId)?.geometry
      .model.sha256,
    initialTargetHash,
  );
  assert.deepEqual(
    invalidState.entities.find((entity) => entity.id === unrelatedId),
    initialUnrelated,
  );
  const errorText = await page.locator(".toast.error").innerText();
  assert.match(errorText, /touching or overlapping/i);
  report.checks.invalidEditPreservedLastGood = {
    targetId: invalidState.entities.find((entity) => entity.id === targetId)
      ?.id,
    targetHash: invalidState.entities.find((entity) => entity.id === targetId)
      ?.geometry.model.sha256,
    error: errorText,
  };
  await page.screenshot({ path: `${output}/invalid-feedback.png` });

  await page
    .locator("#prompt")
    .fill("Fix the rejected overlap with a boolean union");
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  const correctedRequest = await expect
    .poll(() => report.requests[2], { timeout: 15_000 })
    .toBeTruthy()
    .then(() => report.requests[2]);
  assert.equal(correctedRequest.selected, targetId);
  assert.deepEqual(correctedRequest.modelingFeedback, {
    version: 1,
    projectId: first.id,
    entityId: targetId,
    backend: "browser-manifold",
    nodeId: "overlap",
    error:
      "[browser-modeling-kernel] node overlap contains touching or overlapping solids.",
    recipe: rejectedRecipe,
  });
  report.checks.boundedFeedbackCarriedIntoFix = {
    projectId: correctedRequest.modelingFeedback.projectId,
    entityId: correctedRequest.modelingFeedback.entityId,
    nodeId: correctedRequest.modelingFeedback.nodeId,
    recipeBytes: new TextEncoder().encode(
      JSON.stringify(correctedRequest.modelingFeedback.recipe),
    ).byteLength,
  };

  const corrected = await saved(2);
  const correctedTarget = corrected.entities.find(
    (entity) => entity.id === targetId,
  );
  const correctedUnrelated = corrected.entities.find(
    (entity) => entity.id === unrelatedId,
  );
  assert(correctedTarget && correctedUnrelated);
  assert.equal(correctedTarget.id, targetId);
  assert.equal(correctedTarget.stage, "ready");
  assert.equal(correctedTarget.geometry.job.backend, "browser-manifold");
  assert.equal(correctedTarget.geometry.job.recipe.output, "union");
  assert.equal(
    correctedTarget.geometry.job.recipe.nodes.find(
      (node) => node.id === "union",
    )?.operation,
    "union",
  );
  assert.notEqual(correctedTarget.geometry.model.sha256, initialTargetHash);
  assert.deepEqual(correctedUnrelated, initialUnrelated);
  const correctedStored = await storedModel(
    page,
    correctedTarget.geometry.model.sha256,
  );
  assert.equal(correctedStored?.sha256, correctedTarget.geometry.model.sha256);
  assert.equal(
    correctedStored?.actualSha256,
    correctedTarget.geometry.model.sha256,
  );
  assert.equal(correctedStored?.glbBytes, correctedStored?.bytes);
  await expect(page.locator(".toast.error")).toHaveCount(0);
  report.checks.correctedReady = {
    targetId: correctedTarget.id,
    beforeHash: initialTargetHash,
    afterHash: correctedTarget.geometry.model.sha256,
    recipeOutput: correctedTarget.geometry.job.recipe.output,
    unrelatedHash: correctedUnrelated.geometry.model.sha256,
  };

  await page
    .locator("#prompt")
    .fill("Confirm the repaired sculpture remains usable");
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  const followupRequest = await expect
    .poll(() => report.requests[3], { timeout: 15_000 })
    .toBeTruthy()
    .then(() => report.requests[3]);
  assert.equal(followupRequest.selected, targetId);
  assert.equal(followupRequest.modelingFeedback, undefined);
  await expect
    .poll(
      async () => {
        const project = (await storageSnapshot(page)).project;
        return project?.messages?.at(-1)?.text;
      },
      { timeout: 45_000 },
    )
    .toBe("The repaired sculpture remains ready.");
  const afterFollowup = (await storageSnapshot(page)).project;
  assert.deepEqual(afterFollowup.entities, corrected.entities);
  assert.equal(
    afterFollowup.entities.find((entity) => entity.id === targetId)?.geometry
      .model.sha256,
    correctedTarget.geometry.model.sha256,
  );
  assert.deepEqual(
    afterFollowup.entities.find((entity) => entity.id === unrelatedId),
    initialUnrelated,
  );
  await expect(page.locator(".toast.error")).toHaveCount(0);
  report.checks.successClearedErrorAndTransientFeedback = {
    followupRequestHadModelingFeedback: false,
    targetHashUnchanged: true,
    unrelatedHashUnchanged: true,
  };
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${output}/corrected.png` });

  assert.equal(report.requests.length, 4);
  assert.deepEqual(report.unexpectedApi, []);
  assert.deepEqual(report.blocked, []);
  assert.deepEqual(report.pageErrors, []);
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
