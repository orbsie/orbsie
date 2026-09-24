#!/usr/bin/env node
// Bounded live OpenRouter CREATE acceptance. The browser talks to the real
// local app and server routes; route handling only observes, continues the
// first two authorized calls, and aborts any later generation/review call.
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const MODEL = "openai/gpt-6-luna";
const OUTPUT_CAP = 4096;
const LIVE_BUDGET = 2;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const GENERATION_PATHS = new Set(["/api/generate", "/api/generate/review"]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class AcceptanceError extends Error {
  constructor(stage, code, status) {
    super(code);
    this.stage = stage;
    this.code = code;
    this.status = Number.isInteger(status) ? status : undefined;
  }
}

function requireConfiguration(argv) {
  // This explicit opt-in check precedes every credential or prompt read.
  if (process.env.ORBSIE_LIVE_E2E !== "1")
    throw new AcceptanceError("configuration", "live-opt-in-required");
  if (argv.length !== 1)
    throw new AcceptanceError(
      "configuration",
      "usage-requires-evidence-directory",
    );
  if (process.env.ORBSIE_KEY_SCOPE !== "local-only")
    throw new AcceptanceError("configuration", "local-only-key-scope-required");
  if (process.env.ORBSIE_EXPECTED_MODEL !== MODEL)
    throw new AcceptanceError("configuration", "exact-luna-model-required");
  if (process.env.ORBSIE_OUTPUT_CAP_TOKENS !== String(OUTPUT_CAP))
    throw new AcceptanceError("configuration", "4096-output-cap-required");
  if (
    process.env.ORBSIE_SERVICE_TIER !== undefined &&
    process.env.ORBSIE_SERVICE_TIER !== "default"
  )
    throw new AcceptanceError("configuration", "default-service-tier-required");

  const rawURL = process.env.ORBSIE_TEST_URL;
  if (!rawURL)
    throw new AcceptanceError("configuration", "loopback-app-url-required");
  let url;
  try {
    url = new URL(rawURL);
  } catch {
    throw new AcceptanceError("configuration", "invalid-loopback-app-url");
  }
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new AcceptanceError(
      "configuration",
      "exact-http-loopback-origin-required",
    );

  const prompt = process.env.ORBSIE_AUTHORING_REVIEW_PROMPT;
  if (
    typeof prompt !== "string" ||
    prompt.trim().length === 0 ||
    prompt.length > 4000
  )
    throw new AcceptanceError(
      "configuration",
      "bounded-create-prompt-required",
    );

  return {
    baseOrigin: url.origin,
    evidenceDirectory: resolve(argv[0]),
    privateEvidenceDirectory: process.env.ORBSIE_PRIVATE_EVIDENCE_DIR,
    prompt,
    expectedModel: MODEL,
    outputCap: OUTPUT_CAP,
    serviceTier: "default",
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validId(value) {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function safeRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function writeSafeReport(path, report) {
  return writeFile(path, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
}

function isWithinDirectory(directory, target) {
  const pathFromDirectory = relative(directory, target);
  return (
    pathFromDirectory === "" ||
    (pathFromDirectory !== ".." &&
      !pathFromDirectory.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromDirectory))
  );
}

async function preparePrivateEvidenceDirectory(value) {
  if (value === undefined || value === "") return null;
  if (!isAbsolute(value))
    throw new AcceptanceError(
      "configuration",
      "private-evidence-directory-must-be-absolute",
    );
  const target = resolve(value);
  let repository;
  let parent;
  try {
    repository = await realpath(fileURLToPath(new URL("../", import.meta.url)));
    parent = await realpath(dirname(target));
  } catch {
    throw new AcceptanceError(
      "configuration",
      "private-evidence-directory-parent-unavailable",
    );
  }
  if (
    isWithinDirectory(repository, target) ||
    isWithinDirectory(repository, resolve(parent, basename(target)))
  )
    throw new AcceptanceError(
      "configuration",
      "private-evidence-directory-inside-repository",
    );
  try {
    await lstat(target);
    throw new AcceptanceError(
      "configuration",
      "private-evidence-directory-already-exists",
    );
  } catch (error) {
    if (error instanceof AcceptanceError) throw error;
    if (error?.code !== "ENOENT")
      throw new AcceptanceError(
        "configuration",
        "private-evidence-directory-unavailable",
      );
  }
  try {
    await mkdir(target, { recursive: false, mode: 0o700 });
    await chmod(target, 0o700);
    if (((await stat(target)).mode & 0o777) !== 0o700)
      throw new Error("Private directory permissions did not apply.");
  } catch {
    throw new AcceptanceError(
      "configuration",
      "private-evidence-directory-creation-failed",
    );
  }
  return target;
}

async function writePrivateScreenshot(directory, filename, png) {
  const path = `${directory}/${filename}`;
  try {
    await writeFile(path, png, { mode: 0o600, flag: "wx" });
    await chmod(path, 0o600);
    if (((await stat(path)).mode & 0o777) !== 0o600)
      throw new Error("Private screenshot permissions did not apply.");
  } catch {
    throw new AcceptanceError(
      "private-evidence",
      "private-screenshot-write-failed",
    );
  }
}

async function readProjectSummary(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("keyval-store");
        request.onupgradeneeded = () => request.transaction.abort();
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("keyval")) {
            db.close();
            resolve(null);
            return;
          }
          const transaction = db.transaction("keyval", "readonly");
          const draftRequest = transaction
            .objectStore("keyval")
            .get("orbsie-draft");
          const libraryRequest = transaction
            .objectStore("keyval")
            .get("orbsie-library");
          transaction.oncomplete = () => {
            const draft = draftRequest.result;
            const project =
              draft && typeof draft === "object" ? draft.project : null;
            const library = libraryRequest.result;
            const saved =
              project && library && typeof library === "object"
                ? library[project.id]
                : null;
            db.close();
            resolve(
              project && typeof project.id === "string"
                ? {
                    projectId: project.id,
                    revision: Number.isSafeInteger(saved?.revision)
                      ? saved.revision
                      : Number.isSafeInteger(project.revision)
                        ? project.revision
                        : null,
                  }
                : null,
            );
          };
          transaction.onerror = () => {
            db.close();
            resolve(null);
          };
        };
      }),
  );
}

async function waitForSavedRevision(
  page,
  minimumRevision,
  timeout = 180000,
  shouldStop = () => false,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const summary = await readProjectSummary(page);
    if (summary && summary.revision >= minimumRevision) return summary;
    if (shouldStop()) return null;
    await page.waitForTimeout(250);
  }
  return null;
}

async function screenshotEvidence(page, label, privateDirectory) {
  // Pixels stay in memory. The report stores only a one-way digest and size.
  const png = await page.screenshot({ fullPage: true, animations: "disabled" });
  let privatePngWritten = false;
  let privatePng;
  if (privateDirectory && label === "connection-model-selection") {
    privatePng = png;
    await writePrivateScreenshot(
      privateDirectory,
      "connection-model-selection.png",
      privatePng,
    );
    privatePngWritten = true;
  } else if (
    privateDirectory &&
    (label === "review-complete" || label === "revise-bounded-incomplete")
  ) {
    // Save only the rendered canvas, excluding prompts and chat responses.
    privatePng = await page.locator("canvas").screenshot();
    await writePrivateScreenshot(
      privateDirectory,
      "post-review-scene.png",
      privatePng,
    );
    privatePngWritten = true;
  }
  return {
    label,
    sha256: sha256(png),
    bytes: png.byteLength,
    persisted: false,
    persistedScope: "full-page-png",
    privatePngWritten,
    ...(privatePng
      ? {
          privateSha256: sha256(privatePng),
          privateBytes: privatePng.byteLength,
        }
      : {}),
  };
}

async function installActivityHistory(page) {
  await page.evaluate(() => {
    const known = new Map([
      ["Reviewing the saved scene…", "reviewStarted"],
      ["Scene verified. Changes are applied.", "completed"],
      ["Applying a targeted correction to the scene…", "applyingCorrection"],
      ["Checking the corrected scene…", "checkingCorrection"],
    ]);
    const state = {
      reviewStarted: false,
      completed: false,
      applyingCorrection: false,
      checkingCorrection: false,
      otherActivityPresent: false,
    };
    window.__orbsieLiveReviewActivity = state;
    const observe = () => {
      const text = document
        .querySelector(".authoring-activity-latest p")
        ?.textContent?.trim();
      if (!text) return;
      const key = known.get(text);
      if (key) state[key] = true;
      else state.otherActivityPresent = true;
    };
    new MutationObserver(observe).observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    observe();
  });
}

async function readActivityHistory(page) {
  return page.evaluate(() => ({
    reviewStarted: Boolean(window.__orbsieLiveReviewActivity?.reviewStarted),
    completed: Boolean(window.__orbsieLiveReviewActivity?.completed),
    applyingCorrection: Boolean(
      window.__orbsieLiveReviewActivity?.applyingCorrection,
    ),
    checkingCorrection: Boolean(
      window.__orbsieLiveReviewActivity?.checkingCorrection,
    ),
    otherActivityPresent: Boolean(
      window.__orbsieLiveReviewActivity?.otherActivityPresent,
    ),
  }));
}

function isInferenceRoute(origin, url) {
  return (
    url.origin === origin &&
    (GENERATION_PATHS.has(url.pathname) ||
      url.pathname.startsWith("/api/generate/") ||
      url.pathname === "/api/chatgpt/generate" ||
      url.pathname === "/api/chatgpt/review")
  );
}

async function main() {
  const config = requireConfiguration(process.argv.slice(2));
  const privateEvidenceDirectory = await preparePrivateEvidenceDirectory(
    config.privateEvidenceDirectory,
  );
  const reportPath = `${config.evidenceDirectory}/report.json`;
  await mkdir(dirname(config.evidenceDirectory), { recursive: true });
  await mkdir(config.evidenceDirectory, { recursive: false });

  const report = {
    schemaVersion: 1,
    outcome: "running",
    provider: "openrouter",
    model: config.expectedModel,
    serviceTier: config.serviceTier,
    maxOutputTokens: config.outputCap,
    allowedLiveCalls: LIVE_BUDGET,
    actualLiveCalls: 0,
    blockedCalls: 0,
    phaseOrder: [],
    calls: [],
    evidence: [],
    storage: {},
    requestIds: { initial: null, review: null },
    privateEvidence: {
      enabled: Boolean(privateEvidenceDirectory),
      directoryMode: privateEvidenceDirectory ? "0700" : null,
      fileMode: privateEvidenceDirectory ? "0600" : null,
      screenshotsWritten: 0,
    },
    browserActivity: { consoleErrors: 0, pageErrors: 0, requestFailures: 0 },
    blockedExternalRequests: 0,
    blockedExternalOrigins: [],
    failure: null,
  };

  let stage = "server-preflight";
  let browser;
  let clientRunId = null;
  let authoringRunId = null;
  let reviewResponse = null;
  let generationResponseStatus = null;
  const requestRecords = new WeakMap();
  const inFlight = new Set();
  const blockedExternalOrigins = new Set();
  const appURL = new URL(config.baseOrigin);

  function isAllowedAppNetworkURL(url) {
    return (
      url.origin === config.baseOrigin ||
      (url.hostname === appURL.hostname &&
        url.port === appURL.port &&
        (url.protocol === "ws:" || url.protocol === "wss:"))
    );
  }

  try {
    browser = await chromium.launch({
      headless: process.env.ORBSIE_HEADLESS !== "0",
      args: [
        "--no-sandbox",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });

    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        ["http:", "https:", "ws:", "wss:"].includes(url.protocol) &&
        !isAllowedAppNetworkURL(url)
      ) {
        report.blockedExternalRequests += 1;
        const origin = url.origin === "null" ? "opaque" : url.origin;
        blockedExternalOrigins.add(origin);
        report.blockedExternalOrigins = [...blockedExternalOrigins].sort();
        await route.abort("blockedbyclient");
        return;
      }
      if (!isInferenceRoute(config.baseOrigin, url)) {
        await route.continue();
        return;
      }

      let payload;
      try {
        payload = request.postDataJSON();
      } catch {
        payload = null;
      }
      const phase =
        url.pathname === "/api/generate"
          ? "initial-generation"
          : payload?.phase === "review"
            ? "review"
            : payload?.phase === "final-review"
              ? "final-review"
              : "unexpected-review-phase";
      const call = {
        ordinal: report.calls.length + 1,
        phase,
        route: url.pathname,
        status: null,
        requestId: null,
        clientRunId: validId(request.headers()["x-orbsie-client-run-id"]),
        authoringRunId: null,
        requestedAuthoringRunId: validId(payload?.runId),
        projectId: validId(payload?.project?.id),
        projectRevision: safeRevision(payload?.project?.revision),
        modelMatched: payload?.model === MODEL,
        providerMatched: payload?.provider === "openrouter",
        authoringReviewEnabled: payload?.authoringReview === true,
        reviewScope: null,
        reviewProjectId: null,
        reviewRevision: null,
        reviewImageProjectId: null,
        reviewImageRevision: null,
        structuralObservationProjectId: null,
        structuralObservationRevision: null,
        responseBindingRevision: null,
        responseBindingDigest: null,
        verdict: null,
        blocked: false,
      };
      if (url.pathname === "/api/generate/review") {
        const hasImage =
          typeof payload?.reviewImage?.image === "string" &&
          payload.reviewImage.image.startsWith("data:image/png;base64,");
        const hasStructure = Boolean(payload?.structuralObservations);
        call.reviewScope =
          hasImage && hasStructure
            ? "visual+structural"
            : hasStructure
              ? "structural-only"
              : "missing-review-evidence";
        call.reviewProjectId = validId(payload?.project?.id);
        call.reviewRevision = safeRevision(payload?.project?.revision);
        call.reviewImageProjectId = validId(payload?.reviewImage?.projectId);
        call.reviewImageRevision = safeRevision(payload?.reviewImage?.revision);
        call.structuralObservationProjectId = validId(
          payload?.structuralObservations?.projectId,
        );
        call.structuralObservationRevision = safeRevision(
          payload?.structuralObservations?.revision,
        );
      }

      const isBudgeted = call.ordinal <= LIVE_BUDGET;
      const isExpectedFirst =
        call.ordinal === 1 &&
        phase === "initial-generation" &&
        call.providerMatched &&
        call.modelMatched &&
        call.authoringReviewEnabled &&
        Boolean(call.clientRunId) &&
        Boolean(call.projectId);
      const isExpectedSecond =
        call.ordinal === 2 &&
        phase === "review" &&
        generationResponseStatus >= 200 &&
        generationResponseStatus < 300 &&
        Boolean(authoringRunId) &&
        call.providerMatched &&
        call.modelMatched &&
        call.clientRunId === clientRunId &&
        call.projectId === report.calls[0]?.projectId &&
        call.requestedAuthoringRunId === authoringRunId;
      // Do not keep request payloads. `payload` is discarded after this hook.
      if (
        !isBudgeted ||
        (call.ordinal === 1 ? !isExpectedFirst : !isExpectedSecond)
      ) {
        call.blocked = true;
        report.blockedCalls += 1;
        report.phaseOrder.push(`${phase}-blocked-before-server`);
        report.calls.push(call);
        await route.abort("blockedbyclient");
        return;
      }

      if (call.ordinal === 1) clientRunId = call.clientRunId;
      report.actualLiveCalls += 1;
      report.phaseOrder.push(`${phase}-request-observed`);
      report.calls.push(call);
      requestRecords.set(request, call);
      const continuation = route.continue();
      inFlight.add(continuation);
      try {
        await continuation;
      } finally {
        inFlight.delete(continuation);
      }
    });
    await context.routeWebSocket(
      (url) => url.protocol === "ws:" || url.protocol === "wss:",
      async (webSocketRoute) => {
        const url = new URL(webSocketRoute.url());
        if (isAllowedAppNetworkURL(url)) {
          webSocketRoute.connectToServer();
          return;
        }
        report.blockedExternalRequests += 1;
        const origin = url.origin === "null" ? "opaque" : url.origin;
        blockedExternalOrigins.add(origin);
        report.blockedExternalOrigins = [...blockedExternalOrigins].sort();
        await webSocketRoute.close({
          code: 1008,
          reason: "External network blocked.",
        });
      },
    );

    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") report.browserActivity.consoleErrors += 1;
    });
    page.on("pageerror", () => {
      report.browserActivity.pageErrors += 1;
    });
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      if (url.origin === config.baseOrigin)
        report.browserActivity.requestFailures += 1;
    });
    page.on("response", (response) => {
      const task = (async () => {
        const call = requestRecords.get(response.request());
        if (!call) return;
        call.status = response.status();
        const headers = response.headers();
        if (call.phase === "initial-generation") {
          generationResponseStatus = call.status;
          call.requestId = validId(headers["x-orbsie-request-id"]);
          report.requestIds.initial = call.requestId;
          authoringRunId = validId(headers["x-orbsie-authoring-run-id"]);
          call.authoringRunId = authoringRunId;
          report.phaseOrder.push(`initial-generation-response-${call.status}`);
        } else if (call.phase === "review") {
          call.requestId = validId(headers["x-orbsie-request-id"]);
          report.requestIds.review = call.requestId;
          report.phaseOrder.push(`review-response-${call.status}`);
          if (call.status >= 200 && call.status < 300) {
            try {
              const body = await response.json();
              const review = body?.review;
              const binding = body?.binding;
              reviewResponse = {
                verdict:
                  review?.verdict === "accept" || review?.verdict === "revise"
                    ? review.verdict
                    : null,
                scope:
                  body?.scope === "visual+structural" ||
                  body?.scope === "structural-only"
                    ? body.scope
                    : null,
                reviewProjectId: validId(review?.projectId),
                reviewedRevision: safeRevision(review?.reviewedRevision),
                bindingRevision: safeRevision(binding?.revision),
                bindingDigest:
                  typeof binding?.digest === "string" &&
                  /^[a-f0-9]{64}$/.test(binding.digest)
                    ? binding.digest
                    : null,
              };
              call.verdict = reviewResponse.verdict;
              call.responseBindingRevision = reviewResponse.bindingRevision;
              call.responseBindingDigest = reviewResponse.bindingDigest;
            } catch {
              reviewResponse = null;
            }
          }
        }
      })().catch(() => {});
      inFlight.add(task);
      void task.finally(() => inFlight.delete(task));
    });

    stage = "server-preflight";
    await page.goto(config.baseOrigin, { waitUntil: "domcontentloaded" });
    await installActivityHistory(page);
    const configResponse = await page.request.get(
      `${config.baseOrigin}/api/config`,
      {
        headers: { Origin: config.baseOrigin },
        timeout: 30000,
      },
    );
    if (!configResponse.ok())
      throw new AcceptanceError(
        stage,
        "app-config-unavailable",
        configResponse.status(),
      );
    const appConfig = await configResponse.json().catch(() => null);
    if (
      appConfig?.authoringReview !== true ||
      appConfig?.accounts !== true ||
      appConfig?.generationMaxTokens !== OUTPUT_CAP
    )
      throw new AcceptanceError(
        stage,
        "review-auth-or-output-cap-not-configured",
      );
    report.server = {
      status: configResponse.status(),
      authoringReview: true,
      accounts: true,
      maxOutputTokens: OUTPUT_CAP,
    };

    stage = "provider-connection";
    const connectionButton = page
      .getByRole("button", { name: "Connections", exact: true })
      .first();
    await expect(connectionButton).toBeVisible({ timeout: 30000 });
    const catalogPromise = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          url.origin === config.baseOrigin &&
          url.pathname === "/api/models" &&
          url.searchParams.get("provider") === "openrouter"
        );
      },
      { timeout: 30000 },
    );
    await connectionButton.click();
    await page
      .getByLabel("Provider", { exact: true })
      .selectOption("openrouter");
    const catalogResponse = await catalogPromise;
    if (!catalogResponse.ok())
      throw new AcceptanceError(
        stage,
        "openrouter-model-catalog-unavailable",
        catalogResponse.status(),
      );
    const catalog = await catalogResponse.json().catch(() => null);
    const expectedModel = Array.isArray(catalog?.models)
      ? catalog.models.find((item) => item?.id === MODEL)
      : null;
    if (!expectedModel)
      throw new AcceptanceError(stage, "exact-luna-model-absent-from-catalog");
    if (expectedModel.capabilities?.imageInput?.supported !== true)
      throw new AcceptanceError(
        stage,
        "luna-image-input-not-confirmed-by-catalog",
      );
    report.catalog = {
      exactModelPresent: true,
      imageInputSupported: true,
    };
    await page.locator("details.advanced-models summary").click();
    const modelRow = page.locator(
      `.model-catalog-row[data-model-id="${MODEL}"]`,
    );
    await expect(modelRow).toHaveCount(1, { timeout: 30000 });
    await modelRow.click();
    await expect(modelRow).toHaveAttribute("aria-pressed", "true");
    const connectionEvidence = await screenshotEvidence(
      page,
      "connection-model-selection",
      privateEvidenceDirectory,
    );
    report.evidence.push(connectionEvidence);
    if (connectionEvidence.privatePngWritten)
      report.privateEvidence.screenshotsWritten += 1;
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (typeof apiKey !== "string" || apiKey.length < 10)
      throw new AcceptanceError(stage, "openrouter-key-unavailable");
    await page.getByLabel("API key", { exact: true }).fill(apiKey);
    await page
      .getByRole("button", {
        name: "Continue with this connection",
        exact: true,
      })
      .click();
    await expect(page.locator(".mode-button")).toContainText("OpenRouter");
    const keyDigest = sha256(apiKey);
    const connectedStorage = await storageSnapshot(page, keyDigest);
    if (connectedStorage.sensitive)
      throw new AcceptanceError(stage, "provider-key-found-in-browser-storage");
    report.storage.connectionKeyPersisted = false;

    stage = "create-preflight";
    await expect(page.locator("main")).toHaveAttribute(
      "data-renderer-availability",
      "ready",
      { timeout: 30000 },
    );
    const promptInput = page.getByPlaceholder("What experience to build?");
    await expect(promptInput).toBeVisible({ timeout: 30000 });
    const reviewToggle = page.getByTestId("authoring-review-toggle");
    await expect(reviewToggle).toBeVisible();
    const enabled = await reviewToggle
      .locator("input[type=checkbox]")
      .isEnabled();
    const checked = await reviewToggle
      .locator("input[type=checkbox]")
      .isChecked();
    if (!enabled || !checked)
      throw new AcceptanceError(
        stage,
        "authoring-review-toggle-not-enabled-and-checked",
      );
    const before = await readProjectSummary(page);
    report.storage.before = before
      ? {
          projectId: validId(before.projectId),
          revision: safeRevision(before.revision),
        }
      : null;
    await promptInput.fill(config.prompt);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    report.phaseOrder.push("create-submitted-from-browser");

    stage = "initial-generation";
    await expect
      .poll(() => report.calls.length, { timeout: 30000 })
      .toBeGreaterThan(0);
    const initialCall = report.calls.find(
      (call) => call.phase === "initial-generation",
    );
    if (!initialCall)
      throw new AcceptanceError(
        stage,
        "initial-generation-request-not-observed",
      );
    if (initialCall.blocked)
      throw new AcceptanceError(
        stage,
        "initial-generation-request-blocked-by-live-safety-guard",
      );
    const generated = await waitForSavedRevision(
      page,
      (before?.revision ?? 0) + 1,
      180000,
      () =>
        report.calls.some(
          (call) =>
            call.phase === "initial-generation" &&
            call.status !== null &&
            call.status >= 400,
        ),
    );
    if (!generated) {
      const failedCall = report.calls.find(
        (call) => call.phase === "initial-generation",
      );
      if (failedCall?.status && failedCall.status >= 400)
        throw new AcceptanceError(
          stage,
          "initial-generation-http-failure",
          failedCall.status,
        );
      throw new AcceptanceError(
        stage,
        "no-committed-world-observed-within-timeout",
      );
    }
    if (!authoringRunId)
      throw new AcceptanceError(
        stage,
        "initial-generation-missing-authoring-run-id",
      );
    if (!initialCall.requestId)
      throw new AcceptanceError(stage, "initial-request-id-invalid-or-missing");
    report.storage.afterGeneration = {
      projectId: validId(generated.projectId),
      revision: safeRevision(generated.revision),
    };

    stage = "review";
    await expect
      .poll(() => report.calls.some((call) => call.phase === "review"), {
        timeout: 30000,
      })
      .toBe(true);
    const reviewCall = report.calls.find((call) => call.phase === "review");
    if (!reviewCall)
      throw new AcceptanceError(stage, "review-request-not-observed");
    if (reviewCall.blocked)
      throw new AcceptanceError(
        stage,
        "initial-review-request-blocked-by-call-budget-guard",
      );
    const reviewDeadline = Date.now() + 180000;
    while (reviewCall.status === null && Date.now() < reviewDeadline)
      await page.waitForTimeout(200);
    await Promise.allSettled([...inFlight]);
    if (reviewCall.status === null)
      throw new AcceptanceError(stage, "review-response-timeout");
    if (reviewCall.status < 200 || reviewCall.status >= 300)
      throw new AcceptanceError(
        stage,
        "review-http-failure",
        reviewCall.status,
      );
    if (!reviewCall.requestId)
      throw new AcceptanceError(stage, "review-request-id-invalid-or-missing");
    if (reviewCall.requestId === initialCall.requestId)
      throw new AcceptanceError(stage, "request-ids-not-distinct");
    if (
      !reviewResponse?.verdict ||
      !reviewResponse.scope ||
      reviewResponse.bindingRevision === null ||
      !reviewResponse.bindingDigest
    )
      throw new AcceptanceError(stage, "review-response-binding-invalid");
    if (
      reviewCall.projectId !== generated.projectId ||
      reviewResponse.reviewProjectId !== generated.projectId ||
      reviewResponse.reviewedRevision !== reviewCall.projectRevision
    )
      throw new AcceptanceError(stage, "review-project-binding-mismatch");
    if (
      reviewCall.reviewScope !== "visual+structural" ||
      reviewCall.reviewImageProjectId !== reviewCall.projectId ||
      reviewCall.reviewImageRevision !== reviewCall.projectRevision ||
      reviewCall.structuralObservationProjectId !== reviewCall.projectId ||
      reviewCall.structuralObservationRevision !== reviewCall.projectRevision ||
      reviewResponse.scope !== "visual+structural"
    )
      throw new AcceptanceError(stage, "review-evidence-binding-mismatch");

    report.review = {
      phase: "review",
      scope: reviewResponse.scope,
      requestScope: reviewCall.reviewScope,
      imagePresent: reviewCall.reviewScope === "visual+structural",
      projectId: reviewCall.projectId,
      reviewedRevision: reviewResponse.reviewedRevision,
      reviewImageRevision: reviewCall.reviewImageRevision,
      structuralObservationRevision: reviewCall.structuralObservationRevision,
      bindingRevision: reviewResponse.bindingRevision,
      bindingDigest: reviewResponse.bindingDigest,
      verdict: reviewResponse.verdict,
    };
    report.phaseOrder.push(`review-verdict-${reviewResponse.verdict}`);

    if (reviewResponse.verdict === "accept") {
      if (reviewResponse.bindingRevision !== reviewResponse.reviewedRevision)
        throw new AcceptanceError(
          stage,
          "accepted-review-binding-revision-mismatch",
        );
      const completed = await waitForSavedRevision(
        page,
        reviewResponse.bindingRevision,
        30000,
      );
      if (!completed || completed.projectId !== generated.projectId)
        throw new AcceptanceError(stage, "accepted-scene-not-saved");
      await expect(page.locator(".authoring-activity-latest p")).toHaveText(
        "Scene verified. Changes are applied.",
        { timeout: 30000 },
      );
      report.storage.afterReview = {
        projectId: validId(completed.projectId),
        revision: safeRevision(completed.revision),
      };
      const activity = await readActivityHistory(page);
      report.browserActivity.authoring = activity;
      const reviewedEvidence = await screenshotEvidence(
        page,
        "review-complete",
        privateEvidenceDirectory,
      );
      report.evidence.push(reviewedEvidence);
      if (reviewedEvidence.privatePngWritten)
        report.privateEvidence.screenshotsWritten += 1;
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("canvas")).toBeVisible({ timeout: 30000 });
      const reloaded = await waitForSavedRevision(
        page,
        completed.revision,
        30000,
      );
      if (
        !reloaded ||
        reloaded.projectId !== completed.projectId ||
        reloaded.revision !== completed.revision
      )
        throw new AcceptanceError(
          "reload-recovery",
          "accepted-scene-changed-after-reload",
        );
      const reloadStorage = await storageSnapshot(page, keyDigest);
      if (reloadStorage.sensitive)
        throw new AcceptanceError(
          "reload-recovery",
          "provider-key-found-in-browser-storage",
        );
      report.storage.afterReload = {
        projectId: validId(reloaded.projectId),
        revision: safeRevision(reloaded.revision),
        keyPersisted: false,
        recovered: true,
      };
      if (report.actualLiveCalls !== LIVE_BUDGET || report.blockedCalls !== 0)
        throw new AcceptanceError("acceptance", "unexpected-live-call-count");
      report.outcome = "passed";
    } else {
      // A revise result needs a final review to claim acceptance. The route
      // guard aborts that third request before it reaches the local server.
      await expect
        .poll(() => report.blockedCalls, { timeout: 30000 })
        .toBeGreaterThan(0);
      const blockedFinalReview = report.calls.some(
        (call) =>
          call.ordinal === 3 && call.phase === "final-review" && call.blocked,
      );
      if (!blockedFinalReview)
        throw new AcceptanceError(
          stage,
          "revise-did-not-reach-blocked-final-review",
        );
      await page.waitForTimeout(500);
      report.phaseOrder.push("revise-journey-bounded-incomplete");
      const activity = await readActivityHistory(page);
      report.browserActivity.authoring = activity;
      const reviseEvidence = await screenshotEvidence(
        page,
        "revise-bounded-incomplete",
        privateEvidenceDirectory,
      );
      report.evidence.push(reviseEvidence);
      if (reviseEvidence.privatePngWritten)
        report.privateEvidence.screenshotsWritten += 1;
      const afterBlockedReview = await readProjectSummary(page);
      report.storage.afterBlockedFinalReview = afterBlockedReview
        ? {
            projectId: validId(afterBlockedReview.projectId),
            revision: safeRevision(afterBlockedReview.revision),
          }
        : null;
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("canvas")).toBeVisible({ timeout: 30000 });
      const recovered = await readProjectSummary(page);
      const recoverySame = Boolean(
        afterBlockedReview &&
        recovered &&
        recovered.projectId === afterBlockedReview.projectId &&
        recovered.revision === afterBlockedReview.revision,
      );
      const reloadStorage = await storageSnapshot(page, keyDigest);
      if (reloadStorage.sensitive)
        throw new AcceptanceError(
          "reload-recovery",
          "provider-key-found-in-browser-storage",
        );
      report.storage.afterReload = recovered
        ? {
            projectId: validId(recovered.projectId),
            revision: safeRevision(recovered.revision),
            keyPersisted: false,
            recovered: recoverySame,
          }
        : { recovered: false, keyPersisted: false };
      report.outcome = "bounded-incomplete";
    }

    if (report.blockedCalls > 0 && report.outcome === "passed")
      throw new AcceptanceError("acceptance", "call-budget-guard-triggered");
  } catch (error) {
    const known = error instanceof AcceptanceError ? error : null;
    report.outcome = report.outcome === "running" ? "failed" : report.outcome;
    report.failure = {
      stage: known?.stage ?? stage,
      code: known?.code ?? "browser-acceptance-error",
      ...(known?.status ? { status: known.status } : {}),
      errorType: known
        ? "AcceptanceError"
        : (error?.constructor?.name ?? "Error"),
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      await writeSafeReport(reportPath, report);
    } catch {
      process.stderr.write(
        "Could not write sanitized live acceptance report.\n",
      );
      process.exitCode = 1;
      return;
    }
  }

  process.stdout.write(
    `${report.outcome}: ${report.failure?.stage ?? "complete"}`,
  );
  if (report.failure?.status)
    process.stdout.write(` HTTP ${report.failure.status}`);
  process.stdout.write(`; report ${reportPath}\n`);
  if (report.outcome === "failed") process.exitCode = 1;
  else if (report.outcome === "bounded-incomplete") process.exitCode = 2;
}

try {
  await main();
} catch (error) {
  const code =
    error instanceof AcceptanceError
      ? error.code
      : "acceptance-configuration-error";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
