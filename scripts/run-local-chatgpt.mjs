import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const directory = await mkdtemp(join(tmpdir(), "orbsie-harness-"));
try {
  const outfile = join(directory, "harness.mjs");
  await build({
    entryPoints: ["scripts/test-local-chatgpt.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(directory, { recursive: true, force: true });
}
