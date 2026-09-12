#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
const SOURCE_REVISION = 9;
const TARGET_REVISION = 10;
const EXPECTED_VERCEL_PROJECT_ID = "prj_2sG67u1U0jO8mDEWT2lMWMkm64zi";
const EXPECTED_OLD_DEPLOYMENT_ID = "dpl_8SXrutydgMwHjWxZxqSnsb2Z6WDf";
const EXPECTED_NEW_DEPLOYMENT_ID = "dpl_BrHgxz6AhGdqVYbVBEdsbthhLqSS";
const EXPECTED_NEW_DEPLOYMENT_URL =
  "https://orb-c8952b5b6fd77ac951a4-jp58uek10-grappeggias-projects.vercel.app";
const DEFAULT_BASE = "http://127.0.0.1:3017";
const DEFAULT_FIXTURE = ".vercel/dev-generated-cloud-state.json";
const DEFAULT_ZIP =
  "docs/evidence/provider-e2e/gateway-reload-recovery/gateway/world.zip";
const DEFAULT_EVIDENCE =
  "docs/evidence/provider-e2e/gateway-reload-recovery-republish";
const DEFAULT_RESUME_EVIDENCE = `${DEFAULT_EVIDENCE}-resume`;
const DEFAULT_RESUME_REPORT = `${DEFAULT_EVIDENCE}/report.json`;
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

function currentSourceCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
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
    throw new PublicationAcceptanceError(`${label} failed (HTTP ${status}).`, {
      status,
    });
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
    throw new PublicationAcceptanceError(
      `${label} omitted its deployment URL.`,
    );
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
  if (!header)
    throw new PublicationAcceptanceError("Sign-in returned no session cookie.");
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

async function loadCurrentPlayerRuntime() {
  const [runtimeJS, runtimeCSS] = await Promise.all([
    readFile("public/player/runtime.js"),
    readFile("public/player/runtime.css"),
  ]);
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  return {
    runtimeJS: { bytes: runtimeJS.byteLength, sha256: digest(runtimeJS) },
    runtimeCSS: { bytes: runtimeCSS.byteLength, sha256: digest(runtimeCSS) },
    viewportMeta:
      '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  };
}

async function publicText(transport, deploymentUrl, file, label) {
  const result = await transport.publicGet(
    `${deploymentUrl}/${file}`,
    `${label} ${file}`,
  );
  if (statusOf(result) !== 200)
    throw new PublicationAcceptanceError(
      `${label} ${file} was not HTTP 200 (HTTP ${statusOf(result)}).`,
      { status: statusOf(result) },
    );
  return typeof result.text === "string" ? result.text : "";
}

// Cloud checkpoints retain chat history; exports and published project.json
// intentionally remove it. Compare the complete publishable snapshot while
// keeping every scene/game/revision field exact.
function publishableSnapshot(project) {
  return { ...project, messages: [] };
}

function sceneContent(project) {
  const content = structuredClone(publishableSnapshot(project));
  delete content.revision;
  return content;
}

async function loadArtifact(zipPath) {
  const bytes = await readFile(zipPath);
  const files = unzipSync(bytes);
  const projectBytes = files["project.json"];
  if (!projectBytes)
    throw new PublicationAcceptanceError(
      "The saved Gateway ZIP omitted project.json.",
    );
  let project;
  try {
    project = JSON.parse(strFromU8(projectBytes));
  } catch {
    throw new PublicationAcceptanceError(
      "The saved Gateway project.json was invalid.",
    );
  }
  assert.equal(project.id, EXPECTED_PROJECT_ID, "artifact project identity");
  assert.equal(project.revision, SOURCE_REVISION, "artifact revision");
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

function targetProjectFromArtifact(artifact) {
  const target = structuredClone(artifact.project);
  target.revision = TARGET_REVISION;
  return target;
}

async function writeReport(path, report) {
  await mkdir(path, { recursive: true });
  await writeFile(
    `${path}/report.json`,
    `${JSON.stringify(report, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
}

async function touchButton(page, cdp, name, id = 1) {
  const button =
    name instanceof RegExp
      ? page.getByRole("button", { name })
      : page.getByRole("button", { name, exact: true });
  const box = await button.boundingBox();
  assert(box, `Missing signed-out touch control ${String(name)}.`);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id }],
  });
  await page.waitForTimeout(180);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
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
  const targetOrigin = new URL(deploymentUrl).origin;
  try {
    const modes = [
      {
        name: "desktop-keyboard",
        viewport: { width: 1280, height: 800 },
        touch: false,
        screenshot: "signed-out-input-game.png",
      },
      {
        name: "portrait-touch",
        viewport: { width: 390, height: 844 },
        touch: true,
        screenshot: "signed-out-input-game-portrait-touch.png",
      },
      {
        name: "landscape-touch",
        viewport: { width: 844, height: 390 },
        touch: true,
        screenshot: "signed-out-input-game-landscape-touch.png",
      },
    ];
    const modeReports = [];
    let generationRoutesTotal = 0;
    let externalRoutesTotal = 0;
    let pageErrorsTotal = 0;
    for (const mode of modes) {
      const context = await browser.newContext({
        viewport: mode.viewport,
        ...(mode.touch ? { isMobile: true, hasTouch: true } : {}),
      });
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
      page.on("pageerror", (error) =>
        pageErrors.push(error?.message ?? "pageerror"),
      );
      try {
        const response = await page.goto(deploymentUrl, {
          waitUntil: "domcontentloaded",
        });
        assert(
          response?.ok(),
          `published page HTTP ${response?.status() ?? "unknown"}`,
        );
        await expect(page.locator('main[data-ready="true"]')).toBeVisible({
          timeout: 30_000,
        });
        await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
        const score = page.locator(".score");
        await expect(score).toHaveText("Score: 0");
        if (mode.touch) {
          await expect(page.locator(".controls")).toBeVisible();
          await expect(page.locator("footer")).toContainText(
            "Use the controls below to move and jump",
          );
          const cdp = await context.newCDPSession(page);
          await touchButton(page, cdp, "Right");
          await expect(score).toHaveText("Score: 7");
          await touchButton(page, cdp, /Restart/);
          await expect(score).toHaveText("Score: 0");
          await touchButton(page, cdp, "Forward");
          await expect(page.locator(".win")).toContainText("Final score: 0");
          await touchButton(page, cdp, /Restart/);
          await expect(score).toHaveText("Score: 0");
          await touchButton(page, cdp, "Left");
        } else {
          await page.keyboard.press("d", { delay: 100 });
          await expect(score).toHaveText("Score: 7");
          await page.getByRole("button", { name: /Restart/ }).click();
          await expect(score).toHaveText("Score: 0");
          await page.keyboard.press("w", { delay: 100 });
          await expect(page.locator(".win")).toContainText("Final score: 0");
          await page.getByRole("button", { name: /Restart/ }).click();
          await expect(score).toHaveText("Score: 0");
          await page.keyboard.press("a", { delay: 100 });
        }
        await expect(page.locator(".win")).toContainText(
          "Try another adventure",
        );
        await page.screenshot({ path: `${evidenceDir}/${mode.screenshot}` });
        assert.deepEqual(generationRoutes, []);
        assert.deepEqual(externalRoutes, []);
        assert.deepEqual(pageErrors, []);
        assert.equal((await context.cookies()).length, 0);
        modeReports.push({
          name: mode.name,
          viewport: mode.viewport,
          touch: mode.touch,
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
        });
        generationRoutesTotal += generationRoutes.length;
        externalRoutesTotal += externalRoutes.length;
        pageErrorsTotal += pageErrors.length;
      } finally {
        await context.close();
      }
    }
    report.browser = {
      status: "passed",
      ready: true,
      canvas: true,
      scoreRight: 7,
      win: true,
      loss: true,
      restart: true,
      generationRoutes: generationRoutesTotal,
      externalRoutes: externalRoutesTotal,
      cookies: 0,
      pageErrors: pageErrorsTotal,
      modes: modeReports,
    };
  } finally {
    await browser.close();
  }
}

async function validateReadOnlyResume(
  deploymentUrl,
  evidenceDir,
  report,
  artifact,
  recordedReport,
) {
  const recordedPublication = recordedReport?.publication;
  if (!recordedPublication || typeof recordedPublication !== "object")
    throw new PublicationAcceptanceError(
      "Read-only resume report omitted the submitted publication handle.",
    );
  assert.equal(recordedReport.status, "failed");
  assert.equal(recordedReport.save?.status, "CAS_VERIFIED");
  assert.equal(recordedReport.projectId, EXPECTED_PROJECT_ID);
  assert.equal(recordedReport.sourceRevision, SOURCE_REVISION);
  assert.equal(recordedReport.targetRevision, TARGET_REVISION);
  assert.equal(recordedPublication.revision, TARGET_REVISION);
  assert.equal(recordedPublication.status, "SUBMITTED");
  assert.equal(
    recordedPublication.postVercelProjectId,
    EXPECTED_VERCEL_PROJECT_ID,
  );
  assert.equal(recordedPublication.deploymentId, EXPECTED_NEW_DEPLOYMENT_ID);
  assert.equal(recordedPublication.deploymentUrl, EXPECTED_NEW_DEPLOYMENT_URL);
  assert.equal(deploymentUrl, recordedPublication.deploymentUrl);

  const targetProject = targetProjectFromArtifact(artifact);
  const transport = createPublicationTransport(new URL(deploymentUrl).origin);
  const publicIndex = await publicText(
    transport,
    deploymentUrl,
    "index.html",
    "read-only published runtime",
  );
  const publicRuntimeJS = await publicText(
    transport,
    deploymentUrl,
    "runtime.js",
    "read-only published runtime",
  );
  const publicRuntimeCSS = await publicText(
    transport,
    deploymentUrl,
    "runtime.css",
    "read-only published runtime",
  );
  assert.match(
    publicIndex,
    /<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*">/,
  );
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(digest(publicRuntimeJS), report.currentRuntime.runtimeJS.sha256);
  assert.equal(
    digest(publicRuntimeCSS),
    report.currentRuntime.runtimeCSS.sha256,
  );
  const publicProject = JSON.parse(
    await publicText(
      transport,
      deploymentUrl,
      "project.json",
      "read-only published project snapshot",
    ),
  );
  assert.deepEqual(
    publicProject,
    publishableSnapshot(targetProject),
    "read-only snapshot matches target publishable snapshot",
  );
  report.recordedPublication = {
    projectId: EXPECTED_PROJECT_ID,
    vercelProjectId: EXPECTED_VERCEL_PROJECT_ID,
    revision: TARGET_REVISION,
    deploymentId: recordedPublication.deploymentId,
    deploymentUrl,
  };
  report.publication = {
    status: "READ_ONLY_VERIFIED",
    revision: TARGET_REVISION,
    deploymentId: recordedPublication.deploymentId,
    deploymentUrl,
    vercelProjectId: EXPECTED_VERCEL_PROJECT_ID,
    runtime: {
      indexViewportFitCover: true,
      runtimeJS: {
        local: report.currentRuntime.runtimeJS,
        public: {
          bytes: Buffer.byteLength(publicRuntimeJS),
          sha256: digest(publicRuntimeJS),
        },
      },
      runtimeCSS: {
        local: report.currentRuntime.runtimeCSS,
        public: {
          bytes: Buffer.byteLength(publicRuntimeCSS),
          sha256: digest(publicRuntimeCSS),
        },
      },
    },
    snapshot: {
      status: "passed",
      projectId: publicProject.id,
      revision: publicProject.revision,
      messages: Array.isArray(publicProject.messages)
        ? publicProject.messages.length
        : null,
    },
    requestMode: "public GET only",
  };
  await validateSignedOutGameplay(deploymentUrl, evidenceDir, report);
  report.generationRoutesBlocked = report.browser?.generationRoutes ?? 0;
}

async function main() {
  assertLivePublicationOptIn();
  const base = process.env.ORBSIE_TEST_URL ?? DEFAULT_BASE;
  const fixturePath = process.env.ORBSIE_CLOUD_FIXTURE ?? DEFAULT_FIXTURE;
  const zipPath = process.env.ORBSIE_GATEWAY_ARTIFACT ?? DEFAULT_ZIP;
  const resumeOnly = process.env.ORBSIE_PUBLICATION_RESUME_ONLY === "1";
  const recordedReportPath =
    process.env.ORBSIE_PUBLICATION_RESUME_REPORT ?? DEFAULT_RESUME_REPORT;
  const evidenceDir =
    process.env.ORBSIE_PUBLICATION_EVIDENCE_DIR ??
    (resumeOnly ? DEFAULT_RESUME_EVIDENCE : DEFAULT_EVIDENCE);
  const prepareOnly = process.env.ORBSIE_PUBLICATION_PREPARE_ONLY === "1";
  const execute = process.env.ORBSIE_PUBLICATION_EXECUTE === "1";
  const report = {
    status: "running",
    scope: resumeOnly
      ? "Read-only verification of submitted Gateway recovery publication revision 10; no authentication or writes"
      : "Existing Gateway recovery project CAS revision 10 publication; no generation",
    mode: resumeOnly ? "read-only-resume" : "mutation-preparation",
    sourceCommit: currentSourceCommit(),
    baseOrigin: new URL(base).origin,
    projectId: EXPECTED_PROJECT_ID,
    sourceRevision: SOURCE_REVISION,
    targetRevision: TARGET_REVISION,
    generationCalls: 0,
    generationRoutesBlocked: 0,
    artifact: null,
    currentRuntime: null,
    preflight: null,
    save: null,
    publication: null,
    browser: null,
  };
  await mkdir(evidenceDir, { recursive: true });
  try {
    if (!resumeOnly) assertLocalTarget(base);
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
    report.currentRuntime = await loadCurrentPlayerRuntime();
    if (resumeOnly) {
      if (execute)
        throw new PublicationAcceptanceError(
          "Read-only resume cannot run with ORBSIE_PUBLICATION_EXECUTE=1.",
        );
      if (prepareOnly)
        throw new PublicationAcceptanceError(
          "Read-only resume cannot combine with prepare-only mode.",
        );
      let recordedReport;
      try {
        recordedReport = JSON.parse(await readFile(recordedReportPath, "utf8"));
      } catch {
        throw new PublicationAcceptanceError(
          "Read-only resume could not load the recorded publication report.",
        );
      }
      await validateReadOnlyResume(
        EXPECTED_NEW_DEPLOYMENT_URL,
        evidenceDir,
        report,
        artifact,
        recordedReport,
      );
      report.status = "passed";
      return report;
    }
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
      throw new PublicationAcceptanceError(
        "The cloud fixture must be mode 0600 or stricter.",
      );
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    if (fixture.baseURL !== base)
      throw new PublicationAcceptanceError(
        "The cloud fixture origin does not match the target.",
      );
    if (!fixture.credentials || typeof fixture.credentials !== "object")
      throw new PublicationAcceptanceError(
        "The cloud fixture has no credentials.",
      );

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
        throw new PublicationAcceptanceError(
          "Sign-in rate limited; no retry.",
          {
            status: 429,
          },
        );
      if (!signIn.ok())
        throw new PublicationAcceptanceError(
          `Sign-in failed (HTTP ${signIn.status()}).`,
          {
            status: signIn.status(),
          },
        );
      cookies = cookieHeader(await auth.storageState());
    } finally {
      await auth.dispose();
    }

    const transport = createPublicationTransport(base);
    const requestPaths = [];
    const safeRequest = async (path, init, label) => {
      const pathname = new URL(path, base).pathname;
      if (GENERATION_PATHS.has(pathname))
        throw new PublicationAcceptanceError(
          `${label} attempted a generation route.`,
        );
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
    if (cloudSnapshot.revision !== SOURCE_REVISION) {
      report.preflight = {
        status: "failed",
        phase: "source-revision",
        expectedRevision: SOURCE_REVISION,
        observedRevision: cloudSnapshot.revision ?? null,
        writeAttempted: false,
      };
      throw new PublicationAcceptanceError(
        `Refusing resumed publication: expected source revision ${SOURCE_REVISION}, found ${cloudSnapshot.revision}. No CAS save or deployment was attempted.`,
      );
    }
    assert.deepEqual(
      publishableSnapshot(cloudSnapshot),
      publishableSnapshot(artifact.project),
      "existing cloud snapshot matches ZIP publishable content",
    );
    assert.equal(cloudSnapshot.revision, SOURCE_REVISION);
    report.preflight = {
      status: "passed",
      projectId: cloudSnapshot.id,
      revision: cloudSnapshot.revision,
      targetRevision: TARGET_REVISION,
      comparedAs:
        "publishable snapshot (messages cleared like export/publication)",
      snapshotTokenPresent: typeof cloudBody.project.snapshotToken === "string",
    };

    const existingStatusResult = await safeRequest(
      `/api/publish?projectId=${encodeURIComponent(EXPECTED_PROJECT_ID)}`,
      {},
      "existing publication preflight status",
    );
    const existingStatus = requireResponse(
      "existing publication preflight status",
      existingStatusResult,
    );
    if (existingStatus.state !== "READY")
      throw new PublicationAcceptanceError(
        `Existing publication preflight was not READY (${existingStatus.state ?? "unknown"}).`,
        { state: existingStatus.state },
      );
    const existingProjectId = vercelProjectId(existingStatus);
    assert.equal(
      existingProjectId,
      EXPECTED_VERCEL_PROJECT_ID,
      "existing Vercel project mapping",
    );
    const existingDeploymentUrl = publicDeploymentUrl(
      existingStatus,
      "existing publication preflight",
    );
    const existingDeploymentId = existingStatus.deploymentId;
    if (
      typeof existingDeploymentId !== "string" ||
      existingDeploymentId.length === 0
    )
      throw new PublicationAcceptanceError(
        "Existing publication preflight omitted deployment identity; cannot prove the republish replaces the expected deployment.",
      );
    assert.equal(
      existingDeploymentId,
      EXPECTED_OLD_DEPLOYMENT_ID,
      "existing deployment identity",
    );
    assert.equal(
      existingStatus.servedRevision,
      SOURCE_REVISION,
      "existing publication served revision",
    );
    report.preflight.existingPublication = {
      state: existingStatus.state,
      servedRevision: existingStatus.servedRevision ?? null,
      deploymentUrl: existingDeploymentUrl,
      deploymentId: existingDeploymentId,
      vercelProjectId: existingProjectId,
    };

    const sourceSnapshotToken = cloudBody.project?.snapshotToken;
    if (
      typeof sourceSnapshotToken !== "string" ||
      !/^[a-f0-9]{64}$/.test(sourceSnapshotToken)
    )
      throw new PublicationAcceptanceError(
        "Source cloud snapshot omitted a valid CAS token; no write was attempted.",
      );
    const targetProject = structuredClone(cloudSnapshot);
    targetProject.revision = TARGET_REVISION;
    assert.deepEqual(
      sceneContent(targetProject),
      sceneContent(cloudSnapshot),
      "target revision preserves source scene and game content",
    );
    const saved = await safeRequest(
      "/api/projects",
      {
        method: "PUT",
        body: JSON.stringify({
          project: targetProject,
          baseRevision: SOURCE_REVISION,
          baseSnapshotToken: sourceSnapshotToken,
        }),
      },
      "save unchanged target revision",
    );
    const savedBody = requireResponse("save unchanged target revision", saved);
    if (savedBody.revision !== TARGET_REVISION)
      throw new PublicationAcceptanceError(
        `Target revision save returned ${savedBody.revision ?? "no revision"}; refusing publication.`,
      );
    if (
      typeof savedBody.snapshotToken !== "string" ||
      !/^[a-f0-9]{64}$/.test(savedBody.snapshotToken)
    )
      throw new PublicationAcceptanceError(
        "Target revision save omitted a valid CAS token; refusing publication.",
      );
    report.save = {
      status: "CAS_COMMITTED",
      sourceRevision: SOURCE_REVISION,
      targetRevision: TARGET_REVISION,
      snapshotTokenPresent: true,
    };
    await writeReport(evidenceDir, report);
    const targetCloudResult = await safeRequest(
      `/api/projects?id=${encodeURIComponent(EXPECTED_PROJECT_ID)}`,
      {},
      "target cloud snapshot",
    );
    const targetCloudBody = requireResponse(
      "target cloud snapshot",
      targetCloudResult,
    );
    const targetCloudSnapshot = snapshotFromProjectsResponse(targetCloudBody);
    if (targetCloudSnapshot.revision !== TARGET_REVISION)
      throw new PublicationAcceptanceError(
        `Target cloud snapshot is revision ${targetCloudSnapshot.revision ?? "unknown"}; refusing publication.`,
      );
    assert.deepEqual(
      sceneContent(targetCloudSnapshot),
      sceneContent(targetProject),
      "target cloud snapshot preserves source scene and game content",
    );
    report.save.status = "CAS_VERIFIED";

    const submitted = await safeRequest(
      "/api/publish",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: EXPECTED_PROJECT_ID,
          revision: TARGET_REVISION,
        }),
      },
      "publish unchanged target revision",
    );
    const submittedBody = requireResponse(
      "publish unchanged target revision",
      submitted,
    );
    const postProjectId = vercelProjectId(submittedBody);
    assert.equal(
      postProjectId,
      EXPECTED_VERCEL_PROJECT_ID,
      "POST Vercel project mapping",
    );
    const submittedDeploymentId = submittedBody.deploymentId;
    if (
      typeof submittedDeploymentId !== "string" ||
      submittedDeploymentId.length === 0
    )
      throw new PublicationAcceptanceError(
        "POST omitted the new deployment identity.",
      );
    const submittedDeploymentUrl = publicDeploymentUrl(
      submittedBody,
      "POST existing project publication",
    );
    report.publication = {
      status: "SUBMITTED",
      revision: TARGET_REVISION,
      deploymentId: submittedDeploymentId,
      deploymentUrl: submittedDeploymentUrl,
      postVercelProjectId: postProjectId,
      oldDeploymentId: existingDeploymentId,
      oldDeploymentUrl: existingDeploymentUrl,
      requestPaths,
    };
    await writeReport(evidenceDir, report);
    if (submittedDeploymentId === EXPECTED_OLD_DEPLOYMENT_ID)
      throw new PublicationAcceptanceError(
        "Target-revision publication reused the existing READY deployment; no new runtime artifact was submitted.",
      );
    const maxPolls = Number(process.env.ORBSIE_PUBLICATION_MAX_POLLS ?? 120);
    if (!Number.isSafeInteger(maxPolls) || maxPolls < 1 || maxPolls > 240)
      throw new PublicationAcceptanceError(
        "ORBSIE_PUBLICATION_MAX_POLLS must be between 1 and 240.",
      );
    let readyBody;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      const statusResult = await safeRequest(
        `/api/publish?projectId=${encodeURIComponent(EXPECTED_PROJECT_ID)}`,
        {},
        "publish unchanged target revision status",
      );
      const statusBody = requireResponse(
        "publish unchanged target revision status",
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
      throw new PublicationAcceptanceError(
        "Target-revision publication did not become READY within the bounded poll budget.",
      );
    const getProjectId = vercelProjectId(readyBody);
    if (!postProjectId || !getProjectId)
      throw new PublicationAcceptanceError(
        "Publication did not expose Vercel project identity in both POST and GET.",
      );
    assert.equal(
      getProjectId,
      postProjectId,
      "publication Vercel project mapping",
    );
    assert.equal(
      getProjectId,
      EXPECTED_VERCEL_PROJECT_ID,
      "GET Vercel project mapping",
    );
    const readyDeploymentId = readyBody.deploymentId;
    if (typeof readyDeploymentId !== "string" || readyDeploymentId.length === 0)
      throw new PublicationAcceptanceError(
        "READY publication status omitted deployment identity; cannot prove it is the submitted deployment.",
      );
    assert.equal(
      readyDeploymentId,
      submittedDeploymentId,
      "READY deployment identity",
    );
    const deploymentUrl = publicDeploymentUrl(
      readyBody,
      "existing project publication",
    );
    assert.notEqual(
      deploymentUrl,
      existingDeploymentUrl,
      "target-revision publication deployment URL",
    );
    assert.equal(deploymentUrl, submittedDeploymentUrl, "READY deployment URL");
    assert.equal(readyBody.servedRevision, TARGET_REVISION);
    const deploymentId = readyDeploymentId;
    const publicIndex = await publicText(
      transport,
      deploymentUrl,
      "index.html",
      "signed-out published runtime",
    );
    const publicRuntimeJS = await publicText(
      transport,
      deploymentUrl,
      "runtime.js",
      "signed-out published runtime",
    );
    const publicRuntimeCSS = await publicText(
      transport,
      deploymentUrl,
      "runtime.css",
      "signed-out published runtime",
    );
    assert.match(
      publicIndex,
      /<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*">/,
    );
    const digest = (value) => createHash("sha256").update(value).digest("hex");
    assert.equal(
      digest(publicRuntimeJS),
      report.currentRuntime.runtimeJS.sha256,
    );
    assert.equal(
      digest(publicRuntimeCSS),
      report.currentRuntime.runtimeCSS.sha256,
    );
    const publicProject = JSON.parse(
      await publicText(
        transport,
        deploymentUrl,
        "project.json",
        "signed-out published project snapshot",
      ),
    );
    assert.deepEqual(
      publicProject,
      publishableSnapshot(targetProject),
      "signed-out snapshot matches target publishable snapshot",
    );
    report.publication = {
      ...report.publication,
      status: "READY",
      revision: TARGET_REVISION,
      deploymentId,
      deploymentUrl,
      postVercelProjectId: postProjectId,
      getVercelProjectId: getProjectId,
      servedRevision: readyBody.servedRevision ?? null,
      oldDeploymentId: existingDeploymentId,
      oldDeploymentUrl: existingDeploymentUrl,
      runtime: {
        indexViewportFitCover: true,
        runtimeJS: {
          local: report.currentRuntime.runtimeJS,
          public: {
            bytes: Buffer.byteLength(publicRuntimeJS),
            sha256: digest(publicRuntimeJS),
          },
        },
        runtimeCSS: {
          local: report.currentRuntime.runtimeCSS,
          public: {
            bytes: Buffer.byteLength(publicRuntimeCSS),
            sha256: digest(publicRuntimeCSS),
          },
        },
      },
      requestPaths,
    };
    await validateSignedOutGameplay(deploymentUrl, evidenceDir, report);
    report.generationRoutesBlocked = report.browser?.generationRoutes ?? 0;
    report.status = "passed";
    return report;
  } catch (error) {
    report.status = "failed";
    report.error =
      error instanceof Error
        ? error.message.slice(0, 1200)
        : "Publication preparation failed.";
    process.exitCode = 1;
    return report;
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeReport(evidenceDir, report);
    console.log(JSON.stringify(report, null, 2));
  }
}

await main();
