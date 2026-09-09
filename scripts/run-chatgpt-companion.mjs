/** Explicitly launched foreground local companion; startup performs no inference. */
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LocalChatGPT } from "./local-chatgpt.mjs";
const bundleDir = await mkdtemp(join(tmpdir(), "orbsie-companion-bundle-"));
const workingDir = await mkdtemp(join(tmpdir(), "orbsie-companion-empty-"));
let client, companion, stopping;
async function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    if (companion) await companion.close();
    else client?.close();
    await Promise.all([
      rm(bundleDir, { recursive: true, force: true }),
      rm(workingDir, { recursive: true, force: true }),
    ]);
  })();
  return stopping;
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void stop().then(() => process.exit(0));
  });
try {
  const outfile = join(bundleDir, "companion.mjs");
  await build({
    entryPoints: [new URL("./chatgpt-companion.ts", import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
  });
  const { startChatGPTCompanion, companionOrigin } = await import(
    pathToFileURL(outfile).href
  );
  const origin = companionOrigin(process.env.ORBSIE_ORIGIN);
  client = new LocalChatGPT(workingDir);
  client.process.once("exit", () => {
    if (stopping) return;
    console.error(
      "Local ChatGPT disconnected. This companion connection has been revoked.",
    );
    void stop().then(() => process.exit(1));
  });
  const model = await client.connect(process.env.ORBSIE_CHATGPT_MODEL);
  companion = await startChatGPTCompanion({ client, model, origin });
  const connection = encodeURIComponent(
    JSON.stringify({ url: companion.url, token: companion.token }),
  );
  console.log(
    `Open this private connection link in your browser:\n${origin}/#chatgpt=${connection}\nKeep this terminal open. Press Ctrl+C to disconnect and revoke this connection.`,
  );
} catch {
  console.error(
    "Unable to start the local ChatGPT companion. Check that Codex is installed, run codex login locally, and confirm Astra with low reasoning is available.",
  );
  await stop();
  process.exitCode = 1;
}
