import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * Load the canonical project schema for a hosted acceptance run.
 *
 * The browser harness is an ESM script and cannot import the TypeScript
 * protocol module directly. Bundle it once per run, retain only the schema's
 * safeParse closure in memory, and remove the temporary bundle immediately
 * after importing it.
 */
export async function loadHostedProjectValidator() {
  const temporary = await mkdtemp(
    join(tmpdir(), "orbsie-hosted-project-schema-"),
  );
  const bundle = join(temporary, "protocol.mjs");
  try {
    await build({
      entryPoints: [resolve(repositoryRoot, "src/lib/protocol.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: bundle,
      logLevel: "silent",
    });
    const protocol = await import(pathToFileURL(bundle).href);
    const schema = protocol.projectSchema;
    if (!schema || typeof schema.safeParse !== "function")
      throw new Error("The shared project schema was unavailable.");

    return (project) => {
      try {
        return schema.safeParse(project).success;
      } catch {
        return false;
      }
    };
  } catch {
    throw new Error(
      "The shared hosted project validator could not be initialized; no generation was attempted.",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
