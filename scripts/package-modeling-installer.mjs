#!/usr/bin/env node

/**
 * Package one already-assembled candidate distribution as a Linux x64
 * self-extracting installer. This is an offline packaging step: it never
 * downloads a runtime, changes the candidate manifest, or certifies a release.
 */

import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  buildTreeIntegrity,
  copyRuntimeTree,
  removeCreatedOutput,
  validateRuntimeTree,
} from "./assemble-modeling-distribution.mjs";

const execFile = promisify(execFileCallback);

export const DISTRIBUTION_SCHEMA = "orbsie.modeling-distribution/v1";
export const TREE_SCHEMA = "orbsie.modeling-distribution/tree-integrity/v1";
export const PAYLOAD_MARKER = "__ORBSIE_MODELING_PAYLOAD_BELOW__";

function fail(message) {
  throw new Error(`[package-modeling-installer] ${message}`);
}

function archiveEnvironment() {
  const environment = { ...process.env };
  for (const name of [
    "TAR_OPTIONS",
    "GZIP",
    "XZ_OPT",
    "BZIP2",
    "ZIPOPT",
    "POSIXLY_CORRECT",
  ])
    delete environment[name];
  return environment;
}

function isContained(root, candidate) {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith("..") && path !== "..");
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/** Resolve a possibly-new path through existing parent symlinks. */
async function canonicalPotentialPath(path) {
  let current = resolve(path);
  const suffix = [];
  while (!(await pathExists(current))) {
    const parent = dirname(current);
    if (parent === current) return current;
    suffix.unshift(basename(current));
    current = parent;
  }
  let canonical = await realpath(current);
  for (const part of suffix) canonical = join(canonical, part);
  return canonical;
}

async function assertNewOutput(path) {
  if (await pathExists(path))
    fail(
      `installer output already exists and will not be overwritten: ${resolve(path)}`,
    );
  return {
    path: resolve(path),
    canonical: await canonicalPotentialPath(path),
  };
}

async function requireCandidateRoot(path) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT")
      fail(`candidate distribution was not found: ${path}`);
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    fail(`candidate distribution must be a real directory: ${path}`);
  return { path: resolve(path), canonical: await realpath(path) };
}

function digestEntries(entries) {
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

async function buildPayloadEntries(root) {
  // The assembler helper is intentionally generic and includes every entry.
  // A distribution manifest is the one self-describing file excluded by the
  // distribution integrity contract.
  return (await buildTreeIntegrity(root)).filter(
    (entry) => entry.path !== "manifest.json",
  );
}

function safeIntegrityPath(path, label) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").includes("..") ||
    /[\u0000-\u001f\u007f]/.test(path)
  )
    fail(`${label} contains an unsafe relative path: ${JSON.stringify(path)}`);
}

function validateIntegritySection(value) {
  if (!value || typeof value !== "object")
    fail("candidate manifest has no integrity section");
  const integrity = value;
  if (integrity.schema !== TREE_SCHEMA)
    fail(`candidate integrity schema must be ${TREE_SCHEMA}`);
  if (
    !Array.isArray(integrity.excluded) ||
    integrity.excluded.length !== 1 ||
    integrity.excluded[0] !== "manifest.json"
  )
    fail("candidate integrity must exclude exactly manifest.json");
  if (!Array.isArray(integrity.entries))
    fail("candidate integrity entries are missing");
  if (
    !Number.isSafeInteger(integrity.entryCount) ||
    integrity.entryCount !== integrity.entries.length
  )
    fail("candidate integrity entry count is invalid");
  if (
    typeof integrity.treeSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(integrity.treeSha256) ||
    digestEntries(integrity.entries) !== integrity.treeSha256
  )
    fail("candidate integrity treeSha256 does not match its entries");
  const paths = new Set();
  for (const entry of integrity.entries) {
    if (!entry || typeof entry !== "object")
      fail("candidate integrity contains an invalid entry");
    safeIntegrityPath(entry.path, "candidate integrity entry");
    if (paths.has(entry.path))
      fail(`candidate integrity contains duplicate path: ${entry.path}`);
    paths.add(entry.path);
    if (
      !Number.isSafeInteger(entry.mode) ||
      entry.mode < 0 ||
      !["file", "directory", "symlink"].includes(entry.kind)
    )
      fail(`candidate integrity entry has invalid kind or mode: ${entry.path}`);
    if (entry.kind === "file") {
      if (
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 0 ||
        typeof entry.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)
      )
        fail(`candidate integrity file entry is invalid: ${entry.path}`);
    } else if (entry.kind === "symlink") {
      if (
        typeof entry.target !== "string" ||
        /[\u0000-\u001f\u007f]/.test(entry.target)
      )
        fail(`candidate integrity symlink entry is invalid: ${entry.path}`);
    }
  }
}

/** Verify the candidate manifest and every payload byte before packaging. */
export async function validateCandidateDistribution(root) {
  const manifestPath = join(root.path, "manifest.json");
  const manifestInfo = await lstat(manifestPath).catch((error) => {
    if (error?.code === "ENOENT") fail("candidate manifest.json is missing");
    throw error;
  });
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink())
    fail("candidate manifest.json must be a regular file");
  const manifestBytes = await readFile(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    fail(`candidate manifest.json is not valid JSON: ${error.message}`);
  }
  if (manifest?.schema !== DISTRIBUTION_SCHEMA)
    fail(`candidate manifest schema must be ${DISTRIBUTION_SCHEMA}`);
  if (
    manifest.status !== "candidate" ||
    manifest.candidate !== true ||
    manifest.releaseCertified !== false
  )
    fail(
      "candidate manifest must visibly declare status=candidate, candidate=true, and releaseCertified=false",
    );
  validateIntegritySection(manifest.integrity);
  await validateRuntimeTree(root);
  const actualEntries = await buildPayloadEntries(root.path);
  if (
    JSON.stringify(actualEntries) !== JSON.stringify(manifest.integrity.entries)
  )
    fail(
      "candidate files, modes, symlinks, or hashes do not match manifest integrity.entries",
    );
  return { manifest, manifestBytes, entries: actualEntries };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function installerSource(payloadSha256) {
  return `#!/bin/sh
set -eu

# Orbsie modeling distribution installer. The input is a candidate package;
# releaseCertified=false is preserved and this script does not certify it.
payload_sha256='${payloadSha256}'
payload_marker='${PAYLOAD_MARKER}'

die() {
  printf '%s\\n' "Orbsie installer: $1" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"
}

[ -x /bin/sh ] || die "required shell is unavailable: /bin/sh"
for command_name in tar sha256sum tail awk mktemp mkdir rm cp uname find chmod; do
  need "$command_name"
done
[ "$(uname -s)" = "Linux" ] || die "this installer requires Linux"
machine=$(uname -m)
[ "$machine" = "x86_64" ] || [ "$machine" = "amd64" ] || die "this installer requires x86_64 Linux"
unset TAR_OPTIONS GZIP XZ_OPT BZIP2 ZIPOPT POSIXLY_CORRECT

[ "$#" -eq 1 ] || die "usage: $0 NEW_DESTINATION"
destination=$1
[ -n "$destination" ] || die "destination must be a new directory path"
case "$destination" in
  /*) ;;
  *) destination=$PWD/$destination ;;
esac
[ "$destination" != "/" ] || die "refusing the filesystem root as destination"
case "$destination" in
  */*) parent=\${destination%/*}; destination_name=\${destination##*/} ;;
  *) parent=.; destination_name=$destination ;;
esac
[ -n "$destination_name" ] || die "destination must be a new directory path"
[ -n "$parent" ] || parent=/
[ -d "$parent" ] || die "destination parent does not exist: $parent"
parent=$(CDPATH= cd -P -- "$parent" && printf '%s' "$PWD") || die "cannot resolve destination parent"
destination="$parent/$destination_name"
if [ -e "$destination" ] || [ -L "$destination" ]; then
  die "destination already exists and will not be overwritten: $destination"
fi

self=$0
case "$self" in
  /*) ;;
  */*) self=$PWD/$self ;;
  *) self=$PWD/$self ;;
esac
case "$self" in
  */*) self_dir=\${self%/*}; self_name=\${self##*/} ;;
  *) self_dir=.; self_name=$self ;;
esac
self_path=$(CDPATH= cd -P -- "$self_dir" && printf '%s/%s' "$PWD" "$self_name") || die "cannot resolve installer path"
payload_line=$(awk -v marker="$payload_marker" '$0 == marker { print NR + 1; exit }' "$self_path") || die "cannot locate embedded payload"
[ -n "$payload_line" ] || die "cannot locate embedded payload"

tmp_root=$(mktemp -d "$parent/.orbsie-installer.XXXXXX") || die "cannot create temporary staging directory"
created_destination=0
owner_token=\${tmp_root##*/}
owner_marker=

make_owned_tree_writable() {
  find "$1" -type d -exec chmod u+rwx {} + || :
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$created_destination" -eq 1 ] && [ -n "$owner_marker" ] && [ -f "$owner_marker" ]; then
    owner_value=
    IFS= read -r owner_value < "$owner_marker" || owner_value=
    if [ "$owner_value" = "$owner_token" ]; then
      make_owned_tree_writable "$destination"
      rm -rf -- "$destination" || :
    fi
  fi
  if [ -d "$tmp_root" ]; then
    make_owned_tree_writable "$tmp_root"
    rm -rf -- "$tmp_root" || :
  fi
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

payload="$tmp_root/payload.tar.gz"
extract="$tmp_root/extract"
listing="$tmp_root/listing"
tail -n +"$payload_line" "$self_path" > "$payload" || die "cannot read embedded payload"
actual_sha256=$(sha256sum "$payload") || die "cannot hash embedded payload"
actual_sha256=\${actual_sha256%% *}
[ "$actual_sha256" = "$payload_sha256" ] || die "embedded payload checksum mismatch"

mkdir "$extract" || die "cannot create extraction staging directory"
tar -tzf "$payload" > "$listing" || die "embedded payload is not a readable tar archive"
while IFS= read -r archive_path; do
  case "$archive_path" in
    ""|./) ;;
    /*|../*|*/../*|*/..|..|*\\*) die "embedded archive contains an unsafe path" ;;
  esac
done < "$listing"
tar -xzf "$payload" --same-permissions --no-same-owner -C "$extract" || die "embedded payload extraction failed"
[ -x "$extract/orbsie-builder" ] || die "embedded candidate has no executable orbsie-builder"

# mkdir is the no-clobber ownership claim. A competing creator wins with
# EEXIST, and only this invocation's owner marker authorizes cleanup.
mkdir "$destination" || die "could not claim new destination: $destination"
created_destination=1
owner_marker="$destination/.orbsie-installer-owner-$owner_token"
if ! printf '%s\\n' "$owner_token" > "$owner_marker"; then
  make_owned_tree_writable "$destination"
  rm -rf -- "$destination" || :
  die "cannot establish destination ownership"
fi
cp -a "$extract"/. "$destination"/ || die "cannot install staged payload"
[ -f "$owner_marker" ] || die "staged payload replaced the destination ownership marker"
rm -f -- "$owner_marker" || die "cannot remove destination ownership marker"
created_destination=0
printf '%s\\n' "Installed Orbsie modeling candidate (releaseCertified=false) at $destination"
exit 0

${PAYLOAD_MARKER}
`;
}

async function writeInstaller(output, payload, payloadSha256) {
  const header = Buffer.from(installerSource(payloadSha256), "utf8");
  let handle;
  let identity;
  try {
    handle = await open(output, "wx", 0o755);
    identity = await handle.stat();
    const outputStream = handle.createWriteStream();
    // The stream now owns and closes the file handle after the payload ends.
    handle = undefined;
    async function* bytes() {
      yield header;
      for await (const chunk of createReadStream(payload)) yield chunk;
    }
    await pipeline(Readable.from(bytes()), outputStream);
    await chmod(output, 0o755);
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // Preserve the packaging error.
    }
    if (identity) {
      try {
        const current = await lstat(output);
        if (
          current.isFile() &&
          current.dev === identity.dev &&
          current.ino === identity.ino
        )
          await unlink(output);
      } catch {
        // Preserve the packaging error and never remove an unrelated output.
      }
    }
    throw error;
  }
}

function parseArgs(argv) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(
      "Usage: node scripts/package-modeling-installer.mjs INPUT_DIRECTORY OUTPUT.run",
    );
    return null;
  }
  if (
    argv.length !== 2 ||
    !argv[0]?.trim() ||
    !argv[1]?.trim() ||
    !argv[1].endsWith(".run")
  )
    fail(
      "Usage: node scripts/package-modeling-installer.mjs INPUT_DIRECTORY OUTPUT.run",
    );
  return { input: resolve(argv[0]), output: resolve(argv[1]) };
}

export async function packageModelingInstaller({ input, output }) {
  if (process.platform !== "linux" || process.arch !== "x64")
    fail(
      `Linux x64 installer packaging requires linux x64; detected ${process.platform} ${process.arch}`,
    );
  const inputRoot = await requireCandidateRoot(input);
  const outputInfo = await assertNewOutput(output);
  if (
    isContained(inputRoot.canonical, outputInfo.canonical) ||
    isContained(outputInfo.canonical, inputRoot.canonical)
  )
    fail(
      `candidate input and installer output overlap through canonical paths: ${inputRoot.canonical} and ${outputInfo.canonical}`,
    );

  const validated = await validateCandidateDistribution(inputRoot);
  const temporary = await mkdtemp(join(tmpdir(), "orbsie-modeling-installer-"));
  const snapshot = join(temporary, "candidate");
  const payload = join(temporary, "payload.tar.gz");
  try {
    await copyRuntimeTree(inputRoot.path, snapshot);
    const staged = await validateCandidateDistribution({
      path: snapshot,
      canonical: await realpath(snapshot),
    });
    if (!staged.manifestBytes.equals(validated.manifestBytes))
      fail("candidate manifest changed while creating the verified snapshot");
    await execFile("tar", ["-czf", payload, "-C", snapshot, "."], {
      env: archiveEnvironment(),
      maxBuffer: 2 * 1024 * 1024,
    });
    const payloadSha256 = await sha256File(payload);
    await writeInstaller(outputInfo.path, payload, payloadSha256);
    return {
      output: outputInfo.path,
      input: inputRoot.path,
      status: validated.manifest.status,
      releaseCertified: validated.manifest.releaseCertified,
      payloadSha256,
      entryCount: validated.entries.length,
    };
  } finally {
    await removeCreatedOutput(temporary);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options) {
      const result = await packageModelingInstaller(options);
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
