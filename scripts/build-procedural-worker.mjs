import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const project = dirname(root);
const outputDirectory = join(project, "public/modeling");
const quickjsPackage = join(
  project,
  "node_modules/@jitl/quickjs-wasmfile-release-sync",
);

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [join(project, "src/lib/browser-procedural-worker.ts")],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  outfile: join(outputDirectory, "procedural-worker.js"),
});

await copyFile(
  join(quickjsPackage, "dist/emscripten-module.wasm"),
  join(outputDirectory, "emscripten-module.wasm"),
);
await copyFile(
  join(project, "node_modules/quickjs-emscripten-core/LICENSE"),
  join(outputDirectory, "quickjs-emscripten-core-LICENSE.txt"),
);
await copyFile(
  join(quickjsPackage, "LICENSE"),
  join(outputDirectory, "quickjs-wasmfile-release-sync-LICENSE.txt"),
);
