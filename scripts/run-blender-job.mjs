#!/usr/bin/env node
/**
 * Offline agent-facing Blender job runner.
 *
 * This CLI deliberately bundles the existing trusted TypeScript executor into
 * a disposable directory. It accepts only the typed data-only modeling job
 * schema and never accepts Python, paths, URLs or model text as job input.
 */
import { build } from "esbuild";
import {
  access,
  open,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const INPUT_BYTES = 512 * 1024;
const TRUSTED_PYTHON = fileURLToPath(
  new URL("./blender-modeling.py", import.meta.url),
);

function usage() {
  return `Usage: node scripts/run-blender-job.mjs JOB.json NEW_OUTPUT_DIRECTORY

Runs one bounded typed modeling job through the existing isolated Blender
executor and writes model.glb plus metadata.json into a new directory.

The input is limited to 512 KiB. The output directory must not exist.
No network, inference, Python input, or repository checkout is used by the
job itself. Blender and its configured runtime are resolved by the existing
scripts/blender-runtime.ts resolver.
`;
}

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    if (argv.length !== 1)
      fail("--help cannot be combined with job arguments.");
    return { help: true };
  }
  if (argv.length !== 2)
    fail("Provide exactly an input JSON file and a new output directory.");
  return {
    help: false,
    inputPath: resolve(argv[0]),
    outputPath: resolve(argv[1]),
  };
}

async function readBoundedInput(inputPath) {
  let handle;
  try {
    handle = await open(inputPath, "r");
  } catch {
    fail(`Input JSON file was not found: ${inputPath}`);
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) fail("Input JSON path must be a regular file.");
    const bytes = Buffer.allocUnsafe(INPUT_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const result = await handle.read(
        bytes,
        bytesRead,
        bytes.length - bytesRead,
        bytesRead,
      );
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    if (bytesRead > INPUT_BYTES || (await handle.stat()).size > INPUT_BYTES)
      fail(`Input JSON exceeds the ${INPUT_BYTES}-byte (512 KiB) limit.`);
    try {
      return JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
    } catch (error) {
      fail(
        `Input JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    await handle.close();
  }
}

async function assertNewOutput(outputPath) {
  try {
    await access(outputPath, constants.F_OK);
  } catch {
    return;
  }
  fail(`Output directory already exists: ${outputPath}`);
}

async function bundleExecutor(directory) {
  await build({
    entryPoints: [
      fileURLToPath(new URL("./blender-modeling.ts", import.meta.url)),
    ],
    outfile: join(directory, "blender-modeling.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
  });
  await copyFile(TRUSTED_PYTHON, join(directory, "blender-modeling.py"));
  return import(pathToFileURL(join(directory, "blender-modeling.mjs")).href);
}

function metadataFor(result) {
  return {
    schema: "orbsie.blender-modeling-result/v1",
    version: 1,
    sha256: result.sha256,
    bounds: result.bounds,
    materials: result.materialStats,
    objects: result.objects,
    blenderVersion: result.blenderVersion,
  };
}

function printProgress(progress) {
  const fraction = Number.isFinite(progress.progress)
    ? Math.round(progress.progress * 100)
    : 0;
  process.stderr.write(
    `[blender-job] ${progress.stage} ${fraction}% ${progress.message}\n`,
  );
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const value = await readBoundedInput(args.inputPath);
  await assertNewOutput(args.outputPath);
  await mkdir(args.outputPath);
  let ownsOutput = true;
  let bundleDirectory;
  const controller = new AbortController();
  let stopping = false;
  const onSignal = () => {
    if (stopping) return;
    stopping = true;
    controller.abort();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    bundleDirectory = await mkdtemp(join(tmpdir(), "orbsie-agent-blender-"));
    const { runBlenderModelingJob } = await bundleExecutor(bundleDirectory);
    const result = await runBlenderModelingJob(value, {
      signal: controller.signal,
      onProgress: printProgress,
    });
    controller.signal.throwIfAborted();
    await writeFile(join(args.outputPath, "model.glb"), result.glb, {
      mode: 0o644,
    });
    await writeFile(
      join(args.outputPath, "metadata.json"),
      `${JSON.stringify(metadataFor(result), null, 2)}\n`,
      { mode: 0o644 },
    );
    controller.signal.throwIfAborted();
    ownsOutput = false;
    process.stdout.write(
      `${JSON.stringify({
        outputDirectory: args.outputPath,
        model: "model.glb",
        metadata: "metadata.json",
        sha256: result.sha256,
        bytes: result.glb.byteLength,
        blenderVersion: result.blenderVersion,
      })}\n`,
    );
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    if (bundleDirectory)
      await rm(bundleDirectory, { recursive: true, force: true });
    if (ownsOutput) await rm(args.outputPath, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[blender-job] ${message}\n`);
    process.exitCode = 1;
  }
}
