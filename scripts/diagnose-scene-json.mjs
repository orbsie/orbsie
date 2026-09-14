#!/usr/bin/env node
/**
 * One-call, opt-in Gateway scene-stream diagnostic.
 *
 * This command is intentionally inert until --confirm and --output are both
 * present. It reads the mode-0600 key only after those gates pass, tees one
 * expected Gateway completion response, and writes a sanitized report. A raw
 * malformed line or exact SSE capture is written only when an explicit absolute,
 * mode-0600 path outside the repository is supplied. Captures are at most 1 MiB.
 */
import { build } from "esbuild";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  analyzeCapturedSse,
  assertPrivateArtifactPath,
  captureBody,
  diagnosticFromGenerationOutput,
  GATEWAY_COMPLETION_URL,
  MAX_CAPTURE_BYTES,
  reportForRun,
  writePrivateArtifact,
  writePrivateCapture,
} from "./lib/scene-json-diagnostic.mjs";

const MAX_KEY_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 180_000;
const DEFAULT_PROMPT = "a tree with blue strawberries";

function usage() {
  return `Usage:
  ORBSIE_DIAGNOSE_SCENE_JSON=1 node scripts/diagnose-scene-json.mjs \\
    --confirm \\
    --output /absolute/path/report.json \\
    --key-file /absolute/path/gateway.env \\
    [--raw-artifact /absolute/path/offending-line.txt] \\
    [--raw-sse-artifact /absolute/path/provider-response.sse] \\
    [--prompt "a tree with blue strawberries"] \\
    [--timeout-ms 120000]

The command performs one Gateway generation with openai/gpt-5.6-luna,
low reasoning, default service tier and a 4096-token cap. It never retries,
stores request headers/body, or includes provider content in the report.
`;
}

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    confirm: false,
    output: undefined,
    keyFile: undefined,
    rawArtifact: undefined,
    rawSseArtifact: undefined,
    prompt: DEFAULT_PROMPT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      if (argv.length !== 1) fail("--help cannot be combined with arguments.");
      options.help = true;
      continue;
    }
    if (argument === "--confirm") {
      options.confirm = true;
      continue;
    }
    const valueOption =
      argument === "--output" ||
      argument === "--key-file" ||
      argument === "--raw-artifact" ||
      argument === "--raw-sse-artifact" ||
      argument === "--prompt" ||
      argument === "--timeout-ms";
    if (!valueOption) fail(`Unknown argument: ${argument}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value.`);
    if (argument === "--output") options.output = value;
    else if (argument === "--key-file") options.keyFile = value;
    else if (argument === "--raw-artifact") options.rawArtifact = value;
    else if (argument === "--raw-sse-artifact") options.rawSseArtifact = value;
    else if (argument === "--prompt") options.prompt = value;
    else options.timeoutMs = Number(value);
  }
  return options;
}

async function assertNewOutput(outputPath) {
  try {
    await access(outputPath, constants.F_OK);
  } catch {
    return;
  }
  fail(`Output already exists: ${outputPath}`);
}

async function readGatewayKey(keyPath) {
  const metadata = await stat(keyPath);
  if (!metadata.isFile()) fail("The Gateway key path must be a regular file.");
  if ((metadata.mode & 0o077) !== 0)
    fail("The Gateway key file must be mode 0600 or stricter.");
  if (metadata.size > MAX_KEY_BYTES)
    fail("The Gateway key file exceeds the bounded size limit.");
  const source = await readFile(keyPath, "utf8");
  const line = source
    .split(/\r?\n/)
    .find((candidate) => /^\s*AI_GATEWAY_TEST_KEY\s*=/.test(candidate));
  if (!line) fail("The key file does not contain AI_GATEWAY_TEST_KEY.");
  let value = line.slice(line.indexOf("=") + 1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  )
    value = value.slice(1, -1);
  if (!value) fail("AI_GATEWAY_TEST_KEY is empty.");
  return value;
}

async function bundleGeneration(directory) {
  const file = join(directory, "generation.mjs");
  await build({
    stdin: {
      contents:
        'export { generateCommands } from "./src/lib/server/generation"; export { blankProject } from "./src/lib/protocol";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: file,
  });
  return import(pathToFileURL(file).href);
}

function requestUrl(input) {
  return typeof input === "string" ? input : input?.url;
}

function checkTimeout(timeoutMs) {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > MAX_TIMEOUT_MS
  )
    fail(`--timeout-ms must be an integer from 1000 to ${MAX_TIMEOUT_MS}.`);
}

async function run(options) {
  if (process.env.ORBSIE_DIAGNOSE_SCENE_JSON !== "1")
    fail("Set ORBSIE_DIAGNOSE_SCENE_JSON=1 for this explicit diagnostic.");
  if (!options.confirm)
    fail("Pass --confirm to authorize one diagnostic call.");
  if (!options.output) fail("An explicit --output path is required.");
  if (!options.keyFile) fail("An explicit --key-file path is required.");
  if (!options.prompt.trim()) fail("The diagnostic prompt must not be empty.");
  checkTimeout(options.timeoutMs);

  const outputPath = resolve(options.output);
  await assertNewOutput(outputPath);
  if (options.rawArtifact) {
    assertPrivateArtifactPath(options.rawArtifact);
    await assertNewOutput(resolve(options.rawArtifact));
  }
  if (options.rawSseArtifact) {
    assertPrivateArtifactPath(options.rawSseArtifact);
    await assertNewOutput(resolve(options.rawSseArtifact));
  }

  // Keep this read after every opt-in and output-path gate above.
  const key = await readGatewayKey(resolve(options.keyFile));
  const temporary = await mkdtemp(join(tmpdir(), "orbsie-scene-diagnostic-"));
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  let httpStatus;
  let capturePromise;
  let generationOutput = "";
  let runStatus = "failed";
  try {
    const { generateCommands, blankProject } =
      await bundleGeneration(temporary);
    globalThis.fetch = async (input, init) => {
      requestCount += 1;
      if (requestCount > 1)
        fail("The diagnostic attempted more than one provider request.");
      if (requestUrl(input) !== GATEWAY_COMPLETION_URL)
        fail("The diagnostic attempted an unexpected network URL.");
      // Deliberately do not inspect or retain init: it contains credentials and
      // the full request body. The original fetch sees it unchanged.
      const response = await originalFetch(input, init);
      httpStatus = response.status;
      if (!response.body) return response;
      const [parserBody, captureBodyBranch] = response.body.tee();
      capturePromise = captureBody(
        captureBodyBranch,
        MAX_CAPTURE_BYTES,
        options.timeoutMs,
      );
      return new Response(parserBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };

    const signal = AbortSignal.timeout(options.timeoutMs);
    const stream = await generateCommands({
      provider: "gateway",
      model: "openai/gpt-5.6-luna",
      key,
      prompt: options.prompt,
      project: blankProject(),
      browserModeling: true,
      maxTokens: 4096,
      signal,
    });
    generationOutput = await new Response(stream).text();
    if (capturePromise) await capturePromise;
    runStatus = diagnosticFromGenerationOutput(generationOutput)
      ? "generation_failed"
      : "passed";
  } catch (error) {
    if (capturePromise) await capturePromise.catch(() => {});
    generationOutput = "";
    runStatus = httpStatus >= 400 ? "provider_rejected" : "runner_failed";
    if (requestCount > 1) throw error;
  } finally {
    globalThis.fetch = originalFetch;
    await rm(temporary, { recursive: true, force: true });
  }

  const capture = capturePromise
    ? await capturePromise
    : {
        bytes: new Uint8Array(),
        capturedBytes: 0,
        overflow: false,
        complete: false,
        readError: false,
        timedOut: false,
      };
  const upstream = analyzeCapturedSse(capture.bytes);
  if (options.rawSseArtifact)
    await writePrivateCapture(options.rawSseArtifact, capture.bytes);
  const generation = diagnosticFromGenerationOutput(generationOutput);
  const report = reportForRun({
    status: runStatus,
    httpStatus,
    requestCount,
    capture,
    upstream,
    generation,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o644,
  });
  if (options.rawArtifact && upstream.firstInvalid?.offendingLine)
    await writePrivateArtifact(
      options.rawArtifact,
      upstream.firstInvalid.offendingLine,
    );
  console.log(`Sanitized scene diagnostic written to ${outputPath}`);
  if (options.rawArtifact && upstream.firstInvalid?.offendingLine)
    console.log(
      "Private malformed-line artifact written at the requested path.",
    );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  await run(options);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Diagnostic failed.",
    );
    process.exitCode = 1;
  }
}

export { parseArgs, readGatewayKey, run };
