import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "orbsie-host-http-"));
let host;
try {
  const outfile = join(directory, "server.mjs");
  await build({
    stdin: {
      contents:
        'export {startChatGPTHostServer} from "./scripts/chatgpt-host-server"; export {blankProject} from "./src/lib/protocol";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
  });
  const { startChatGPTHostServer, blankProject } = await import(
    pathToFileURL(outfile).href
  );
  const token = randomBytes(32).toString("hex");
  host = await startChatGPTHostServer({ token, allowGeneration: true });
  const base = `http://127.0.0.1:${host.port}`;
  const authorization = `Bearer ${token}`;
  const statusCodes = {};
  for (const [name, path, options, expected] of [
    [
      "signedOutGenerationRejected",
      "/generate",
      {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          effort: "low",
          prompt: "Create an orb",
          project: blankProject(),
        }),
      },
      200,
    ],
    ["unauthenticated", "/login/status", {}, 401],
    [
      "browserOriginRejected",
      "/login/status",
      { headers: { authorization, origin: "https://orbsie.com" } },
      403,
    ],
    ["signedOutModelsRejected", "/models", { headers: { authorization } }, 502],
    ["signedOutStatus", "/login/status", { headers: { authorization } }, 200],
  ]) {
    const response = await fetch(base + path, {
      ...options,
      signal: AbortSignal.timeout(20_000),
    });
    assert.equal(response.status, expected, name);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    if (name === "signedOutStatus") {
      const status = await response.json();
      assert.equal(status.authStatus, "disconnected");
      assert.equal(status.lifecycle, "idle");
    } else if (name === "signedOutGenerationRejected") {
      const body = await response.text();
      assert.match(body, /"error":/);
      assert.doesNotMatch(body, /"commit_revision"/);
    } else await response.arrayBuffer();
    statusCodes[name] = response.status;
  }
  console.log(
    JSON.stringify(
      {
        statusCodes,
        realIsolatedAppServer: true,
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
    await host?.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
