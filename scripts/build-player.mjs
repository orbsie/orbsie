import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
await mkdir("public/player", { recursive: true });
await build({
  entryPoints: ["src/player/main.tsx"],
  bundle: true,
  minify: true,
  jsx: "automatic",
  format: "esm",
  outfile: "public/player/runtime.js",
  define: { "process.env.NODE_ENV": '"production"' },
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
  "src/lib/generated-glb.ts",
  "src/lib/generated-geometry.ts",
  "src/lib/use-generated-geometry.ts",
  "src/lib/asset-catalog.ts",
  "src/lib/asset-policy.ts",
  "src/lib/asset-geometry.ts",
  "src/lib/use-asset-geometry.ts",
  "assets/catalog/manifest.json",
  "assets/catalog/licenses/kenney-nature-kit-License.txt",
  "src/lib/protocol.ts",
  "src/lib/fixtures.ts",
  "src/lib/geometry.ts",
  "src/lib/gameplay.ts",
  "src/lib/render-budget.ts",
  "LICENSE",
];
const sources = {};
for (const path of paths) sources[path] = await readFile(path, "utf8");
sources["build-source.mjs"] =
  `import {build} from 'esbuild';await build({entryPoints:['src/player/main.tsx'],bundle:true,minify:true,jsx:'automatic',format:'esm',outfile:'runtime.js',define:{'process.env.NODE_ENV':'"production"'},alias:{'@':'./src'}});`;
await writeFile("public/player/source.json", JSON.stringify(sources));
