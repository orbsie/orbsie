#!/usr/bin/env node

/**
 * Copy the Python release notices that are absent from Blender's official
 * runtime archive. This is a local packaging step: it never downloads from
 * the recorded PyPI URLs. The checked-in manifest and notice bytes are
 * verified before anything is copied into a bundle.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const NOTICES_RELATIVE_ROOT = "third_party/blender-python-notices";
const OUTPUT_RELATIVE_ROOT = "licenses/python";
const SOURCE_SCHEMA = "orbsie.blender-python-notices/v1";

function fail(message) {
  throw new Error(`[blender-python-notices] ${message}`);
}

function stableCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isContained(root, candidate) {
  const relativePath = relative(resolve(root), resolve(candidate));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("../") &&
      relativePath !== ".." &&
      !relativePath.startsWith("..\\"))
  );
}

function assertContained(root, candidate, label) {
  if (!isContained(root, candidate))
    fail(`${label} escapes its allowed root: ${candidate}`);
  return candidate;
}

function requireDirectory(path, label) {
  if (!existsSync(path) || !lstatSync(path).isDirectory())
    fail(`${label} is not a directory: ${path}`);
  return path;
}

function lstatIfExists(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function ensureDirectoryNoSymlink(path, label) {
  const status = lstatIfExists(path);
  if (status?.isSymbolicLink()) fail(`${label} must not be a symlink: ${path}`);
  if (status && !status.isDirectory())
    fail(`${label} is not a directory: ${path}`);
  if (!status) mkdirSync(path, { mode: 0o755 });
  return path;
}

function requireRegularFile(path, label) {
  if (!existsSync(path) || !lstatSync(path).isFile())
    fail(`${label} is not a regular file: ${path}`);
  return path;
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

function stringField(value, label) {
  if (typeof value !== "string" || value.length === 0)
    fail(`notice manifest has no ${label}`);
  return value;
}

function relativeNoticePath(noticesRoot, value, label) {
  const path = stringField(value, label).replaceAll("\\", "/");
  if (
    path.startsWith("/") ||
    path.split("/").includes("..") ||
    path.split("/").includes("")
  )
    fail(`notice ${label} is not a safe relative path: ${path}`);
  const resolved = resolve(noticesRoot, path);
  assertContained(noticesRoot, resolved, `notice ${label}`);
  return resolved;
}

function assertHttpsHost(value, label, host, prefix) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} is not a valid HTTPS URL: ${value}`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== host ||
    (prefix && !parsed.pathname.startsWith(prefix))
  )
    fail(`${label} is outside the allowed HTTPS host: ${value}`);
}

function normalizePythonName(value) {
  return value.toLowerCase().replaceAll(/[-_.]+/g, "-");
}

function readMetadata(path) {
  const contents = readFileSync(path, "utf8");
  const name = contents.match(/^Name:\s*(.+)$/m)?.[1]?.trim();
  const version = contents.match(/^Version:\s*(.+)$/m)?.[1]?.trim();
  if (!name || !version)
    fail(`Python package metadata has no Name/Version: ${path}`);
  return { name, version, path };
}

function findPythonSite(bundle) {
  const pythonLib = requireDirectory(
    join(bundle, "share/blender/python/lib"),
    "bundled Blender Python library",
  );
  const versions = readdirSync(pythonLib, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && /^python\d+\.\d+$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort(stableCompare);
  if (versions.length !== 1)
    fail(
      `expected one bundled Python version, found ${versions.join(", ") || "none"}`,
    );
  return requireDirectory(
    join(pythonLib, versions[0], "site-packages"),
    "bundled Python site-packages",
  );
}

function findPackageMetadata(site, packageName) {
  const normalized = normalizePythonName(packageName);
  const matches = [];
  for (const entry of readdirSync(site, { withFileTypes: true }).sort((a, b) =>
    stableCompare(a.name, b.name),
  )) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.endsWith(".dist-info") && !entry.name.endsWith(".egg-info"))
      continue;
    const filename = entry.name.endsWith(".dist-info")
      ? "METADATA"
      : "PKG-INFO";
    const path = join(site, entry.name, filename);
    if (!existsSync(path) || !lstatSync(path).isFile()) continue;
    const metadata = readMetadata(path);
    if (normalizePythonName(metadata.name) === normalized)
      matches.push(metadata);
  }
  if (matches.length !== 1)
    fail(
      `expected one metadata record for ${packageName}, found ${matches.length}`,
    );
  return matches[0];
}

function validateManifest(root) {
  const noticesRoot = requireDirectory(
    join(root, NOTICES_RELATIVE_ROOT),
    "checked-in Python notices",
  );
  const canonicalNoticesRoot = realpathSync(noticesRoot);
  const manifestPath = requireRegularFile(
    join(noticesRoot, "manifest.json"),
    "Python notice manifest",
  );
  let entries;
  try {
    entries = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(
      `Python notice manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(entries) || entries.length === 0)
    fail("Python notice manifest must contain at least one package");
  const names = new Set();
  const validated = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object")
      fail("Python notice manifest contains an invalid package record");
    const name = stringField(entry.name, "package name");
    const version = stringField(entry.version, `version for ${name}`);
    const metadataURL = stringField(
      entry.metadataURL,
      `metadata URL for ${name}`,
    );
    const archiveURL = stringField(entry.archiveURL, `archive URL for ${name}`);
    const archiveSha256 = stringField(
      entry.archiveSha256,
      `archive SHA-256 for ${name}`,
    );
    assertHttpsHost(
      metadataURL,
      `metadata URL for ${name}`,
      "pypi.org",
      "/pypi/",
    );
    assertHttpsHost(
      archiveURL,
      `archive URL for ${name}`,
      "files.pythonhosted.org",
      "/",
    );
    if (!/^[a-f0-9]{64}$/.test(archiveSha256))
      fail(`archive SHA-256 for ${name} is malformed`);
    const packageKey = normalizePythonName(name);
    if (names.has(packageKey)) fail(`duplicate Python package: ${name}`);
    names.add(packageKey);
    if (!Array.isArray(entry.notices) || entry.notices.length === 0)
      fail(`Python package has no notices: ${name}`);
    const notices = entry.notices.map((notice) => {
      if (!notice || typeof notice !== "object")
        fail(`invalid notice record for ${name}`);
      const sourcePath = relativeNoticePath(
        noticesRoot,
        notice.path,
        `path for ${name}`,
      );
      const archivePath = stringField(
        notice.archivePath,
        `archive path for ${name}`,
      ).replaceAll("\\", "/");
      if (
        archivePath.startsWith("/") ||
        archivePath.split("/").includes("..") ||
        archivePath.split("/").includes("")
      )
        fail(`archive path for ${name} is unsafe: ${archivePath}`);
      const expectedSha256 = stringField(
        notice.sha256,
        `SHA-256 for ${name}/${basename(sourcePath)}`,
      );
      if (!/^[a-f0-9]{64}$/.test(expectedSha256))
        fail(`notice SHA-256 for ${name} is malformed`);
      requireRegularFile(sourcePath, `notice source for ${name}`);
      const canonicalSourcePath = realpathSync(sourcePath);
      assertContained(
        canonicalNoticesRoot,
        canonicalSourcePath,
        `notice source for ${name}`,
      );
      const actualSha256 = sha256(canonicalSourcePath);
      if (actualSha256 !== expectedSha256)
        fail(`notice bytes changed for ${name}/${basename(sourcePath)}`);
      return {
        archivePath,
        sourcePath: canonicalSourcePath,
        sourceRelativePath: relative(noticesRoot, sourcePath).replaceAll(
          "\\",
          "/",
        ),
        filename: basename(sourcePath),
        sha256: actualSha256,
      };
    });
    validated.push({
      name,
      version,
      metadataURL,
      archiveURL,
      archiveSha256,
      notices,
    });
  }
  return {
    noticesRoot: canonicalNoticesRoot,
    manifestPath,
    packages: validated,
  };
}

/**
 * Copy verified Python notices into a Blender bundle and write their
 * provenance manifest. The returned records are suitable for the parent
 * Blender package manifest.
 */
export function copyPythonNotices(root, bundle) {
  const canonicalRoot = realpathSync(resolve(root));
  const canonicalBundle = realpathSync(resolve(bundle));
  requireDirectory(canonicalBundle, "Blender bundle");
  const { manifestPath, packages } = validateManifest(canonicalRoot);
  const site = findPythonSite(canonicalBundle);
  const packageMetadata = packages.map((packageEntry) => {
    const metadata = findPackageMetadata(site, packageEntry.name);
    if (metadata.version !== packageEntry.version)
      fail(
        `bundled ${packageEntry.name} version ${metadata.version} does not match notice ${packageEntry.version}`,
      );
    return { packageEntry, metadata };
  });
  const licensesRoot = ensureDirectoryNoSymlink(
    join(canonicalBundle, dirname(OUTPUT_RELATIVE_ROOT)),
    "bundle licenses directory",
  );
  const outputRoot = ensureDirectoryNoSymlink(
    join(licensesRoot, basename(OUTPUT_RELATIVE_ROOT)),
    "Python notice output directory",
  );
  const records = [];
  const destinationPaths = new Set();
  for (const { packageEntry, metadata } of packageMetadata) {
    const safeDirectory = `${packageEntry.name}-${packageEntry.version}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(safeDirectory))
      fail(`unsafe output directory for ${packageEntry.name}`);
    const packageOutput = join(outputRoot, safeDirectory);
    assertContained(outputRoot, packageOutput, "Python notice output");
    ensureDirectoryNoSymlink(packageOutput, "Python notice package output");
    for (const notice of packageEntry.notices) {
      const destination = join(packageOutput, notice.filename);
      assertContained(packageOutput, destination, "Python notice destination");
      if (destinationPaths.has(destination))
        fail(`duplicate Python notice destination: ${destination}`);
      destinationPaths.add(destination);
      const destinationStatus = lstatIfExists(destination);
      if (destinationStatus?.isSymbolicLink())
        fail(`Python notice destination must not be a symlink: ${destination}`);
      if (destinationStatus) {
        requireRegularFile(destination, "existing Python notice destination");
        if (sha256(destination) !== notice.sha256)
          fail(`existing Python notice differs: ${destination}`);
      } else {
        cpSync(notice.sourcePath, destination, { dereference: true });
      }
      if (sha256(destination) !== notice.sha256)
        fail(`copied Python notice failed verification: ${destination}`);
      records.push({
        name: packageEntry.name,
        version: packageEntry.version,
        metadataURL: packageEntry.metadataURL,
        archiveURL: packageEntry.archiveURL,
        archiveSha256: packageEntry.archiveSha256,
        archivePath: notice.archivePath,
        source: `${NOTICES_RELATIVE_ROOT}/${notice.sourceRelativePath}`,
        bundled: relative(canonicalBundle, destination).replaceAll("\\", "/"),
        sha256: notice.sha256,
        metadata: {
          name: metadata.name,
          version: metadata.version,
          path: relative(canonicalBundle, metadata.path).replaceAll("\\", "/"),
        },
      });
    }
  }
  records.sort((left, right) => stableCompare(left.bundled, right.bundled));
  const outputManifest = {
    schema: SOURCE_SCHEMA,
    sourceManifest: `${NOTICES_RELATIVE_ROOT}/manifest.json`,
    sourceManifestSha256: sha256(manifestPath),
    pythonSite: relative(canonicalBundle, site).replaceAll("\\", "/"),
    records,
  };
  const outputManifestPath = join(outputRoot, "manifest.json");
  const outputManifestStatus = lstatIfExists(outputManifestPath);
  if (outputManifestStatus?.isSymbolicLink())
    fail(
      `Python notice output manifest must not be a symlink: ${outputManifestPath}`,
    );
  if (outputManifestStatus && !outputManifestStatus.isFile())
    fail(
      `Python notice output manifest is not a regular file: ${outputManifestPath}`,
    );
  writeFileSync(
    outputManifestPath,
    `${JSON.stringify(outputManifest, null, 2)}\n`,
    {
      mode: 0o644,
    },
  );
  return records;
}
