#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium, expect } from "@playwright/test";
import {
  PublicationAcceptanceError,
  republishWorld,
  runPublicationAcceptance,
  runTerminalReplacementAcceptance,
} from "./lib/publication-acceptance.mjs";
import { createPublicationTransport } from "./lib/publication-transport.mjs";

const MAIN_VERCEL_PROJECT_ID = "prj_oRks1By5wPlChGkGgHG0Kz4xYn17";
const PENDING_STATES = new Set([
  "INITIALIZING",
  "QUEUED",
  "BUILDING",
  "VERIFYING",
]);
const BASE = process.env.ORBSIE_TEST_URL ?? "https://orbsie.com";
const EVIDENCE = resolve(
  process.env.ORBSIE_TERMINAL_PUBLICATION_EVIDENCE_DIR ??
    "docs/evidence/publication-terminal",
);
const sourceFiles = [
  "scripts/verify-terminal-publication.mjs",
  "scripts/lib/publication-acceptance.mjs",
];

if (
  process.env.ORBSIE_LIVE_PUBLICATION !== "1" ||
  process.env.ORBSIE_CANCEL_TEST_REPLACEMENT !== "1"
) {
  console.log(
    "Terminal publication verification skipped: set ORBSIE_LIVE_PUBLICATION=1 and ORBSIE_CANCEL_TEST_REPLACEMENT=1 explicitly.",
  );
  process.exit(0);
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function readVercelCredential() {
  const path = process.env.ORBSIE_VERCEL_CREDENTIAL_PATH;
  if (!path)
    throw new Error(
      "Set ORBSIE_VERCEL_CREDENTIAL_PATH to an explicit local 0600 JSON or env file.",
    );
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600)
    throw new Error("The Vercel credential file must be a regular local file mode 0600.");
  const text = await readFile(path, "utf8");
  let values;
  if (path.endsWith(".json")) values = JSON.parse(text);
  else {
    values = Object.fromEntries(
      text.split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^\s*(VERCEL_DEPLOY_TOKEN|VERCEL_TEAM_ID|token|teamId)\s*=\s*["']?([^"']*)["']?\s*$/);
        return match ? [[match[1], match[2]]] : [];
      }),
    );
  }
  const token = values?.token ?? values?.VERCEL_DEPLOY_TOKEN;
  const teamId = values?.teamId ?? values?.VERCEL_TEAM_ID ?? process.env.ORBSIE_VERCEL_TEAM_ID;
  if (typeof token !== "string" || token.length === 0)
    throw new Error("The local Vercel credential file has no deployment token.");
  if (typeof teamId !== "string" || teamId.length === 0)
    throw new Error("The local Vercel credential file has no team ID.");
  return { token, teamId };
}

function responseBody(result) {
  return result?.body && typeof result.body === "object" ? result.body : {};
}

function requireSuccess(label, result) {
  if (!result?.ok && !(typeof result?.status === "number" && result.status >= 200 && result.status < 300))
    throw new Error(`${label} failed (HTTP ${result?.status ?? "unknown"}).`);
  return responseBody(result);
}

function cookieFromResult(result) {
  if (typeof result?.cookies === "string" && result.cookies.length > 0)
    return result.cookies;
  const lines = result?.response?.headers?.getSetCookie?.() ?? [];
  const cookie = lines.map((line) => line.split(";", 1)[0]).join("; ");
  if (cookie.length > 0) return cookie;
  throw new Error("Sign-up did not return a session cookie.");
}

async function browserReady(url, label, report) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let status = null;
  const screenshot = `${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    status = response?.status() ?? null;
    if (!response || !response.ok())
      throw new Error(`${label} failed (HTTP ${status ?? "unknown"}).`);
    await expect(page.locator('main[data-ready="true"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: join(EVIDENCE, screenshot), fullPage: true });
    report.browserChecks.push({ label, status, ready: true, canvas: true, pageErrors, screenshot });
    return { status, ready: true, canvas: true, pageErrors };
  } catch (error) {
    report.browserChecks.push({
      label,
      status,
      ready: false,
      canvas: false,
      pageErrors,
      error: error instanceof Error ? error.message : String(error),
    });
    if (pageErrors.length > 0) return { status, ready: false, canvas: false, pageErrors };
    throw new PublicationAcceptanceError(`${label} readiness check failed.`, { cause: error, status });
  } finally {
    await browser.close();
  }
}

async function vercelRequest(method, url, token, report) {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {}
  report.vercelCalls.push({ method, path: new URL(url).pathname, status: response.status });
  if (!response.ok)
    throw new Error(`Vercel ${method} ${new URL(url).pathname} failed (HTTP ${response.status}).`);
  return body;
}

const credential = await readVercelCredential();
const email =
  process.env.ORBSIE_TERMINAL_PUBLICATION_EMAIL ??
  `orbsie-terminal-${Date.now().toString(36)}@example.com`;
const password =
  process.env.ORBSIE_TERMINAL_PUBLICATION_PASSWORD ??
  `terminal-${Date.now().toString(36)}-pass-1`;
const world = {
  version: 1,
  id: `terminal-publication-${Date.now().toString(36)}`,
  title: "A tiny terminal continuity island",
  seed: 47,
  revision: 0,
  environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
  messages: [],
  entities: [
    {
      id: "tree-accept",
      label: "Friendly tree",
      position: [-2, 0, 1],
      color: "#6d9d58",
      scale: [1.25, 1.35, 1.25],
      geometry: { kind: "tree", detail: "refined" },
      behavior: { type: "static" },
      stage: "ready",
    },
    {
      id: "crystal-accept",
      label: "Glowing crystal",
      position: [1.5, 0.8, -1],
      color: "#a1f0d7",
      scale: [0.6, 0.6, 0.6],
      geometry: { kind: "crystal", detail: "refined" },
      behavior: { type: "collect" },
      stage: "ready",
    },
    {
      id: "portal-accept",
      label: "Sunlight portal",
      position: [0, 0, -3.5],
      color: "#eddbb7",
      scale: [1.2, 1.2, 1.2],
      geometry: { kind: "arch", detail: "refined" },
      behavior: { type: "portal" },
      stage: "ready",
    },
  ],
};
const report = {
  schemaVersion: "orbsie.terminal-publication/v1",
  status: "running",
  startedAt: new Date().toISOString(),
  base: new URL(BASE).origin,
  account: { email },
  world: { id: world.id, revision: world.revision, title: world.title },
  providerCalls: 0,
  publishPostCount: 0,
  cancellationCount: 0,
  vercelCalls: [],
  browserChecks: [],
  progress: null,
  first: null,
  replacement: null,
  checks: {},
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceHashes: {},
};
const evidenceWrite = async () => {
  await mkdir(EVIDENCE, { recursive: true });
  await writeFile(join(EVIDENCE, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
};
let firstSnapshotToken;
let cookies;
let cancellationUsed = false;
const rawTransport = createPublicationTransport(BASE);
const transport = {
  ...rawTransport,
  browserReady: (url, label) => browserReady(url, label, report),
  async request(path, init, label) {
    if (path === "/api/publish") {
      report.publishPostCount += 1;
      if (report.publishPostCount > 2) throw new Error("Exceeded the two publish POST bound.");
    }
    const result = await rawTransport.request(path, init, label);
    if (path === "/api/auth/sign-up/email") cookies = cookieFromResult(result);
    if (path === "/api/projects" && init?.body) {
      const body = JSON.parse(init.body);
      if (body.project?.revision === 1) firstSnapshotToken = responseBody(result).snapshotToken;
    }
    return result;
  },
};

try {
  const firstResult = await runPublicationAcceptance({
    transport: {
      ...transport,
      browserReady: (url, label) => browserReady(url, label, report),
    },
    world,
    email,
    password,
    republish: false,
    maxPolls: 24,
    pollDelayMs: 2000,
    onProgress: async (progress) => {
      report.progress = progress;
      await evidenceWrite();
    },
  });
  report.first = firstResult.first;
  assert.equal(report.publishPostCount, 1, "first publication POST count");
  assert.ok(cookies && firstSnapshotToken, "first publication credentials and CAS token were captured in memory");
  const firstWorld = structuredClone(world);
  firstWorld.revision = 1;
  const secondWorld = republishWorld(firstWorld);
  const secondSaved = await transport.request(
    "/api/projects",
    {
      method: "PUT",
      cookie: cookies,
      body: JSON.stringify({ project: secondWorld, baseRevision: 1, baseSnapshotToken: firstSnapshotToken }),
    },
    "cloud save terminal replacement",
  );
  const secondSavedBody = requireSuccess("cloud save terminal replacement", secondSaved);
  assert.equal(secondSavedBody.revision, 2, "terminal replacement cloud revision");
  const secondSubmitted = await transport.request(
    "/api/publish",
    {
      method: "POST",
      cookie: cookies,
      body: JSON.stringify({ projectId: secondWorld.id, revision: secondWorld.revision }),
    },
    "submit terminal replacement",
  );
  const secondBody = requireSuccess("submit terminal replacement", secondSubmitted);
  report.replacement = {
    submission: Object.fromEntries(["state", "deploymentId", "deploymentUrl", "vercelProjectId", "servedRevision"].map((key) => [key, secondBody[key]])),
  };
  await evidenceWrite();
  assert(PENDING_STATES.has(secondBody.state), `Replacement submission was not pending (${secondBody.state ?? "unknown"}).`);
  assert.equal(secondBody.vercelProjectId, firstResult.first.vercelProjectId, "replacement Vercel project");
  assert.notEqual(secondBody.deploymentId, firstResult.first.deploymentId, "replacement deployment identity");
  assert.ok(typeof secondBody.deploymentUrl === "string", "replacement deployment URL");
  assert.equal(report.publishPostCount, 2, "publish POST bound");
  assert.equal(secondBody.servedRevision, 1, "pending replacement retains served revision");
  // POST exposes the candidate deployment URL; owner GET reports the served
  // release. The terminal helper verifies that served URL after cancellation.
  assert.ok(typeof secondBody.deploymentId === "string" && secondBody.deploymentId.length > 0, "replacement deployment ID exists");
  const deploymentId = secondBody.deploymentId;
  const deployment = await vercelRequest(
    "GET",
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}?teamId=${encodeURIComponent(credential.teamId)}`,
    credential.token,
    report,
  );
  assert.equal(deployment.id, deploymentId, "Vercel returned exact requested deployment");
  assert(PENDING_STATES.has(deployment.readyState ?? deployment.status), "Vercel replacement is still pending immediately before cancellation");
  const deploymentProjectId = deployment.projectId ?? deployment.project?.id;
  assert.equal(deploymentProjectId, firstResult.first.vercelProjectId, "Vercel deployment project mapping");
  assert.notEqual(deploymentProjectId, MAIN_VERCEL_PROJECT_ID, "test deployment must exclude the main project");
  assert.notEqual(deploymentId, firstResult.first.deploymentId, "Vercel deployment differs from first release");
  if (cancellationUsed) throw new Error("Cancellation already used.");
  cancellationUsed = true;
  report.cancellationCount += 1;
  await vercelRequest(
    "PATCH",
    `https://api.vercel.com/v12/deployments/${encodeURIComponent(deploymentId)}/cancel?teamId=${encodeURIComponent(credential.teamId)}`,
    credential.token,
    report,
  );
  const terminal = await runTerminalReplacementAcceptance({
    transport,
    cookies,
    projectId: firstWorld.id,
    firstRelease: firstResult.first,
    firstWorld,
    secondSubmission: secondBody,
    maxPolls: 24,
    pollDelayMs: 2000,
    onProgress: async (progress) => {
      report.progress = progress;
      await evidenceWrite();
    },
  });
  report.replacement = terminal;
  report.checks = {
    firstReleaseReady: true,
    firstSnapshotReadiness: true,
    secondSavedWithCas: true,
    replacementPendingBeforeCancel: true,
    replacementDeploymentDistinct: true,
    sameVercelProject: true,
    terminalFailureObserved: ["ERROR", "CANCELED"].includes(terminal.state),
    originalDeploymentRetained: terminal.status.deploymentUrl === firstResult.first.deploymentUrl,
    originalServedRevisionRetained: terminal.status.servedRevision === firstWorld.revision,
    exactOldSnapshotRetained: terminal.oldRelease.snapshot?.revision === firstWorld.revision,
    providerCalls: report.providerCalls === 0,
    publishPostBound: report.publishPostCount === 2,
    cancellationBound: report.cancellationCount === 1,
  };
  report.status = Object.values(report.checks).every(Boolean) ? "passed" : "failed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message.slice(0, 1200) : String(error).slice(0, 1200);
  process.exitCode = 1;
} finally {
  for (const path of sourceFiles)
    report.sourceHashes[path] = await sha256(path).catch(() => null);
  report.finishedAt = new Date().toISOString();
  await evidenceWrite();
  credential.token = undefined;
  cookies = undefined;
}

if (report.status !== "passed")
  console.error(`Terminal publication verification failed: ${report.error ?? "a correctness gate failed"}`);
