import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join, relative } from "node:path";
import assert from "node:assert/strict";

const [snapshotArg, outputArg] = process.argv.slice(2);
if (!snapshotArg || !outputArg || process.argv.length !== 4)
  throw Error(
    "Usage: node scripts/reconstruct-flagship-generated-models.mjs SNAPSHOT.json OUTPUT_DIR",
  );

const snapshotPath = resolve(snapshotArg);
const evidenceDir = resolve(outputArg);
const sourceRoot = process.cwd();
const kernelVersion = "3.3.2";
const helperPaths = [
  "scripts/reconstruct-flagship-generated-models.mjs",
  "src/lib/browser-modeling-connection.ts",
  "src/lib/browser-modeling-glb.ts",
  "src/lib/browser-modeling-queue.ts",
  "src/lib/browser-modeling-worker.ts",
  "src/lib/browser-modeling-kernel.ts",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytesFrom(value) {
  if (value instanceof Uint8Array) return value;
  if (
    Array.isArray(value) &&
    value.every(
      (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
    )
  )
    return Uint8Array.from(value);
  throw Error("Browser reconstruction returned invalid GLB bytes.");
}

const snapshotBytes = await readFile(snapshotPath);
const snapshot = JSON.parse(snapshotBytes.toString("utf8"));
const crystalEntities = (snapshot.entities ?? []).filter(
  (entity) =>
    /^crystal-[1-5]$/.test(entity?.id ?? "") &&
    entity?.geometry?.kind === "generated" &&
    entity?.geometry?.job?.backend === "browser-manifold" &&
    entity?.geometry?.model?.source === "browser-manifold",
);
assert.equal(
  crystalEntities.length,
  5,
  "Expected exactly five browser-manifold crystal entities in the snapshot.",
);

const models = crystalEntities
  .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  .map((entity) => {
    const model = entity.geometry.model;
    if (
      !/^[a-f0-9]{64}$/.test(model.sha256) ||
      !Number.isSafeInteger(model.bytes) ||
      model.bytes <= 0
    )
      throw Error(`Invalid saved metadata for ${entity.id}.`);
    return {
      id: entity.id,
      label: entity.label,
      color: entity.color,
      recipe: entity.geometry.job.recipe,
      expected: {
        sha256: model.sha256,
        bytes: model.bytes,
        bounds: model.bounds,
      },
    };
  });

const helperHashes = {};
for (const path of helperPaths)
  helperHashes[path] = sha256(await readFile(resolve(sourceRoot, path)));

const worker = await build({
  entryPoints: ["src/lib/browser-modeling-worker.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  external: ["module"],
  write: false,
});
const client = await build({
  stdin: {
    resolveDir: sourceRoot,
    contents: `
import {evaluateBrowserModelRecipeInWorker} from './src/lib/browser-modeling-queue';
import {bakeBrowserModelGLB} from './src/lib/browser-modeling-glb';
window.run=async models=>{
  const results=[];
  for (const model of models) {
    const evaluation=await evaluateBrowserModelRecipeInWorker(model.recipe,new AbortController().signal);
    const glb=bakeBrowserModelGLB(evaluation,{color:model.color});
    results.push({id:model.id,bounds:evaluation.bounds,glb:[...glb]});
  }
  return results;
};
`,
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
});

const resources = new Map([
  [
    "/",
    {
      type: "text/html",
      body: '<!doctype html><title>Orbsie model reconstruction</title><script type="module" src="/client.js"></script>',
    },
  ],
  [
    "/client.js",
    { type: "text/javascript", body: client.outputFiles[0].contents },
  ],
  [
    "/modeling/worker.js",
    { type: "text/javascript", body: worker.outputFiles[0].contents },
  ],
  [
    "/modeling/manifold.wasm",
    {
      type: "application/wasm",
      body: await readFile("public/modeling/manifold.wasm"),
    },
  ],
]);
const server = createServer((request, response) => {
  const resource = resources.get(request.url);
  if (!resource) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { "Content-Type": resource.type });
  response.end(resource.body);
});
await mkdir(join(evidenceDir, "generated"), { recursive: true, mode: 0o700 });
await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});

const report = {
  status: "running",
  method: "reconstructed-from-recipe",
  sourceSnapshot: relative(sourceRoot, snapshotPath),
  sourceSnapshotSha256: sha256(snapshotBytes),
  helperHashes,
  kernelVersion,
  inferenceCalls: 0,
  externalRequests: [],
  models: [],
};
const reportPath = join(evidenceDir, "report.json");
const saveReport = async () =>
  writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
await saveReport();

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const blocked = [];
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    blocked.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.run === "function");
  const rebuilt = await page.evaluate((input) => window.run(input), models);
  assert.deepEqual(blocked, [], "Reconstruction requested an external resource.");
  assert.deepEqual(pageErrors, [], "Reconstruction page reported an error.");

  for (const [index, result] of rebuilt.entries()) {
    const expected = models[index].expected;
    const bytes = bytesFrom(result.glb);
    const actual = { sha256: sha256(bytes), bytes: bytes.byteLength };
    const modelReport = {
      id: models[index].id,
      label: models[index].label,
      expected,
      actual,
      bounds: result.bounds,
      status:
        actual.sha256 === expected.sha256 && actual.bytes === expected.bytes
          ? "complete"
          : "mismatch",
      path: `generated/${expected.sha256}.glb`,
    };
    report.models.push(modelReport);
    if (modelReport.status !== "complete") {
      report.status = "failed";
      report.firstMismatch = modelReport;
      await saveReport();
      throw Error(
        `${models[index].id} reconstruction mismatch: expected ${expected.sha256}/${expected.bytes}, got ${actual.sha256}/${actual.bytes}.`,
      );
    }
    await writeFile(join(evidenceDir, modelReport.path), bytes, {
      mode: 0o600,
    });
    await saveReport();
  }
  report.status = "passed";
  report.externalRequests = blocked;
  await saveReport();
  console.log(`Reconstructed ${report.models.length} generated models exactly.`);
} catch (error) {
  if (report.status === "running") {
    report.status = "failed";
    report.error = error instanceof Error ? error.message : String(error);
    await saveReport();
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
