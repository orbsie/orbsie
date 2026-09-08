import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  readSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const OFFICIAL_RELEASE_ARCHIVES: Record<string, string> = {
  "4.0.2": "5583a5588736da8858c522ef17fff5d73be59c47a6fe91ad29c6f3263e22086a",
};

export const BLENDER_RUNTIME_ENV = "ORBSIE_BLENDER_RUNTIME_DIR";
export const BLENDER_RUNTIME_MOUNT = "/opt/orbsie-blender-runtime";

type RuntimeManifest = {
  schema?: unknown;
  status?: unknown;
  source?: {
    kind?: unknown;
    blenderVersion?: unknown;
    archive?: {
      downloaded?: unknown;
      sha256?: unknown;
      pinnedSha256?: unknown;
    };
  };
  layout?: {
    executable?: unknown;
    resources?: unknown;
  };
  sourceStats?: {
    blenderExecutable?: { sha256?: unknown };
  };
  verification?: {
    status?: unknown;
    blenderVersion?: unknown;
    glb?: { bytes?: unknown };
  };
  integrity?: unknown;
};

export type BlenderRuntime = {
  kind: "system" | "packaged";
  blenderPath: string;
  numpyPath: string;
  numpySite: string;
  version?: string;
  root?: string;
  resourcePath?: string;
  pythonSite?: string;
  pythonVersion?: string;
};

function fail(message: string): never {
  throw new Error(`[blender-runtime] ${message}`);
}

function fileSha256(path: string) {
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

function stableCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isContained(root: string, candidate: string) {
  const relativePath = relative(root, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && relativePath !== "..")
  );
}

type TreeIntegrityEntry =
  | { path: string; kind: "directory"; mode: number }
  | {
      path: string;
      kind: "file";
      mode: number;
      bytes: number;
      sha256: string;
    }
  | { path: string; kind: "symlink"; mode: number; target: string };

type TreeIntegrityManifest = {
  schema?: unknown;
  excluded?: unknown;
  entryCount?: unknown;
  treeSha256?: unknown;
  entries?: unknown;
};

function actualTreeEntries(root: string, excluded: Set<string>) {
  const entries: TreeIntegrityEntry[] = [];
  const visit = (current: string) => {
    const children = readdirSync(current, { withFileTypes: true }).sort(
      (a, b) => stableCompare(a.name, b.name),
    );
    for (const child of children) {
      const path = join(current, child.name);
      const entryPath = relative(root, path).replaceAll("\\", "/");
      if (excluded.has(entryPath)) continue;
      const info = lstatSync(path);
      const mode = info.mode & 0o7777;
      if (info.isSymbolicLink()) {
        const target = readlinkSync(path);
        if (!isContained(root, resolve(dirname(path), target)))
          fail(`packaged runtime symlink escapes its package: ${entryPath}`);
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
          sha256: fileSha256(path),
        });
      } else {
        fail(`unsupported packaged runtime entry type: ${path}`);
      }
    }
  };
  visit(root);
  entries.sort((a, b) => stableCompare(a.path, b.path));
  return entries;
}

function validTreeEntry(value: unknown): TreeIntegrityEntry {
  if (!value || typeof value !== "object")
    fail("packaged runtime tree integrity entry is invalid");
  const entry = value as Record<string, unknown>;
  const path = entry.path;
  const kind = entry.kind;
  const mode = entry.mode;
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.split("/").includes("..") ||
    path.includes("\\") ||
    typeof kind !== "string" ||
    !Number.isSafeInteger(mode) ||
    (mode as number) < 0
  )
    fail(
      "packaged runtime tree integrity entry has invalid path, kind or mode",
    );
  if (kind === "directory") return { path, kind, mode: mode as number };
  if (kind === "file") {
    if (
      !Number.isSafeInteger(entry.bytes) ||
      (entry.bytes as number) < 0 ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      fail(`packaged runtime file integrity entry is invalid: ${path}`);
    return {
      path,
      kind,
      mode: mode as number,
      bytes: entry.bytes as number,
      sha256: entry.sha256,
    };
  }
  if (kind === "symlink" && typeof entry.target === "string")
    return { path, kind, mode: mode as number, target: entry.target };
  fail(`packaged runtime integrity entry has unsupported kind: ${path}`);
}

/** Verify a complete package tree against the versioned manifest section. */
export function verifyTreeIntegrity(
  root: string,
  value: unknown,
): TreeIntegrityEntry[] {
  if (!value || typeof value !== "object")
    fail(
      "packaged runtime manifest has no tree integrity section; regenerate it",
    );
  const manifest = value as TreeIntegrityManifest;
  if (manifest.schema !== "orbsie.blender-runtime/tree-integrity/v1")
    fail(
      "packaged runtime tree integrity schema is unsupported; regenerate it",
    );
  if (
    !Array.isArray(manifest.excluded) ||
    manifest.excluded.length !== 1 ||
    manifest.excluded[0] !== "manifest.json"
  )
    fail("packaged runtime tree integrity exclusion set is invalid");
  if (!Array.isArray(manifest.entries))
    fail("packaged runtime tree integrity entries are missing");
  const expected = manifest.entries.map(validTreeEntry);
  if (
    manifest.entryCount !== expected.length ||
    !Number.isSafeInteger(manifest.entryCount)
  )
    fail("packaged runtime tree integrity entry count is invalid");
  const paths = new Set<string>();
  for (const entry of expected) {
    if (paths.has(entry.path))
      fail(
        `packaged runtime tree integrity contains duplicate path: ${entry.path}`,
      );
    paths.add(entry.path);
  }
  const expectedCanonical = JSON.stringify(expected);
  if (
    typeof manifest.treeSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.treeSha256) ||
    createHash("sha256").update(expectedCanonical).digest("hex") !==
      manifest.treeSha256
  )
    fail("packaged runtime tree integrity manifest digest is invalid");
  const actual = actualTreeEntries(root, new Set(["manifest.json"]));
  if (JSON.stringify(actual) !== expectedCanonical) {
    const actualByPath = new Map(actual.map((entry) => [entry.path, entry]));
    for (const entry of expected) {
      const actualEntry = actualByPath.get(entry.path);
      if (!actualEntry)
        fail(`packaged runtime entry is missing: ${entry.path}`);
      if (JSON.stringify(actualEntry) !== JSON.stringify(entry))
        fail(`packaged runtime entry changed: ${entry.path}`);
    }
    const expectedByPath = new Set(expected.map((entry) => entry.path));
    const unexpected = actual.find((entry) => !expectedByPath.has(entry.path));
    fail(
      `packaged runtime has an unexpected entry: ${unexpected?.path || "unknown"}`,
    );
  }
  return actual;
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    fail(`runtime manifest has no ${label}`);
  return value;
}

function relativeRuntimePath(root: string, value: unknown, label: string) {
  const path = stringField(value, label);
  if (path.startsWith("/") || path.split(/[\\/]/).includes(".."))
    fail(`runtime manifest ${label} must be a relative path`);
  const resolved = resolve(root, path);
  const relativePath = relative(root, resolved);
  if (relativePath.startsWith("..") || relativePath === "..")
    fail(`runtime manifest ${label} escapes its package`);
  return resolved;
}

function requireRegularFile(path: string, label: string) {
  if (!existsSync(path) || !lstatSync(path).isFile())
    fail(`${label} is not a regular file: ${path}`);
  return path;
}

function requireDirectory(path: string, label: string) {
  if (!existsSync(path) || !statSync(path).isDirectory())
    fail(`${label} is not a directory: ${path}`);
  return path;
}

function findBundledPython(root: string, resources: string) {
  const pythonLib = join(resources, "python", "lib");
  requireDirectory(pythonLib, "bundled Blender Python library");
  const candidates = readdirSync(pythonLib, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && /^python\d+\.\d+$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  if (candidates.length !== 1)
    fail(
      `expected exactly one bundled Python version, found ${candidates.join(", ") || "none"}`,
    );
  const pythonVersion = candidates[0];
  const pythonSite = join(pythonLib, pythonVersion, "site-packages");
  requireDirectory(pythonSite, "bundled Blender Python site-packages");
  requireDirectory(join(pythonSite, "numpy"), "bundled NumPy");
  return { pythonSite, pythonVersion };
}

/**
 * Resolve the local Blender runtime used by the trusted modeling runner.
 *
 * With no runtime directory this preserves the existing Debian development
 * install path. Setting ORBSIE_BLENDER_RUNTIME_DIR opts into a packaged
 * runtime only when its package manifest, release provenance, executable
 * digest, bundled Python, NumPy and GPL notice all validate.
 */
export function resolveBlenderRuntime(): BlenderRuntime {
  const runtimeDir = process.env[BLENDER_RUNTIME_ENV];
  if (!runtimeDir) {
    const blenderPath = process.env.ORBSIE_BLENDER_PATH || "/usr/bin/blender";
    const numpyPath =
      process.env.ORBSIE_BLENDER_NUMPY_PATH ||
      join(
        process.env.HOME || "/home/probe",
        ".local/lib/python3.12/site-packages/numpy",
      );
    const numpySite = dirname(numpyPath);
    requireRegularFile(blenderPath, "Blender executable");
    requireDirectory(numpyPath, "system NumPy package");
    return { kind: "system", blenderPath, numpyPath, numpySite };
  }

  const configuredRoot = resolve(runtimeDir);
  if (!existsSync(configuredRoot))
    fail(
      `configured packaged Blender runtime was not found: ${configuredRoot}`,
    );
  const root = realpathSync(configuredRoot);
  requireDirectory(root, "packaged Blender runtime");
  const manifestPath = requireRegularFile(
    join(root, "manifest.json"),
    "packaged runtime manifest",
  );
  let manifest: RuntimeManifest;
  try {
    manifest = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as RuntimeManifest;
  } catch (error) {
    fail(
      `packaged runtime manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (manifest.schema !== "orbsie.blender-runtime/v1")
    fail("packaged runtime manifest schema is unsupported");
  if (manifest.status !== "official-release-tarball-prototype")
    fail("packaged runtime is not an official release prototype");
  if (manifest.source?.kind !== "official-release-tarball")
    fail("packaged runtime has no official release provenance");
  const version = stringField(
    manifest.source.blenderVersion,
    "Blender version",
  );
  const archiveSha = stringField(
    manifest.source.archive?.sha256,
    "official archive SHA-256",
  );
  const pinnedSha = stringField(
    manifest.source.archive?.pinnedSha256,
    "pinned official archive SHA-256",
  );
  if (
    manifest.source.archive?.downloaded !== true ||
    !/^[a-f0-9]{64}$/.test(archiveSha) ||
    archiveSha !== pinnedSha
  )
    fail("packaged runtime archive provenance is not verified");
  const knownArchiveSha = OFFICIAL_RELEASE_ARCHIVES[version];
  if (!knownArchiveSha)
    fail(`Blender ${version} is not an explicitly pinned official runtime`);
  if (archiveSha !== knownArchiveSha)
    fail(
      `official Blender ${version} archive digest does not match the pinned release`,
    );
  verifyTreeIntegrity(root, manifest.integrity);

  const blenderPath = relativeRuntimePath(
    root,
    manifest.layout?.executable,
    "executable",
  );
  requireRegularFile(blenderPath, "packaged Blender executable");
  if ((statSync(blenderPath).mode & 0o111) === 0)
    fail("packaged Blender executable is not executable");
  const expectedExecutableSha = stringField(
    manifest.sourceStats?.blenderExecutable?.sha256,
    "executable SHA-256",
  );
  if (!/^[a-f0-9]{64}$/.test(expectedExecutableSha))
    fail("packaged executable SHA-256 is malformed");
  if (fileSha256(blenderPath) !== expectedExecutableSha)
    fail("packaged Blender executable failed the manifest SHA-256 check");

  const resources = relativeRuntimePath(
    root,
    manifest.layout?.resources,
    "resources",
  );
  requireDirectory(resources, "packaged Blender resources");
  requireDirectory(join(resources, "datafiles"), "packaged Blender datafiles");
  requireDirectory(join(resources, "scripts"), "packaged Blender scripts");
  const { pythonSite, pythonVersion } = findBundledPython(root, resources);
  requireRegularFile(
    join(root, "licenses/blender/license/GPL-license.txt"),
    "Blender GPL notice",
  );
  if (manifest.verification?.status !== "passed")
    fail("packaged runtime has no passed clean-environment verification");
  if (manifest.verification.blenderVersion !== version)
    fail("packaged runtime verification version does not match its manifest");
  if (
    typeof manifest.verification.glb?.bytes !== "number" ||
    manifest.verification.glb.bytes <= 0 ||
    manifest.verification.glb.bytes > 2 * 1024 * 1024
  )
    fail("packaged runtime verification GLB size is invalid");

  return {
    kind: "packaged",
    blenderPath,
    numpyPath: join(pythonSite, "numpy"),
    numpySite: pythonSite,
    root,
    resourcePath: resources,
    pythonSite,
    pythonVersion,
    version,
  };
}
