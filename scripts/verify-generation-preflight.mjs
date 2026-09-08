/** Production preflight rejection check. Uses an absent model and synthetic key. */
import { build } from "esbuild";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const origin = process.env.ORBSIE_TEST_URL || "https://orbsie.com";
const temporary = await mkdtemp(join(tmpdir(), "orbsie-preflight-"));
try {
  await build({
    entryPoints: ["src/lib/protocol.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(temporary, "protocol.mjs"),
  });
  const { blankProject } = await import(
    pathToFileURL(join(temporary, "protocol.mjs"))
  );
  const results = [];
  for (const provider of ["openrouter", "gateway"]) {
    const catalogResponse = await fetch(
      `${origin}/api/models?provider=${provider}`,
      { signal: AbortSignal.timeout(20000) },
    );
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json();
    const model = catalog.models.find(
      (model) => model.id === "openai/gpt-6-astra",
    );
    assert.equal(model?.capabilities?.text?.supported, true);
    const absent = "orbsie/unsupported-capability-check";
    assert.ok(!catalog.models.some((model) => model.id === absent));
    const response = await fetch(`${origin}/api/generate`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        model: absent,
        key: "synthetic-not-a-provider-credential",
        prompt: "Preflight validation only",
        project: blankProject(),
      }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(
      body.error,
      "This model does not support the current world-generation connection. Choose a supported model in Advanced.",
    );
    results.push({
      provider,
      catalogStatus: catalogResponse.status,
      astraCapabilities: model.capabilities,
      rejectionStatus: response.status,
      error: body.error,
    });
  }
  const directory = "docs/evidence/generation-preflight-release";
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "preflight.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        origin,
        status: "passed",
        credential: "synthetic",
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Deployed catalog and unsupported-model preflight checks passed.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
