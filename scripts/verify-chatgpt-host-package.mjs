import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Run after a production build: deployment tracing must carry both files that
// provisioning uploads to the isolated host, not merely compile the route.
for (const route of ["[action]", "generate"]) {
  const tracePath = resolve(
    `.next/server/app/api/chatgpt/${route}/route.js.nft.json`,
  );
  const trace = JSON.parse(await readFile(tracePath, "utf8"));
  assert(Array.isArray(trace.files), "Route trace must list deployment files");
  const included = new Set(
    trace.files.map((file) => resolve(dirname(tracePath), file)),
  );
  for (const file of ["server.mjs", "package.json"]) {
    const path = resolve(".orbsie/chatgpt-host", file);
    assert(included.has(path), `ChatGPT route deployment is missing ${file}`);
    assert((await stat(path)).size > 0, `${file} must not be empty`);
  }
  for (const file of included) {
    const relative = file.slice(resolve(".").length + 1);
    assert(
      !/^\.env(?:[./]|$)/.test(relative),
      "Deployment must not trace environment files",
    );
    assert(
      !relative.startsWith(".vercel/"),
      "Deployment must not trace local Vercel state",
    );
    assert(
      !relative.startsWith("docs/"),
      "Deployment must not trace project evidence",
    );
  }
}
const manifest = JSON.parse(
  await readFile(".orbsie/chatgpt-host/package.json", "utf8"),
);
assert.equal(manifest.dependencies["@openai/codex"], "0.153.4");
assert.equal(manifest.scripts.start, "node server.mjs");
console.log(
  JSON.stringify({
    passed: true,
    routeTraceIncludesHostBundle: true,
    pinnedRuntime: true,
  }),
);
