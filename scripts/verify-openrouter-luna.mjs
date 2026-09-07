// One explicitly authorized, small paid request. Never substitute another model.
// node --env-file=.env.openrouter.local scripts/verify-openrouter-luna.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

const model = "openai/gpt-5.6-luna";
const maxTokens = 512;
const key = process.env.OPENROUTER_API_KEY;
assert(key, "Load the private local OpenRouter test environment first.");
assert(
  !process.env.OPENROUTER_TEST_MODEL ||
    process.env.OPENROUTER_TEST_MODEL === model,
  "This credential is authorized for Luna only.",
);
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
const started = Date.now();
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://orbsie.com",
    "X-Title": "Orbsie bounded Luna test",
  },
  body: JSON.stringify({
    model,
    max_tokens: maxTokens,
    reasoning: { effort: "low" },
    provider: { allow_fallbacks: false },
    messages: [
      {
        role: "user",
        content:
          'Create one small pink mushroom at [0,0,0] for a 3D world. Output ONLY three newline-delimited JSON commands, no markdown: reserve_entity with entity {id,label,position,scale,color,stage:"seed"}; set_geometry with the same id and geometry {kind:"mushroom",detail:"refined"}; commit_revision with a short message. Pick suitable label, hex color and scale; no other entities or commands.',
      },
    ],
  }),
  signal: AbortSignal.timeout(45000),
});
if (!response.ok) {
  await response.body?.cancel();
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    "docs/evidence/openrouter-luna.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        model,
        requests: 1,
        maxOutputTokens: maxTokens,
        status: response.status,
        passed: false,
        scope:
          "Direct OpenRouter request rejected; no retry or model substitution.",
      },
      null,
      2,
    ) + "\n",
  );
  throw Error(
    `OpenRouter request failed: HTTP ${response.status}; no retry made.`,
  );
}
const data = await response.json();
assert(
  data.model === model || data.model === "gpt-5.6-luna",
  "Unexpected returned model.",
);
assert.equal(
  data.choices?.[0]?.finish_reason,
  "stop",
  "Incomplete generation; no retry made.",
);
const commands = data.choices[0].message.content
  .trim()
  .split("\n")
  .map(JSON.parse);
assert.equal(commands.length, 3);
assert.equal(commands.at(-1).type, "commit_revision");
let project = blankProject();
let cursor = { runId: crypto.randomUUID(), sequence: 0, seen: new Set() };
for (const command of commands) {
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
assert.equal(project.entities.length, 1);
assert.equal(project.entities[0].geometry.kind, "mushroom");
assert.equal(project.entities[0].stage, "ready");
const usage = data.usage || {};
const report = {
  date: new Date().toISOString(),
  model,
  requests: 1,
  maxOutputTokens: maxTokens,
  elapsedMs: Date.now() - started,
  commands: commands.length,
  entities: project.entities.length,
  promptTokens: usage.prompt_tokens,
  completionTokens: usage.completion_tokens,
  totalTokens: usage.total_tokens,
  cost: usage.cost,
  passed: true,
  scope:
    "Direct OpenRouter request and Orbsie protocol validation; not hosted relay or browser E2E.",
};
await mkdir("docs/evidence", { recursive: true });
await writeFile(
  "docs/evidence/openrouter-luna.json",
  JSON.stringify(report, null, 2) + "\n",
);
await writeFile(
  "docs/evidence/openrouter-luna-project.json",
  JSON.stringify(project, null, 2) + "\n",
);
console.log(JSON.stringify(report));
