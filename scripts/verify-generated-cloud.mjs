/**
 * Local-only browser proof for generated-model cloud persistence.
 *
 * This harness uses the checked-in vase ZIP as evidence. It creates or signs
 * into a synthetic dev account through the Orbsie UI, saves the evidence world
 * through the UI, then opens it in a fresh browser context with no IndexedDB.
 * It never targets a hosted origin and never prints credentials.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

const DEFAULT_URL = "http://127.0.0.1:3017";
const EVIDENCE_ZIP = resolve(
  process.env.ORBSIE_GENERATED_CLOUD_EVIDENCE ??
    "docs/evidence/provider-e2e/blender/chatgpt-local/world.zip",
);
const STATE_PATH = resolve(
  process.env.ORBSIE_GENERATED_CLOUD_STATE ??
    ".vercel/dev-generated-cloud-state.json",
);
const EVIDENCE_DIR = resolve(
  process.env.ORBSIE_GENERATED_CLOUD_OUTPUT ?? ".vercel/dev-generated-cloud",
);
let activeStage = "startup";
let failureArtifact;

function localOrigin(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Error("ORBSIE_TEST_URL must be a valid local HTTP URL.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error(
      "This harness only permits an HTTP loopback ORBSIE_TEST_URL; production targets are forbidden.",
    );
  return url.origin;
}

const baseURL = localOrigin(process.env.ORBSIE_TEST_URL ?? DEFAULT_URL);
const baseOrigin = new URL(baseURL).origin;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function parseEvidence() {
  const archive = unzipSync(new Uint8Array(await readFile(EVIDENCE_ZIP)));
  const projectBytes = archive["project.json"];
  const modelManifestBytes = archive["models/generated/manifest.json"];
  assert(projectBytes && modelManifestBytes, "The evidence ZIP is incomplete.");
  const project = JSON.parse(strFromU8(projectBytes));
  const manifest = JSON.parse(strFromU8(modelManifestBytes));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.models.length, 1);
  const metadata = manifest.models[0];
  const modelPath = `models/generated/${metadata.sha256}.glb`;
  const glb = archive[modelPath];
  assert(glb, `The evidence ZIP is missing ${modelPath}.`);
  assert.equal(glb.byteLength, metadata.bytes);
  assert.equal(digest(glb), metadata.sha256);
  const generated = project.entities?.filter(
    (entity) => entity.geometry?.kind === "generated",
  );
  assert.equal(generated?.length, 1);
  assert.equal(generated[0].geometry.model.sha256, metadata.sha256);
  assert.equal(generated[0].geometry.model.bytes, metadata.bytes);
  return { project, metadata, modelPath, glb };
}

function safeState(value) {
  return value && typeof value === "object" && value.baseURL === baseURL
    ? value
    : undefined;
}

async function readState() {
  try {
    const current = safeState(JSON.parse(await readFile(STATE_PATH, "utf8")));
    if (!current) return undefined;
    await chmod(STATE_PATH, 0o600);
    return current;
  } catch {
    return undefined;
  }
}

async function persistState(value) {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(STATE_PATH, 0o600);
  const permissions = (await stat(STATE_PATH)).mode & 0o777;
  assert.equal(permissions, 0o600, "Credential state must be mode 0600.");
}

async function captureFailure(page, stage, error) {
  const diagnostic = {
    stage,
    message: error instanceof Error ? error.message : String(error),
    url: page?.url() ?? null,
    title: page ? await page.title().catch(() => "") : null,
    visibleText: page
      ? (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        ).slice(0, 12000)
      : "",
    dialogs: page
      ? await page
          .locator("dialog")
          .evaluateAll((elements) =>
            elements.map((element) => ({
              open: element.hasAttribute("open"),
              text: (element.textContent ?? "").slice(0, 3000),
            })),
          )
          .catch(() => [])
      : [],
  };
  const diagnosticFile = `${EVIDENCE_DIR}/failure-diagnostic.json`;
  const screenshot = `${EVIDENCE_DIR}/failure.png`;
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(diagnosticFile, `${JSON.stringify(diagnostic, null, 2)}\n`);
  if (page)
    await page
      .screenshot({ path: screenshot, fullPage: true })
      .catch(() => undefined);
  return { ...diagnostic, diagnosticFile, screenshot };
}

async function routeLocalOnly(context) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === baseOrigin ||
      url.protocol === "data:" ||
      url.protocol === "blob:"
    ) {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
}

async function putIDB(page, key, value) {
  await page.evaluate(
    ({ key, value }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("keyval-store");
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains("keyval"))
            open.result.createObjectStore("keyval");
        };
        open.onerror = () =>
          reject(open.error ?? Error("IndexedDB open failed"));
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction("keyval", "readwrite");
          transaction.objectStore("keyval").put(value, key);
          transaction.onerror = () => reject(transaction.error);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    { key, value },
  );
}

async function seedEvidence(page, evidence, project) {
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await putIDB(page, `orbsie-model:${evidence.metadata.sha256}`, {
    metadata: evidence.metadata,
    glb: Array.from(evidence.glb),
  });
  await putIDB(page, "orbsie-draft", {
    project,
    history: [],
    future: [],
    savedAt: Date.now(),
  });
  await putIDB(page, "orbsie-library", { [project.id]: project });
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function openLocalEvidence(page, project) {
  await page.getByRole("button", { name: "Your worlds" }).click();
  await page
    .getByRole("button", {
      name: new RegExp(project.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    })
    .first()
    .click();
  await page
    .locator(".workspace-heading h2")
    .filter({ hasText: project.title })
    .waitFor({ state: "visible", timeout: 30000 });
}

async function authenticateInUI(page, credentials, createAccount) {
  await page
    .getByRole("button", { name: /Your account and cloud worlds|Your worlds/ })
    .click();
  if (!createAccount) {
    await page.getByLabel("Email", { exact: true }).fill(credentials.email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(credentials.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  } else {
    await page
      .getByRole("button", { name: "New here? Create an account" })
      .click();
    await page
      .getByLabel("Your name", { exact: true })
      .fill("Orbsie dev cloud proof");
    await page.getByLabel("Email", { exact: true }).fill(credentials.email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(credentials.password);
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
  }
  await page.locator("dialog").waitFor({ state: "hidden", timeout: 30000 });
}

function projectEscapedTitle(title) {
  return title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function saveFromUI(page, project, evidence) {
  const uploadResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === "/api/generated-models",
    { timeout: 90000 },
  );
  const projectResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === "/api/projects",
    { timeout: 90000 },
  );
  await page
    .getByRole("button", { name: /Your account and cloud worlds|Your worlds/ })
    .click();
  await page
    .getByRole("button", { name: "Save current world to cloud" })
    .click();
  const [uploaded, saved] = await Promise.all([
    uploadResponse,
    projectResponse,
  ]);
  assert.equal(uploaded.status(), 200);
  assert.equal(saved.status(), 200);
  const uploadBody = JSON.parse(uploaded.request().postData() ?? "{}");
  assert.equal(uploadBody.metadata.sha256, evidence.metadata.sha256);
  const uploadedBytes = Buffer.from(uploadBody.glb, "base64");
  assert.equal(uploadedBytes.length, evidence.metadata.bytes);
  assert.equal(digest(uploadedBytes), evidence.metadata.sha256);
  const savedBody = JSON.parse(saved.request().postData() ?? "{}");
  assert.equal(savedBody.project.id, project.id);
  assert.equal(
    savedBody.project.entities[0].geometry.model.sha256,
    evidence.metadata.sha256,
  );
  await page
    .getByText("Saved to your account.", { exact: true })
    .waitFor({ timeout: 30000 });
  return { uploadStatus: uploaded.status(), projectStatus: saved.status() };
}

async function freshRestore(browser, storageState, project, evidence) {
  const context = await browser.newContext({
    // A new device shares authentication cookies, not another tab's local writer lease.
    storageState: { cookies: storageState.cookies, origins: [] },
    viewport: { width: 1440, height: 1000 },
  });
  await routeLocalOnly(context);
  await context.addInitScript(() => {
    const Original = window.Worker;
    window.__generatedCloudWorkerResults = [];
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) =>
          window.__generatedCloudWorkerResults.push({
            error: data.error ?? null,
            hash: data.userData?.orbsieGeneratedHash,
            vertices: data.attributes?.position?.array?.length / 3,
          }),
        );
      }
    };
  });
  const page = await context.newPage();
  try {
    activeStage = "fresh restore: project listing";
    const projectGet = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/projects",
      { timeout: 30000 },
    );
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    const listed = await projectGet;
    assert.equal(listed.status(), 200);
    const listedBody = await listed.json();
    assert(listedBody.projects.some((entry) => entry.id === project.id));
    await page.getByRole("button", { name: "Your worlds" }).click();
    const cloudButton = page.getByRole("button", {
      name: new RegExp(
        `${projectEscapedTitle(project.title)}.*Revision ${project.revision} · Cloud`,
      ),
    });
    activeStage = "fresh restore: cloud world list";
    await cloudButton.waitFor({ state: "visible", timeout: 30000 });
    const modelGet = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/generated-models" &&
        new URL(response.url()).searchParams.get("hash") ===
          evidence.metadata.sha256,
      { timeout: 90000 },
    );
    activeStage = "fresh restore: generated model download";
    await cloudButton.click();
    const modelResponse = await modelGet;
    assert.equal(modelResponse.status(), 200);
    const modelBody = await modelResponse.json();
    assert.equal(modelBody.metadata.sha256, evidence.metadata.sha256);
    const downloaded = Buffer.from(modelBody.glb, "base64");
    assert.equal(downloaded.length, evidence.metadata.bytes);
    assert.equal(digest(downloaded), evidence.metadata.sha256);
    activeStage = "fresh restore: workspace transition";
    await page
      .locator(".workspace-heading h2")
      .filter({ hasText: project.title })
      .waitFor({ timeout: 30000 });
    const canvas = page.locator("canvas");
    await canvas.waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(1500);
    activeStage = "fresh restore: WebGL render evidence";
    await page.waitForFunction(() =>
      window.__generatedCloudWorkerResults?.some(
        (result) => result.hash && result.vertices > 0,
      ),
    );
    const render = await page.evaluate(() => ({
      width: document.querySelector("canvas")?.width ?? 0,
      height: document.querySelector("canvas")?.height ?? 0,
      workers: window.__generatedCloudWorkerResults,
    }));
    assert(
      render.width > 0 && render.height > 0,
      "WebGL canvas is unavailable.",
    );
    assert(
      render.workers.some(
        (result) =>
          result.hash === evidence.metadata.sha256 &&
          result.vertices > 0 &&
          !result.error,
      ),
      "Expected generated model was not prepared for rendering.",
    );
    const storedModel = await page.evaluate(async (hash) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onerror = () =>
          reject(request.error ?? Error("IndexedDB open failed"));
        request.onsuccess = () => resolve(request.result);
      });
      const record = await new Promise((resolve, reject) => {
        const transaction = database.transaction("keyval", "readonly");
        const request = transaction
          .objectStore("keyval")
          .get(`orbsie-model:${hash}`);
        request.onerror = () =>
          reject(request.error ?? Error("IndexedDB read failed"));
        request.onsuccess = () => resolve(request.result);
      });
      database.close();
      return record
        ? {
            sha256: record.metadata?.sha256,
            bytes: record.metadata?.bytes,
            storedBytes: new Uint8Array(record.glb).byteLength,
            digest: [
              ...new Uint8Array(
                await crypto.subtle.digest(
                  "SHA-256",
                  new Uint8Array(record.glb),
                ),
              ),
            ]
              .map((byte) => byte.toString(16).padStart(2, "0"))
              .join(""),
          }
        : null;
    }, evidence.metadata.sha256);
    assert.equal(storedModel?.sha256, evidence.metadata.sha256);
    assert.equal(storedModel?.bytes, evidence.metadata.bytes);
    assert.equal(storedModel?.storedBytes, evidence.metadata.bytes);
    assert.equal(storedModel?.digest, evidence.metadata.sha256);
    // Let the landing-to-workspace camera transition settle before visual evidence.
    await page.waitForTimeout(5000);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/fresh-context-restored.png`,
      fullPage: true,
    });
    return {
      projectStatus: listed.status(),
      modelStatus: modelResponse.status(),
      render,
      storedModel,
    };
  } catch (error) {
    failureArtifact = await captureFailure(page, activeStage, error);
    throw error;
  } finally {
    await context.close();
  }
}

async function verifyOwnership(browser, storageState, project, hash) {
  const anonymous = await browser.newContext();
  const anonymousProject = await anonymous.request.get(
    `${baseURL}/api/projects?id=${encodeURIComponent(project.id)}`,
  );
  const anonymousModel = await anonymous.request.get(
    `${baseURL}/api/generated-models?hash=${hash}`,
  );
  assert([401, 404].includes(anonymousProject.status()));
  assert([401, 404].includes(anonymousModel.status()));
  await anonymous.close();

  const second = await browser.newContext({ storageState });
  const email = `orbsie-dev-owner-${randomUUID()}@example.invalid`;
  const password = randomBytes(30).toString("base64url");
  const signup = await second.request.post(
    `${baseURL}/api/auth/sign-up/email`,
    {
      headers: { Origin: baseOrigin },
      data: { name: "Orbsie second dev owner", email, password },
    },
  );
  assert.equal(signup.status(), 200);
  const secondProject = await second.request.get(
    `${baseURL}/api/projects?id=${encodeURIComponent(project.id)}`,
  );
  const secondModel = await second.request.get(
    `${baseURL}/api/generated-models?hash=${hash}`,
  );
  assert.equal(secondProject.status(), 404);
  assert.equal(secondModel.status(), 404);
  await second.close();
  return {
    anonymousProject: anonymousProject.status(),
    anonymousModel: anonymousModel.status(),
    secondProject: secondProject.status(),
    secondModel: secondModel.status(),
  };
}

const evidence = await parseEvidence();
const previous = await readState();
const credentials = previous?.credentials ?? {
  email: `orbsie-dev-generated-${randomUUID()}@example.invalid`,
  password: randomBytes(30).toString("base64url"),
};
const project = structuredClone(evidence.project);
// Use a fresh world identity each run so the UI's initial null base revision
// creates an independent dev record instead of colliding with an old run.
project.id = randomUUID();
project.revision = evidence.project.revision;
project.title = `${evidence.project.title} ${project.id.slice(0, 8)}`;

await mkdir(EVIDENCE_DIR, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
let context;
let page;
try {
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await routeLocalOnly(context);
  page = await context.newPage();
  activeStage = "seed local evidence";
  await seedEvidence(page, evidence, project);
  activeStage = "open local evidence";
  await openLocalEvidence(page, project);
  activeStage = "authenticate synthetic account";
  await authenticateInUI(page, credentials, !previous);
  // Keep the account usable if a later cloud or rendering assertion fails. The
  // state file is private and is also the resume marker for the next run.
  await persistState({
    version: 1,
    baseURL,
    credentials,
    projectId: project.id,
    modelSha256: evidence.metadata.sha256,
    stage: "authenticated",
  });
  activeStage = "save current world to cloud";
  const saveResult = await saveFromUI(page, project, evidence);
  await persistState({
    version: 1,
    baseURL,
    credentials,
    projectId: project.id,
    modelSha256: evidence.metadata.sha256,
    stage: "saved",
    save: saveResult,
  });
  const storageState = await context.storageState();
  activeStage = "fresh context restore";
  const restoreResult = await freshRestore(
    browser,
    storageState,
    project,
    evidence,
  );
  await persistState({
    version: 1,
    baseURL,
    credentials,
    projectId: project.id,
    modelSha256: evidence.metadata.sha256,
    stage: "restored",
    save: saveResult,
    restore: restoreResult,
  });
  activeStage = "ownership isolation";
  const ownership = await verifyOwnership(
    browser,
    storageState,
    project,
    evidence.metadata.sha256,
  );
  await persistState({
    version: 1,
    baseURL,
    credentials,
    projectId: project.id,
    modelSha256: evidence.metadata.sha256,
    stage: "passed",
    save: saveResult,
    restore: restoreResult,
    ownership,
    screenshot: `${EVIDENCE_DIR}/fresh-context-restored.png`,
  });
  console.log(
    JSON.stringify(
      {
        status: "passed",
        target: baseURL,
        projectId: project.id,
        modelSha256: evidence.metadata.sha256,
        save: saveResult,
        restore: restoreResult,
        ownership,
        screenshot: `${EVIDENCE_DIR}/fresh-context-restored.png`,
      },
      null,
      2,
    ),
  );
} catch (error) {
  // freshRestore captures its own page before closing it. Preserve that
  // evidence instead of overwriting it with the initiating page's modal.
  const diagnostic =
    failureArtifact ?? (await captureFailure(page, activeStage, error));
  await persistState({
    version: 1,
    baseURL,
    credentials,
    projectId: project.id,
    modelSha256: evidence.metadata.sha256,
    stage: activeStage,
    diagnosticFile: diagnostic.diagnosticFile,
    screenshot: diagnostic.screenshot,
  });
  console.error(
    JSON.stringify(
      {
        status: "failed",
        target: baseURL,
        projectId: project.id,
        stage: activeStage,
        message: diagnostic.message,
        diagnosticFile: diagnostic.diagnosticFile,
        screenshot: diagnostic.screenshot,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser.close();
}
