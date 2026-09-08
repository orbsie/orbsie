/** Foreground local builder. No inference or hosted credentials are needed. */
import { build } from "esbuild";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const directory = await mkdtemp(join(tmpdir(), "orbsie-builder-bundle-"));
const controller = new AbortController();
let companion, stopping, startup;
async function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    controller.abort();
    await startup?.catch(() => undefined);
    await companion?.close();
    await rm(directory, { recursive: true, force: true });
  })();
  return stopping;
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => void stop().then(() => process.exit(0)));
try {
  await build({
    entryPoints: ["modeling-companion.ts", "blender-modeling.ts"].map((name) =>
      fileURLToPath(new URL(name, import.meta.url)),
    ),
    outdir: directory,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
  });
  await copyFile(
    new URL("blender-modeling.py", import.meta.url),
    join(directory, "blender-modeling.py"),
  );
  const { runBlenderModelingJob } = await import(
    pathToFileURL(join(directory, "blender-modeling.mjs")).href
  );
  const { startModelingCompanion } = await import(
    pathToFileURL(join(directory, "modeling-companion.mjs")).href
  );
  // Validate the actual local installation before advertising a usable capability.
  startup = runBlenderModelingJob(
    { version: 1, parts: [{ id: "startup", shape: "box", color: "#ffffff" }] },
    { signal: controller.signal },
  );
  await startup;
  controller.signal.throwIfAborted();
  companion = await startModelingCompanion({
    build: runBlenderModelingJob,
    origin: process.env.ORBSIE_ORIGIN ?? "https://orbsie.com",
  });
  const connection = encodeURIComponent(
    JSON.stringify({ url: companion.url, token: companion.token }),
  );
  console.log(
    `Open this private local Blender connection link:\n${process.env.ORBSIE_ORIGIN ?? "https://orbsie.com"}/#builder=${connection}\nKeep this terminal open. Press Ctrl+C to disconnect.`,
  );
} catch {
  console.error(
    "The local Blender companion could not start. Check the documented Linux Blender, NumPy and bubblewrap runtime requirements.",
  );
  await stop();
  process.exitCode = 1;
}
