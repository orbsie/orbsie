/** Real packaged startup/restart/auth lifecycle; never records capabilities. */
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import assert from "node:assert/strict";

if (process.argv.length !== 3)
  throw Error("Pass the packaged companion.mjs path.");
const entry = resolve(process.argv[2]);
const runtimeOverride = process.env.ORBSIE_BLENDER_RUNTIME_DIR?.trim();
const runtime = runtimeOverride
  ? resolve(runtimeOverride)
  : join(dirname(entry), "runtime");
const cwd = await mkdtemp(join(tmpdir(), "orbsie-companion-lifecycle-"));
const origin = "http://127.0.0.1:3017";
const report = {
  scope:
    "Real local packaged companion preflight, restart and authorization; no inference",
  checks: [],
  runtimeResolution: runtimeOverride ? "explicit-override" : "beside-launcher",
  launcherSha256: createHash("sha256")
    .update(await readFile(entry))
    .digest("hex"),
  runtimeManifestSha256: createHash("sha256")
    .update(await readFile(join(runtime, "manifest.json")))
    .digest("hex"),
};
let child;
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
  assert.equal(child.exitCode, 0, "Companion must shut down cleanly");
}
async function launch() {
  const started = performance.now();
  child = spawn(process.execPath, [entry], {
    cwd,
    env: {
      PATH: process.env.PATH,
      ORBSIE_ORIGIN: origin,
      ...(runtimeOverride ? { ORBSIE_BLENDER_RUNTIME_DIR: runtime } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.resume();
  const connection = await new Promise((accept, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(Error("Companion startup timed out")),
      45000,
    );
    child.once("error", () => {
      clearTimeout(timer);
      reject(Error("Companion launch failed"));
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(Error("Companion exited before ready"));
    });
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.length > 16384) {
        clearTimeout(timer);
        reject(Error("Unexpected launcher output size"));
        return;
      }
      const match = output.match(/#builder=([^\s]+)/);
      if (match) {
        clearTimeout(timer);
        try {
          accept(JSON.parse(decodeURIComponent(match[1])));
        } catch {
          reject(Error("Invalid launcher connection"));
        }
      }
    });
  });
  const url = new URL(connection.url);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.protocol, "http:");
  report.checks.push({
    name: "preflight-startup",
    milliseconds: Math.round(performance.now() - started),
  });
  return connection;
}
async function health(connection, token = connection.token) {
  return fetch(connection.url + "/health", {
    headers: { Origin: origin, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
}
try {
  const first = await launch();
  assert.equal((await health(first)).status, 200);
  assert.equal((await health(first, "invalid")).status, 401);
  await stop();
  report.checks.push({
    name: "authenticated-health-and-clean-shutdown",
    passed: true,
  });
  const second = await launch();
  assert.notEqual(first.token, second.token);
  assert.equal((await health(second, first.token)).status, 401);
  assert.equal((await health(second)).status, 200);
  await stop();
  report.checks.push({
    name: "restart-rotates-capability-and-rejects-old-token",
    passed: true,
  });
  report.status = "passed";
  const output = "docs/evidence/packaged-companion";
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "lifecycle.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await stop();
  await rm(cwd, { recursive: true, force: true });
}
