#!/usr/bin/env node

/**
 * Assemble the already-built modeling application beside a verified Blender
 * runtime. This is intentionally an offline delivery gate: it never builds
 * the application, downloads a runtime, contacts a provider, or overwrites an
 * existing destination.
 */

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  NODE_RUNTIME_PROVENANCE,
  PINNED_NODE_ARCHITECTURE,
  PINNED_NODE_LICENSE_SHA256,
  PINNED_NODE_PLATFORM,
  PINNED_NODE_SHA256,
  PINNED_NODE_VERSION,
  packageNodeRuntime,
} from "./node-runtime-package.mjs";

const execFile = promisify(execFileCallback);

const APPLICATION_FILES = Object.freeze([
  "README.txt",
  "blender-modeling.py",
  "companion.mjs",
  "licenses/Orbsie-LICENSE",
  "licenses/Zod-LICENSE",
  "node/LICENSE",
  "node/bin/node",
  "orbsie-builder",
  "package.json",
]);
const APPLICATION_DIRECTORIES = Object.freeze(["licenses", "node", "node/bin"]);
const DISTRIBUTION_MANIFEST = "manifest.json";
const TREE_SCHEMA = "orbsie.modeling-distribution/tree-integrity/v1";

function fail(message) {
  throw new Error(`[assemble-modeling-distribution] ${message}`);
}

function isContained(root, candidate) {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith("..") && path !== "..");
}

async function requiredLstat(path, label) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") fail(`${label} was not found: ${path}`);
    throw error;
  }
  return info;
}

async function requireRealDirectory(path, label) {
  const info = await requiredLstat(path, label);
  if (!info.isDirectory() || info.isSymbolicLink())
    fail(`${label} must be a real directory, not a symlink: ${path}`);
  return { path: resolve(path), canonical: await realpath(path) };
}

async function requireRegularFile(path, label) {
  const info = await requiredLstat(path, label);
  if (!info.isFile() || info.isSymbolicLink())
    fail(`${label} must be a regular file and must not be a symlink: ${path}`);
  return info;
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

/** Resolve an output path through existing parent symlinks without creating it. */
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
    fail(`output already exists and will not be overwritten: ${resolve(path)}`);
  return {
    path: resolve(path),
    canonical: await canonicalPotentialPath(path),
  };
}

function assertRootsDoNotOverlap(output, application, runtime) {
  const pairs = [
    ["output", output.canonical, "application", application.canonical],
    ["output", output.canonical, "runtime", runtime.canonical],
    ["application", application.canonical, "runtime", runtime.canonical],
  ];
  for (const [leftLabel, left, rightLabel, right] of pairs) {
    if (isContained(left, right) || isContained(right, left))
      fail(
        `${leftLabel}, ${rightLabel}, and their canonical paths must not overlap: ${left} and ${right}`,
      );
  }
}

async function directoryEntries(path) {
  return (await readdir(path, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

async function assertApplicationPackage(root) {
  const expectedFiles = new Set(APPLICATION_FILES);
  const expectedDirectories = new Set(APPLICATION_DIRECTORIES);
  const actualFiles = [];
  const actualDirectories = [];

  async function visit(current, prefix) {
    for (const entry of await directoryEntries(current)) {
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(current, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink())
        fail(`application package symlink is not allowed: ${entryPath}`);
      if (info.isDirectory()) {
        actualDirectories.push(entryPath);
        await visit(path, entryPath);
      } else if (info.isFile()) {
        actualFiles.push(entryPath);
      } else {
        fail(`application package contains a special file: ${entryPath}`);
      }
    }
  }
  await visit(root.path, "");

  const actualFileSet = new Set(actualFiles);
  const actualDirectorySet = new Set(actualDirectories);
  const unexpectedFiles = actualFiles.filter(
    (path) => !expectedFiles.has(path),
  );
  const unexpectedDirectories = actualDirectories.filter(
    (path) => !expectedDirectories.has(path),
  );
  const missingFiles = APPLICATION_FILES.filter(
    (path) => !actualFileSet.has(path),
  );
  const missingDirectories = APPLICATION_DIRECTORIES.filter(
    (path) => !actualDirectorySet.has(path),
  );
  if (unexpectedFiles.length || unexpectedDirectories.length)
    fail(
      `application package has unexpected payload paths: ${[
        ...unexpectedDirectories,
        ...unexpectedFiles,
      ].join(", ")}`,
    );
  if (missingFiles.length || missingDirectories.length)
    fail(
      `application package is missing required payload paths: ${[
        ...missingDirectories,
        ...missingFiles,
      ].join(", ")}`,
    );

  for (const path of APPLICATION_FILES)
    await requireRegularFile(join(root.path, path), `application ${path}`);
  if (((await lstat(join(root.path, "orbsie-builder"))).mode & 0o111) === 0)
    fail("application orbsie-builder must be executable");

  // packageNodeRuntime performs the pinned byte and version checks. These
  // checks make the selected app contract explicit before any destination is
  // created, including when a caller supplied a hand-assembled application.
  const packageMetadata = JSON.parse(
    await readFile(join(root.path, "package.json"), "utf8"),
  );
  if (packageMetadata?.nodeIncluded !== true)
    fail("application package metadata must declare nodeIncluded=true");
  return {
    files: [...APPLICATION_FILES],
    nodeRoot: join(root.path, "node"),
  };
}

export async function validateRuntimeTree(root) {
  async function visit(current) {
    for (const entry of await directoryEntries(current)) {
      const path = join(current, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        const target = await readlink(path);
        const lexicalTarget = resolve(dirname(path), target);
        if (!isContained(root.path, lexicalTarget))
          fail(
            `runtime symlink escapes its package: ${relative(root.path, path)}`,
          );
        let resolvedTarget;
        try {
          resolvedTarget = await realpath(path);
        } catch (error) {
          fail(
            `runtime symlink is dangling or cyclic: ${relative(root.path, path)} (${error instanceof Error ? error.message : String(error)})`,
          );
        }
        if (!isContained(root.canonical, resolvedTarget))
          fail(
            `runtime symlink escapes its package: ${relative(root.path, path)}`,
          );
        const canonicalLinkPath = join(
          await realpath(dirname(path)),
          basename(path),
        );
        if (
          (await lstat(resolvedTarget)).isDirectory() &&
          isContained(resolvedTarget, canonicalLinkPath)
        )
          fail(
            `runtime symlink creates an ancestor cycle: ${relative(root.path, path)}`,
          );
        if (target.startsWith("/"))
          fail(
            `runtime symlink must be relocatable and relative: ${relative(root.path, path)}`,
          );
        continue;
      }
      if (info.isDirectory()) await visit(path);
      else if (!info.isFile())
        fail(`runtime contains a special file: ${relative(root.path, path)}`);
    }
  }
  await visit(root.path);
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function copyRegular(source, destination, mode) {
  await copyFile(source, destination);
  await chmod(destination, mode & 0o7777);
}

export async function copyApplicationTree(sourceRoot, destinationRoot) {
  async function copyEntry(source, destination) {
    const info = await lstat(source);
    if (info.isSymbolicLink())
      fail(`application package symlink is not allowed: ${source}`);
    if (info.isDirectory()) {
      // Keep the destination writable while descendants are copied. A source
      // directory may intentionally be read-only (for example, 0555).
      await mkdir(destination, { mode: 0o700 });
      for (const entry of await directoryEntries(source))
        await copyEntry(
          join(source, entry.name),
          join(destination, entry.name),
        );
      await chmod(destination, info.mode & 0o7777);
      return;
    }
    if (!info.isFile()) fail(`application contains a special file: ${source}`);
    await copyRegular(source, destination, info.mode);
  }

  for (const entry of await directoryEntries(sourceRoot)) {
    if (entry.name === "node") continue;
    await copyEntry(
      join(sourceRoot, entry.name),
      join(destinationRoot, entry.name),
    );
  }
}

export async function copyRuntimeTree(sourceRoot, destinationRoot) {
  async function copyEntry(source, destination) {
    const info = await lstat(source);
    if (info.isSymbolicLink()) {
      const target = await readlink(source);
      await symlink(target, destination);
      return;
    }
    if (info.isDirectory()) {
      // Keep the destination writable while descendants are copied. A source
      // directory may intentionally be read-only (for example, 0555).
      await mkdir(destination, { mode: 0o700 });
      for (const entry of await directoryEntries(source))
        await copyEntry(
          join(source, entry.name),
          join(destination, entry.name),
        );
      await chmod(destination, info.mode & 0o7777);
      return;
    }
    if (!info.isFile()) fail(`runtime contains a special file: ${source}`);
    await copyRegular(source, destination, info.mode);
  }

  const sourceInfo = await lstat(sourceRoot);
  await mkdir(destinationRoot, { mode: 0o700 });
  for (const entry of await directoryEntries(sourceRoot))
    await copyEntry(
      join(sourceRoot, entry.name),
      join(destinationRoot, entry.name),
    );
  await chmod(destinationRoot, sourceInfo.mode & 0o7777);
}

/**
 * Remove only a newly-created, owner-owned output tree. Read-only copied
 * directories are made writable before removal; symlinks are never followed.
 */
export async function removeCreatedOutput(outputRoot) {
  let rootInfo;
  try {
    rootInfo = await lstat(outputRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return;
  if (typeof process.getuid === "function" && rootInfo.uid !== process.getuid())
    return;

  async function makeWritable(path) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) return;
    await chmod(path, (info.mode & 0o7777) | 0o700);
    for (const entry of await directoryEntries(path))
      await makeWritable(join(path, entry.name));
  }

  await makeWritable(outputRoot);
  await rm(outputRoot, { recursive: true, force: true });
}

export async function buildTreeIntegrity(root, prefix = "") {
  const entries = [];
  const canonicalRoot = await realpath(root);
  async function visit(current) {
    for (const entry of await directoryEntries(current)) {
      const path = join(current, entry.name);
      const entryPath = `${prefix}${relative(root, path).replaceAll("\\", "/")}`;
      const info = await lstat(path);
      const mode = info.mode & 0o7777;
      if (info.isSymbolicLink()) {
        const target = await readlink(path);
        if (!isContained(root, resolve(dirname(path), target)))
          fail(`copied runtime symlink escapes its package: ${entryPath}`);
        if (!isContained(canonicalRoot, await realpath(path)))
          fail(`copied runtime symlink escapes its package: ${entryPath}`);
        entries.push({ path: entryPath, kind: "symlink", mode, target });
      } else if (info.isDirectory()) {
        entries.push({ path: entryPath, kind: "directory", mode });
        await visit(path);
      } else if (info.isFile()) {
        entries.push({
          path: entryPath,
          kind: "file",
          mode,
          bytes: info.size,
          sha256: await sha256(path),
        });
      } else {
        fail(`copied distribution contains a special file: ${entryPath}`);
      }
    }
  }
  await visit(root);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

function integrityDigest(entries) {
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

/** Compose the expected top-level tree before the distribution manifest exists. */
export function composeDistributionIntegrityEntries(
  applicationEntries,
  runtimeEntries,
  runtimeDirectoryMode,
) {
  return [
    ...applicationEntries,
    { path: "runtime", kind: "directory", mode: runtimeDirectoryMode },
    ...runtimeEntries.map((entry) => ({
      ...entry,
      path: `runtime/${entry.path}`,
    })),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function verifyPinnedNode(root, label) {
  if (
    process.platform !== PINNED_NODE_PLATFORM ||
    process.arch !== PINNED_NODE_ARCHITECTURE
  )
    fail(
      `pinned Node runtime requires ${PINNED_NODE_PLATFORM} ${PINNED_NODE_ARCHITECTURE}; detected ${process.platform} ${process.arch}`,
    );
  const binary = join(root, "bin/node");
  const license = join(root, "LICENSE");
  const binaryInfo = await requireRegularFile(binary, `${label} executable`);
  const licenseInfo = await requireRegularFile(license, `${label} LICENSE`);
  const [binarySha, licenseSha] = await Promise.all([
    sha256(binary),
    sha256(license),
  ]);
  if (binarySha !== PINNED_NODE_SHA256)
    fail(
      `${label} executable SHA-256 mismatch: expected ${PINNED_NODE_SHA256}, got ${binarySha}`,
    );
  if (licenseSha !== PINNED_NODE_LICENSE_SHA256)
    fail(
      `${label} LICENSE SHA-256 mismatch: expected ${PINNED_NODE_LICENSE_SHA256}, got ${licenseSha}`,
    );
  const environment = {
    PATH: "",
    HOME: tmpdir(),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };
  delete environment.NODE_OPTIONS;
  delete environment.NODE_PATH;
  let stdout;
  try {
    ({ stdout } = await execFile(binary, ["--version"], {
      env: environment,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    }));
  } catch (error) {
    fail(
      `${label} could not execute for version validation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (stdout.trim() !== `v${PINNED_NODE_VERSION}`)
    fail(
      `${label} reported ${stdout.trim() || "no version"}; expected v${PINNED_NODE_VERSION}`,
    );
  return {
    version: PINNED_NODE_VERSION,
    platform: PINNED_NODE_PLATFORM,
    architecture: PINNED_NODE_ARCHITECTURE,
    provenance: NODE_RUNTIME_PROVENANCE,
    files: [
      { path: "bin/node", bytes: binaryInfo.size, sha256: binarySha },
      { path: "LICENSE", bytes: licenseInfo.size, sha256: licenseSha },
    ],
  };
}

async function checkRuntime(runtimeRoot, label) {
  const checkerRoot = await mkdtemp(join(tmpdir(), "orbsie-runtime-check-"));
  const checker = join(checkerRoot, "checker.mjs");
  const bundle = join(checkerRoot, "checker.bundle.mjs");
  const runtimeModule = fileURLToPath(
    new URL("./blender-runtime.ts", import.meta.url),
  );
  const source = `import { resolveBlenderRuntime } from ${JSON.stringify(runtimeModule)};\nprocess.stdout.write(JSON.stringify(resolveBlenderRuntime()) + "\\n");\n`;
  try {
    await writeFile(checker, source, { mode: 0o600 });
    await build({
      entryPoints: [checker],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      logLevel: "silent",
    });
    const home = join(checkerRoot, "home");
    const temporary = join(checkerRoot, "tmp");
    await mkdir(home);
    await mkdir(temporary);
    const environment = {
      PATH: "/usr/bin:/bin",
      HOME: home,
      TMPDIR: temporary,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      ORBSIE_BLENDER_RUNTIME_DIR: runtimeRoot,
    };
    delete environment.NODE_OPTIONS;
    delete environment.NODE_PATH;
    let stdout;
    try {
      ({ stdout } = await execFile(process.execPath, [bundle], {
        cwd: checkerRoot,
        env: environment,
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
      }));
    } catch (error) {
      const stderr = error?.stderr ? `: ${String(error.stderr).trim()}` : "";
      fail(`${label} did not pass resolveBlenderRuntime${stderr}`);
    }
    let resolved;
    try {
      resolved = JSON.parse(stdout.trim());
    } catch (error) {
      fail(
        `${label} checker returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (resolved?.kind !== "packaged")
      fail(`${label} is not a packaged runtime`);
    return resolved;
  } finally {
    await rm(checkerRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(
      "Usage: node scripts/assemble-modeling-distribution.mjs OUTPUT --application-root PATH --runtime-root PATH",
    );
    return null;
  }
  if (
    argv.length !== 5 ||
    !argv[0]?.trim() ||
    argv[1] !== "--application-root" ||
    !argv[2]?.trim() ||
    argv[3] !== "--runtime-root" ||
    !argv[4]?.trim()
  )
    fail(
      "Usage: node scripts/assemble-modeling-distribution.mjs OUTPUT --application-root PATH --runtime-root PATH",
    );
  return {
    output: resolve(argv[0]),
    applicationRoot: resolve(argv[2]),
    runtimeRoot: resolve(argv[4]),
  };
}

export async function assembleModelingDistribution({
  output,
  applicationRoot,
  runtimeRoot,
}) {
  const outputInfo = await assertNewOutput(output);
  const applicationInfo = await requireRealDirectory(
    applicationRoot,
    "application root",
  );
  const runtimeInfo = await requireRealDirectory(runtimeRoot, "runtime root");
  assertRootsDoNotOverlap(outputInfo, applicationInfo, runtimeInfo);

  const application = await assertApplicationPackage(applicationInfo);
  await validateRuntimeTree(runtimeInfo);
  const sourceApplicationIntegrity = await buildTreeIntegrity(
    applicationInfo.path,
  );
  const sourceRuntimeIntegrity = await buildTreeIntegrity(runtimeInfo.path);
  const sourceRuntimeRootInfo = await lstat(runtimeInfo.path);
  const sourceRuntimeManifestSha256 = await sha256(
    join(runtimeInfo.path, "manifest.json"),
  );
  const sourceRuntimeResolution = await checkRuntime(
    runtimeInfo.path,
    "source runtime",
  );

  let created = false;
  try {
    await mkdir(outputInfo.path, { mode: 0o755 });
    created = true;
    await chmod(outputInfo.path, 0o755);
    await copyApplicationTree(applicationInfo.path, outputInfo.path);

    const sourceNodeRootInfo = await lstat(application.nodeRoot);
    const packagedNode = await packageNodeRuntime(
      application.nodeRoot,
      join(outputInfo.path, "node"),
    );
    // packageNodeRuntime intentionally sets executable permissions. Restore
    // the selected application's modes after its byte/version gate succeeds.
    await chmod(
      join(outputInfo.path, "node"),
      sourceNodeRootInfo.mode & 0o7777,
    );
    await chmod(
      join(outputInfo.path, "node/bin"),
      (await lstat(join(application.nodeRoot, "bin"))).mode & 0o7777,
    );
    await chmod(
      join(outputInfo.path, "node/bin/node"),
      (await lstat(join(application.nodeRoot, "bin/node"))).mode & 0o7777,
    );
    await chmod(
      join(outputInfo.path, "node/LICENSE"),
      (await lstat(join(application.nodeRoot, "LICENSE"))).mode & 0o7777,
    );
    const copiedNode = await verifyPinnedNode(
      join(outputInfo.path, "node"),
      "copied Node",
    );
    if (JSON.stringify(copiedNode.files) !== JSON.stringify(packagedNode.files))
      fail("copied Node metadata changed after packaging");

    await copyRuntimeTree(runtimeInfo.path, join(outputInfo.path, "runtime"));
    const copiedRuntimeResolution = await checkRuntime(
      join(outputInfo.path, "runtime"),
      "copied runtime",
    );
    const copiedRuntimeManifestSha256 = await sha256(
      join(outputInfo.path, "runtime/manifest.json"),
    );

    const copiedEntries = await buildTreeIntegrity(outputInfo.path);
    const expectedEntries = composeDistributionIntegrityEntries(
      sourceApplicationIntegrity,
      sourceRuntimeIntegrity,
      sourceRuntimeRootInfo.mode & 0o7777,
    );
    if (JSON.stringify(copiedEntries) !== JSON.stringify(expectedEntries))
      fail(
        "copied distribution file integrity does not match its selected inputs",
      );

    const integrity = {
      schema: TREE_SCHEMA,
      excluded: [DISTRIBUTION_MANIFEST],
      entryCount: copiedEntries.length,
      treeSha256: integrityDigest(copiedEntries),
      entries: copiedEntries,
    };
    const manifest = {
      schema: "orbsie.modeling-distribution/v1",
      status: "candidate",
      candidate: true,
      portable: false,
      releaseCertified: false,
      generatedAt: new Date().toISOString(),
      application: {
        path: ".",
        requiredPayload: APPLICATION_FILES,
        node: copiedNode,
      },
      runtime: {
        path: "runtime",
        verified: true,
        blenderVersion: copiedRuntimeResolution.version,
        pythonVersion: copiedRuntimeResolution.pythonVersion,
        sourceManifestSha256: sourceRuntimeManifestSha256,
        copiedManifestSha256: copiedRuntimeManifestSha256,
      },
      gates: {
        nativeDependencies: "open",
        licenses: "open",
        correspondingSource: "open",
        cleanHostProvenance: "open",
      },
      networkRequests: 0,
      providerCalls: 0,
      notes: [
        "This is an offline candidate assembled from explicitly selected local inputs.",
        "Portability, native dependency closure, complete license/source delivery, and clean-host provenance remain release gates.",
      ],
      integrity,
    };
    await writeFile(
      join(outputInfo.path, DISTRIBUTION_MANIFEST),
      JSON.stringify(manifest, null, 2) + "\n",
      { mode: 0o644 },
    );
    return { output: outputInfo.path, manifest };
  } catch (error) {
    if (created) {
      try {
        await removeCreatedOutput(outputInfo.path);
      } catch {
        // Preserve the original assembly error; cleanup is scoped to the new output.
      }
    }
    throw error;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options) {
      const result = await assembleModelingDistribution(options);
      console.log(
        JSON.stringify(
          {
            output: result.output,
            status: result.manifest.status,
            manifest: join(result.output, DISTRIBUTION_MANIFEST),
            integrity: {
              entryCount: result.manifest.integrity.entryCount,
              treeSha256: result.manifest.integrity.treeSha256,
            },
          },
          null,
          2,
        ),
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
