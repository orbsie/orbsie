/** Build the companion application, optionally with its pinned Node launcher. */
import { build } from "esbuild";
import { mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packageNodeRuntime } from "./node-runtime-package.mjs";

const args = process.argv.slice(2);
if (
  !args[0]?.trim() ||
  (args.length === 3 && !args[2]?.trim()) ||
  (args.length !== 1 && (args.length !== 3 || args[1] !== "--node-root"))
)
  throw Error(
    "Usage: node scripts/package-modeling-companion.mjs OUTPUT_DIRECTORY [--node-root NODE_DISTRIBUTION_DIRECTORY]",
  );
const output = resolve(args[0]);
const nodeRoot = args.length === 3 ? resolve(args[2]) : undefined;
if (nodeRoot && (output === nodeRoot || output.startsWith(nodeRoot + "/")))
  throw Error(
    "Companion output must not be inside its Node input distribution.",
  );
// Refuse existing destinations so packaging cannot overwrite an installation.
await mkdir(output);
try {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const node = nodeRoot
    ? await packageNodeRuntime(nodeRoot, join(output, "node"))
    : undefined;
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
  await copyFile(
    join(root, "LICENSE"),
    join(output, "licenses/Orbsie-LICENSE"),
  );
  await copyFile(
    join(root, "node_modules/zod/LICENSE"),
    join(output, "licenses/Zod-LICENSE"),
  );
  if (node) {
    // Use only shell builtins to locate the adjacent runtime, including when
    // PATH contains no Node (or no commands at all). Paths may contain spaces.
    await writeFile(
      join(output, "orbsie-builder"),
      `#!/bin/sh
set -eu
case "$0" in
  /*) launcher="$0" ;;
  *) launcher="$PWD/$0" ;;
esac
CDPATH= cd -P -- "\${launcher%/*}"
unset NODE_OPTIONS NODE_PATH
exec "$PWD/node/bin/node" "$PWD/companion.mjs" "$@"
`,
      { mode: 0o755 },
    );
  }
  await writeFile(
    join(output, "README.txt"),
    "Orbsie companion application component\n\n" +
      (node
        ? "Run: ./orbsie-builder --help\nNode is included; no Node/npm/Python installation or repository checkout is needed to launch the application. Run the launcher directly from this directory, not through a symlink.\n"
        : "Run: node companion.mjs --help\nRequires Node 22. No npm install or repository is needed at runtime.\n") +
      "Model construction still requires Linux x86_64, bubblewrap and the verified Blender runtime at ./runtime (or an explicit ORBSIE_BLENDER_RUNTIME_DIR).\nRun --check before connecting. This output does not include Blender.\nThis component is not yet a portable installer or a complete Blender distribution. Native dependency closure, clean-host installation and source/license release gates remain open.\n" +
      (node
        ? "The bundled Node binary is pinned to the inspected local installation, with its complete license file preserved at node/LICENSE. Independent official-archive provenance verification remains a release gate.\n"
        : ""),
  );
  const manifest = {
    schema: "orbsie.modeling-companion-package/v1",
    status: node ? "application-and-node-bundled" : "application-bundled",
    runtimeIncluded: false,
    nodeIncluded: !!node,
    ...(node ? { node } : {}),
  };
  await writeFile(
    join(output, "package.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(JSON.stringify({ output, ...manifest }));
} catch (error) {
  // Only this invocation's newly-created directory can reach this cleanup.
  await rm(output, { recursive: true, force: true });
  throw error;
}
