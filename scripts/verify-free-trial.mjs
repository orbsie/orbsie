// Explicitly authorized production trial: at most three Gateway Luna prompts, then one blocked request.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.TEST_URL || "https://orbsie.com";
const compiled = await build({
  entryPoints: ["src/lib/protocol.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { blankProject, applyOperation } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString("base64")}`
);
const trial = await fetch(`${base}/api/trial`);
assert.equal(trial.status, 200);
let cookie = trial.headers.get("set-cookie")?.split(";")[0];
assert(cookie, "Expected private visitor identity cookie");
assert.deepEqual(
  await trial.json(),
  { enabled: true, remaining: 3, limit: 3 },
  "Fresh three-prompt trial required; no inference started",
);
await mkdir(".vercel", { recursive: true });
await mkdir("docs/evidence", { recursive: true });
await writeFile(
  ".vercel/free-trial-session.json",
  JSON.stringify({ base, cookie }),
  { mode: 0o600 },
);
let project = blankProject();
const report = {
  date: new Date().toISOString(),
  base,
  model: "openai/gpt-5.6-luna",
  inferenceRequests: 0,
  turns: [],
  passed: false,
};
async function save() {
  await writeFile(
    "docs/evidence/free-trial.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
for (const prompt of [
  "Create exactly one tiny cyan crystal at [0,0,0]. Use reserve_entity, refined set_geometry, commit_revision. No other objects. Keep this under 300 output tokens.",
  "Change the existing crystal color to purple. Use one set_material then commit_revision. No other commands. Keep under 100 output tokens.",
  'Keep this world unchanged. Output only commit_revision with message "Ready to explore.". Keep under 40 output tokens.',
]) {
  const started = Date.now();
  report.inferenceRequests++;
  const response = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { origin: base, cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "free", prompt, project }),
    signal: AbortSignal.timeout(180000),
  });
  cookie = response.headers.get("set-cookie")?.split(";")[0] || cookie;
  const text = await response.text();
  const records = text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const turn = {
    status: response.status,
    remaining: Number(response.headers.get("X-Orbsie-Trial-Remaining")),
    elapsedMs: Date.now() - started,
    commands: records.map((r) => r.type || "error"),
    error: records.find((r) => r.error)?.error,
  };
  report.turns.push(turn);
  await save();
  assert.equal(response.status, 200);
  assert(!turn.error, turn.error);
  assert.equal(turn.remaining, 3 - report.inferenceRequests);
  assert.equal(records.at(-1)?.type, "commit_revision");
  let cursor = { runId: crypto.randomUUID(), sequence: 0, seen: new Set() };
  for (const command of records)
    ({ project, cursor } = applyOperation(
      project,
      {
        version: 1,
        projectId: project.id,
        runId: cursor.runId,
        operationId: crypto.randomUUID(),
        sequence: cursor.sequence + 1,
        baseRevision: project.revision,
        command,
      },
      cursor,
    ));
}
const fourth = await fetch(`${base}/api/generate`, {
  method: "POST",
  headers: { origin: base, cookie, "Content-Type": "application/json" },
  body: JSON.stringify({
    provider: "free",
    prompt: "This must not reach inference.",
    project,
  }),
});
assert.equal(fourth.status, 429);
assert.equal((await fourth.json()).code, "FREE_LIMIT_REACHED");
const refreshed = await fetch(`${base}/api/trial`, { headers: { cookie } });
assert.equal((await refreshed.json()).remaining, 0);
report.blockedFourth = true;
report.entities = project.entities.length;
report.passed = true;
await save();
console.log(JSON.stringify(report));
