import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";

const [project, reportPath, backend = "bitbybit"] = process.argv.slice(2);
if (
  !project ||
  !reportPath ||
  process.argv.length > 5 ||
  !["bitbybit", "direct"].includes(backend)
)
  throw Error(
    "Usage: node scripts/verify-browser-modeling-prototype.mjs PROTOTYPE_NPM_DIRECTORY NEW_REPORT.json [bitbybit|direct]",
  );
const root = resolve(project);
for (const [name, version] of [
  ["manifold-3d", "3.3.2"],
  ["@bitbybit-dev/manifold-worker", "1.1.1"],
]) {
  const metadata = JSON.parse(
    await readFile(join(root, "node_modules", name, "package.json"), "utf8"),
  );
  assert.equal(metadata.version, version);
}
const source = await readFile(
  new URL(
    `../docs/evidence/browser-modeling-prototype/${backend === "direct" ? "direct-browser-worker" : "browser-worker"}.mjs`,
    import.meta.url,
  ),
  "utf8",
);
const bundle = await build({
  stdin: {
    contents: source,
    resolveDir: root,
    sourcefile: "browser-worker.mjs",
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  external: ["module"],
  write: false,
});
const wasm = await readFile(
  join(root, "node_modules/manifold-3d/manifold.wasm"),
);
const resources = new Map([
  [
    "/",
    {
      body: "<!doctype html><title>Orbsie worker verification</title>",
      type: "text/html",
    },
  ],
  [
    "/worker.js",
    { body: bundle.outputFiles[0].contents, type: "text/javascript" },
  ],
  ["/manifold.wasm", { body: wasm, type: "application/wasm" }],
]);
const served = [];
const server = createServer((req, res) => {
  const resource = resources.get(req.url);
  if (req.method !== "GET" || !resource) {
    res.writeHead(404);
    res.end();
    return;
  }
  served.push(req.url);
  res.writeHead(200, { "Content-Type": resource.type });
  res.end(resource.body);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
let browser;
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const blocked = [];
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    blocked.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  const runs = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker("/worker.js", { type: "module" });
        const results = [];
        const fail = (error) => {
          clearTimeout(timer);
          worker.terminate();
          reject(error);
        };
        const timer = setTimeout(
          () => fail(Error("Worker deadline exceeded")),
          15000,
        );
        worker.onerror = (e) => fail(Error(e.message));
        worker.onmessageerror = () =>
          fail(Error("Worker result could not be decoded"));
        worker.onmessage = (e) => {
          if (e.data?.ready) {
            worker.postMessage({ run: true });
            return;
          }
          try {
            results.push(JSON.parse(e.data));
          } catch (error) {
            fail(error);
            return;
          }
          if (results.length < 2) worker.postMessage({ run: true });
          else {
            clearTimeout(timer);
            worker.terminate();
            resolve(results);
          }
        };
      }),
  );
  assert.equal(runs.length, 2);
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  for (const result of runs) {
    assert.equal(result.arch.status, "NoError");
    assert.equal(result.edited.status, "NoError");
    assert.equal(result.arch.numTri, 152);
    assert.equal(result.edited.numTri, 136);
    assert(Math.abs(result.arch.volume - 23.288210523297796) < 1e-8);
    assert(result.edited.volume < result.arch.volume);
    assert.deepEqual(result.arch.boundingBox, [
      [-3, -2, -0.75],
      [3, 2, 0.75],
    ]);
  }
  assert(served.includes("/manifold.wasm"));
  await writeFile(
    resolve(reportPath),
    JSON.stringify(
      {
        status: "passed",
        scope:
          "Real Chromium module Worker; repeated geometry only, no app integration",
        browser: browser.version(),
        runs,
        errors,
        blocked,
        served,
        backend,
        bundleBytes: bundle.outputFiles[0].contents.length,
        bundleGzipBytes: gzipSync(bundle.outputFiles[0].contents).length,
        wasmGzipBytes: gzipSync(wasm).length,
        wasmBytes: wasm.length,
        inferenceCalls: 0,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log("Browser worker geometry verification passed.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
