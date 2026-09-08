/** Local dev API proof only. No inference, production sessions, or credential output. */
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { request } from "@playwright/test";
const origin = "http://127.0.0.1:3017";
if (process.env.ORBSIE_TEST_URL && process.env.ORBSIE_TEST_URL !== origin)
  throw Error("Only the authorized local origin on port 3017 is permitted.");
const privatePath = ".vercel/dev-generated-cloud-state.json";
assert.equal(
  (await stat(privatePath)).mode & 0o777,
  0o600,
  "Private fixture permissions must be 0600",
);
const state = JSON.parse(await readFile(privatePath, "utf8"));
assert.equal(state.baseURL, origin);
const output =
  process.env.ORBSIE_JOURNAL_EVIDENCE_DIRECTORY ??
  "docs/evidence/generation-journal";
await mkdir(output, { recursive: true });
const report = {
  scope:
    "Local dev API and real PostgreSQL; no inference or production requests",
  origin,
  startedAt: new Date().toISOString(),
  checks: [],
  requests: 0,
};
const contexts = [];
async function context() {
  const c = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
    timeout: 30000,
  });
  contexts.push(c);
  return c;
}
async function call(c, method, path, body) {
  if (++report.requests > 65) throw Error("Request budget exceeded");
  const response = await c.fetch(path, { method, data: body, maxRedirects: 0 });
  if (response.status() === 429)
    throw Error("Rate limit reached; stopped without retry");
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error(`Non-JSON response (${response.status()})`);
  }
  return { status: response.status(), data };
}
function check(name, condition) {
  assert(condition, name);
  report.checks.push(name);
}
function envelope(run, command, sequence = run.sequence + 1) {
  return {
    version: 1,
    projectId: run.projectId,
    runId: run.id,
    operationId: randomUUID(),
    sequence,
    baseRevision: run.checkpoint.revision,
    command,
  };
}
let stage = "authenticate";
try {
  const owner = await context();
  let result = await call(
    owner,
    "POST",
    "/api/auth/sign-in/email",
    state.credentials,
  );
  assert.equal(result.status, 200, "Synthetic owner sign-in failed");
  const anonymous = await context(),
    other = await context();
  const otherPath = ".vercel/dev-generation-journal-owner.json";
  let credentials;
  try {
    assert.equal((await stat(otherPath)).mode & 0o777, 0o600);
    credentials = JSON.parse(await readFile(otherPath, "utf8"));
    result = await call(other, "POST", "/api/auth/sign-in/email", credentials);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    credentials = {
      email: `orbsie-journal-${randomUUID()}@example.invalid`,
      password: randomBytes(30).toString("base64url"),
    };
    result = await call(other, "POST", "/api/auth/sign-up/email", {
      ...credentials,
      name: "Journal isolation test",
    });
    if (result.status === 200)
      await writeFile(otherPath, JSON.stringify(credentials), { mode: 0o600 });
  }
  assert.equal(
    result.status,
    200,
    "Second synthetic owner authentication failed",
  );
  const snapshotTokens = new Map();
  async function start() {
    const project = {
      version: 1,
      id: randomUUID(),
      title: "Generation journal API evidence",
      seed: 42,
      revision: 0,
      entities: [],
      environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
      messages: [{ role: "user", text: "Build a test tree" }],
    };
    const saved = await call(owner, "PUT", "/api/projects", {
      project,
      baseRevision: null,
    });
    assert.equal(saved.status, 200, "Baseline save failed");
    snapshotTokens.set(project.id, saved.data.snapshotToken);
    const created = await call(owner, "POST", "/api/generation-runs", {
      runId: randomUUID(),
      project,
      prompt: "Build a test tree",
    });
    assert.equal(created.status, 200, "Run creation failed");
    return created.data.run;
  }
  stage = "operations";
  let run = await start();
  report.projectId = run.projectId;
  report.runId = run.id;
  const reserve = envelope(run, {
    type: "reserve_entity",
    entity: {
      id: "test-tree",
      label: "Test tree",
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#6ead60",
      stage: "seed",
    },
  });
  result = await call(owner, "PUT", "/api/generation-runs", {
    runId: run.id,
    envelope: reserve,
  });
  assert.equal(result.status, 200);
  run = result.data.run;
  check(
    "reserve acknowledged at sequence one",
    run.sequence === 1 && run.checkpoint.entities.length === 1,
  );
  result = await call(owner, "PUT", "/api/generation-runs", {
    runId: run.id,
    envelope: reserve,
  });
  check(
    "exact retry does not duplicate operation",
    result.status === 200 &&
      result.data.run.sequence === 1 &&
      result.data.run.checkpoint.entities.length === 1,
  );
  const conflict = structuredClone(reserve);
  conflict.command.entity.label = "conflict";
  result = await call(owner, "PUT", "/api/generation-runs", {
    runId: run.id,
    envelope: conflict,
  });
  check("conflicting retry rejected", result.status === 409);
  result = await call(owner, "PUT", "/api/generation-runs", {
    runId: run.id,
    envelope: envelope(run, { type: "set_environment", sky: "#ffffff" }, 3),
  });
  check("out-of-order operation rejected", result.status === 409);
  const geometry = envelope(run, {
    type: "set_geometry",
    id: "test-tree",
    geometry: { kind: "mushroom", detail: "refined" },
  });
  result = await call(owner, "PUT", "/api/generation-runs", {
    runId: run.id,
    envelope: geometry,
  });
  assert.equal(result.status, 200);
  run = result.data.run;
  result = await call(owner, "PUT", "/api/generation-runs", {
    runId: run.id,
    envelope: envelope(run, { type: "commit_revision", message: "Finished" }),
  });
  assert.equal(result.status, 200);
  run = result.data.run;
  check(
    "geometry and commit checkpoint persisted",
    run.state === "complete" &&
      run.sequence === 3 &&
      run.checkpoint.entities[0].geometry.kind === "mushroom",
  );
  result = await call(
    owner,
    "GET",
    `/api/generation-runs?projectId=${run.projectId}`,
  );
  check(
    "latest owner checkpoint discovered",
    result.status === 200 && result.data.run.id === run.id,
  );
  result = await call(
    owner,
    "GET",
    `/api/generation-runs?runId=${run.id}&afterSequence=1`,
  );
  check(
    "replay ordered after acknowledged sequence",
    result.status === 200 &&
      result.data.operations.length === 2 &&
      result.data.operations[0].sequence === 2 &&
      result.data.nextSequence === 3,
  );
  stage = "ownership";
  for (const [label, c, status] of [
    ["anonymous", anonymous, 401],
    ["second owner", other, 404],
  ]) {
    result = await call(c, "GET", `/api/generation-runs?runId=${run.id}`);
    check(`${label} cannot read checkpoint`, result.status === status);
    result = await call(c, "PUT", "/api/generation-runs", {
      runId: run.id,
      envelope: reserve,
    });
    check(`${label} cannot append`, result.status === status);
  }
  stage = "concurrent cancellation";
  const racing = await start();
  const operation = envelope(racing, {
    type: "set_environment",
    sky: "#ffffff",
  });
  const [appended, cancelled] = await Promise.all([
    call(owner, "PUT", "/api/generation-runs", {
      runId: racing.id,
      envelope: operation,
    }),
    call(owner, "PATCH", "/api/generation-runs", { runId: racing.id }),
  ]);
  assert.equal(cancelled.status, 200);
  assert([200, 409].includes(appended.status));
  result = await call(owner, "GET", `/api/generation-runs?runId=${racing.id}`);
  check(
    "concurrent append and cancel serialize",
    result.data.run.state === "cancelled" &&
      result.data.run.sequence === (appended.status === 200 ? 1 : 0),
  );
  const after = result.data.run;
  result = await call(owner, "PUT", "/api/generation-runs", {
    runId: racing.id,
    envelope: envelope(after, { type: "set_environment", sky: "#000000" }),
  });
  check("cancelled run rejects later operation", result.status === 409);
  stage = "cloud revision drift";
  const drift = await start();
  result = await call(owner, "PUT", "/api/projects", {
    project: { ...drift.checkpoint, revision: 1, title: "Newer cloud save" },
    baseRevision: 0,
    baseSnapshotToken: snapshotTokens.get(drift.projectId),
  });
  assert.equal(result.status, 200);
  result = await call(owner, "PUT", "/api/generation-runs", {
    runId: drift.id,
    envelope: envelope(drift, { type: "set_environment", sky: "#000000" }),
  });
  check(
    "cloud revision drift rejects checkpoint mutation",
    result.status === 409,
  );
  result = await call(owner, "GET", `/api/generation-runs?runId=${drift.id}`);
  check("rejected drift preserves checkpoint", result.data.run.sequence === 0);
  await call(owner, "PATCH", "/api/generation-runs", { runId: drift.id });
  stage = "same-revision content drift";
  const same = await start();
  result = await call(owner, "PUT", "/api/projects", {
    project: { ...same.checkpoint, title: "Changed content at same revision" },
    baseRevision: 0,
    baseSnapshotToken: snapshotTokens.get(same.projectId),
  });
  assert.equal(result.status, 200);
  result = await call(owner, "PUT", "/api/generation-runs", {
    runId: same.id,
    envelope: envelope(same, { type: "set_environment", sky: "#000000" }),
  });
  check("same-revision content drift rejects mutation", result.status === 409);
  result = await call(owner, "GET", `/api/generation-runs?runId=${same.id}`);
  check(
    "diverged baseline remains readable and flagged",
    result.status === 200 &&
      result.data.run.sequence === 0 &&
      result.data.run.cloudBaselineCurrent === false,
  );
  await call(owner, "PATCH", "/api/generation-runs", { runId: same.id });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failedStage = stage;
  report.error =
    "A journal API assertion failed; inspect the local harness stage without exposing authentication data.";
  throw new Error(
    `Journal API verification failed during ${stage}. See sanitized evidence report.`,
  );
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  await Promise.all(contexts.map((c) => c.dispose()));
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks.length,
      requests: report.requests,
      stage: report.failedStage ?? "complete",
      report: `${output}/report.json`,
    }),
  );
}
