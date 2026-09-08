/** Exercise actual bundled decode workers with local GLBs; no provider traffic. */
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const temporary = await mkdtemp(join(tmpdir(), "orbsie-particle-workers-"));
let browser;
try {
  const sources = {};
  for (const kind of ["asset", "generated"]) {
    const file = join(temporary, `${kind}.js`);
    await build({
      entryPoints: [`src/lib/${kind}-geometry-worker.ts`],
      bundle: true,
      platform: "browser",
      format: "esm",
      outfile: file,
    });
    sources[`/${kind}.js`] = await readFile(file, "utf8");
  }
  browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.route("**/*", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      contentType: sources[path] ? "text/javascript" : "text/html",
      body:
        sources[path] || "<!doctype html><title>Local worker fixture</title>",
    });
  });
  await page.goto("https://fixture.orbsie.test/");
  const results = [];
  for (const [kind, path] of [
    ["asset", "public/models/kenney/nature-kit/tree_default.glb"],
    ["generated", "docs/evidence/local-modeling/model.glb"],
  ]) {
    const bytes = await readFile(path);
    const result = await page.evaluate(
      async ({ kind, base64, hash }) => {
        const bytes = Uint8Array.from(atob(base64), (value) =>
          value.charCodeAt(0),
        );
        const worker = new Worker(`/${kind}.js`, { type: "module" });
        try {
          return await new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(Error("Worker timed out")),
              15000,
            );
            worker.onerror = (event) => {
              clearTimeout(timer);
              reject(Error(event.message));
            };
            worker.onmessage = ({ data }) => {
              clearTimeout(timer);
              if (data.error) return reject(Error(data.error));
              const payload = data.decoded || data;
              const position = payload.attributes.formationPosition;
              const color = payload.attributes.formationColor;
              resolve({
                kind,
                positionCount: position?.array.length / 3,
                colorCount: color?.array.length / 3,
                float32:
                  position?.array instanceof Float32Array &&
                  color?.array instanceof Float32Array,
                finite:
                  position?.array.every(Number.isFinite) &&
                  color?.array.every(Number.isFinite),
              });
            };
            worker.postMessage(
              {
                bytes,
                hash,
                id: "kenney.nature.tree-default",
                maxAssetBytes: 2 * 1024 * 1024,
                maxVertices: 100000,
                maxGeometryBytes: 16 * 1024 * 1024,
                verifyManifest: true,
              },
              [bytes.buffer],
            );
          });
        } finally {
          worker.terminate();
        }
      },
      {
        kind,
        base64: bytes.toString("base64"),
        hash: createHash("sha256").update(bytes).digest("hex"),
      },
    );
    assert.equal(result.positionCount, 2048);
    assert.equal(result.colorCount, 2048);
    assert.ok(result.float32 && result.finite);
    results.push(result);
  }
  const directory = "docs/evidence/prepared-particle-workers";
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify({ status: "passed", providerCalls: 0, results }, null, 2) +
      "\n",
  );
  console.log(
    "Both actual decode workers transferred bounded surface samples.",
  );
} finally {
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
