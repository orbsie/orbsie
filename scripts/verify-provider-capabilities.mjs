/** Public catalog verification only; no credentials or inference requests. */
import { build } from "esbuild";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const temporary = await mkdtemp(join(tmpdir(), "orbsie-capabilities-"));
const evidence = "docs/evidence/provider-capabilities";
try {
  await build({
    entryPoints: ["src/lib/model-catalog.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(temporary, "catalog.mjs"),
  });
  const { catalogModels } = await import(
    pathToFileURL(join(temporary, "catalog.mjs"))
  );
  const report = {
    checkedAt: new Date().toISOString(),
    inferenceRequests: 0,
    providers: [],
  };
  for (const [provider, url] of [
    ["openrouter", "https://openrouter.ai/api/v1/models"],
    ["gateway", "https://ai-gateway.vercel.sh/v1/models"],
  ]) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200);
    const body = await response.json();
    const models = catalogModels(body.data, provider);
    const astra = models.find((model) => model.id === "openai/gpt-6-astra");
    assert.ok(astra, "Required exact Astra ID missing");
    assert.equal(astra.capabilities.text.supported, true);
    assert.equal(astra.capabilities.tools.supported, true);
    assert.ok(models.every((model) => !model.id.endsWith(":batch")));
    report.providers.push({
      provider,
      url,
      rawCount: body.data.length,
      compatibleCount: models.length,
      astra: { id: astra.id, capabilities: astra.capabilities },
    });
  }
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "report.json"),
    JSON.stringify({ ...report, status: "passed" }, null, 2) + "\n",
  );
  console.log(
    "Public provider capability checks passed; zero inference requests.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
