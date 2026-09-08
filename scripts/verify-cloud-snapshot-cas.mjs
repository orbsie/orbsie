/** Actual local API/database CAS check; existing development account, no inference. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import { request } from "@playwright/test";
const origin = "http://127.0.0.1:3017";
const fixturePath = ".vercel/dev-generated-cloud-state.json";
assert.equal((await stat(fixturePath)).mode & 0o777, 0o600);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
assert.equal(fixture.baseURL, origin);
const directory = "docs/evidence/cloud-snapshot-cas";
await mkdir(directory, { recursive: true });
const report = {
  passed: false,
  realProviderCalls: 0,
  scope: "Local authenticated API and real database, no browser UI",
  checks: [],
};
const client = await request.newContext({
  baseURL: origin,
  extraHTTPHeaders: { Origin: origin },
  timeout: 30000,
});
async function call(method, path, data) {
  const response = await client.fetch(path, { method, data, maxRedirects: 0 });
  assert.notEqual(response.status(), 429, "Rate limit reached; no retry");
  return { status: response.status(), body: await response.json() };
}
try {
  const auth = await call(
    "POST",
    "/api/auth/sign-in/email",
    fixture.credentials,
  );
  assert.equal(auth.status, 200, "Existing development account sign-in");
  const project = {
    version: 1,
    id: randomUUID(),
    title: "Snapshot CAS evidence",
    seed: 1,
    revision: 0,
    entities: [],
    environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
    messages: [],
  };
  let result = await call("PUT", "/api/projects", {
    project,
    baseRevision: null,
  });
  assert.equal(result.status, 200);
  const firstToken = result.body.snapshotToken;
  assert.match(firstToken, /^[a-f0-9]{64}$/);
  report.checks.push("New project returns a content token");
  const remote = {
    ...project,
    title: "Other device saved at the same revision",
  };
  result = await call("PUT", "/api/projects", {
    project: remote,
    baseRevision: 0,
    baseSnapshotToken: firstToken,
  });
  assert.equal(result.status, 200);
  const remoteToken = result.body.snapshotToken;
  assert.notEqual(remoteToken, firstToken);
  const stale = { ...project, title: "Stale local edit", revision: 1 };
  result = await call("PUT", "/api/projects", {
    project: stale,
    baseRevision: 0,
    baseSnapshotToken: firstToken,
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.conflict.snapshotToken, remoteToken);
  assert.equal(result.body.conflict.snapshot.title, remote.title);
  report.checks.push(
    "Same-revision intervening save rejects stale token and returns current conflict",
  );
  result = await call("PUT", "/api/projects", {
    project: stale,
    baseRevision: 0,
  });
  assert.equal(result.status, 409);
  report.checks.push("Existing project rejects missing content precondition");
  result = await call("GET", `/api/projects?id=${project.id}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.project.snapshot.title, remote.title);
  assert.equal(result.body.project.snapshotToken, remoteToken);
  report.checks.push("Rejected writes leave the remote snapshot intact");
  result = await call("PUT", "/api/projects", {
    project: stale,
    baseRevision: 0,
    baseSnapshotToken: remoteToken,
  });
  assert.equal(result.status, 200);
  assert.notEqual(result.body.snapshotToken, remoteToken);
  report.checks.push("Explicitly rebased write with current token succeeds");
  report.projectId = project.id;
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await client.dispose();
  await writeFile(
    `${directory}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
