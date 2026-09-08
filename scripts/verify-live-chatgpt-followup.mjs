/** One real Astra-low follow-up through the authenticated local HTTP adapter. */
import { build } from "esbuild";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { LocalChatGPT } from "./local-chatgpt.mjs";

if (process.env.ORBSIE_LIVE_E2E !== "1")
  throw Error("Set ORBSIE_LIVE_E2E=1 to authorize the real-provider check.");
const directory = await mkdtemp("/tmp/orbsie-followup-");
let client, companion;
const report = {
  scope:
    "One actual ChatGPT follow-up through local HTTP and protocol reducer; not a browser E2E",
  status: "running",
  inferenceRequests: 0,
};
try {
  await build({
    entryPoints: ["scripts/chatgpt-companion.ts", "src/lib/protocol.ts"],
    outdir: directory,
    outbase: ".",
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
  });
  const { startChatGPTCompanion } = await import(
    pathToFileURL(join(directory, "scripts/chatgpt-companion.mjs"))
  );
  const { blankProject, applyOperation } = await import(
    pathToFileURL(join(directory, "src/lib/protocol.mjs"))
  );
  await mkdir(join(directory, "work"));
  client = new LocalChatGPT(join(directory, "work"));
  const model = await client.connect();
  assert.equal(model, "gpt-6-astra");
  report.model = model;
  report.reasoning = "low";
  const origin = "http://127.0.0.1:3017";
  companion = await startChatGPTCompanion({
    client: {
      generate: (...args) => {
        report.inferenceRequests++;
        return client.generate(...args);
      },
      close: () => client.close(),
    },
    model,
    origin,
  });
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
  const start = performance.now();
  report.stage = "http-request";
  const response = await fetch(companion.url + "/generate", {
    method: "POST",
    headers: {
      Origin: origin,
      Authorization: `Bearer ${companion.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, project }),
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
  report.commands = commands;
  assert.equal(commands.at(-1)?.type, "commit_revision");
  report.stage = "apply-commands";
  let cursor = {
    projectId: project.id,
    runId: randomUUID(),
    sequence: 0,
    seen: new Set(),
  };
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
  report.actualSky = project.environment.sky;
  assert.equal(project.environment.sky.toLowerCase(), expectedSky);
  assert.equal(project.environment.ground, before.environment.ground);
  assert.equal(project.environment.water, before.environment.water);
  assert.deepEqual(project.entities, before.entities);
  Object.assign(report, {
    status: "passed",
    stage: "complete",
    durationMs: Math.round(performance.now() - start),
    prompt,
    expectedSky,
    actualSky: project.environment.sky,
    commandTypes: commands.map((command) => command.type),
    unchangedEntities: true,
    unchangedGroundAndWater: true,
  });
} catch {
  report.status = "failed";
  process.exitCode = 1;
} finally {
  if (companion) await companion.close();
  else client?.close();
  await rm(directory, { recursive: true, force: true });
  await mkdir("docs/evidence/provider-followup", { recursive: true });
  await writeFile(
    "docs/evidence/provider-followup/chatgpt-local.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
