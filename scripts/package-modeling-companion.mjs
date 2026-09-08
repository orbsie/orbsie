/** Build the application component; runtime/Node distribution is a separate gate. */
import { build } from "esbuild";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.length !== 3)
  throw Error(
    "Usage: node scripts/package-modeling-companion.mjs OUTPUT_DIRECTORY",
  );
const output = resolve(process.argv[2]);
// Refuse existing destinations so packaging cannot overwrite an installation.
await mkdir(output);
const root = fileURLToPath(new URL("../", import.meta.url));
await build({
  entryPoints: [join(root, "scripts/modeling-companion-entry.ts")],
  outfile: join(output, "companion.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
});
await copyFile(
  join(root, "scripts/blender-modeling.py"),
  join(output, "blender-modeling.py"),
);
await mkdir(join(output, "licenses"));
await copyFile(join(root, "LICENSE"), join(output, "licenses/Orbsie-LICENSE"));
await copyFile(
  join(root, "node_modules/zod/LICENSE"),
  join(output, "licenses/Zod-LICENSE"),
);
await writeFile(
  join(output, "README.txt"),
  "Orbsie companion application component\n\nRun: node companion.mjs --help\nRequires Node 22, Linux x86_64 and bubblewrap. Place the verified Blender runtime at ./runtime, or explicitly set ORBSIE_BLENDER_RUNTIME_DIR.\nRun --check before connecting. No npm install or repository is needed at runtime.\nThis component is not yet a portable installer or a complete Blender/Node distribution.\n",
);
console.log(
  JSON.stringify({
    output,
    status: "application-bundled",
    runtimeIncluded: false,
    nodeIncluded: false,
  }),
);
