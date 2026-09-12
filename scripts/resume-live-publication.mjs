#!/usr/bin/env node
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  assertLivePublicationOptIn,
  PublicationAcceptanceError,
  resumePublicationAcceptance,
} from "./lib/publication-acceptance.mjs";
import { createPublicationTransport } from "./lib/publication-transport.mjs";

// Resume is deliberately separate from the publisher: it signs in, reads one
// owner status, and checks existing public deployments without saving or
// submitting anything.
assertLivePublicationOptIn();

const BASE = process.env.ORBSIE_TEST_URL ?? "https://orbsie.com";
const EVIDENCE =
  process.env.ORBSIE_PUBLICATION_EVIDENCE_DIR ??
  "docs/evidence/republishing-browser-live";
const PASSWORD_FILE = process.env.ORBSIE_PUBLICATION_PASSWORD_FILE;
const EMAIL = process.env.ORBSIE_TEST_ACCOUNT_EMAIL;
const PROJECT_ID = process.env.ORBSIE_PUBLICATION_PROJECT_ID;
const VERCEL_PROJECT_ID = process.env.ORBSIE_PUBLICATION_VERCEL_PROJECT_ID;
const FIRST_DEPLOYMENT_ID = process.env.ORBSIE_PUBLICATION_FIRST_DEPLOYMENT_ID;
const FIRST_DEPLOYMENT_URL =
  process.env.ORBSIE_PUBLICATION_FIRST_DEPLOYMENT_URL;
const SECOND_DEPLOYMENT_ID =
  process.env.ORBSIE_PUBLICATION_SECOND_DEPLOYMENT_ID;
const SECOND_DEPLOYMENT_URL =
  process.env.ORBSIE_PUBLICATION_SECOND_DEPLOYMENT_URL;
for (const [name, value] of Object.entries({
  ORBSIE_PUBLICATION_PASSWORD_FILE: PASSWORD_FILE,
  ORBSIE_TEST_ACCOUNT_EMAIL: EMAIL,
  ORBSIE_PUBLICATION_PROJECT_ID: PROJECT_ID,
  ORBSIE_PUBLICATION_VERCEL_PROJECT_ID: VERCEL_PROJECT_ID,
  ORBSIE_PUBLICATION_FIRST_DEPLOYMENT_ID: FIRST_DEPLOYMENT_ID,
  ORBSIE_PUBLICATION_FIRST_DEPLOYMENT_URL: FIRST_DEPLOYMENT_URL,
  ORBSIE_PUBLICATION_SECOND_DEPLOYMENT_ID: SECOND_DEPLOYMENT_ID,
  ORBSIE_PUBLICATION_SECOND_DEPLOYMENT_URL: SECOND_DEPLOYMENT_URL,
})) {
  if (!value)
    throw new PublicationAcceptanceError(`${name} is required for resume.`);
}

const firstWorld = {
  id: PROJECT_ID,
  revision: 1,
  title: "A tiny island to share",
  entities: [{ id: "crystal-accept", color: "#a1f0d7" }],
};
const secondWorld = {
  id: PROJECT_ID,
  revision: 2,
  title: "A tiny island to share — Sunset crystal garden",
  entities: [{ id: "crystal-accept", color: "#ff8f6b" }],
};

async function browserReady(url, label) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let status = null;
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    status = response?.status() ?? null;
    if (!response || !response.ok())
      throw new PublicationAcceptanceError(
        `${label} failed (HTTP ${status ?? "unknown"}).`,
        { status },
      );
    await expect(page.locator('main[data-ready="true"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
    return { status, ready: true, canvas: true, pageErrors };
  } catch (error) {
    if (pageErrors.length > 0)
      return { status, ready: false, canvas: false, pageErrors };
    throw new PublicationAcceptanceError(`${label} readiness check failed.`, {
      cause: error,
      status,
    });
  } finally {
    await browser.close();
  }
}

const report = {
  status: "running",
  base: BASE,
  account: { email: EMAIL },
  projectId: PROJECT_ID,
  expectedVercelProjectId: VERCEL_PROJECT_ID,
  originalReport: "report.json",
  progress: null,
  checks: {},
};
const reportPath = `${EVIDENCE}/resume-report.json`;
const persist = async () => {
  await mkdir(EVIDENCE, { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
};
const httpTransport = createPublicationTransport(BASE);

try {
  const password = (await readFile(PASSWORD_FILE, "utf8")).trim();
  if (!password)
    throw new PublicationAcceptanceError("Resume password file is empty.");
  const result = await resumePublicationAcceptance({
    transport: { ...httpTransport, browserReady },
    projectId: PROJECT_ID,
    email: EMAIL,
    password,
    expectedVercelProjectId: VERCEL_PROJECT_ID,
    firstRelease: {
      deploymentId: FIRST_DEPLOYMENT_ID,
      deploymentUrl: FIRST_DEPLOYMENT_URL,
      vercelProjectId: VERCEL_PROJECT_ID,
    },
    secondRelease: {
      deploymentId: SECOND_DEPLOYMENT_ID,
      deploymentUrl: SECOND_DEPLOYMENT_URL,
      vercelProjectId: VERCEL_PROJECT_ID,
    },
    firstWorld,
    secondWorld,
    onProgress: async (progress) => {
      report.progress = progress;
      await persist();
    },
  });
  report.checks = {
    signIn: "passed",
    statusGet: result.status,
    sameVercelProjectId: result.vercelProjectId === VERCEL_PROJECT_ID,
    distinctDeploymentIds: FIRST_DEPLOYMENT_ID !== SECOND_DEPLOYMENT_ID,
    pendingWindow: result.pendingWindow,
    previousRelease: {
      deploymentId: FIRST_DEPLOYMENT_ID,
      deploymentUrl: FIRST_DEPLOYMENT_URL,
      browser: result.oldRelease.browser,
      snapshot: {
        revision: result.oldRelease.snapshot.revision,
        title: result.oldRelease.snapshot.title,
        materialColor: result.oldRelease.snapshot.entities?.find(
          (entity) => entity.id === "crystal-accept",
        )?.color,
      },
    },
    finalRelease: result.finalRelease
      ? {
          deploymentId: SECOND_DEPLOYMENT_ID,
          deploymentUrl: SECOND_DEPLOYMENT_URL,
          browser: result.finalRelease.browser,
          snapshot: {
            revision: result.finalRelease.snapshot.revision,
            title: result.finalRelease.snapshot.title,
            materialColor: result.finalRelease.snapshot.entities?.find(
              (entity) => entity.id === "crystal-accept",
            )?.color,
          },
        }
      : null,
  };
  report.status = result.finalRelease ? "passed" : "partial";
} catch (error) {
  report.status = "failed";
  report.error = {
    message:
      error instanceof Error ? error.message.slice(0, 1200) : "Resume failed.",
    ...(typeof error?.status === "number" ? { status: error.status } : {}),
    ...(typeof error?.state === "string" ? { state: error.state } : {}),
    ...(typeof error?.code === "string" ? { code: error.code } : {}),
  };
  process.exitCode = 1;
} finally {
  await persist();
  console.log(JSON.stringify(report, null, 1));
}
