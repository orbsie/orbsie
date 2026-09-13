import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const glbPath =
  process.env.MUSHROOM_TEXTURED_GLB_PATH ??
  "docs/evidence/mushroom-basic-textured-filter-corrected/prototype.glb";
const evidenceDirectory =
  process.env.ASSET_GEOMETRY_TEXTURED_WORKER_EVIDENCE_DIRECTORY ??
  "docs/evidence/mushroom-basic-textured-worker";
const reportPath = join(evidenceDirectory, "report.json");
const temporary = await mkdtemp(
  join(tmpdir(), "orbsie-asset-textured-worker-"),
);
let evidenceCreated = false;
let server;
let browser;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  await mkdir(dirname(evidenceDirectory), { recursive: true });
  await mkdir(evidenceDirectory);
  evidenceCreated = true;
  const glbBytes = await readFile(glbPath);
  const glbSha256 = sha256(glbBytes);
  const workerBuild = await build({
    entryPoints: ["src/lib/asset-geometry-worker.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    outfile: join(temporary, "asset-geometry-worker.js"),
  });
  const worker = await readFile(join(temporary, "asset-geometry-worker.js"));
  server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://asset.local").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (pathname === "/asset-geometry-worker.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(worker);
    } else if (pathname === "/prototype.glb") {
      response.setHeader("Content-Type", "model/gltf-binary");
      response.setHeader("Content-Length", String(glbBytes.byteLength));
      response.end(glbBytes);
    } else if (pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><title>Asset texture worker probe</title>");
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const externalRequests = [];
  await context.route("**/*", (route) => {
    const requestOrigin = new URL(route.request().url()).origin;
    if (requestOrigin === origin) return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  const pageErrors = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      pageErrors.push(message.text().slice(0, 500));
  });
  await page.goto(`${origin}/`, { waitUntil: "load" });
  const result = await page.evaluate(async () => {
    const response = await fetch("/prototype.glb");
    const bytes = await response.arrayBuffer();
    const worker = new Worker("/asset-geometry-worker.js", { type: "module" });
    try {
      const message = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("worker probe timed out")),
          30_000,
        );
        worker.onerror = (event) => {
          clearTimeout(timer);
          reject(new Error(event.message || "worker probe failed"));
        };
        worker.onmessage = (event) => {
          clearTimeout(timer);
          resolve(event.data);
        };
        worker.postMessage(
          {
            bytes,
            id: "kenney.nature.tree-default",
            maxAssetBytes: 2 * 1024 * 1024,
            maxVertices: 250_000,
            maxGeometryBytes: 24 * 1024 * 1024,
            verifyManifest: false,
          },
          [bytes],
        );
      });
      const decoded = message.decoded;
      if (!decoded) return message;
      const texture = decoded.baseColorTexture;
      return {
        byteLength: decoded.byteLength,
        attributes: Object.fromEntries(
          Object.entries(decoded.attributes).map(([name, value]) => [
            name,
            {
              constructor: value.array.constructor.name,
              bytes: value.array.byteLength,
              itemSize: value.itemSize,
              count: value.array.length / value.itemSize,
            },
          ]),
        ),
        texture: texture
          ? {
              width: texture.width,
              height: texture.height,
              pixels: texture.pixels.byteLength,
              constructor: texture.pixels.constructor.name,
              firstPixel: Array.from(texture.pixels.slice(0, 4)),
              distinctSampleBytes: new Set(
                texture.pixels.filter((_, index) => index % 257 === 0),
              ).size,
              colorSpace: texture.colorSpace,
              wrapS: texture.wrapS,
              wrapT: texture.wrapT,
              magFilter: texture.magFilter,
              minFilter: texture.minFilter,
              generateMipmaps: texture.generateMipmaps,
            }
          : null,
      };
    } finally {
      worker.terminate();
    }
  });
  const pageExternalRequests = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => !url.startsWith(location.origin)),
  );
  const allExternalRequests = [...externalRequests, ...pageExternalRequests];
  if (pageErrors.length)
    throw new Error(`Worker probe page errors: ${pageErrors.join(" | ")}`);
  if (allExternalRequests.length)
    throw new Error(
      `Worker probe external requests: ${allExternalRequests.join(" | ")}`,
    );
  if (result.error)
    throw new Error(`Worker returned ${result.code}: ${result.error}`);
  if (!result.texture)
    throw new Error("Worker returned no base-color texture descriptor.");
  const attributeBytes = Object.values(result.attributes).reduce(
    (total, attribute) => total + attribute.bytes,
    0,
  );
  if (
    !result.attributes.uv ||
    result.attributes.uv.constructor !== "Float32Array"
  )
    throw new Error("Worker returned no transferred UV attribute.");
  if (
    !result.attributes.position ||
    result.attributes.uv.count !== result.attributes.position.count ||
    result.attributes.uv.count !== 666
  )
    throw new Error("Worker returned an unexpected UV vertex count.");
  if (result.byteLength !== attributeBytes + result.texture.pixels)
    throw new Error(
      "Worker byte accounting omitted geometry or texture pixels.",
    );
  if (
    result.texture.width !== 512 ||
    result.texture.height !== 512 ||
    result.texture.pixels !== 512 * 512 * 4 ||
    result.texture.constructor !== "Uint8Array" ||
    result.texture.colorSpace !== "srgb" ||
    result.texture.wrapS !== 1000 ||
    result.texture.wrapT !== 1000 ||
    result.texture.magFilter !== 1006 ||
    result.texture.minFilter !== 1008 ||
    result.texture.generateMipmaps !== true
  )
    throw new Error(
      "Worker returned invalid decoded PNG pixels or sampler metadata.",
    );
  const report = {
    status: "decoded",
    scope:
      "isolated real browser worker PNG decode; test-only existing catalog ID with manifest verification disabled",
    input: { path: glbPath, sha256: glbSha256, bytes: glbBytes.byteLength },
    worker: {
      bytes: worker.byteLength,
      esbuildInputs: Object.keys(workerBuild.metafile?.inputs ?? {}),
      id: "kenney.nature.tree-default",
      verifyManifest: false,
    },
    result,
    checks: {
      actualWorker: true,
      pngDecodedToRgbaUint8Array: true,
      dimensions512: true,
      pixelBytesBounded: result.texture.pixels <= 1024 * 1024 * 4,
      transferredGeometryAndPixels: true,
      uvTransferred: true,
      expectedUvCount: result.attributes.uv.count === 666,
      expectedSamplerValues:
        result.texture.wrapS === 1000 &&
        result.texture.wrapT === 1000 &&
        result.texture.magFilter === 1006 &&
        result.texture.minFilter === 1008 &&
        result.texture.generateMipmaps === true,
      byteAccountingIncludesPixels:
        result.byteLength === attributeBytes + result.texture.pixels,
      noPageErrors: pageErrors.length === 0,
      noExternalRequests: allExternalRequests.length === 0,
    },
    pageErrors,
    externalRequests: allExternalRequests,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  await context.close();
}

try {
  await main();
} catch (error) {
  const report = {
    status: "error",
    scope: "isolated real browser worker PNG decode; no runtime integration",
    error:
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error),
  };
  if (evidenceCreated)
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
