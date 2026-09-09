import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const project = dirname(root);
const outputDirectory = join(project, "public/modeling");

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [join(project, "src/lib/browser-modeling-worker.ts")],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  external: ["module"],
  outfile: join(outputDirectory, "worker.js"),
});

// Keep the pinned runtime asset and its license beside the worker. The
// provenance record is committed separately and remains untouched here.
await copyFile(
  join(project, "node_modules/manifold-3d/manifold.wasm"),
  join(outputDirectory, "manifold.wasm"),
);
await copyFile(
  join(project, "node_modules/manifold-3d/LICENSE"),
  join(outputDirectory, "manifold-LICENSE.txt"),
);
