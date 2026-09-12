#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import {
  assertLivePublicationOptIn,
  PublicationAcceptanceError,
  runPublicationAcceptance,
} from "./lib/publication-acceptance.mjs";

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

function parseResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

async function request(path, init = {}, label) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Origin: BASE,
        ...(init.cookie ? { Cookie: init.cookie } : {}),
      },
      redirect: "error",
    });
  } catch (error) {
    throw new PublicationAcceptanceError(`${label} network request failed.`, {
      cause: error,
    });
  }
  const text = await response.text();
  return {
    response,
    status: response.status,
    ok: response.ok,
    body: parseResponse(text),
  };
}

async function publicGet(url, label) {
  let response;
  try {
    response = await fetch(url, {
      redirect: "error",
      credentials: "omit",
      headers: { "User-Agent": "OrbsiePublicationAcceptance/1.0" },
    });
  } catch (error) {
    throw new PublicationAcceptanceError(`${label} network request failed.`, {
      cause: error,
    });
  }
  return { status: response.status, text: await response.text() };
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
  checks: {},
};

try {
  const result = await runPublicationAcceptance({
    transport: { request, publicGet },
    world,
    email: EMAIL,
    password: PASSWORD,
    republish: REPUBLISH,
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
