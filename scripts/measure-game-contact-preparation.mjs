/** CPU-only contact preparation probe; does not measure browser rendering. */
import { build } from "esbuild";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { cpus, platform, arch } from "node:os";
const temporary = await mkdtemp("/tmp/orbsie-contact-budget-");
try {
  await build({
    entryPoints: ["src/lib/gameplay.ts", "src/lib/protocol.ts"],
    outdir: temporary,
    outbase: "src/lib",
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
  });
  const { stepGameplay } = await import(
    pathToFileURL(join(temporary, "gameplay.mjs"))
  );
  const { entitySchema } = await import(
    pathToFileURL(join(temporary, "protocol.mjs"))
  );
  const results = { all: [], none: [], one: [] };
  for (let iteration = 0; iteration < 7; iteration++)
    for (const mode of ["none", "one", "all"]) {
      const entities = Array.from({ length: 80 }, (_, index) =>
        entitySchema.parse({
          id: `tree-${index}`,
          label: "Tree",
          position: [(index % 10) - 5, 0, Math.floor(index / 10) - 4],
          stage: "ready",
          geometry: { kind: "tree" },
        }),
      );
      const targets =
        mode === "all" ? undefined : new Set(mode === "one" ? ["tree-0"] : []);
      const started = performance.now();
      stepGameplay(
        { position: [0, 0.42, 5], velocityY: 0 },
        { x: 0, z: 0, jump: false },
        entities,
        [],
        0,
        0.016,
        targets,
      );
      results[mode].push(performance.now() - started);
    }
  const median = (values) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const report = {
    scope:
      "Cold CPU contact preparation for 80 procedural decorations; fresh geometry recipes each sample; excludes setup, GPU rendering, provider latency and input responsiveness",
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    samples: 7,
    entityCount: 80,
    medianMs: Object.fromEntries(
      Object.entries(results).map(([mode, values]) => [
        mode,
        Number(median(values).toFixed(3)),
      ]),
    ),
    samplesMs: results,
  };
  await mkdir("docs/evidence/contact-budget", { recursive: true });
  await writeFile(
    "docs/evidence/contact-budget/cpu-preparation.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
