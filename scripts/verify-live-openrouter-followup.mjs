/** One authorized local Luna/512 request; start the documented capped server first. */
import { build } from "esbuild";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

if (
  process.env.ORBSIE_LIVE_E2E !== "1" ||
  process.env.ORBSIE_OUTPUT_CAP_TOKENS !== "512"
)
  throw Error(
    "Requires live opt-in and the documented server-owned 512-token cap.",
  );
process.loadEnvFile(".env.openrouter.local");
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw Error("Local OpenRouter credential is unavailable.");
const origin = "http://127.0.0.1:3024";
const model = "openai/gpt-5.6-luna";
const directory = await mkdtemp("/tmp/orbsie-openrouter-followup-");
const report = {
  scope:
    "One real OpenRouter follow-up through local Next route and reducer; not browser E2E",
  model,
  outputCapTokens: 512,
  status: "running",
  generationRequests: 0,
};
try {
  const outfile = join(directory, "protocol.mjs");
  await build({
    entryPoints: ["src/lib/protocol.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
  });
  const { blankProject, applyOperation } = await import(pathToFileURL(outfile));
  let project = blankProject();
  const expectedSky = "#d9a7c7";
  const prompt =
    "Apply the exact sky color I specified earlier, leave everything else unchanged, and commit.";
  project.messages = [
    {
      role: "user",
      text: `For our next edit, the sky must be exactly ${expectedSky}.`,
    },
    {
      role: "assistant",
      text: "I will use that sky color for your next edit.",
    },
    { role: "user", text: prompt },
  ];
  const before = structuredClone(project);
  const started = performance.now();
  report.stage = "http-request";
  report.generationRequests++;
  const response = await fetch(origin + "/api/generate", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "openrouter",
      model,
      key,
      prompt,
      project,
    }),
    signal: AbortSignal.timeout(120000),
  });
  report.httpStatus = response.status;
  assert.equal(response.status, 200);
  report.stage = "read-commands";
  const text = await response.text();
  assert(text.length <= 16000);
  const commands = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  report.commandTypes = commands.map((command) => command.type);
  assert.equal(commands.at(-1)?.type, "commit_revision");
  report.commands = commands;
  report.stage = "apply-commands";
  let cursor = { runId: randomUUID(), sequence: 0, seen: new Set() };
  for (const command of commands) {
    const result = applyOperation(
      project,
      {
        version: 1,
        projectId: project.id,
        runId: cursor.runId,
        sequence: cursor.sequence + 1,
        operationId: randomUUID(),
        baseRevision: project.revision,
        command,
      },
      cursor,
    );
    project = result.project;
    cursor = result.cursor;
  }
  report.stage = "assert-scene";
  assert.equal(project.environment.sky.toLowerCase(), expectedSky);
  assert.equal(project.environment.ground, before.environment.ground);
  assert.equal(project.environment.water, before.environment.water);
  assert.deepEqual(project.entities, before.entities);
  Object.assign(report, {
    status: "passed",
    stage: "complete",
    durationMs: Math.round(performance.now() - started),
    prompt,
    expectedSky,
    actualSky: project.environment.sky,
    unchangedEntities: true,
    unchangedGroundAndWater: true,
  });
} catch {
  report.status = "failed";
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
  await mkdir("docs/evidence/provider-followup", { recursive: true });
  await writeFile(
    "docs/evidence/provider-followup/openrouter.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
