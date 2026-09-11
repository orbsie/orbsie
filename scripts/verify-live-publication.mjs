#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BASE = process.env.ORBSIE_TEST_URL ?? "https://orbsie.com";
const EVIDENCE =
  process.env.ORBSIE_PUBLICATION_EVIDENCE_DIR ?? "docs/evidence/publication-live";
const EMAIL =
  process.env.ORBSIE_TEST_ACCOUNT_EMAIL ??
  `orbsie-publication-${Date.now()}@example.com`;
const PASSWORD =
  process.env.ORBSIE_TEST_ACCOUNT_PASSWORD ?? "orbsie-publication-pass-1";

const report = { status: "running", base: BASE, startedAt: new Date().toISOString(), checks: {} };
await mkdir(EVIDENCE, { recursive: true });

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

async function call(path, init, label) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      ...(init.cookie ? { Cookie: init.cookie } : {}),
    },
    redirect: "error",
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!response.ok)
    throw new Error(`${label} HTTP ${response.status}: ${text.slice(0, 220)}`);
  return { response, body };
}

try {
  const signup = await call(
    "/api/auth/sign-up/email",
    {
      method: "POST",
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: "Orbsie Publication Acceptance" }),
    },
    "sign-up",
  );
  const cookies = (signup.response.headers.getSetCookie?.() ?? [])
    .map((line) => line.split(";")[0])
    .join("; ");
  assert.ok(cookies.length > 0, "signup returned a session cookie");
  report.checks.signup = "passed";

  world.revision = 1;
  const saved = await call(
    "/api/projects",
    {
      method: "PUT",
      cookie: cookies,
      body: JSON.stringify({ project: world, baseRevision: null, baseSnapshotToken: null }),
    },
    "cloud save",
  );
  assert.equal(saved.body.revision, 1);
  report.checks.cloudSave = { revision: saved.body.revision };

  const submitted = await call(
    "/api/publish",
    {
      method: "POST",
      cookie: cookies,
      body: JSON.stringify({ projectId: world.id, revision: world.revision }),
    },
    "publish",
  );
  report.checks.publishSubmitted = {
    state: submitted.body.state,
    url: submitted.body.url,
    deploymentUrl: submitted.body.deploymentUrl,
  };

  let ready;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      const status = await call(
        `/api/publish?projectId=${encodeURIComponent(world.id)}`,
        { cookie: cookies },
        "publication status",
      );
      ready = status.body;
      if (ready.state === "READY" && ready.public_url) break;
      if (ready.state === "PROTECTED")
        throw new Error(`Deployment protected: ${ready.error ?? ""}`);
      if (ready.error && ready.state === "VERIFYING" && attempt > 60)
        throw new Error(`Still unverified: ${ready.error}`);
    } catch (error) {
      report.pollErrors ??= [];
      report.pollErrors.push(String(error).slice(0, 200));
      if (attempt > 100) throw error;
    }
  }
  if (!ready || ready.state !== "READY")
    throw new Error(`Publication never became READY: ${JSON.stringify(ready).slice(0, 300)}`);
  report.checks.publicationReady = { state: ready.state, publicUrl: ready.public_url, servedRevision: ready.served_revision ?? ready.servedRevision };

  const signedOut = await fetch(ready.public_url, {
    redirect: "error",
    headers: { "User-Agent": "OrbsiePublicationAcceptance/1.0" },
  });
  report.checks.signedOutStatus = signedOut.status;
  const page = await signedOut.text();
  report.checks.signedOutDataReady = page.includes('data-ready="true"');
  report.checks.signedOutTitle = (page.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? null;
  assert.equal(report.checks.signedOutStatus, 200);
  assert.equal(report.checks.signedOutDataReady, true);

  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error).slice(0, 1200);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${EVIDENCE}/report.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 1));
}
