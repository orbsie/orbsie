import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outdir = process.argv[2];
if (!outdir)
  throw Error("Provide an output directory outside the source tree.");
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: ["scripts/run-chatgpt-host.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: resolve(outdir, "server.mjs"),
});
await writeFile(
  resolve(outdir, "package.json"),
  JSON.stringify(
    {
      name: "orbsie-private-chatgpt-host",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: { start: "node server.mjs" },
      dependencies: { "@openai/codex": "0.153.4" },
    },
    null,
    2,
  ) + "\n",
);
