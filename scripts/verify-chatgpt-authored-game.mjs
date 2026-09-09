#!/usr/bin/env node

/**
 * Opt-in real-provider wrapper for the input-game browser scenario.
 *
 * The wrapper owns the authenticated local companion and gives its capability
 * only to the child provider harness. It never prints the capability or the
 * child process output; the child writes the provider harness's sanitized
 * report and screenshots under the configured evidence directory.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  stat,
} from "node:fs/promises";
import { request } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { LocalChatGPT } from "./local-chatgpt.mjs";

const BASE_ORIGIN = process.env.ORBSIE_TEST_URL ?? "http://127.0.0.1:3024";
assert(
  [
    "http://127.0.0.1:3017",
    "http://127.0.0.1:3024",
    "http://127.0.0.1:3031",
  ].includes(BASE_ORIGIN),
  "Only the known local test origins are allowed.",
);
const VERIFY_CLOUD = process.env.ORBSIE_VERIFY_CLOUD_RECOVERY === "1";
const VERIFY_INTERRUPTED =
  process.env.ORBSIE_VERIFY_INTERRUPTED_RECOVERY === "1";
if (VERIFY_INTERRUPTED)
  assert(
    VERIFY_CLOUD,
    "Interrupted recovery requires authenticated cloud recovery.",
  );
const GENERATION_BUDGET = VERIFY_INTERRUPTED ? 3 : 2;
const INTERRUPTION_METHOD = process.env.ORBSIE_INTERRUPTION_METHOD ?? "stop";
assert(
  ["stop", "reload"].includes(INTERRUPTION_METHOD),
  "Interruption method must be stop or reload.",
);
if (INTERRUPTION_METHOD === "reload")
  assert(
    VERIFY_INTERRUPTED,
    "Reload interruption requires the interrupted recovery scenario.",
  );
if (VERIFY_CLOUD)
  assert.equal(
    BASE_ORIGIN,
    "http://127.0.0.1:3017",
    "Cloud verification uses the existing development account origin.",
  );
const EVIDENCE_DIR =
  process.env.ORBSIE_EVIDENCE_DIR ??
  "docs/evidence/provider-e2e/chatgpt-authored-input-game";

if (process.env.ORBSIE_LIVE_E2E !== "1")
  throw Error(
    "Refusing real ChatGPT-authored input-game E2E: set ORBSIE_LIVE_E2E=1 explicitly.",
  );

let temporaryDirectory;
let client;
let companion;
let child;
let stopping = false;
let actualGenerateCalls = 0;
let selectedModel;
let harnessResult;
let wrapperFailure;
let companionTokenForRedaction;

function safeError(error) {
  let message = String(error instanceof Error ? error.message : error);
  if (companionTokenForRedaction)
    message = message.split(companionTokenForRedaction).join("[redacted]");
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500);
}

async function writeWrapperReport() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(
    join(EVIDENCE_DIR, "wrapper.json"),
    `${JSON.stringify(
      {
        status:
          !wrapperFailure && harnessResult?.code === 0 ? "passed" : "failed",
        model: selectedModel ?? "gpt-5.6-luna",
        effort: "low",
        serviceTier: "default",
        actualGenerateCalls,
        cloudRecoveryRequested: VERIFY_CLOUD,
        interruptedRecoveryRequested: VERIFY_INTERRUPTED,
        interruptionMethod: VERIFY_INTERRUPTED
          ? INTERRUPTION_METHOD
          : undefined,
        childExitCode: harnessResult?.code ?? null,
        childSignal: harnessResult?.signal ?? null,
        error: wrapperFailure ? safeError(wrapperFailure) : undefined,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}

function runHarness(environment) {
  return new Promise((resolveRun, rejectRun) => {
    const processHandle = spawn(
      process.execPath,
      ["scripts/provider-browser-e2e.mjs", "--provider", "chatgpt-local"],
      {
        cwd: process.cwd(),
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child = processHandle;
    // Do not forward provider or companion process output. The harness only
    // writes sanitized evidence, and failures are reported without logs.
    processHandle.stdout.resume();
    processHandle.stderr.resume();
    processHandle.once("error", rejectRun);
    processHandle.once("close", (code, signal) => resolveRun({ code, signal }));
  });
}

async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    try {
      if (child && child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
        await new Promise((resolve) => child.once("close", resolve));
      }
    } finally {
      child = undefined;
      if (companion) await companion.close();
      else client?.close();
    }
  } finally {
    companion = undefined;
    client = undefined;
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void stop().finally(() => process.exit(128));
  });
}

try {
  temporaryDirectory = await mkdtemp(
    join(tmpdir(), "orbsie-chatgpt-authored-input-game-"),
  );
  const bundleDirectory = join(temporaryDirectory, "companion");
  const workDirectory = join(temporaryDirectory, "empty-work");
  await mkdir(bundleDirectory);
  await mkdir(workDirectory);

  const companionBundle = join(bundleDirectory, "companion.mjs");
  await build({
    entryPoints: ["scripts/chatgpt-companion.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: companionBundle,
  });
  const { startChatGPTCompanion } = await import(
    pathToFileURL(companionBundle).href
  );

  client = new LocalChatGPT(workDirectory);
  const model = await client.connect("gpt-5.6-luna");
  selectedModel = model;
  assert.equal(
    model,
    "gpt-5.6-luna",
    "Luna with low reasoning is required for live tests.",
  );
  companion = await startChatGPTCompanion({
    client: {
      generate: (...args) => {
        if (actualGenerateCalls >= GENERATION_BUDGET)
          throw Error("The bounded live test generation budget is exhausted.");
        actualGenerateCalls += 1;
        return client.generate(...args);
      },
      close: () => client.close(),
    },
    model,
    origin: BASE_ORIGIN,
  });
  companionTokenForRedaction = companion.token;

  const childEnvironment = { ...process.env };
  Object.assign(childEnvironment, {
    ORBSIE_LIVE_E2E: "1",
    ORBSIE_TEST_URL: BASE_ORIGIN,
    ORBSIE_EXPECTED_MODEL: "gpt-5.6-luna",
    ORBSIE_KEY_SCOPE: "local-only",
    ORBSIE_REQUIRE_NEW_ONLY: "1",
    ORBSIE_REQUIRE_INPUT_GAME: "1",
    ORBSIE_SERVICE_TIER: "default",
    ORBSIE_EVIDENCE_DIR: EVIDENCE_DIR,
    ORBSIE_CHATGPT_COMPANION_URL: companion.url,
    ORBSIE_CHATGPT_COMPANION_TOKEN: companion.token,
  });
  // ChatGPT-local deliberately has no output-cap environment setting. Remove
  // inherited live-provider and local-builder capabilities as well.
  for (const name of [
    "ORBSIE_OUTPUT_CAP_TOKENS",
    "ORBSIE_CREATION_PROMPT",
    "ORBSIE_EDIT_PROMPT",
    "ORBSIE_REAL_PUBLICATION",
    "ORBSIE_CLOUD_TEST_STATE",
    "ORBSIE_BUILDER_URL",
    "ORBSIE_BUILDER_TOKEN",
    "OPENROUTER_API_KEY",
    "AI_GATEWAY_API_KEY",
  ])
    delete childEnvironment[name];

  if (VERIFY_CLOUD) {
    const fixturePath = ".vercel/dev-generated-cloud-state.json";
    assert.equal(
      (await stat(fixturePath)).mode & 0o777,
      0o600,
      "Development account fixture must be private.",
    );
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    assert.equal(
      fixture.baseURL,
      BASE_ORIGIN,
      "Development account origin mismatch.",
    );
    const auth = await request.newContext({
      baseURL: BASE_ORIGIN,
      extraHTTPHeaders: { Origin: BASE_ORIGIN },
      timeout: 30000,
    });
    try {
      const response = await auth.post("/api/auth/sign-in/email", {
        data: fixture.credentials,
        maxRedirects: 0,
      });
      assert.equal(
        response.status(),
        200,
        "Existing development account authentication failed; no retry.",
      );
      const privateState = join(temporaryDirectory, "cloud-state.json");
      await writeFile(
        privateState,
        JSON.stringify({ storageState: await auth.storageState() }),
        { mode: 0o600 },
      );
      childEnvironment.ORBSIE_CLOUD_TEST_STATE = privateState;
      childEnvironment.ORBSIE_VERIFY_CLOUD_RECOVERY = "1";
    } finally {
      await auth.dispose();
    }
  } else {
    delete childEnvironment.ORBSIE_VERIFY_CLOUD_RECOVERY;
  }

  const result = await runHarness(childEnvironment);
  harnessResult = result;
  child = undefined;
  assert.equal(
    result.code,
    0,
    "The provider browser harness did not complete successfully; inspect its sanitized evidence report.",
  );
  assert.equal(
    actualGenerateCalls,
    GENERATION_BUDGET,
    `Expected exactly ${GENERATION_BUDGET} actual ChatGPT generations, observed ${actualGenerateCalls}.`,
  );
  console.log(
    `ChatGPT-authored input-game E2E passed; sanitized evidence: ${EVIDENCE_DIR}`,
  );
} catch (error) {
  wrapperFailure = error;
  process.exitCode = 1;
  console.error(safeError(error));
} finally {
  try {
    await stop();
  } catch (error) {
    wrapperFailure ??= error;
    process.exitCode = 1;
  } finally {
    await writeWrapperReport();
  }
}
