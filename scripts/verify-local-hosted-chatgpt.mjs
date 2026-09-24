#!/usr/bin/env node
// Opt-in, two-call hosted ChatGPT check against the isolated local app.
import assert from "node:assert/strict";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const MODEL = "gpt-6-luna";
const SERVICE_TIER = "default";
const BASE_URL =
  process.env.ORBSIE_LOCAL_CHATGPT_URL ?? "http://localhost:3159";
const STORAGE_STATE = process.env.ORBSIE_CHATGPT_DEVICE_STORAGE_STATE;
const INITIAL_PROMPT = "Build a gingerbread house";
const EDIT_PROMPT =
  "Add blue shutters to this gingerbread house; keep its shape, colors, and all other objects unchanged.";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const INFERENCE_PATHS = new Set([
  "/api/chatgpt/generate",
  "/api/chatgpt/review",
  "/api/generate",
  "/api/generate/review",
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

class HarnessError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function require(condition, code) {
  if (!condition) throw new HarnessError(code);
}

function parseLoopbackOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HarnessError("invalid-local-url");
  }
  require(url.protocol === "http:" &&
    LOOPBACK.has(url.hostname) &&
    url.port === "3159" &&
    url.pathname === "/" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash, "loopback-port-3159-required");
  return url.origin;
}

function safeRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeId(value) {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function safeEvidenceSlug(value) {
  require(/^[a-z0-9][a-z0-9-]{0,63}$/.test(
    value ?? "",
  ), "invalid-evidence-slug");
  return value;
}

async function requireConfiguration(args) {
  // Explicit opt-in is checked before touching the private browser state.
  require(process.env.ORBSIE_LOCAL_CHATGPT_E2E === "1", "live-opt-in-required");
  require(args.length === 1, "usage-requires-one-evidence-slug");
  const slug = safeEvidenceSlug(args[0]);
  const origin = parseLoopbackOrigin(BASE_URL);
  require(isAbsolute(STORAGE_STATE ?? ""), "private-storage-state-required");
  const statePath = resolve(STORAGE_STATE);
  const fromRoot = relative(ROOT, statePath);
  require(fromRoot === ".." ||
    fromRoot.startsWith(
      `..${sep}`,
    ), "private-storage-state-must-be-outside-repository");
  let info;
  try {
    info = await lstat(statePath);
  } catch {
    throw new HarnessError("private-storage-state-unavailable");
  }
  require(info.isFile() &&
    !info.isSymbolicLink(), "private-storage-state-not-regular-file");
  require((info.mode & 0o077) ===
    0, "private-storage-state-permissions-too-open");
  require(info.size > 0 &&
    info.size <= 2 * 1024 * 1024, "private-storage-state-size-invalid");
  const evidenceDirectory = resolve(
    ROOT,
    "docs/evidence/local-hosted-chatgpt",
    slug,
  );
  require(!relative(ROOT, evidenceDirectory).startsWith(
    `..${sep}`,
  ), "evidence-directory-outside-repository");
  return { origin, statePath, evidenceDirectory };
}

async function readDraft(page) {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === "keyval-store"))
      return null;
    const opened = indexedDB.open("keyval-store");
    const db = await new Promise((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
      opened.onupgradeneeded = () => opened.transaction.abort();
    });
    if (!db.objectStoreNames.contains("keyval")) {
      db.close();
      return null;
    }
    const value = await new Promise((resolve, reject) => {
      const request = db
        .transaction("keyval")
        .objectStore("keyval")
        .get("orbsie-draft");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const project = value?.project;
    if (!project || typeof project.id !== "string") return null;
    return {
      id: project.id,
      revision: project.revision,
      entities: Array.isArray(project.entities)
        ? project.entities.map((entity) => ({
            id: entity.id,
            label: entity.label,
            stage: entity.stage,
          }))
        : [],
    };
  });
}

async function readDiagnostics(page) {
  return page.evaluate(() => {
    try {
      const parsed = JSON.parse(
        localStorage.getItem("orbsie-generation-diagnostics-v1") ?? "{}",
      );
      return Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
      return [];
    }
  });
}

async function main() {
  if (process.argv[2] === "--preflight") {
    assert.equal(parseLoopbackOrigin(BASE_URL), "http://localhost:3159");
    assert.equal(
      safeEvidenceSlug("static-preflight-20260924"),
      "static-preflight-20260924",
    );
    console.log(
      JSON.stringify({
        preflight: "passed",
        model: MODEL,
        serviceTier: SERVICE_TIER,
      }),
    );
    return;
  }

  const config = await requireConfiguration(process.argv.slice(2));
  await mkdir(dirname(config.evidenceDirectory), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(config.evidenceDirectory, { mode: 0o700 });
  const report = {
    scope:
      "Interim local hosted ChatGPT device-code connector check; not direct OAuth acceptance.",
    status: "running",
    stage: "startup",
    model: MODEL,
    serviceTier: SERVICE_TIER,
    maxGenerationCalls: 2,
    generationCalls: [],
    savedRevisions: [],
    browserErrors: [],
    externalOrigins: [],
  };
  let browser;
  let context;
  let page;
  let stage = "startup";
  let routeViolation;
  const externalOrigins = new Set();
  const inferenceRequests = [];
  const inferenceResponses = [];
  const pageErrors = [];
  let externalRequestCount = 0;

  try {
    browser = await chromium.launch({
      args: [
        "--no-sandbox",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    });
    context = await browser.newContext({
      storageState: config.statePath,
      viewport: { width: 1280, height: 900 },
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== config.origin) {
        externalOrigins.add(url.origin);
        externalRequestCount++;
        await route.abort();
        return;
      }
      if (!INFERENCE_PATHS.has(url.pathname)) {
        await route.continue();
        return;
      }
      if (
        url.pathname !== "/api/chatgpt/generate" ||
        request.method() !== "POST"
      ) {
        routeViolation = "unexpected-inference-route-blocked";
        await route.abort();
        return;
      }
      let body;
      try {
        body = request.postDataJSON();
      } catch {
        routeViolation = "invalid-inference-payload-blocked";
        await route.abort();
        return;
      }
      const number = inferenceRequests.length + 1;
      const expectedPrompt = number === 1 ? INITIAL_PROMPT : EDIT_PROMPT;
      const requestHeaders = await request.allHeaders();
      const clientRunId = safeId(requestHeaders["x-orbsie-client-run-id"]);
      const projectId = safeId(body?.project?.id);
      const problem =
        number > 2
          ? "generation-call-budget-exceeded"
          : body?.model !== MODEL
            ? "unexpected-model-blocked"
            : !["low", "medium", "high"].includes(body?.effort)
              ? "unexpected-reasoning-effort-blocked"
              : body?.prompt !== expectedPrompt
                ? "unexpected-prompt-blocked"
                : body?.authoringReview !== false
                  ? "extra-review-call-risk-blocked"
                  : body?.localModeling !== false
                    ? "unexpected-modeling-mode-blocked"
                    : !clientRunId || !projectId
                      ? "missing-request-identifiers-blocked"
                      : body?.serviceTier !== undefined ||
                          body?.tier !== undefined
                        ? "explicit-nondefault-tier-field-blocked"
                        : number === 1 &&
                            (!Array.isArray(body?.project?.entities) ||
                              body.project.entities.length !== 0)
                          ? "existing-scene-initial-call-blocked"
                          : number === 2 &&
                              (!safeId(body?.selected) ||
                                body.selected !== report.targetEntityId ||
                                projectId !== report.projectId ||
                                safeRevision(body?.project?.revision) !==
                                  report.savedRevisions[0]?.revision)
                            ? "targeted-edit-selection-mismatch-blocked"
                            : null;
      if (problem) {
        routeViolation = problem;
        await route.abort();
        return;
      }
      inferenceRequests.push({
        step: number === 1 ? "initial" : "targeted-edit",
        clientRunId,
        projectId,
        promptMatched: true,
        model: body.model,
        effort: body.effort,
        initialRevision: safeRevision(body.project.revision),
      });
      await route.continue();
    });

    page = await context.newPage();
    page.on("pageerror", () => pageErrors.push({ type: "pageerror" }));
    page.on("console", (message) => {
      if (message.type() === "error")
        report.browserErrors.push({ type: "console" });
    });
    page.on("response", async (response) => {
      const url = new URL(response.url());
      if (
        url.origin !== config.origin ||
        url.pathname !== "/api/chatgpt/generate"
      )
        return;
      const headers = await response.allHeaders().catch(() => ({}));
      const requestHeaders = await response
        .request()
        .allHeaders()
        .catch(() => ({}));
      inferenceResponses.push({
        clientRunId: safeId(requestHeaders["x-orbsie-client-run-id"]),
        requestId: safeId(headers["x-orbsie-request-id"]),
        status: response.status(),
      });
    });

    stage = "local-app";
    const response = await page.goto(config.origin, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    assert.equal(response?.status(), 200, "local app must return HTTP 200");
    await expect(page.locator("canvas").first()).toBeVisible({
      timeout: 30000,
    });
    const existing = await readDraft(page);
    require(existing === null, "saved-draft-present-refusing-to-overwrite");
    await expect(
      page.getByRole("button", { name: "Continue your saved world" }),
    ).toHaveCount(0);

    stage = "connection-preflight";
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByText(/^ChatGPT · gpt-6-luna · (low|medium|high) reasoning$/),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByText("Signed in to ChatGPT.", { exact: false }),
    ).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "Close dialog" }).click();

    stage = "initial-generation";
    const firstResponse = page.waitForResponse(
      (item) => new URL(item.url()).pathname === "/api/chatgpt/generate",
      { timeout: 180000 },
    );
    await page.locator("#prompt").fill(INITIAL_PROMPT);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const firstStatus = await firstResponse;
    assert.equal(
      firstStatus.status(),
      200,
      "initial hosted request must succeed",
    );
    await expect
      .poll(() => inferenceResponses.length, { timeout: 5000 })
      .toBe(1);
    await expect(
      page.getByRole("button", { name: "Change this", exact: true }),
    ).toBeEnabled({ timeout: 180000 });
    await expect
      .poll(() => readDraft(page), { timeout: 15000 })
      .toMatchObject({
        id: inferenceRequests[0]?.projectId,
      });
    const savedInitial = await readDraft(page);
    assert.ok(savedInitial && safeRevision(savedInitial.revision) !== null);
    const house = savedInitial.entities.find(
      (entity) =>
        typeof entity.label === "string" &&
        /gingerbread|house/i.test(entity.label) &&
        entity.stage === "ready",
    );
    assert.ok(
      house && safeId(house.id),
      "the first revision must save a ready gingerbread-house target",
    );
    report.projectId = savedInitial.id;
    report.targetEntityId = house.id;
    report.savedRevisions.push({
      step: "initial",
      revision: savedInitial.revision,
    });

    stage = "initial-reload-recovery";
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await expect(page.locator("canvas").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByRole("button", { name: "Continue your saved world" }),
    ).toBeVisible({ timeout: 15000 });
    await page
      .getByRole("button", { name: "Continue your saved world" })
      .click();
    await expect(
      page.getByRole("button", { name: "Change this", exact: true }),
    ).toBeEnabled({ timeout: 30000 });
    const recoveredInitial = await readDraft(page);
    assert.equal(recoveredInitial?.id, savedInitial.id);
    assert.equal(recoveredInitial?.revision, savedInitial.revision);
    assert.ok(
      recoveredInitial.entities.some((entity) => entity.id === house.id),
    );
    report.reloadRecovery = {
      initialRevision: recoveredInitial.revision,
      recovered: true,
    };

    stage = "target-selection";
    await page.getByRole("button", { name: "Show objects" }).click();
    await page
      .locator('[aria-label="Objects"] button')
      .filter({ hasText: house.label })
      .first()
      .click();
    await expect(
      page.getByText(house.label, { exact: true }).first(),
    ).toBeVisible();

    stage = "targeted-edit";
    const secondResponse = page.waitForResponse(
      (item) => new URL(item.url()).pathname === "/api/chatgpt/generate",
      { timeout: 180000 },
    );
    await page.locator("#prompt").fill(EDIT_PROMPT);
    await page
      .getByRole("button", { name: "Change this", exact: true })
      .click();
    const secondStatus = await secondResponse;
    assert.equal(
      secondStatus.status(),
      200,
      "targeted edit request must succeed",
    );
    await expect
      .poll(() => inferenceResponses.length, { timeout: 5000 })
      .toBe(2);
    await expect(
      page.getByRole("button", { name: "Change this", exact: true }),
    ).toBeEnabled({ timeout: 180000 });
    const edited = await readDraft(page);
    assert.equal(edited?.id, savedInitial.id);
    assert.ok(safeRevision(edited?.revision) > savedInitial.revision);
    assert.ok(edited.entities.some((entity) => entity.id === house.id));
    report.savedRevisions.push({
      step: "targeted-edit",
      revision: edited.revision,
    });

    stage = "final-reload-recovery";
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await expect(page.locator("canvas").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByRole("button", { name: "Continue your saved world" }),
    ).toBeVisible({ timeout: 15000 });
    await page
      .getByRole("button", { name: "Continue your saved world" })
      .click();
    const recoveredFinal = await readDraft(page);
    assert.equal(recoveredFinal?.id, edited.id);
    assert.equal(recoveredFinal?.revision, edited.revision);
    assert.ok(recoveredFinal.entities.some((entity) => entity.id === house.id));
    report.reloadRecovery.finalRevision = recoveredFinal.revision;
    assert.equal(
      inferenceRequests.length,
      2,
      "exactly two inference requests are required",
    );
    assert.equal(
      inferenceResponses.length,
      2,
      "both inference requests must return a status",
    );
    assert.equal(
      inferenceResponses.every(
        (item) => item.status >= 200 && item.status < 300,
      ),
      true,
    );
    assert.equal(
      externalRequestCount,
      0,
      "browser must make no external requests",
    );
    assert.equal(
      pageErrors.length,
      0,
      "browser must have no uncaught page errors",
    );
    assert.equal(routeViolation, undefined);
    const diagnostics = await readDiagnostics(page);
    for (const request of inferenceRequests) {
      const entry = diagnostics.find(
        (item) =>
          item.kind === "generation" && item.runId === request.clientRunId,
      );
      assert.ok(entry, "generation diagnostic for each call must be saved");
      assert.equal(entry.provider, "chatgpt");
      assert.equal(entry.serviceTier, SERVICE_TIER);
      assert.equal(
        entry.requestId,
        inferenceResponses.find(
          (item) => item.clientRunId === request.clientRunId,
        )?.requestId,
      );
      assert.equal(entry.terminal?.reason, "completed");
      assert.ok(
        safeRevision(entry.lastCommittedRevision) > request.initialRevision,
      );
    }
    report.status = "passed";
    report.stage = "complete";
  } catch (error) {
    report.status = "failed";
    report.stage = stage;
    report.failureCode =
      error instanceof HarnessError
        ? error.code
        : (routeViolation ??
          (error?.name === "AssertionError"
            ? "assertion-failed"
            : "acceptance-failed"));
  } finally {
    report.generationCalls = inferenceRequests.map((request) => {
      const response = inferenceResponses.find(
        (item) => item.clientRunId === request.clientRunId,
      );
      return {
        step: request.step,
        clientRunId: request.clientRunId,
        requestId: response?.requestId ?? null,
        status: response?.status ?? null,
        model: request.model,
        effort: request.effort,
      };
    });
    report.externalOrigins = [...externalOrigins].sort();
    report.externalRequestCount = externalRequestCount;
    report.blockedInferenceViolation = routeViolation ?? null;
    report.browserErrors.push(...pageErrors);
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await writeFile(
      resolve(config.evidenceDirectory, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
    console.log(JSON.stringify(report));
  }
  if (report.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  const code = error instanceof HarnessError ? error.code : "preflight-failed";
  console.error(`Local hosted ChatGPT harness refused to run: ${code}`);
  process.exitCode = 1;
});
