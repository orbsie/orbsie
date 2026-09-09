// Creates a signed-out ephemeral thread to validate installed request/config
// compatibility. Never sends turn/start, starts login, or performs inference.
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const dir = await mkdtemp(join(tmpdir(), "orbsie-generation-contract-"));
let rpc;
try {
  const file = join(dir, "probe.mjs");
  await build({
    stdin: {
      contents:
        'export {createIsolatedChatGPTRpc} from "./src/lib/server/chatgpt-runtime"; export {CHATGPT_GENERATION_CONFIG} from "./src/lib/server/chatgpt-generation-policy";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: file,
  });
  const { createIsolatedChatGPTRpc, CHATGPT_GENERATION_CONFIG } = await import(
    pathToFileURL(file).href
  );
  rpc = await createIsolatedChatGPTRpc({ allowGeneration: true });
  const account = await rpc.request("account/read", { refreshToken: false });
  assert.equal(account.account, null);
  const result = await rpc.request("thread/start", {
    model: "gpt-5.6-luna",
    serviceTier: "default",
    ephemeral: true,
    approvalPolicy: "never",
    sandbox: "read-only",
    baseInstructions: "Return only scene commands. Do not use tools.",
    config: CHATGPT_GENERATION_CONFIG,
  });
  assert.equal(typeof result.thread?.id, "string");
  await assert.rejects(rpc.request("command/exec", { command: "id" }));
  console.log(
    JSON.stringify({
      passed: true,
      realIsolatedRuntime: true,
      signedOut: true,
      ephemeralThreadCreated: true,
      executionRequestRejected: true,
      turnStarted: false,
      inferencePerformed: false,
    }),
  );
} finally {
  await rpc?.close();
  await rm(dir, { recursive: true, force: true });
}
