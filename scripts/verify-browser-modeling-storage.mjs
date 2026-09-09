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
import {evaluateBrowserModelRecipeInWorker} from './src/lib/browser-modeling-queue';
import {saveGeneratedModel,readGeneratedModel} from './src/lib/generated-models';
import {generatedGLBBounds} from './src/lib/generated-glb';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
window.run=async()=>{
const recipe={version:1,revision:4,output:'arch',nodes:[{id:'box',kind:'box',size:[6,4,1.5]},{id:'cut',kind:'cylinder',radius:1.8,depth:2,axis:'z'},{id:'placed',kind:'transform',input:'cut',position:[0,-1,0],rotation:[0,0,0],scale:[1,1,1]},{id:'arch',kind:'boolean',operation:'subtract',operands:['box','placed']}]};
const activeAbort=new AbortController(),queuedAbort=new AbortController();
const cancelledActive=evaluateBrowserModelRecipeInWorker(recipe,activeAbort.signal).then(()=>{throw Error('Active job unexpectedly completed');},error=>error.code);
const cancelledQueued=evaluateBrowserModelRecipeInWorker(recipe,queuedAbort.signal).then(()=>{throw Error('Queued job unexpectedly completed');},error=>error.code);
queuedAbort.abort();activeAbort.abort();
const cancellations=await Promise.all([cancelledActive,cancelledQueued]);
if(cancellations.some(code=>code!=='aborted'))throw Error('Cancellation contract failed');
const mesh=await evaluateBrowserModelRecipeInWorker(recipe,new AbortController().signal);
const glb=bakeBrowserModelGLB(mesh,{color:'#E4C79B',roughness:.9});
const metadata=await saveGeneratedModel(glb,{source:'browser-manifold',kernelVersion:'3.3.2',bounds:mesh.bounds});
return {metadata,statistics:mesh.statistics,cancellations};
};
window.render=async hash=>{
const record=await readGeneratedModel(hash);const gltf=await new GLTFLoader().parseAsync(record.glb.buffer,'');
const scene=new THREE.Scene();scene.background=new THREE.Color('#e8efe4');scene.add(gltf.scene);
scene.add(new THREE.HemisphereLight(0xffffff,0x586d53,2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(4,8,6);scene.add(light);
const camera=new THREE.PerspectiveCamera(40,1.5,.1,100);camera.position.set(7,4,10);camera.lookAt(0,0,0);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(900,600);document.body.appendChild(renderer.domElement);renderer.render(scene,camera);
return {canvas:true};
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
  await page.evaluate((hash) => window.render(hash), built.metadata.sha256);
  await page.locator("canvas").screenshot({ path: resolve(output) + ".png" });
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
          "Actual queue cancellation/recovery → worker → GLB → IndexedDB → page reload; no editor/provider integration",
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
