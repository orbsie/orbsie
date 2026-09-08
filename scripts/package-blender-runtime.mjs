#!/usr/bin/env node

/**
 * Build a local Blender companion prototype from an already installed Linux
 * package. This is intentionally a packaging probe, not a download or
 * installer: no network, privilege escalation, project files, or credentials
 * are involved. The output defaults to /tmp and is disposable.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  chmodSync,
  closeSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const DEFAULT_BLENDER = "/usr/bin/blender";
const DEFAULT_DATA = "/usr/share/blender";
const DEFAULT_NUMPY = join(
  process.env.HOME || "/home/marcos",
  ".local/lib/python3.12/site-packages/numpy",
);
const DEFAULT_OUTPUT = "/tmp/orbsie-blender-runtime-system-prototype";
export const PINNED_OFFICIAL_ARCHIVES = Object.freeze({
  "blender-4.0.2-linux-x64.tar.xz":
    "5583a5588736da8858c522ef17fff5d73be59c47a6fe91ad29c6f3263e22086a",
});

const VERIFY_JOB = String.raw`
import bpy
import json
import os

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0, location=(0, 0, 1))
sphere = bpy.context.object
sphere.name = "orbsie_probe_orb"
material = bpy.data.materials.new("Probe Material")
material.diffuse_color = (0.12, 0.48, 0.95, 1.0)
sphere.data.materials.append(material)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath("/work/verify.blend"))
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath("/work/verify.glb"),
    export_format="GLB",
    export_materials="EXPORT",
    use_selection=True,
)
try:
    import numpy
    numpy_version = numpy.__version__
except ImportError:
    numpy_version = None
with open("/work/verify-result.json", "w", encoding="utf-8") as handle:
    json.dump(
        {
            "blenderVersion": bpy.app.version_string,
            "numpy": numpy_version,
            "glb": os.path.getsize("/work/verify.glb"),
        },
        handle,
        sort_keys=True,
    )
`;

function usage() {
  console.log(`Usage: node scripts/package-blender-runtime.mjs [options]

Options:
  --archive PATH       Official Blender Linux tar.xz (requires --checksum)
  --checksum PATH      SHA-256 file matching the official archive basename
  --blender PATH       Installed Blender executable (default /usr/bin/blender)
  --data PATH          Blender data directory (default /usr/share/blender)
  --numpy PATH         NumPy package directory used by Blender Python
  --output PATH        Bundle directory (default ${DEFAULT_OUTPUT})
  --replace            Remove an existing output directory under /tmp first
  --no-verify          Package without the clean-environment GLB probe
  -h, --help           Show this help
`);
}

function parseArgs(argv) {
  const options = {
    archive: null,
    checksum: null,
    blender: process.env.ORBSIE_BLENDER_PATH || DEFAULT_BLENDER,
    data: process.env.ORBSIE_BLENDER_DATA || DEFAULT_DATA,
    numpy: process.env.ORBSIE_BLENDER_NUMPY_PATH || DEFAULT_NUMPY,
    numpyExplicit: false,
    output: DEFAULT_OUTPUT,
    replace: false,
    verify: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--archive") options.archive = resolve(argv[++index]);
    else if (arg === "--checksum") options.checksum = resolve(argv[++index]);
    else if (arg === "--blender") options.blender = argv[++index];
    else if (arg === "--data") options.data = argv[++index];
    else if (arg === "--numpy") {
      options.numpy = argv[++index];
      options.numpyExplicit = true;
    } else if (arg === "--output") options.output = resolve(argv[++index]);
    else if (arg === "--replace") options.replace = true;
    else if (arg === "--no-verify") options.verify = false;
    else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
    if (arg === "--blender" || arg === "--data" || arg === "--numpy") {
      if (!argv[index]) throw new Error(`${arg} requires a path`);
      if (arg !== "--output")
        options[
          {
            "--blender": "blender",
            "--data": "data",
            "--numpy": "numpy",
          }[arg]
        ] = resolve(argv[index]);
    }
  }
  return options;
}

function fail(message) {
  throw new Error(`[blender-package] ${message}`);
}

export function isPathContained(root, candidate) {
  const relativePath = relative(resolve(root), resolve(candidate));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("../") &&
      relativePath !== ".." &&
      !relativePath.startsWith("..\\"))
  );
}

export function assertContainedPath(root, candidate, label = "path") {
  if (!isPathContained(root, candidate))
    fail(`${label} escapes its allowed root: ${candidate}`);
  return candidate;
}

export function assertDisposableOutputPath(output) {
  const resolved = resolve(output);
  const parent = dirname(resolved);
  const safeRoot = realpathSync(tmpdir());
  if (parent !== safeRoot || realpathSync(parent) !== safeRoot)
    fail(`output must be a direct child of ${safeRoot}: ${resolved}`);
  if (!/^orbsie-blender-runtime-[A-Za-z0-9._-]+$/.test(basename(resolved)))
    fail(`output does not have the disposable Orbsie prefix: ${resolved}`);
  if (existsSync(resolved)) {
    const outputStat = lstatSync(resolved);
    if (outputStat.isSymbolicLink())
      fail(`output cannot be a symbolic link: ${resolved}`);
    if (
      typeof process.getuid === "function" &&
      outputStat.uid !== process.getuid()
    )
      fail(`output is not owned by the current user: ${resolved}`);
  }
  return resolved;
}

export function validateArchiveEntries(entries) {
  for (const entry of entries) {
    const normalized = entry.replaceAll("\\", "/");
    if (
      normalized.startsWith("/") ||
      normalized.split("/").includes("..") ||
      /^[A-Za-z]:\//.test(normalized)
    )
      fail(`unsafe path in Blender archive: ${entry}`);
  }
  return entries;
}

export function assertArchiveLinkTarget(root, linkPath, target) {
  const canonicalRoot = resolve(root);
  const canonicalTarget = resolve(dirname(linkPath), target);
  assertContainedPath(canonicalRoot, canonicalTarget, "archive symlink target");
  return canonicalTarget;
}

function ensureFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile())
    fail(`${label} is not a readable file: ${path}`);
}

function ensureDirectory(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory())
    fail(`${label} is not a readable directory: ${path}`);
}

function commandOutput(binary, args) {
  try {
    return execFileSync(binary, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch (error) {
    fail(`${binary} ${args.join(" ")} failed: ${error.message}`);
  }
}

function blenderVersion(binary) {
  const first = commandOutput(binary, ["--version"]).split(/\r?\n/)[0];
  const match = first.match(/Blender\s+([^\s]+)/i);
  if (!match) fail(`could not parse Blender version from ${first}`);
  return { line: first, version: match[1] };
}

function verifyArchive(archive, checksumPath) {
  ensureFile(archive, "Blender archive");
  ensureFile(checksumPath, "Blender checksum file");
  const name = archive.split("/").at(-1);
  const pinned = PINNED_OFFICIAL_ARCHIVES[name];
  if (!pinned)
    fail(
      `unsupported official archive ${name}; this prototype only pins ${Object.keys(PINNED_OFFICIAL_ARCHIVES).join(", ")}`,
    );
  const expected = readFileSync(checksumPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts.length >= 2 && parts.at(-1) === name)?.[0];
  if (!expected) fail(`checksum file has no entry for ${name}`);
  if (expected !== pinned)
    fail(
      `checksum file does not match the pinned official SHA-256 for ${name}: expected ${pinned}, got ${expected}`,
    );
  const actual = sha256(archive);
  if (actual !== pinned)
    fail(`Blender archive SHA-256 mismatch: expected ${pinned}, got ${actual}`);
  return {
    downloaded: true,
    name,
    bytes: statSync(archive).size,
    sha256: actual,
    pinnedSha256: pinned,
    checksumFile: checksumPath,
  };
}

function extractOfficialArchive(archive) {
  const extractRoot = mkdtempSync(join(tmpdir(), "orbsie-blender-release-"));
  const entries = commandOutput("tar", ["-tJf", archive])
    .split(/\r?\n/)
    .filter(Boolean);
  validateArchiveEntries(entries);
  try {
    execFileSync("tar", ["-xJf", archive, "-C", extractRoot], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    fail(`could not extract Blender archive: ${error.message}`);
  }
  const root = readdirSync(extractRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(extractRoot, entry.name))
    .find((candidate) => existsSync(join(candidate, "blender")));
  if (!root)
    fail("official Blender archive has no top-level blender executable");
  const data = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .find(
      (candidate) =>
        existsSync(join(candidate, "scripts")) &&
        existsSync(join(candidate, "datafiles")),
    );
  if (!data) fail("official Blender archive has no versioned data directory");
  return {
    root,
    blender: join(root, "blender"),
    data,
    runtimeLib: join(root, "lib"),
    license: join(root, "license"),
    extractRoot,
  };
}

export function copyDirectory(
  source,
  destination,
  { dereference = false, containmentRoot = source, active = new Set() } = {},
) {
  const canonicalRoot = realpathSync(containmentRoot);
  const canonicalSource = realpathSync(source);
  assertContainedPath(canonicalRoot, canonicalSource, "source path");
  if (active.has(canonicalSource))
    fail(`cyclic source symlink or directory: ${source}`);
  active.add(canonicalSource);
  mkdirSync(destination, { recursive: true });
  try {
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const sourcePath = join(source, entry.name);
      const destinationPath = join(destination, entry.name);
      if (entry.isSymbolicLink()) {
        let resolved;
        try {
          assertArchiveLinkTarget(
            canonicalRoot,
            sourcePath,
            readlinkSync(sourcePath),
          );
          resolved = realpathSync(sourcePath);
        } catch (error) {
          fail(
            `unresolvable or cyclic source symlink ${sourcePath}: ${error.message}`,
          );
        }
        assertContainedPath(canonicalRoot, resolved, "source symlink target");
        if (dereference && lstatSync(resolved).isDirectory())
          copyDirectory(resolved, destinationPath, {
            dereference: true,
            containmentRoot: canonicalRoot,
            active,
          });
        else if (dereference) copyFile(resolved, destinationPath);
        else cpSync(sourcePath, destinationPath, { dereference: false });
      } else if (entry.isDirectory()) {
        copyDirectory(sourcePath, destinationPath, {
          dereference,
          containmentRoot: canonicalRoot,
          active,
        });
      } else if (entry.isFile()) {
        assertContainedPath(
          canonicalRoot,
          realpathSync(sourcePath),
          "source file",
        );
        copyFile(sourcePath, destinationPath);
      } else {
        fail(`unsupported source entry: ${sourcePath}`);
      }
    }
  } finally {
    active.delete(canonicalSource);
  }
}

function copyFile(source, destination, mode = undefined) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { dereference: false });
  // chmod is deliberately done through the source-independent file API so
  // the result is executable even when the host umask is restrictive.
  if (mode !== undefined) chmodSync(destination, mode);
}

function walkFiles(root) {
  const files = [];
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  visit(root);
  return files;
}

function treeStats(root) {
  let bytes = 0;
  let files = 0;
  for (const path of walkFiles(root)) {
    bytes += statSync(path).size;
    files += 1;
  }
  return { bytes, files };
}

function sha256(path) {
  const descriptor = openSync(path, "r");
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytesRead > 0) hash.update(chunk.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Record every bundle entry except the manifest itself. Directories and
 * symlinks are recorded as entries so a package cannot silently change its
 * Python/native tree shape between packaging and execution.
 */
export function buildTreeIntegrity(
  root,
  { excluded = ["manifest.json"] } = {},
) {
  const canonicalRoot = realpathSync(root);
  const excludedSet = new Set(excluded);
  const entries = [];
  const visit = (current) => {
    const children = readdirSync(current, { withFileTypes: true }).sort(
      (a, b) => stableCompare(a.name, b.name),
    );
    for (const child of children) {
      const path = join(current, child.name);
      const entryPath = relative(canonicalRoot, path).replaceAll("\\", "/");
      if (excludedSet.has(entryPath)) continue;
      const info = lstatSync(path);
      const mode = info.mode & 0o7777;
      if (info.isSymbolicLink()) {
        const target = readlinkSync(path);
        if (!isPathContained(canonicalRoot, resolve(dirname(path), target)))
          fail(`bundle symlink escapes its package: ${path} -> ${target}`);
        entries.push({
          path: entryPath,
          kind: "symlink",
          mode,
          target,
        });
      } else if (info.isDirectory()) {
        entries.push({ path: entryPath, kind: "directory", mode });
        visit(path);
      } else if (info.isFile()) {
        entries.push({
          path: entryPath,
          kind: "file",
          mode,
          bytes: info.size,
          sha256: sha256(path),
        });
      } else {
        fail(`unsupported bundle entry type: ${path}`);
      }
    }
  };
  visit(canonicalRoot);
  entries.sort((a, b) => stableCompare(a.path, b.path));
  return {
    schema: "orbsie.blender-runtime/tree-integrity/v1",
    excluded: [...excludedSet].sort(),
    entryCount: entries.length,
    treeSha256: sha256Bytes(JSON.stringify(entries)),
    entries,
  };
}

function parseLdd(binary) {
  const output = commandOutput("ldd", [binary]);
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\s*(\S+)\s+=>\s+(\S+)\s+\(([^)]+)\)/);
      if (match) return { soname: match[1], path: match[2], address: match[3] };
      const direct = line.match(/^\s*(\/\S+)\s+\(([^)]+)\)/);
      if (direct)
        return { soname: direct[1], path: direct[1], address: direct[2] };
      return { line };
    });
}

function packageMetadata(path) {
  try {
    return commandOutput("dpkg-query", ["-S", path])
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function packageVersions(enabled = true) {
  if (!enabled) return "not an installed system package";
  try {
    return commandOutput("dpkg-query", [
      "-W",
      "-f=${Package} ${Version} ${Architecture}\\n",
      "blender",
      "blender-data",
    ]);
  } catch {
    return "unavailable";
  }
}

function numpyVersion(numpyPath) {
  const parent = dirname(numpyPath);
  const distInfo = readdirSync(parent).find((name) =>
    /^numpy-[^/]+\.dist-info$/.test(name),
  );
  if (!distInfo) return "unknown";
  const metadata = join(parent, distInfo, "METADATA");
  if (!existsSync(metadata)) return "unknown";
  const match = readFileSync(metadata, "utf8").match(/^Version:\s*(.+)$/m);
  return match?.[1]?.trim() || "unknown";
}

function launcherText() {
  return `#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export HOME="\${ORBSIE_BLENDER_HOME:-\$ROOT/home}"
export TMPDIR="\${ORBSIE_BLENDER_TMP:-\$ROOT/tmp}"
export XDG_CONFIG_HOME="$HOME/.config"
export BLENDER_USER_CONFIG="$XDG_CONFIG_HOME/blender"
export BLENDER_USER_SCRIPTS="$ROOT/user-scripts"
export BLENDER_USER_EXTENSIONS="$ROOT/extensions"
export BLENDER_SYSTEM_RESOURCES="$ROOT/share/blender"
export BLENDER_SYSTEM_DATAFILES="$ROOT/share/blender/datafiles"
export BLENDER_SYSTEM_SCRIPTS="$ROOT/share/blender/scripts"
export BLENDER_SYSTEM_PYTHON="$ROOT/share/blender/python"
HOST_LD_LIBRARY_PATH="\${LD_LIBRARY_PATH:-}"
export LD_LIBRARY_PATH="$ROOT/lib"
if [ -d "$ROOT/lib/python3.12/site-packages" ]; then
  export PYTHONPATH="$ROOT/lib/python3.12/site-packages\${PYTHONPATH:+:\$PYTHONPATH}"
  export LD_LIBRARY_PATH="$ROOT/lib/python3.12/site-packages/numpy.libs:$LD_LIBRARY_PATH"
fi
if [ -d "$ROOT/lib/python3.10/site-packages" ]; then
  export PYTHONPATH="$ROOT/lib/python3.10/site-packages\${PYTHONPATH:+:\$PYTHONPATH}"
fi
if [ -n "$HOST_LD_LIBRARY_PATH" ]; then
  export LD_LIBRARY_PATH="$LD_LIBRARY_PATH:$HOST_LD_LIBRARY_PATH"
fi
mkdir -p "$HOME" "$TMPDIR" "$XDG_CONFIG_HOME" "$BLENDER_USER_SCRIPTS" "$BLENDER_USER_EXTENSIONS"
exec "$ROOT/bin/blender" "$@"
`;
}

function validateGlb(path) {
  const buffer = readFileSync(path);
  if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "glTF")
    fail("verification output is not a GLB");
  if (buffer.readUInt32LE(4) !== 2)
    fail("verification output is not GLB version 2");
  if (buffer.readUInt32LE(8) !== buffer.length)
    fail("verification GLB length header does not match output");
  return { bytes: buffer.length, sha256: sha256(path) };
}

function verifyCleanEnvironment(bundle) {
  const verifyDir = join(bundle, "verification");
  mkdirSync(verifyDir, { recursive: true });
  const jobPath = join(verifyDir, "trusted-probe.py");
  const glbPath = join(verifyDir, "verify.glb");
  const blendPath = join(verifyDir, "verify.blend");
  const resultPath = join(verifyDir, "verify-result.json");
  writeFileSync(jobPath, VERIFY_JOB.replaceAll("/work/", `${verifyDir}/`), {
    mode: 0o600,
  });
  const isolatedHome = join(verifyDir, "home");
  const isolatedTmp = join(verifyDir, "tmp");
  const env = {
    PATH: "/usr/bin:/bin",
    HOME: isolatedHome,
    TMPDIR: isolatedTmp,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    ORBSIE_BLENDER_HOME: isolatedHome,
    ORBSIE_BLENDER_TMP: isolatedTmp,
  };
  const started = performance.now();
  const child = spawnSync(
    join(bundle, "bin/orbsie-blender"),
    [
      "--background",
      "--factory-startup",
      "--disable-autoexec",
      "--python",
      jobPath,
    ],
    {
      cwd: bundle,
      env,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const elapsedMs = Math.round(performance.now() - started);
  if (child.error)
    fail(`clean-environment probe failed: ${child.error.message}`);
  if (child.status !== 0)
    fail(
      `clean-environment Blender probe exited ${child.status}: ${(child.stderr || child.stdout || "").trim()}`,
    );
  ensureFile(glbPath, "clean-environment GLB");
  ensureFile(blendPath, "clean-environment blend file");
  ensureFile(resultPath, "clean-environment result");
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  const glb = validateGlb(glbPath);
  return {
    status: "passed",
    command:
      "orbsie-blender --background --factory-startup --disable-autoexec --python trusted-probe.py",
    environment:
      "env -i equivalent: no inherited HOME, PYTHONPATH, credentials, or project cwd",
    blenderVersion: result.blenderVersion,
    numpyVersion: result.numpy,
    coldStartMs: elapsedMs,
    glb,
    blendBytes: statSync(blendPath).size,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  let sourceKind = "installed-system-package";
  let archiveInfo = null;
  let extracted = null;
  let runtimeLib = null;
  let licenseRoots = ["/usr/share/doc/blender", "/usr/share/doc/blender-data"];
  if (options.archive) {
    if (!options.checksum)
      fail("--archive requires --checksum for an authoritative hash check");
    archiveInfo = verifyArchive(options.archive, options.checksum);
    extracted = extractOfficialArchive(options.archive);
    const extractedStats = treeStats(extracted.root);
    archiveInfo = {
      ...archiveInfo,
      unpackedFiles: extractedStats.files,
      unpackedBytes: extractedStats.bytes,
    };
    options.blender = extracted.blender;
    options.data = extracted.data;
    runtimeLib = extracted.runtimeLib;
    licenseRoots = [extracted.license];
    sourceKind = "official-release-tarball";
    if (!options.numpyExplicit) options.numpy = null;
  }
  ensureFile(options.blender, "Blender executable");
  ensureDirectory(options.data, "Blender data directory");
  if (options.numpy) {
    ensureDirectory(options.numpy, "NumPy package");
    ensureDirectory(
      join(dirname(options.numpy), "numpy.libs"),
      "NumPy native libraries",
    );
  }
  options.output = assertDisposableOutputPath(options.output);
  if (existsSync(options.output)) {
    if (!options.replace)
      fail(`output exists; pass --replace: ${options.output}`);
    rmSync(options.output, { recursive: true, force: true });
  }
  mkdirSync(options.output, { recursive: true, mode: 0o700 });
  const version = blenderVersion(options.blender);
  const bundle = options.output;
  copyFile(options.blender, join(bundle, "bin/blender"), 0o755);
  copyDirectory(options.data, join(bundle, "share/blender"), {
    dereference: Boolean(extracted),
    containmentRoot: extracted ? extracted.root : options.data,
  });
  if (runtimeLib)
    copyDirectory(runtimeLib, join(bundle, "lib"), {
      dereference: true,
      containmentRoot: extracted ? extracted.root : runtimeLib,
    });
  let distInfo = null;
  if (options.numpy) {
    copyDirectory(
      options.numpy,
      join(bundle, "lib/python3.12/site-packages/numpy"),
      { dereference: true, containmentRoot: dirname(options.numpy) },
    );
    copyDirectory(
      join(dirname(options.numpy), "numpy.libs"),
      join(bundle, "lib/python3.12/site-packages/numpy.libs"),
      { dereference: true, containmentRoot: dirname(options.numpy) },
    );
    distInfo = readdirSync(dirname(options.numpy)).find((name) =>
      /^numpy-[^/]+\.dist-info$/.test(name),
    );
    if (distInfo)
      copyDirectory(
        join(dirname(options.numpy), distInfo),
        join(bundle, "lib/python3.12/site-packages", distInfo),
        { dereference: true, containmentRoot: dirname(options.numpy) },
      );
  }
  mkdirSync(join(bundle, "home"), { recursive: true, mode: 0o700 });
  mkdirSync(join(bundle, "tmp"), { recursive: true, mode: 0o700 });
  writeFileSync(join(bundle, "bin/orbsie-blender"), launcherText(), {
    mode: 0o755,
  });

  const licenses = [];
  if (options.numpy && distInfo)
    licenseRoots.push(join(dirname(options.numpy), distInfo));
  const sourcePath = (path) =>
    extracted && path.startsWith(`${extracted.root}/`)
      ? `${archiveInfo.name}!/${relative(extracted.root, path)}`
      : path;
  for (const source of licenseRoots) {
    if (!existsSync(source)) continue;
    for (const file of walkFiles(source)) {
      if (!/(copyright|license|LICENSE|METADATA|NOTICE)/i.test(file)) continue;
      const licenseRelative =
        extracted && isPathContained(extracted.root, file)
          ? join("blender", relative(extracted.root, file))
          : options.numpy && isPathContained(dirname(options.numpy), file)
            ? join("external-numpy", relative(dirname(options.numpy), file))
            : join("host", file.replace(/^\//, ""));
      const destination = join(bundle, "licenses", licenseRelative);
      assertContainedPath(bundle, destination, "license destination");
      copyFile(file, destination);
      licenses.push({
        source: sourcePath(file),
        bundled: relative(bundle, destination),
        sha256: sha256(file),
      });
    }
  }

  const sourceStats = {
    blenderExecutable: {
      path: sourcePath(options.blender),
      bytes: statSync(options.blender).size,
      sha256: sha256(options.blender),
      package: packageMetadata(options.blender),
    },
    blenderData: {
      path: sourcePath(options.data),
      ...treeStats(options.data),
      package: packageMetadata(options.data),
    },
    numpy: options.numpy
      ? {
          path: sourcePath(options.numpy),
          version: numpyVersion(options.numpy),
          ...treeStats(options.numpy),
          nativeLibraries: treeStats(
            join(dirname(options.numpy), "numpy.libs"),
          ),
        }
      : null,
    bundledRuntimeLibraries: runtimeLib ? treeStats(runtimeLib) : null,
  };
  const dependencyManifest = parseLdd(options.blender).map((dependency) =>
    dependency.path &&
    extracted &&
    dependency.path.startsWith(`${extracted.root}/`)
      ? {
          ...dependency,
          path: `${archiveInfo.name}!/${relative(extracted.root, dependency.path)}`,
        }
      : dependency,
  );
  let verification = { status: "skipped" };
  if (options.verify) {
    verification = verifyCleanEnvironment(bundle);
    // Verification output is evidence captured in the manifest, not runtime
    // payload. Removing it also prevents temporary absolute Pulse symlinks
    // from making the package tree path-dependent.
    rmSync(join(bundle, "verification"), { recursive: true, force: true });
  }
  const bundleStats = treeStats(bundle);
  const integrity = buildTreeIntegrity(bundle);
  const pythonLayout = options.numpy
    ? "lib/python3.12/site-packages/numpy"
    : (() => {
        const pythonLib = join(bundle, "share/blender/python/lib");
        const version = readdirSync(pythonLib, { withFileTypes: true }).find(
          (entry) => entry.isDirectory() && /^python\d+\.\d+$/.test(entry.name),
        )?.name;
        if (!version)
          fail("packaged Blender Python version directory is missing");
        return `share/blender/python/lib/${version}/site-packages/numpy`;
      })();
  const manifest = {
    schema: "orbsie.blender-runtime/v1",
    status: `${sourceKind}-prototype`,
    portable: false,
    generatedAt: new Date().toISOString(),
    source: {
      kind: sourceKind,
      blenderVersion: version.version,
      blenderVersionLine: version.line,
      packageVersions: packageVersions(
        sourceKind === "installed-system-package",
      ),
      sourceAvailability: {
        blenderSource: "https://projects.blender.org/blender/blender",
        officialReleaseIndex:
          "https://download.blender.org/release/Blender4.0/",
        buildInstructions:
          "https://developer.blender.org/docs/handbook/building_blender/linux/",
        releaseLicense: "https://www.blender.org/about/license/",
      },
      archive: archiveInfo ?? {
        downloaded: false,
        note: "This prototype packages the installed Debian/Ubuntu closure; use the official release tarball or a Rocky Linux 8 build for a redistributable artifact.",
      },
    },
    layout: {
      launcher: "bin/orbsie-blender",
      executable: "bin/blender",
      resources: "share/blender",
      python: pythonLayout,
    },
    sourceStats,
    runtimeDependencies: {
      hostProvided: true,
      bundledRuntimeLibraries: Boolean(runtimeLib),
      note: runtimeLib
        ? "Blender's bundled library directory is included; the executable still links to host glibc, X11, and other platform libraries."
        : "The executable links to the host glibc and system multimedia/OpenGL libraries; this bundle intentionally does not copy them.",
      ldd: dependencyManifest,
    },
    licenses,
    verification,
    integrity,
    bundle: {
      payloadBytes: bundleStats.bytes,
      payloadFiles: bundleStats.files,
      manifestBytes: 0,
      totalBytes: bundleStats.bytes,
    },
  };
  const manifestPath = join(bundle, "manifest.json");
  // Include the manifest in the reported unpacked size. Its own byte count is
  // stable after the first pass because the fields use fixed-width integers.
  for (let pass = 0; pass < 3; pass += 1) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const manifestBytes = statSync(manifestPath).size;
    manifest.bundle.manifestBytes = manifestBytes;
    manifest.bundle.totalBytes = bundleStats.bytes + manifestBytes;
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        status: "ok",
        manifest: manifestPath,
        blenderVersion: version.version,
        verification: manifest.verification,
        bundle: manifest.bundle,
        integrity: {
          schema: manifest.integrity.schema,
          entryCount: manifest.integrity.entryCount,
          treeSha256: manifest.integrity.treeSha256,
        },
      },
      null,
      2,
    ),
  );
  if (extracted)
    rmSync(extracted.extractRoot, { recursive: true, force: true });
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    main();
  } catch (error) {
    console.error(
      JSON.stringify({ status: "error", message: error.message }, null, 2),
    );
    process.exitCode = 1;
  }
}
