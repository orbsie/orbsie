#!/usr/bin/env node
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  assertLivePublicationOptIn,
  PublicationAcceptanceError,
  runPublicationAcceptance,
} from "./lib/publication-acceptance.mjs";
import { createPublicationTransport } from "./lib/publication-transport.mjs";

// This harness creates an account, saves a cloud revision, and publishes to
// Vercel. Keep the safety gate before reading credentials or making any write.
assertLivePublicationOptIn();

const BASE = process.env.ORBSIE_TEST_URL ?? "https://orbsie.com";
const EVIDENCE =
  process.env.ORBSIE_PUBLICATION_EVIDENCE_DIR ??
  "docs/evidence/publication-live";
const REPUBLISH = process.env.ORBSIE_PUBLICATION_REPUBLISH === "1";
const EMAIL =
  process.env.ORBSIE_TEST_ACCOUNT_EMAIL ??
  `orbsie-publication-${Date.now()}@example.com`;
const PASSWORD =
  process.env.ORBSIE_TEST_ACCOUNT_PASSWORD ?? "orbsie-publication-pass-1";

const world = {
  version: 1,
  id: `pub-accept-${Date.now().toString(36)}`,
  title: "A tiny island to share",
  seed: 42,
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
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
    });
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

function reportOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "<invalid-origin>";
  }
}

const report = {
  status: "running",
  base: reportOrigin(BASE),
  republish: REPUBLISH,
  startedAt: new Date().toISOString(),
  account: { email: EMAIL },
  world: { id: world.id, title: world.title, revision: world.revision },
  progress: null,
  checks: {},
};
const httpTransport = createPublicationTransport(BASE);

try {
  const result = await runPublicationAcceptance({
    transport: { ...httpTransport, browserReady },
    world,
    email: EMAIL,
    password: PASSWORD,
    republish: REPUBLISH,
    onProgress: async (progress) => {
      report.progress = progress;
      await mkdir(EVIDENCE, { recursive: true });
      await writeFile(
        `${EVIDENCE}/report.json`,
        JSON.stringify(report, null, 2) + "\n",
      );
    },
  });
  const sharingPage = new URL(result.first.publicUrl, BASE).toString();
  report.checks = {
    // Keep the first-publish evidence fields stable for existing reports.
    signup: "passed",
    cloudSave: { revision: result.first.revision },
    publishSubmitted: {
      state: result.first.state,
      url: result.first.publicUrl,
      deploymentUrl: result.first.deploymentUrl,
      deploymentId: result.first.deploymentId,
      vercelProjectId: result.first.vercelProjectId,
    },
    publicationReady: {
      state: "READY",
      publicUrl: result.first.deploymentUrl,
      sharingPage,
      servedRevision: result.first.servedRevision,
      vercelProjectId: result.first.vercelProjectId,
    },
    signedOutStatus: 200,
    signedOutDataReady: true,
    signedOutTitle: result.first.signedOutSnapshot.title,
    first: result.first,
    ...(result.republish ? { republish: result.republish } : {}),
  };
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error =
    error instanceof Error
      ? error.message.slice(0, 1200)
      : "Publication acceptance failed.";
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(EVIDENCE, { recursive: true });
  await writeFile(
    `${EVIDENCE}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 1));
}
