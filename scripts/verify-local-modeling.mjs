/** Opt-in real local Blender + browser transport proof; performs no inference. */
import { build } from "esbuild";
import { chromium } from "playwright";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const origin = process.env.ORBSIE_ORIGIN ?? "http://127.0.0.1:3017";
const evidence = resolve(
  process.env.ORBSIE_MODELING_EVIDENCE ?? "docs/evidence/local-modeling",
);
const directory = await mkdtemp(join(tmpdir(), "orbsie-modeling-proof-"));
let browser, companion;
try {
  await build({
    entryPoints: [
      "scripts/modeling-companion.ts",
      "scripts/blender-modeling.ts",
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    outdir: directory,
    outExtension: { ".js": ".mjs" },
  });
  await copyFile(
    "scripts/blender-modeling.py",
    join(directory, "blender-modeling.py"),
  );
  const { startModelingCompanion } = await import(
    pathToFileURL(join(directory, "modeling-companion.mjs"))
  );
  const { runBlenderModelingJob } = await import(
    pathToFileURL(join(directory, "blender-modeling.mjs"))
  );
  const client = await build({
    stdin: {
      contents:
        'export { buildLocalModel, checkModelingConnection } from "./src/lib/modeling-connection"; export { readGeneratedModel } from "./src/lib/generated-models"; export { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"; export * as THREE from "three";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "modelingProof",
    write: false,
  });
  companion = await startModelingCompanion({
    build: runBlenderModelingJob,
    origin,
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: client.outputFiles[0].text });
  const result = await page.evaluate(
    async (connection) => {
      const api = window.modelingProof;
      const health = await api.checkModelingConnection(connection);
      const stages = [];
      const started = performance.now();
      const metadata = await api.buildLocalModel(
        connection,
        {
          version: 1,
          parts: [
            {
              id: "vase",
              shape: "lathe",
              color: "#ed8fa3",
              profile: [
                [0, -1],
                [0.7, -0.8],
                [0.4, 0.4],
                [0.55, 1],
              ],
              segments: 16,
              position: [0, 1, 0],
            },
            {
              id: "fin",
              shape: "extrude",
              color: "#69bfad",
              profile: [
                [0, 0],
                [1, 0],
                [0.3, 1.3],
              ],
              depth: 0.3,
              position: [1, 1, 0],
            },
          ],
        },
        { onProgress: (event) => stages.push(event.stage) },
      );
      const saved = await api.readGeneratedModel(metadata.sha256);
      const { THREE } = api;
      const gltf = await new api.GLTFLoader().parseAsync(saved.glb.buffer, "");
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      const expected = metadata.bounds;
      const min = bounds.min.toArray(),
        max = bounds.max.toArray();
      if (
        min.some(
          (value, index) => Math.abs(value - expected.min[index]) > 0.0001,
        ) ||
        max.some(
          (value, index) => Math.abs(value - expected.max[index]) > 0.0001,
        )
      )
        throw Error("Exported geometry and persisted bounds disagree.");
      document.body.replaceChildren();
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#e5efe9");
      scene.add(gltf.scene);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x697b74, 3));
      const light = new THREE.DirectionalLight(0xffffff, 3);
      light.position.set(3, 5, 4);
      scene.add(light);
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      });
      renderer.setSize(900, 650);
      document.body.append(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(42, 900 / 650, 0.1, 100);
      camera.position.set(5, 4, 7);
      camera.lookAt(0.5, 1, 0);
      renderer.render(scene, camera);
      return {
        scope:
          "actual browser transport, isolated Blender, GLB decode/render and IndexedDB persistence; no LLM inference or editor integration",
        health,
        stages,
        elapsedMs: Math.round(performance.now() - started),
        metadata,
        renderedBounds: { min, max },
        glb: Array.from(saved.glb),
      };
    },
    { url: companion.url, token: companion.token },
  );
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, "render.png") });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: client.outputFiles[0].text });
  result.reloadVerified = await page.evaluate(async (hash) => {
    const saved = await window.modelingProof.readGeneratedModel(hash);
    return saved.metadata.sha256 === hash && saved.glb.byteLength > 0;
  }, result.metadata.sha256);
  if (!result.reloadVerified)
    throw Error("Generated model did not survive reload.");
  await writeFile(join(evidence, "model.glb"), new Uint8Array(result.glb));
  delete result.glb;
  await writeFile(
    join(evidence, "report.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await companion?.close();
  await rm(directory, { recursive: true, force: true });
}
