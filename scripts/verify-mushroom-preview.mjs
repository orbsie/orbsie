import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const inspectionPath = "docs/evidence/mushroom-candidate-inspection/report.json";
const conversionPath = "docs/evidence/mushroom-candidate-conversion/report.json";
const evidenceDirectory = "docs/evidence/mushroom-candidate-preview";
const reportPath = join(evidenceDirectory, "report.json");
const temporary = await mkdtemp(join(tmpdir(), "orbsie-mushroom-preview-"));
let server;
let browser;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  await mkdir(evidenceDirectory, { recursive: true });
  const inspection = JSON.parse(await readFile(inspectionPath, "utf8"));
  const conversion = JSON.parse(await readFile(conversionPath, "utf8"));
  const fbxEntry = inspection.selectedFiles.find(
    (entry) => entry.archivePath === "Meshes/Fly_Agaric_Big.fbx",
  );
  const tgaEntry = inspection.selectedFiles.find(
    (entry) => entry.archivePath === "Textures/Mushrooms_C.tga",
  );
  const glbPath = conversion.output.path;
  if (!fbxEntry || !tgaEntry || !glbPath)
    throw new Error("Inspection or conversion evidence is missing an input/output path.");
  const [fbxBytes, tgaBytes, glbBytes] = await Promise.all([
    readFile(fbxEntry.path),
    readFile(tgaEntry.path),
    readFile(glbPath),
  ]);
  const hashes = {
    fbx: sha256(fbxBytes),
    tga: sha256(tgaBytes),
    glb: sha256(glbBytes),
  };
  if (hashes.fbx !== fbxEntry.sha256)
    throw new Error(`FBX SHA-256 mismatch: ${hashes.fbx}`);
  if (hashes.tga !== tgaEntry.sha256)
    throw new Error(`TGA SHA-256 mismatch: ${hashes.tga}`);
  if (hashes.glb !== conversion.output.sha256)
    throw new Error(`GLB SHA-256 mismatch: ${hashes.glb}`);

  await build({
    entryPoints: ["scripts/mushroom-preview-fixture.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    outfile: join(temporary, "fixture.js"),
  });
  const fixture = await readFile(join(temporary, "fixture.js"));
  const originPath = {
    fixture: "/fixture.js",
    fbx: "/source.fbx",
    tga: "/source.tga",
    glb: "/prototype.glb",
  };
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture.local").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (path === originPath.fixture) {
      response.setHeader("Content-Type", "text/javascript");
      response.end(fixture);
    } else if (path === originPath.fbx) {
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("Content-Length", String(fbxBytes.byteLength));
      response.end(fbxBytes);
    } else if (path === originPath.tga) {
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("Content-Length", String(tgaBytes.byteLength));
      response.end(tgaBytes);
    } else if (path === originPath.glb) {
      response.setHeader("Content-Type", "model/gltf-binary");
      response.setHeader("Content-Length", String(glbBytes.byteLength));
      response.end(glbBytes);
    } else if (path === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><title>Mushroom preview</title><style>html,body{margin:0;background:#07110e;color:#e9f5ef;font:16px sans-serif}#root{display:flex;gap:18px;padding:18px}section{background:#10251c;padding:10px;border-radius:8px}h2{font-size:16px;font-weight:500;margin:0 0 8px}canvas{display:block}</style><div id="root"></div><script type="module" src="${originPath.fixture}"></script>`);
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
  const context = await browser.newContext({
    viewport: { width: 1400, height: 500 },
    serviceWorkers: "block",
  });
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
    if (message.type() === "error") pageErrors.push(message.text().slice(0, 500));
  });
  await page.goto(`${origin}/`, { waitUntil: "load" });
  const startedAt = Date.now();
  while (!(await page.evaluate(() => window.mushroomPreviewFixture?.ready?.()))) {
    if (Date.now() - startedAt > 30_000) throw new Error("Preview fixture did not become ready.");
    await page.waitForTimeout(50);
  }
  const frontStatus = await page.evaluate(() => window.mushroomPreviewFixture.status());
  const frontPath = join(evidenceDirectory, "front.png");
  await page.screenshot({ path: frontPath });
  await page.evaluate(() => window.mushroomPreviewFixture.renderRear());
  await page.waitForTimeout(100);
  const rearPath = join(evidenceDirectory, "rear.png");
  await page.screenshot({ path: rearPath });
  const pageExternalRequests = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => !url.startsWith(location.origin)),
  );
  const allExternalRequests = [...externalRequests, ...pageExternalRequests];
  if (pageErrors.length) throw new Error(`Preview page errors: ${pageErrors.join(" | ")}`);
  if (allExternalRequests.length)
    throw new Error(`Preview external requests: ${allExternalRequests.join(" | ")}`);
  const report = {
    status: "rendered",
    scope: "isolated local Three/Playwright visual comparison; no app or catalog integration",
    inputs: {
      inspection: inspectionPath,
      conversion: conversionPath,
      fbx: { path: fbxEntry.path, sha256: hashes.fbx, bytes: fbxBytes.byteLength },
      tga: { path: tgaEntry.path, sha256: hashes.tga, bytes: tgaBytes.byteLength },
      glb: { path: glbPath, sha256: hashes.glb, bytes: glbBytes.byteLength },
    },
    renderer: frontStatus.renderer,
    browser: frontStatus.browser,
    camera: {
      front: frontStatus.camera,
      rear: { position: [-1.7, 1.2, -2], lookAt: [0, 0.5, 0] },
    },
    lightsAndBackground: "identical hemisphere + key/fill directional lights and #07110e background",
    texture: frontStatus.texture,
    bounds: frontStatus.bounds,
    sourceTextureComplete: frontStatus.texture.loaded === true,
    ready: frontStatus.ready === true,
    pageErrors,
    externalRequests: allExternalRequests,
    screenshots: {
      front: frontPath,
      rear: rearPath,
    },
    appearance: {
      status: "review-required",
      note: "Screenshots are evidence for human visual review; this probe does not claim fidelity or recognizability.",
    },
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
    scope: "isolated local Three/Playwright visual comparison; no app or catalog integration",
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
