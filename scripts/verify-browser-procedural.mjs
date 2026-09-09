/** Actual browser QuickJS worker acceptance; no model or account access. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const directory = process.argv[2];
if (!directory || process.argv.length !== 3)
  throw Error(
    "Usage: node scripts/verify-browser-procedural.mjs NEW_EVIDENCE_DIRECTORY",
  );
await mkdir(directory, { recursive: false });
const bundle = await build({
  stdin: {
    contents:
      'export {evaluateBrowserProceduralInWorker} from "./src/lib/browser-procedural-queue";',
    resolveDir: process.cwd(),
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
      body: "<!doctype html><title>Browser procedural acceptance</title>",
      type: "text/html",
    },
  ],
  [
    "/queue.js",
    { body: bundle.outputFiles[0].contents, type: "text/javascript" },
  ],
]);
for (const [name, type] of [
  ["procedural-worker.js", "text/javascript"],
  ["emscripten-module.wasm", "application/wasm"],
])
  resources.set(`/modeling/${name}`, {
    body: await readFile(resolve("public/modeling", name)),
    type,
  });
const served = [];
const server = createServer((req, res) => {
  const asset = resources.get(req.url);
  if (req.method !== "GET" || !asset) {
    res.writeHead(404);
    res.end();
    return;
  }
  served.push(req.url);
  res.writeHead(200, { "Content-Type": asset.type });
  res.end(asset.body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
const report = {
  mode: "actual-browser-worker-no-inference",
  status: "running",
  blocked: [],
  pageErrors: [],
  served,
};
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    report.blocked.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => report.pageErrors.push(e.message));
  await page.goto(origin);
  report.cases = await page.evaluate(async () => {
    const { evaluateBrowserProceduralInWorker: run } =
      await import("/queue.js");
    const source = (code, seed = 73) => ({
      version: 1,
      language: "quickjs",
      code,
      seed,
    });
    const code =
      '({version:1,revision:0,output:"box",nodes:[{id:"box",kind:"box",size:[1+orb.random(),1,1]}]})';
    const a = await run(source(code));
    const b = await run(source(code));
    const c = await run(source(code, 74));
    if (
      JSON.stringify(a) !== JSON.stringify(b) ||
      JSON.stringify(a) === JSON.stringify(c)
    )
      throw Error("Seed determinism failed");
    const absent =
      '["fetch","XMLHttpRequest","WebSocket","indexedDB","localStorage","document","process","require","Date"].every(k=>typeof globalThis[k]==="undefined")';
    await run(
      source(
        `(()=>{if(!(${absent}))throw Error("host API exposed");return ${code};})()`,
      ),
    );
    const reject = async (code, options) => {
      try {
        await run(source(code), options);
      } catch (e) {
        return e.code ?? "error";
      }
      throw Error("Unexpected acceptance");
    };
    const malformed = await reject("({version:1,nodes:[]})");
    const loop = await reject("(()=>{while(true){} })()");
    const controller = new AbortController();
    const pending = run(source("(()=>{while(true){} })()"), {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    let cancellation;
    try {
      await pending;
      throw Error("Abort accepted");
    } catch (e) {
      cancellation = e.code;
      if (cancellation !== "aborted") throw e;
    }
    const recovered = await run(source(code));
    if (JSON.stringify(a) !== JSON.stringify(recovered))
      throw Error("Recovery failed");
    return {
      deterministic: true,
      seedVariation: true,
      hostAPIsAbsent: true,
      malformed,
      loop,
      cancellation,
      recovered: true,
    };
  });
  assert.deepEqual(report.blocked, []);
  assert.deepEqual(report.pageErrors, []);
  assert(served.includes("/modeling/emscripten-module.wasm"));
  assert.equal(report.cases.loop, "timeout");
  assert.equal(report.cases.malformed, "invalid-recipe");
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  await writeFile(
    `${directory}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(JSON.stringify(report));
