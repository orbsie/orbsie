/** Packaged foreground entry point; no build tools or repository required. */
import { fileURLToPath } from "node:url";
import { runBlenderModelingJob } from "./blender-modeling";
import { startModelingCompanion } from "./modeling-companion";

const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && !["--help", "--check"].includes(args[0]))) {
  console.error("Usage: node companion.mjs [--help|--check]");
  process.exitCode = 2;
} else if (args[0] === "--help") {
  console.log(
    "Orbsie local model builder\nRun ./orbsie-builder [--check] when the bundled launcher is included; otherwise use node companion.mjs [--check] with Node 22.\nModel construction requires Linux x86_64, bubblewrap and the verified Blender runtime in ./runtime.\nORBSIE_ORIGIN selects the app origin (default https://orbsie.com).\n--check constructs and validates a tiny model, then exits without opening a connection.",
  );
} else {
  // A packaged launcher must never silently use an unrelated system Blender.
  if (!process.env.ORBSIE_BLENDER_RUNTIME_DIR?.trim())
    process.env.ORBSIE_BLENDER_RUNTIME_DIR = fileURLToPath(
      new URL("./runtime", import.meta.url),
    );
  const controller = new AbortController();
  let companion: Awaited<ReturnType<typeof startModelingCompanion>> | undefined;
  const stop = () => {
    controller.abort();
    void companion?.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const started = performance.now();
    const result = await runBlenderModelingJob(
      {
        version: 1,
        parts: [{ id: "startup", shape: "box", color: "#ffffff" }],
      },
      { signal: controller.signal },
    );
    controller.signal.throwIfAborted();
    if (args[0] === "--check") {
      console.log(
        JSON.stringify({
          status: "ready",
          startupMs: Math.round(performance.now() - started),
          bytes: result.glb.byteLength,
        }),
      );
    } else {
      const origin = process.env.ORBSIE_ORIGIN ?? "https://orbsie.com";
      companion = await startModelingCompanion({
        build: runBlenderModelingJob,
        origin,
      });
      if (controller.signal.aborted) await companion.close();
      else {
        const connection = encodeURIComponent(
          JSON.stringify({ url: companion.url, token: companion.token }),
        );
        console.log(
          `Open this private local Blender connection link:\n${origin}/#builder=${connection}\nKeep this terminal open. Press Ctrl+C to disconnect.`,
        );
      }
    }
  } catch {
    if (!controller.signal.aborted) {
      console.error(
        "Local builder startup failed. Check the bundled runtime, supported platform and bubblewrap installation.",
      );
      process.exitCode = 1;
    }
    await companion?.close();
  }
}
