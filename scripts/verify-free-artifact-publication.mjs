#!/usr/bin/env node
import { chromium, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  artifactMutationPlan,
  loadFreeArtifact,
  verifyFreeArtifactPublicFiles,
  withFreeArtifactGeneratedUploads,
} from "./lib/free-artifact-publication.mjs";
import {
  assertLivePublicationOptIn,
  PublicationAcceptanceError,
  runPublicationAcceptance,
} from "./lib/publication-acceptance.mjs";
import { createPublicationTransport } from "./lib/publication-transport.mjs";

const DEFAULT_ARTIFACT =
  "docs/evidence/provider-e2e/free-strawberry-current/free/world.zip";
const BASE = process.env.ORBSIE_TEST_URL ?? "https://orbsie.com";
const ARTIFACT_PATH = process.env.ORBSIE_FREE_ARTIFACT ?? DEFAULT_ARTIFACT;
const EVIDENCE_DIR =
  process.env.ORBSIE_PUBLICATION_EVIDENCE_DIR ??
  "docs/evidence/publication-free-strawberry";

function origin(value) {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error("ORBSIE_TEST_URL must be a valid HTTP(S) URL.");
  }
}

function passwordFromFile(path) {
  return readFile(path, "utf8").then((value) => {
    const password = value.trim();
    if (password.length < 16)
      throw new Error("The private publication password is too short.");
    return password;
  });
}

function harnessProvenance() {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { commit, dirty: status.length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}

async function browserReady(url, label) {
  const targetOrigin = new URL(url).origin;
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
  const externalRoutes = [];
  const generationRoutes = [];
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    const generation =
      requestUrl.pathname.startsWith("/api/") ||
      requestUrl.pathname === "/generate" ||
      requestUrl.pathname === "/health";
    if (generation) {
      generationRoutes.push(requestUrl.pathname);
      await route.abort("blockedbyclient");
      return;
    }
    if (
      requestUrl.origin === targetOrigin ||
      requestUrl.protocol === "data:" ||
      requestUrl.protocol === "blob:"
    ) {
      await route.continue();
      return;
    }
    externalRoutes.push(requestUrl.origin || requestUrl.protocol);
    await route.abort("blockedbyclient");
  });
  const pageErrors = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 240)));
  let status = null;
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    status = response?.status() ?? null;
    if (!response || !response.ok())
      throw new PublicationAcceptanceError(
        `${label} failed (HTTP ${status ?? "unknown"}).`,
        {
          status,
        },
      );
    await expect(page.locator('main[data-ready="true"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
    const cookies = await context.cookies();
    const result = {
      status,
      ready: true,
      canvas: true,
      pageErrors,
      externalRoutes,
      generationRoutes,
      cookies: cookies.length,
    };
    if (
      pageErrors.length ||
      externalRoutes.length ||
      generationRoutes.length ||
      cookies.length
    )
      throw new PublicationAcceptanceError(
        `${label} used an unexpected signed-out request.`,
        {
          status,
        },
      );
    return result;
  } catch (error) {
    if (error instanceof PublicationAcceptanceError) throw error;
    throw new PublicationAcceptanceError(`${label} readiness check failed.`, {
      cause: error,
      status,
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

async function publicGetBytes(fetchImpl, url, label) {
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: "error",
      credentials: "omit",
      headers: { "User-Agent": "OrbsiePublicationAcceptance/1.0" },
    });
  } catch (error) {
    throw new PublicationAcceptanceError(`${label} network request failed.`, {
      cause: error,
    });
  }
  return {
    status: response.status,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

export async function prepareFreeArtifactPublication({
  artifactPath = ARTIFACT_PATH,
  projectId,
} = {}) {
  const artifact = await loadFreeArtifact(artifactPath, { projectId });
  return {
    artifact,
    plan: artifactMutationPlan(artifact),
    source: {
      zipPath: artifactPath,
      sourceZipSha256: artifact.sourceZipSha256,
      sourceProjectId: artifact.sourceProjectId,
      sourceRevision: artifact.sourceProject.revision,
      publicationProjectId: artifact.publicationProject.id,
      publicationRevision: artifact.expectedProject.revision,
      expectedReferencedFiles: artifact.expectedFiles.map(
        ({ file, kind, bytes, sha256 }) => ({
          file,
          kind,
          bytes,
          sha256,
        }),
      ),
    },
  };
}

export async function runFreeArtifactPublication({
  base = BASE,
  artifactPath = ARTIFACT_PATH,
  evidenceDir = EVIDENCE_DIR,
  email = process.env.ORBSIE_TEST_ACCOUNT_EMAIL ??
    `orbsie-free-publication-${Date.now()}@example.com`,
  password,
  projectId,
  fetchImpl = fetch,
} = {}) {
  assertLivePublicationOptIn();
  const prepared = await prepareFreeArtifactPublication({
    artifactPath,
    projectId,
  });
  const artifact = prepared.artifact;
  const report = {
    status: "running",
    base: origin(base),
    startedAt: new Date().toISOString(),
    account: { email },
    harness: harnessProvenance(),
    source: prepared.source,
    plan: prepared.plan,
    mutations: {
      accountSignup: 0,
      generatedModelUploads: 0,
      generatedModelHashes: [],
      cloudProjectSaves: 0,
      publicationSubmissions: 0,
    },
    progress: null,
    checks: {},
  };
  const update = async () => {
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(
      `${evidenceDir}/report.json`,
      `${JSON.stringify(report, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
  };
  await update();
  const httpTransport = createPublicationTransport(base, fetchImpl);
  const transport = withFreeArtifactGeneratedUploads(
    {
      ...httpTransport,
      publicGetBytes: (url, label) => publicGetBytes(fetchImpl, url, label),
      browserReady,
    },
    artifact,
    async (metadata) => {
      report.mutations.generatedModelUploads += 1;
      report.mutations.generatedModelHashes.push(metadata.sha256);
      await update();
    },
  );
  try {
    if (!password)
      throw new Error("A private publication password is required.");
    const result = await runPublicationAcceptance({
      transport,
      world: artifact.publicationProject,
      email,
      password,
      onProgress: async (progress) => {
        report.progress = progress;
        for (const step of progress.steps) {
          if (step.step === "sign-up") report.mutations.accountSignup = 1;
          if (step.step === "cloud save revision 1")
            report.mutations.cloudProjectSaves = 1;
          if (step.step === "publish revision 1")
            report.mutations.publicationSubmissions = 1;
        }
        await update();
      },
    });
    const cloudRevision =
      result.first?.revision ?? result.first?.signedOutSnapshot?.revision;
    if (cloudRevision !== artifact.expectedProject.revision)
      throw new Error(
        "The publication acceptance returned an unexpected cloud revision.",
      );
    const artifactChecks = await verifyFreeArtifactPublicFiles(
      transport,
      result.first.deploymentUrl,
      artifact,
    );
    report.checks = {
      signup: "passed",
      generatedModelUploads: report.mutations.generatedModelUploads,
      cloudSave: { revision: cloudRevision },
      publicationSubmitted: {
        deploymentId: result.first.deploymentId,
        deploymentUrl: result.first.deploymentUrl,
        vercelProjectId: result.first.vercelProjectId,
      },
      signedOut: result.first.signedOutSnapshot,
      artifact: artifactChecks,
    };
    report.status = "passed";
    return report;
  } catch (error) {
    report.status = "failed";
    report.error =
      error instanceof Error
        ? error.message.slice(0, 1200)
        : "Publication failed.";
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeFile(
      `${evidenceDir}/report.json`,
      `${JSON.stringify(report, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
  }
}

async function main() {
  if (process.env.ORBSIE_LIVE_E2E !== "1") {
    const prepared = await prepareFreeArtifactPublication();
    console.log(
      JSON.stringify(
        {
          mode: "prepare-only",
          harness: harnessProvenance(),
          ...prepared.source,
          plan: prepared.plan,
        },
        null,
        2,
      ),
    );
    return;
  }
  const passwordFile = process.env.ORBSIE_TEST_ACCOUNT_PASSWORD_FILE;
  if (!passwordFile)
    throw new Error(
      "ORBSIE_TEST_ACCOUNT_PASSWORD_FILE is required for live execution.",
    );
  const password = await passwordFromFile(passwordFile);
  const report = await runFreeArtifactPublication({ password });
  console.log(JSON.stringify(report, null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Publication acceptance failed.",
    );
    process.exitCode = 1;
  });
}
