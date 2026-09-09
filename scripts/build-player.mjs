import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
await import("./build-modeling-worker.mjs");
await mkdir("public/player", { recursive: true });
await build({
  entryPoints: ["src/lib/generated-geometry-worker.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  outfile: "public/player/generated-geometry-worker.js",
});
await build({
  entryPoints: ["src/lib/asset-geometry-worker.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  outfile: "public/player/asset-geometry-worker.js",
});
await build({
  entryPoints: ["src/player/main.tsx"],
  bundle: true,
  minify: true,
  jsx: "automatic",
  format: "esm",
  outfile: "public/player/runtime.js",
  define: {
    "process.env.NODE_ENV": '"production"',
    ORBSIE_STANDALONE_WORKER: JSON.stringify("./generated-geometry-worker.js"),
    ORBSIE_STANDALONE_ASSET_WORKER: JSON.stringify(
      "./asset-geometry-worker.js",
    ),
  },
  alias: { "@": "./src" },
});
const paths = [
  "src/player/main.tsx",
  "src/player/player.css",
  "src/components/world.tsx",
  "src/lib/store.ts",
  "src/lib/generation-connection.ts",
  "src/lib/modeling.ts",
  "src/lib/modeling-policy.ts",
  "src/lib/modeling-connection.ts",
  "src/lib/generated-models.ts",
  "src/lib/cloud-generated-models.ts",
  "src/lib/cloud-generation-journal.ts",
  "src/lib/generation-journal.ts",
  "src/lib/parcel-transition.ts",
  "src/lib/generated-glb.ts",
  "src/lib/generated-geometry.ts",
  "src/lib/generated-geometry-core.ts",
  "src/lib/generated-geometry-error.ts",
  "src/lib/generated-geometry-queue.ts",
  "src/lib/generated-geometry-worker.ts",
  "src/lib/use-generated-geometry.ts",
  "src/lib/asset-catalog.ts",
  "src/lib/asset-policy.ts",
  "src/lib/asset-geometry.ts",
  "src/lib/asset-geometry-core.ts",
  "src/lib/asset-geometry-error.ts",
  "src/lib/asset-geometry-queue.ts",
  "src/lib/asset-geometry-worker.ts",
  "src/lib/use-asset-geometry.ts",
  "assets/catalog/manifest.json",
  "assets/catalog/licenses/kenney-nature-kit-License.txt",
  "src/lib/protocol.ts",
  "src/lib/fixtures.ts",
  "src/lib/geometry.ts",
  "src/lib/gameplay.ts",
  "src/lib/game-program.ts",
  "src/lib/game-session.ts",
  "src/lib/render-budget.ts",
  "LICENSE",
];
const sources = {};
for (const path of paths) sources[path] = await readFile(path, "utf8");
sources["build-source.mjs"] =
  `import {build} from 'esbuild';await build({entryPoints:['src/lib/generated-geometry-worker.ts'],bundle:true,minify:true,format:'esm',outfile:'generated-geometry-worker.js'});await build({entryPoints:['src/lib/asset-geometry-worker.ts'],bundle:true,minify:true,format:'esm',outfile:'asset-geometry-worker.js'});await build({entryPoints:['src/player/main.tsx'],bundle:true,minify:true,jsx:'automatic',format:'esm',outfile:'runtime.js',define:{'process.env.NODE_ENV':'"production"',ORBSIE_STANDALONE_WORKER:JSON.stringify('./generated-geometry-worker.js'),ORBSIE_STANDALONE_ASSET_WORKER:JSON.stringify('./asset-geometry-worker.js')},alias:{'@':'./src'}});`;
await writeFile("public/player/source.json", JSON.stringify(sources));
