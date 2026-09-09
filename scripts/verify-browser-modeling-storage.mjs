import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const [output] = process.argv.slice(2);
if (!output || process.argv.length !== 3)
  throw Error(
    "Usage: node scripts/verify-browser-modeling-storage.mjs NEW_REPORT.json",
  );
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
    resolveDir: process.cwd(),
    contents: `
import {bakeBrowserModelGLB} from './src/lib/browser-modeling-glb';
import {saveGeneratedModel,readGeneratedModel} from './src/lib/generated-models';
import {generatedGLBBounds} from './src/lib/generated-glb';
window.run=async()=>{
const recipe={version:1,revision:4,output:'arch',nodes:[{id:'box',kind:'box',size:[6,4,1.5]},{id:'cut',kind:'cylinder',radius:1.8,depth:2,axis:'z'},{id:'placed',kind:'transform',input:'cut',position:[0,-1,0],rotation:[0,0,0],scale:[1,1,1]},{id:'arch',kind:'boolean',operation:'subtract',operands:['box','placed']}]};
const mesh=await new Promise((resolve,reject)=>{const w=new Worker('/modeling/worker.js',{type:'module'});const timer=setTimeout(()=>{w.terminate();reject(Error('timeout'));},15000);w.onerror=e=>{clearTimeout(timer);w.terminate();reject(Error(e.message));};w.onmessage=({data})=>{clearTimeout(timer);w.terminate();if(data.type!=='result'||data.jobId!=='storage-test'||data.revision!==4)reject(Error('invalid worker response'));else resolve(data);};w.postMessage({type:'evaluate',jobId:'storage-test',recipe});});
const glb=bakeBrowserModelGLB(mesh,{color:'#E4C79B',roughness:.9});
const metadata=await saveGeneratedModel(glb,{source:'browser-manifold',kernelVersion:'3.3.2',bounds:mesh.bounds});
return {metadata,statistics:mesh.statistics};
};
window.reopen=async hash=>{const record=await readGeneratedModel(hash);return {metadata:record.metadata,bounds:generatedGLBBounds(record.glb),bytes:record.glb.length};};
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
      body: '<!doctype html><title>Orbsie storage test</title><script type="module" src="/client.js"></script>',
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
const server = createServer((req, res) => {
  const r = resources.get(req.url);
  if (!r) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "Content-Type": r.type });
  res.end(r.body);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const blocked = [];
  await context.route("**/*", (r) => {
    if (new URL(r.request().url()).origin === origin) return r.continue();
    blocked.push(r.request().url());
    return r.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.run === "function");
  const built = await page.evaluate(() => window.run());
  await page.reload();
  await page.waitForFunction(() => typeof window.reopen === "function");
  const reopened = await page.evaluate(
    (hash) => window.reopen(hash),
    built.metadata.sha256,
  );
  assert.deepEqual(reopened.metadata, built.metadata);
  assert.deepEqual(reopened.bounds, built.metadata.bounds);
  assert.equal(reopened.bytes, built.metadata.bytes);
  assert.equal(built.metadata.source, "browser-manifold");
  assert.equal(built.metadata.kernelVersion, "3.3.2");
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  await writeFile(
    resolve(output),
    JSON.stringify(
      {
        status: "passed",
        scope:
          "Actual worker → GLB → IndexedDB → page reload; no editor/provider integration",
        built,
        reopened,
        errors,
        blocked,
        inferenceCalls: 0,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log("Browser worker storage round trip passed.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
