#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import { chromium, expect, request } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import {
  assertLivePublicationOptIn,
  PublicationAcceptanceError,
} from "./lib/publication-acceptance.mjs";
import { createPublicationTransport } from "./lib/publication-transport.mjs";

const EXPECTED_PROJECT_ID = "4a5d7783-c7fd-44e0-bf19-864bab9f9b08";
const EXPECTED_REVISION = 9;
const DEFAULT_BASE = "http://127.0.0.1:3017";
const DEFAULT_FIXTURE = ".vercel/dev-generated-cloud-state.json";
const DEFAULT_ZIP =
  "docs/evidence/provider-e2e/gateway-reload-recovery/gateway/world.zip";
const DEFAULT_EVIDENCE =
  "docs/evidence/provider-e2e/gateway-reload-recovery-publication";
const GENERATION_PATHS = new Set([
  "/api/generate",
  "/api/chatgpt/generate",
  "/generate",
]);

function responseBody(result) {
  return result?.body && typeof result.body === "object" ? result.body : {};
}

function statusOf(result) {
  return typeof result?.status === "number" ? result.status : 0;
}

function requireResponse(label, result) {
  const status = statusOf(result);
  const body = responseBody(result);
  if (status === 401 || status === 403 || status === 429)
    throw new PublicationAcceptanceError(
      `${label} stopped at HTTP ${status}; no retry is permitted.`,
      { status },
    );
  if (status < 200 || status >= 300)
    throw new PublicationAcceptanceError(
      `${label} failed (HTTP ${status}).`,
      { status },
    );
  if (["PROTECTED", "ERROR", "CANCELED"].includes(body.state) || body.error)
    throw new PublicationAcceptanceError(
      `${label} returned a blocked publication state.`,
      { status, state: body.state },
    );
  return body;
}

function vercelProjectId(body) {
  for (const key of ["vercelProjectId", "vercel_project_id"])
    if (typeof body?.[key] === "string" && body[key].length > 0)
      return body[key];
  return undefined;
}

function publicDeploymentUrl(body, label) {
  const value = body?.deploymentUrl ?? body?.url ?? body?.publicUrl;
  if (typeof value !== "string" || value.length === 0)
    throw new PublicationAcceptanceError(`${label} omitted its deployment URL.`);
  return value.replace(/\/$/, "");
}

function assertLocalTarget(base) {
  const target = new URL(base);
  if (
    target.protocol !== "http:" ||
    !new Set(["127.0.0.1", "localhost"]).has(target.hostname)
  )
    throw new PublicationAcceptanceError(
      "Existing-project publication requires a loopback development target.",
    );
}

function cookieHeader(storageState) {
  const cookies = Array.isArray(storageState?.cookies)
    ? storageState.cookies
    : [];
  const header = cookies
    .filter((cookie) => typeof cookie?.name === "string")
    .map((cookie) => `${cookie.name}=${cookie.value ?? ""}`)
    .join("; ");
  if (!header) throw new PublicationAcceptanceError("Sign-in returned no session cookie.");
  return header;
}

function snapshotFromProjectsResponse(body) {
  const snapshot = body?.project?.snapshot;
  if (!snapshot || typeof snapshot !== "object")
    throw new PublicationAcceptanceError(
      "The authenticated project lookup omitted its snapshot.",
    );
  return snapshot;
}

// Cloud checkpoints retain chat history; exports and published project.json
// intentionally remove it. Compare the complete publishable snapshot while
// keeping every scene/game/revision field exact.
function publishableSnapshot(project) {
  return { ...project, messages: [] };
}

async function loadArtifact(zipPath) {
  const bytes = await readFile(zipPath);
  const files = unzipSync(bytes);
  const projectBytes = files["project.json"];
  if (!projectBytes)
    throw new PublicationAcceptanceError("The saved Gateway ZIP omitted project.json.");
  let project;
  try {
    project = JSON.parse(strFromU8(projectBytes));
  } catch {
    throw new PublicationAcceptanceError("The saved Gateway project.json was invalid.");
  }
  assert.equal(project.id, EXPECTED_PROJECT_ID, "artifact project identity");
  assert.equal(project.revision, EXPECTED_REVISION, "artifact revision");
  if (!project.game || project.game.rules?.length !== 3)
    throw new PublicationAcceptanceError(
      "The saved Gateway artifact is not the expected three-rule input game.",
    );
  return {
    project,
    sha256: createHash("sha256").update(projectBytes).digest("hex"),
    bytes: projectBytes.byteLength,
  };
}

async function writeReport(path, report) {
  await mkdir(path, { recursive: true });
  await writeFile(`${path}/report.json`, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function validateSignedOutGameplay(deploymentUrl, evidenceDir, report) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const targetOrigin = new URL(deploymentUrl).origin;
  const generationRoutes = [];
  const externalRoutes = [];
  const pageErrors = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (GENERATION_PATHS.has(url.pathname)) {
      generationRoutes.push(url.pathname);
      await route.abort("blockedbyclient");
      return;
    }
    if (
      url.protocol === "data:" ||
      url.protocol === "blob:" ||
      url.origin === targetOrigin
    ) {
      await route.continue();
      return;
    }
    externalRoutes.push(url.origin || url.protocol);
    await route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error?.message ?? "pageerror"));
  try {
    const response = await page.goto(deploymentUrl, {
      waitUntil: "domcontentloaded",
    });
    assert(response?.ok(), `published page HTTP ${response?.status() ?? "unknown"}`);
    await expect(page.locator('main[data-ready="true"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
    const score = page.locator(".score");
    await expect(score).toHaveText("Score: 0");
    await page.keyboard.press("d", { delay: 100 });
    await expect(score).toHaveText("Score: 7");
    await page.getByRole("button", { name: /Restart/ }).click();
    await expect(score).toHaveText("Score: 0");
    await page.keyboard.press("w", { delay: 100 });
    await expect(page.locator(".win")).toContainText("Final score: 0");
    await page.getByRole("button", { name: /Restart/ }).click();
    await expect(score).toHaveText("Score: 0");
    await page.keyboard.press("a", { delay: 100 });
    await expect(page.locator(".win")).toContainText("Try another adventure");
    await page.screenshot({ path: `${evidenceDir}/signed-out-input-game.png` });
    assert.deepEqual(generationRoutes, []);
    assert.deepEqual(externalRoutes, []);
    assert.deepEqual(pageErrors, []);
    assert.equal((await context.cookies()).length, 0);
    report.browser = {
      status: "passed",
      ready: true,
      canvas: true,
      scoreRight: 7,
      win: true,
      loss: true,
      restart: true,
      generationRoutes: generationRoutes.length,
      externalRoutes: externalRoutes.length,
      cookies: 0,
      pageErrors: pageErrors.length,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  assertLivePublicationOptIn();
  const base = process.env.ORBSIE_TEST_URL ?? DEFAULT_BASE;
  const fixturePath = process.env.ORBSIE_CLOUD_FIXTURE ?? DEFAULT_FIXTURE;
  const zipPath = process.env.ORBSIE_GATEWAY_ARTIFACT ?? DEFAULT_ZIP;
  const evidenceDir =
    process.env.ORBSIE_PUBLICATION_EVIDENCE_DIR ?? DEFAULT_EVIDENCE;
  const prepareOnly = process.env.ORBSIE_PUBLICATION_PREPARE_ONLY === "1";
  const execute = process.env.ORBSIE_PUBLICATION_EXECUTE === "1";
  const report = {
    status: "running",
    scope: "Existing Gateway recovery project publication; no generation",
    baseOrigin: new URL(base).origin,
    projectId: EXPECTED_PROJECT_ID,
    expectedRevision: EXPECTED_REVISION,
    generationCalls: 0,
    generationRoutesBlocked: 0,
    artifact: null,
    preflight: null,
    publication: null,
    browser: null,
  };
  await mkdir(evidenceDir, { recursive: true });
  try {
    assertLocalTarget(base);
    const artifact = await loadArtifact(zipPath);
    report.artifact = {
      path: zipPath,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      projectId: artifact.project.id,
      revision: artifact.project.revision,
      title: artifact.project.title,
      entityCount: artifact.project.entities?.length ?? 0,
      gameRuleCount: artifact.project.game.rules.length,
    };
    if (prepareOnly) {
      report.status = "prepared";
      return report;
    }
    if (!execute)
      throw new PublicationAcceptanceError(
        "Set ORBSIE_PUBLICATION_EXECUTE=1 only after reviewing this existing-project publication command.",
      );
    const fixtureMode = await stat(fixturePath);
    if ((fixtureMode.mode & 0o077) !== 0)
      throw new PublicationAcceptanceError("The cloud fixture must be mode 0600 or stricter.");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    if (fixture.baseURL !== base)
      throw new PublicationAcceptanceError("The cloud fixture origin does not match the target.");
    if (!fixture.credentials || typeof fixture.credentials !== "object")
      throw new PublicationAcceptanceError("The cloud fixture has no credentials.");

    const auth = await request.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
      timeout: 30_000,
    });
    let cookies;
    try {
      const signIn = await auth.post("/api/auth/sign-in/email", {
        data: fixture.credentials,
        maxRedirects: 0,
      });
      if (signIn.status() === 429)
        throw new PublicationAcceptanceError("Sign-in rate limited; no retry.", {
          status: 429,
        });
      if (!signIn.ok())
        throw new PublicationAcceptanceError(`Sign-in failed (HTTP ${signIn.status()}).`, {
          status: signIn.status(),
        });
      cookies = cookieHeader(await auth.storageState());
    } finally {
      await auth.dispose();
    }

    const transport = createPublicationTransport(base);
    const requestPaths = [];
    const safeRequest = async (path, init, label) => {
      const pathname = new URL(path, base).pathname;
      if (GENERATION_PATHS.has(pathname))
        throw new PublicationAcceptanceError(`${label} attempted a generation route.`);
      requestPaths.push(pathname);
      return transport.request(path, { ...init, cookie: cookies }, label);
    };
    const cloudResult = await safeRequest(
      `/api/projects?id=${encodeURIComponent(EXPECTED_PROJECT_ID)}`,
      {},
      "existing cloud snapshot",
    );
    const cloudBody = requireResponse("existing cloud snapshot", cloudResult);
    const cloudSnapshot = snapshotFromProjectsResponse(cloudBody);
    assert.deepEqual(
      publishableSnapshot(cloudSnapshot),
      publishableSnapshot(artifact.project),
      "existing cloud snapshot matches ZIP publishable content",
    );
    assert.equal(cloudSnapshot.revision, EXPECTED_REVISION);
    report.preflight = {
      status: "passed",
      projectId: cloudSnapshot.id,
      revision: cloudSnapshot.revision,
      comparedAs: "publishable snapshot (messages cleared like export/publication)",
      snapshotTokenPresent: typeof cloudBody.project.snapshotToken === "string",
    };

    const submitted = await safeRequest(
      "/api/publish",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: EXPECTED_PROJECT_ID,
          revision: EXPECTED_REVISION,
        }),
      },
      "publish existing Gateway recovery project",
    );
    const submittedBody = requireResponse("publish existing Gateway recovery project", submitted);
    const postProjectId = vercelProjectId(submittedBody);
    const maxPolls = Number(process.env.ORBSIE_PUBLICATION_MAX_POLLS ?? 120);
    if (!Number.isSafeInteger(maxPolls) || maxPolls < 1 || maxPolls > 240)
      throw new PublicationAcceptanceError("ORBSIE_PUBLICATION_MAX_POLLS must be between 1 and 240.");
    let readyBody;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      const statusResult = await safeRequest(
        `/api/publish?projectId=${encodeURIComponent(EXPECTED_PROJECT_ID)}`,
        {},
        "publish existing Gateway recovery project status",
      );
      const statusBody = requireResponse(
        "publish existing Gateway recovery project status",
        statusResult,
      );
      if (statusBody.state === "READY") {
        readyBody = statusBody;
        break;
      }
      if (attempt + 1 < maxPolls)
        await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    if (!readyBody)
      throw new PublicationAcceptanceError("Existing project publication did not become READY within the bounded poll budget.");
    const getProjectId = vercelProjectId(readyBody);
    if (!postProjectId || !getProjectId)
      throw new PublicationAcceptanceError("Publication did not expose Vercel project identity in both POST and GET.");
    assert.equal(getProjectId, postProjectId, "publication Vercel project mapping");
    const deploymentUrl = publicDeploymentUrl(readyBody, "existing project publication");
    const deploymentId = readyBody.deploymentId ?? submittedBody.deploymentId;
    if (typeof deploymentId !== "string" || deploymentId.length === 0)
      throw new PublicationAcceptanceError("Existing project publication omitted deployment identity.");
    const publicProjectResult = await transport.publicGet(
      `${deploymentUrl}/project.json`,
      "signed-out published project snapshot",
    );
    if (statusOf(publicProjectResult) !== 200)
      throw new PublicationAcceptanceError("Signed-out published project snapshot was not HTTP 200.");
    const publicProject = JSON.parse(publicProjectResult.text);
    assert.deepEqual(publicProject, artifact.project, "signed-out snapshot matches ZIP");
    report.publication = {
      status: "READY",
      deploymentId,
      deploymentUrl,
      postVercelProjectId: postProjectId,
      getVercelProjectId: getProjectId,
      servedRevision: readyBody.servedRevision ?? null,
      requestPaths,
    };
    await validateSignedOutGameplay(deploymentUrl, evidenceDir, report);
    report.generationRoutesBlocked = report.browser?.generationRoutes ?? 0;
    report.status = "passed";
    return report;
  } catch (error) {
    report.status = "failed";
    report.error =
      error instanceof Error ? error.message.slice(0, 1200) : "Publication preparation failed.";
    process.exitCode = 1;
    return report;
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeReport(evidenceDir, report);
    console.log(JSON.stringify(report, null, 2));
  }
}

await main();
