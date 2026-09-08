#!/usr/bin/env node

/**
 * Inventory the native library closure observed for one explicitly selected
 * system executable. This is evidence about the current host installation;
 * it is not a portable package builder or a legal-completeness assertion.
 */

import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { open, lstat, readFile, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const NATIVE_INVENTORY_SCHEMA = "orbsie.native-notices/v1";
export const INVENTORY_LIMITS = Object.freeze({
  lddBytes: 1024 * 1024,
  pathBytes: 4096,
  pathCount: 2048,
  packageCount: 1024,
  noticeBytes: 16 * 1024 * 1024,
  manifestBytes: 8 * 1024 * 1024,
});

function fail(message) {
  throw new Error(`[native-notices] ${message}`);
}

function ensureString(value, label) {
  if (typeof value !== "string" || value.length === 0)
    fail(`${label} must be a non-empty string`);
  return value;
}

function checkPath(path, label = "path") {
  ensureString(path, label);
  if (path.length > INVENTORY_LIMITS.pathBytes)
    fail(`${label} exceeds the ${INVENTORY_LIMITS.pathBytes}-byte limit`);
  if (!isAbsolute(path)) fail(`${label} must be absolute: ${path}`);
  return path;
}

function checkLddOutput(output) {
  ensureString(output, "ldd output");
  if (Buffer.byteLength(output) > INVENTORY_LIMITS.lddBytes)
    fail(`ldd output exceeds the ${INVENTORY_LIMITS.lddBytes}-byte limit`);
  return output;
}

/**
 * Parse the text emitted by ldd without executing any of the listed files.
 * Resolved paths are retained only when they are absolute. `not found` and
 * loader entries without a file path stay in the result as unresolved
 * dependency records so a caller cannot mistake an incomplete closure for a
 * complete one.
 */
export function parseLdd(output) {
  const text = checkLddOutput(output);
  const entries = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (entries.length >= INVENTORY_LIMITS.pathCount)
      fail(
        `ldd output contains more than ${INVENTORY_LIMITS.pathCount} entries`,
      );

    // The address is optional in malformed or architecture-specific output,
    // but a trailing parenthesized address is removed from the path first.
    const redirected =
      line.match(/^([^\s]+)\s+=>\s+(.+?)\s+\(([^)]*)\)\s*$/) ||
      line.match(/^([^\s]+)\s+=>\s+(.+?)\s*$/);
    if (redirected) {
      const soname = redirected[1];
      const candidate = redirected[2].trim();
      const address = redirected[3] || null;
      if (candidate === "not found") {
        entries.push({
          soname,
          path: null,
          address,
          status: "unresolved",
          reason: "not-found",
          line,
        });
      } else if (candidate.startsWith("/")) {
        entries.push({
          soname,
          path: candidate,
          address,
          status: "resolved",
          line,
        });
      } else {
        entries.push({
          soname,
          path: null,
          address,
          status: "unresolved",
          reason: "non-absolute-path",
          line,
        });
      }
      continue;
    }

    const direct =
      line.match(/^(\/.*?)\s+\(([^)]*)\)\s*$/) || line.match(/^(\/.*)$/);
    if (direct) {
      entries.push({
        soname: direct[1],
        path: direct[1],
        address: direct[2] || null,
        status: "resolved",
        line,
      });
      continue;
    }

    // linux-vdso and similar loader-provided entries have no filesystem
    // path. Preserve them as unresolved evidence instead of silently dropping
    // them from the dependency report.
    const loader = line.match(/^(\S+)(?:\s+\(([^)]*)\))?$/);
    if (loader) {
      entries.push({
        soname: loader[1],
        path: null,
        address: loader[2] || null,
        status: "unresolved",
        reason: "no-filesystem-path",
        line,
      });
    } else {
      entries.push({
        soname: null,
        path: null,
        address: null,
        status: "unresolved",
        reason: "unparsed-line",
        line,
      });
    }

    if (entries.length > INVENTORY_LIMITS.pathCount)
      fail(
        `ldd output contains more than ${INVENTORY_LIMITS.pathCount} entries`,
      );
  }
  return entries;
}

function resultStdout(result) {
  if (typeof result === "string") return result;
  if (result && typeof result.stdout === "string") return result.stdout;
  return "";
}

async function invoke(run, command, args, options = {}) {
  const result = await run(command, args, options);
  const output = resultStdout(result);
  if (Buffer.byteLength(output) > INVENTORY_LIMITS.lddBytes)
    fail(
      `${command} output exceeds the ${INVENTORY_LIMITS.lddBytes}-byte limit`,
    );
  return output;
}

async function maybeRealpath(realpathFn, path) {
  try {
    const value = await realpathFn(path);
    if (typeof value !== "string" || !isAbsolute(value)) return null;
    if (value.length > INVENTORY_LIMITS.pathBytes) return null;
    return value;
  } catch {
    return null;
  }
}

function pathCandidates(originalPath, canonicalPath) {
  const candidates = new Set();
  for (const path of [originalPath, canonicalPath]) {
    if (!path || !isAbsolute(path)) continue;
    candidates.add(path);
    if (path.startsWith("/usr/lib/")) candidates.add(`/lib/${path.slice(9)}`);
    if (path.startsWith("/lib/")) candidates.add(`/usr/lib/${path.slice(5)}`);
    if (path.startsWith("/usr/lib64/"))
      candidates.add(`/lib64/${path.slice(10)}`);
    if (path.startsWith("/lib64/"))
      candidates.add(`/usr/lib64/${path.slice(6)}`);
  }
  return [...candidates];
}

function parseOwnerLine(line, queriedPath) {
  const match = line.match(/^([^:\s]+)(?::([^:\s]+))?:\s+(.+)$/);
  if (!match) return null;
  const [, packageName, architecture, ownedPath] = match;
  return {
    package: packageName,
    architecture: architecture || null,
    packageWithArchitecture: architecture
      ? `${packageName}:${architecture}`
      : packageName,
    path: ownedPath,
    queriedPath,
  };
}

function parseOwners(output, queriedPath) {
  return output
    .split(/\r?\n/)
    .map((line) => parseOwnerLine(line.trim(), queriedPath))
    .filter((owner) => owner && owner.path === queriedPath)
    .filter(Boolean);
}

async function queryOwners(run, paths) {
  const owners = [];
  for (const path of paths) {
    try {
      const output = await invoke(run, "dpkg-query", ["-S", path]);
      owners.push(...parseOwners(output, path));
    } catch {
      // A file outside the dpkg database is an explicit unresolved result;
      // callers should still receive the rest of the inventory.
    }
  }
  const unique = new Map();
  for (const owner of owners) {
    const key = `${owner.packageWithArchitecture}\u0000${owner.path}`;
    if (!unique.has(key)) unique.set(key, owner);
  }
  return [...unique.values()];
}

function parsePackageMetadata(output, requestedPackage) {
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  if (!line) return null;
  const fields = line.includes("\t")
    ? line.split("\t")
    : line.trim().split(/\s+/);
  if (fields.length < 2) return null;
  const packageWithArchitecture = fields[0] || requestedPackage;
  const packageParts = packageWithArchitecture.match(/^([^:]+)(?::(.+))?$/);
  const packageName = packageParts?.[1] || requestedPackage.split(":", 1)[0];
  const architecture = packageParts?.[2] || fields[4] || null;
  return {
    package: packageName,
    architecture,
    packageWithArchitecture,
    version: fields[1] || null,
    sourcePackage: fields[2] || null,
    sourceVersion: fields[3] || null,
  };
}

async function queryPackageMetadata(run, owner) {
  const format =
    "${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\t${Architecture}\\n";
  try {
    const output = await invoke(run, "dpkg-query", [
      "-W",
      `-f=${format}`,
      owner.packageWithArchitecture,
    ]);
    return parsePackageMetadata(output, owner.packageWithArchitecture);
  } catch {
    return null;
  }
}

function bytesAndHash(value, path) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value)
      : typeof value === "string"
        ? Buffer.from(value)
        : null;
  if (!bytes) fail(`notice reader returned unsupported data for ${path}`);
  if (bytes.byteLength > INVENTORY_LIMITS.noticeBytes)
    fail(
      `notice exceeds the ${INVENTORY_LIMITS.noticeBytes}-byte limit: ${path}`,
    );
  return {
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function readNotice({
  packageName,
  readFile: readFileFn,
  realpath: realpathFn,
}) {
  const logicalPath = join("/usr/share/doc", packageName, "copyright");
  const canonicalPath = await maybeRealpath(realpathFn, logicalPath);
  const paths =
    canonicalPath && canonicalPath !== logicalPath
      ? [canonicalPath, logicalPath]
      : [logicalPath];
  let lastError;
  for (const path of paths) {
    try {
      const digest = bytesAndHash(await readFileFn(path), path);
      return {
        status: "resolved",
        path,
        logicalPath,
        ...digest,
      };
    } catch (error) {
      if (
        !error?.code &&
        /notice (?:reader returned unsupported data|exceeds the)/i.test(
          error instanceof Error ? error.message : String(error),
        )
      )
        throw error;
      lastError = error;
    }
  }
  return {
    status: "unresolved",
    path: canonicalPath || logicalPath,
    logicalPath,
    reason: lastError?.code === "ENOENT" ? "not-found" : "unreadable",
  };
}

function normalizeInput(input, index) {
  if (typeof input === "string")
    return { path: input, kind: index === 0 ? "binary" : "dependency" };
  if (input && typeof input === "object") {
    return {
      ...input,
      path: input.path ?? null,
      kind: input.kind || (index === 0 ? "binary" : "dependency"),
    };
  }
  return {
    path: null,
    kind: index === 0 ? "binary" : "dependency",
    reason: "invalid-path",
  };
}

/**
 * Collect package ownership, installed package metadata, and copyright hashes
 * for the supplied executable/dependency paths. `run`, `readFile`, and
 * `realpath` are injectable so tests can prove argument boundaries without
 * touching the host package database.
 * @param {Array<string | {path?: string | null, kind?: string, soname?: string | null, reason?: string, line?: string}>} paths
 * @param {{run?: (command: string, args: string[], options?: object) => Promise<string | {stdout: string}>, readFile?: (path: string) => Promise<Uint8Array | string>, realpath?: (path: string) => Promise<string>}} [options]
 */
export async function collectNativeNotices(
  paths,
  {
    run = async (command, args, options) => {
      const result = await execFile(command, args, {
        ...options,
        encoding: "utf8",
        maxBuffer: INVENTORY_LIMITS.lddBytes,
      });
      return { stdout: result.stdout };
    },
    readFile: readFileFn = (path) => readFile(path),
    realpath: realpathFn = (path) => realpath(path),
  } = {},
) {
  const inputs = paths;
  if (!Array.isArray(inputs) || inputs.length === 0)
    fail("paths must contain at least one executable or dependency path");
  if (inputs.length > INVENTORY_LIMITS.pathCount)
    fail(`paths contains more than ${INVENTORY_LIMITS.pathCount} entries`);

  const entries = [];
  const unresolvedDependencies = [];
  for (const [index, rawInput] of inputs.entries()) {
    const input = normalizeInput(rawInput, index);
    if (!input.path) {
      unresolvedDependencies.push({
        soname: input.soname || null,
        status: "unresolved",
        reason: input.reason || "missing-path",
        line: input.line || null,
      });
      continue;
    }
    if (
      !isAbsolute(input.path) ||
      input.path.length > INVENTORY_LIMITS.pathBytes
    ) {
      entries.push({
        path: input.path,
        canonicalPath: null,
        kind: input.kind,
        soname: input.soname || null,
        status: "unresolved",
        reason: !isAbsolute(input.path) ? "non-absolute-path" : "path-too-long",
        owner: null,
        notice: null,
      });
      continue;
    }
    const canonicalPath = await maybeRealpath(realpathFn, input.path);
    const entry = {
      path: input.path,
      canonicalPath,
      kind: input.kind,
      soname: input.soname || null,
      owners:
        /** @type {NonNullable<ReturnType<typeof parseOwnerLine>>[]} */ ([]),
      owner: /** @type {ReturnType<typeof parseOwnerLine>} */ (null),
      status: canonicalPath ? "observed" : "unresolved",
      reason: canonicalPath ? null : "realpath-failed",
    };
    const duplicate = entries.find(
      (existing) =>
        (entry.canonicalPath &&
          existing.canonicalPath === entry.canonicalPath) ||
        (!entry.canonicalPath && existing.path === entry.path),
    );
    if (duplicate) {
      if (entry.kind === "binary") duplicate.kind = "binary";
      if (!duplicate.soname && entry.soname) duplicate.soname = entry.soname;
    } else {
      entries.push(entry);
    }
  }

  const unresolvedOwners = [];
  for (const entry of entries) {
    if (!entry.canonicalPath && !entry.path) {
      unresolvedOwners.push({ path: entry.path, reason: "missing-path" });
      continue;
    }
    if (
      entry.reason === "non-absolute-path" ||
      entry.reason === "path-too-long"
    ) {
      unresolvedOwners.push({
        path: entry.path,
        canonicalPath: entry.canonicalPath,
        reason: entry.reason,
      });
      continue;
    }
    const owners = await queryOwners(
      run,
      pathCandidates(entry.path, entry.canonicalPath),
    );
    entry.owners = owners;
    entry.owner = owners[0] || null;
    if (!entry.owner)
      unresolvedOwners.push({
        path: entry.path,
        canonicalPath: entry.canonicalPath,
        reason: "package-owner-not-found",
      });
  }

  const ownerMap = new Map();
  for (const entry of entries) {
    for (const owner of entry.owners || []) {
      if (!ownerMap.has(owner.packageWithArchitecture))
        ownerMap.set(owner.packageWithArchitecture, owner);
    }
  }
  if (ownerMap.size > INVENTORY_LIMITS.packageCount)
    fail(
      `inventory contains more than ${INVENTORY_LIMITS.packageCount} packages`,
    );

  const packages = [];
  const unresolvedNotices = [];
  for (const owner of ownerMap.values()) {
    const metadata = await queryPackageMetadata(run, owner);
    const packageName = owner.package;
    const notice = await readNotice({
      packageName,
      readFile: readFileFn,
      realpath: realpathFn,
    });
    const record = {
      package: packageName,
      architecture: owner.architecture,
      packageWithArchitecture: owner.packageWithArchitecture,
      metadata: metadata || {
        status: "unresolved",
        reason: "package-metadata-not-found",
      },
      notice,
      ownerPath: owner.path,
    };
    packages.push(record);
    if (notice.status !== "resolved")
      unresolvedNotices.push({
        package: packageName,
        packageWithArchitecture: owner.packageWithArchitecture,
        path: notice.path,
        reason: notice.reason,
      });
  }

  const unresolved = {
    dependencies: unresolvedDependencies,
    owners: unresolvedOwners,
    notices: unresolvedNotices,
  };
  return {
    files: entries,
    records: entries,
    packages,
    unresolved,
  };
}

async function lstatIfPresent(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/** Write a new JSON manifest and refuse every existing destination. */
export async function writeManifest(outputPath, manifest) {
  checkPath(outputPath, "output path");
  const existing = await lstatIfPresent(outputPath);
  if (existing)
    fail(`output already exists and will not be overwritten: ${outputPath}`);
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  if (bytes.byteLength > INVENTORY_LIMITS.manifestBytes)
    fail(`manifest exceeds the ${INVENTORY_LIMITS.manifestBytes}-byte limit`);
  let handle;
  let created = false;
  try {
    handle = await open(outputPath, "wx", 0o644);
    created = true;
    await handle.writeFile(bytes);
  } catch (error) {
    try {
      if (handle) await handle.close();
    } finally {
      // Only remove the file created by this invocation. A concurrent writer
      // remains protected by wx and is never overwritten.
      if (created) await unlink(outputPath).catch(() => undefined);
    }
    throw error;
  }
  await handle.close();
  return outputPath;
}

async function assertNewOutput(outputPath) {
  const existing = await lstatIfPresent(outputPath);
  if (existing)
    fail(`output already exists and will not be overwritten: ${outputPath}`);
}

function parseArgs(argv) {
  let binary = null;
  let output = null;
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--binary" || arg === "-b") binary = argv[++index];
    else if (arg === "--output" || arg === "-o") output = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/inventory-native-notices.mjs --binary /absolute/path/to/blender --output /absolute/path/manifest.json",
      );
      process.exit(0);
    } else if (arg.startsWith("-")) fail(`unknown option: ${arg}`);
    else positional.push(arg);
  }
  binary ||= positional[0];
  output ||= positional[1];
  if (!binary || !output)
    fail("explicit --binary and --output paths are required");
  checkPath(binary, "binary path");
  checkPath(resolve(output), "output path");
  return { binary, output: resolve(output) };
}

export async function main(argv = process.argv.slice(2)) {
  const { binary, output } = parseArgs(argv);
  await assertNewOutput(output);
  // This is the sole ELF inspection call. Dependency paths from its output
  // are parsed and queried; ldd is never recursively invoked on them.
  const lddOutput = await invoke(
    (command, args, options) =>
      execFile(command, args, {
        encoding: "utf8",
        maxBuffer: INVENTORY_LIMITS.lddBytes,
        ...options,
      }),
    "ldd",
    [binary],
  );
  const dependencies = parseLdd(lddOutput);
  const collected = await collectNativeNotices([
    { path: binary, kind: "binary", soname: binary },
    ...dependencies.map((dependency) => ({
      ...dependency,
      kind: "dependency",
    })),
  ]);
  const binaryRecord = collected.files.find((entry) => entry.kind === "binary");
  const manifest = {
    schema: NATIVE_INVENTORY_SCHEMA,
    systemInventoryOnly: true,
    releaseCertified: false,
    provenance: "observed-installed-system",
    portability: "unverified",
    legalCompleteness: "unverified",
    downloads: 0,
    networkRequests: 0,
    providerCalls: 0,
    binary: {
      path: binary,
      canonicalPath: binaryRecord?.canonicalPath || null,
    },
    ldd: dependencies,
    ...collected,
    generatedAt: new Date().toISOString(),
  };
  await writeManifest(output, manifest);
  console.log(
    JSON.stringify({ status: "ok", output, systemInventoryOnly: true }),
  );
  return manifest;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
