// Read-only integration of the production RPC adapter and login lifecycle.
// Never starts login or model inference.
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "orbsie-runtime-probe-"));
let rpc;
let session;
try {
  const outfile = join(directory, "runtime.mjs");
  await build({
    stdin: {
      contents:
        'export { createIsolatedChatGPTRpc } from "./src/lib/server/chatgpt-runtime"; export { ChatGPTDeviceSession } from "./src/lib/server/chatgpt-device-session";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
  });
  const { createIsolatedChatGPTRpc, ChatGPTDeviceSession } = await import(
    pathToFileURL(outfile).href
  );
  rpc = await createIsolatedChatGPTRpc();
  const account = await rpc.request("account/read", { refreshToken: false });
  if (account?.account !== null)
    throw Error("Fresh runtime did not explicitly report an absent account.");
  session = new ChatGPTDeviceSession({
    ownerId: "isolation-probe",
    sessionId: "fresh-session",
    rpc,
  });
  const result = await session.readAuthStatus();
  if (result.status !== "disconnected")
    throw Error("Fresh runtime unexpectedly has an account; isolation failed.");
  console.log(
    JSON.stringify(
      {
        isolatedRuntimeStarted: true,
        accountAbsent: true,
        productionAdapterAndLifecycle: true,
        inheritedDeveloperEnvironment: false,
        loginStarted: false,
        inferencePerformed: false,
        hostedDeploymentVerified: false,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await session?.close();
  } finally {
    try {
      await rpc?.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
