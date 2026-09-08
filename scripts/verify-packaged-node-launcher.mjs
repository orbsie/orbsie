/** Offline integration proof for the application + Node package, not Blender. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  stat,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
const exec = promisify(execFile);
const nodeRoot = resolve(
  process.env.ORBSIE_NODE_DISTRIBUTION ?? join(dirname(process.execPath), ".."),
);
const root = await mkdtemp(join(tmpdir(), "orbsie-node-launcher-"));
const evidence = "docs/evidence/packaged-node-launcher";
const report = {
  passed: false,
  scope:
    "Offline bundled Node launcher: no Blender construction, browser pairing or portable installer claim",
  realProviderCalls: 0,
  networkRequests: 0,
};
async function installedBytes(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    bytes += entry.isDirectory()
      ? await installedBytes(path)
      : (await stat(path)).size;
  }
  return bytes;
}
try {
  for (const invalidRoot of ["", "   "]) {
    const invalidOutput = join(root, "invalid-root");
    await assert.rejects(
      exec(process.execPath, [
        "scripts/package-modeling-companion.mjs",
        invalidOutput,
        "--node-root",
        invalidRoot,
      ]),
      /Usage:/,
    );
    await assert.rejects(stat(invalidOutput), { code: "ENOENT" });
  }
  report.emptyExplicitNodeRootRejected = true;
  const output = join(root, "initial");
  await exec(
    process.execPath,
    ["scripts/package-modeling-companion.mjs", output, "--node-root", nodeRoot],
    { timeout: 60000, maxBuffer: 20000 },
  );
  const originalManifest = await readFile(join(output, "package.json"));
  await assert.rejects(
    exec(process.execPath, ["scripts/package-modeling-companion.mjs", output]),
    /EEXIST/,
  );
  assert.deepEqual(
    await readFile(join(output, "package.json")),
    originalManifest,
  );
  report.existingPackagePreserved = true;
  const relocated = join(root, "relocated bundle with spaces");
  await rename(output, relocated);
  const cwd = join(root, "empty work");
  await mkdir(cwd);
  const env = {
    PATH: "",
    HOME: cwd,
    LANG: "C",
    NODE_OPTIONS: "--require=/missing-module-that-must-not-load",
    NODE_PATH: "/missing-modules",
  };
  const started = performance.now();
  const help = await exec(join(relocated, "orbsie-builder"), ["--help"], {
    cwd,
    env,
    timeout: 15000,
    maxBuffer: 5000,
  });
  report.launcherHelpMs = Math.round(performance.now() - started);
  assert.match(help.stdout, /Orbsie local model builder/);
  assert.equal(help.stderr, "");
  report.relocatedLaunchWithoutPath = true;
  report.inheritedNodeOptionsCleared = true;
  const second = await exec(join(relocated, "orbsie-builder"), ["--help"], {
    cwd,
    env,
    timeout: 15000,
    maxBuffer: 5000,
  });
  assert.equal(second.stdout, help.stdout);
  report.restartHelp = true;
  let failure;
  try {
    await exec(join(relocated, "orbsie-builder"), ["--check"], {
      cwd,
      env,
      timeout: 15000,
      maxBuffer: 5000,
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, 1);
  assert.match(failure.stderr, /Local builder startup failed/);
  assert.equal(failure.stdout, "");
  report.missingBlenderFailsWithoutConnection = true;
  const manifest = JSON.parse(
    await readFile(join(relocated, "package.json"), "utf8"),
  );
  assert.equal(manifest.nodeIncluded, true);
  assert.equal(manifest.runtimeIncluded, false);
  report.package = manifest;
  report.installedBytes = await installedBytes(relocated);
  report.host = { platform: process.platform, architecture: process.arch };
  const sourceLicense = await readFile(join(nodeRoot, "LICENSE"));
  const bundledLicense = await readFile(join(relocated, "node/LICENSE"));
  assert.deepEqual(bundledLicense, sourceLicense);
  report.nodeLicenseSha256 = createHash("sha256")
    .update(bundledLicense)
    .digest("hex");
  report.completeLocalLicensePreserved = true;
  const applicationOnly = join(root, "application only");
  await exec(
    process.execPath,
    ["scripts/package-modeling-companion.mjs", applicationOnly],
    { timeout: 60000, maxBuffer: 20000 },
  );
  assert.equal(
    JSON.parse(await readFile(join(applicationOnly, "package.json"), "utf8"))
      .nodeIncluded,
    false,
  );
  const applicationHelp = await exec(
    process.execPath,
    [join(applicationOnly, "companion.mjs"), "--help"],
    { cwd, timeout: 15000 },
  );
  assert.match(applicationHelp.stdout, /Orbsie local model builder/);
  report.applicationOnlyModePreserved = true;
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
