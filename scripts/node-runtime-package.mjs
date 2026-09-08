#!/usr/bin/env node

/**
 * Package the explicitly selected local Node distribution used by the
 * companion application. This is deliberately a local packaging step: it
 * never downloads Node, consults a package manager, or copies global modules.
 *
 * The pinned bytes were observed in the trusted local installation at the
 * time this package gate was added. They are not an independently verified
 * official Node archive provenance claim.
 */

import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";

const execFile = promisify(execFileCallback);

export const PINNED_NODE_VERSION = "22.22.0";
export const PINNED_NODE_PLATFORM = "linux";
export const PINNED_NODE_ARCHITECTURE = "x64";
export const PINNED_NODE_SHA256 =
  "1bec56ef7cfa9a76f3e0b7c0a87f220eb73f23102b9c0b4c7529a3f7c3ce7c31";
export const PINNED_NODE_LICENSE_SHA256 =
  "e991d81497a85bb24fc6bffae0a3637a6accd6c6bc5ce1f2c5698bd555cf9d49";
export const NODE_RUNTIME_PROVENANCE = "pinned-local-installation";

const NODE_EXECUTABLE_RELATIVE_PATH = "bin/node";
const NODE_LICENSE_RELATIVE_PATH = "LICENSE";

function fail(message) {
  throw new Error(`[node-runtime-package] ${message}`);
}

async function lstatIfPresent(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function requireDirectory(path, label) {
  const status = await lstatIfPresent(path);
  if (!status || !status.isDirectory() || status.isSymbolicLink())
    fail(`${label} must be a real directory: ${path}`);
  return path;
}

async function requireRegularFile(path, label) {
  const status = await lstatIfPresent(path);
  if (!status || !status.isFile() || status.isSymbolicLink())
    fail(`${label} must be a regular file and must not be a symlink: ${path}`);
  return path;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function assertPinnedDigest(actual, expected, label, path) {
  if (actual !== expected)
    fail(
      `${label} SHA-256 mismatch for ${path}: expected ${expected}, got ${actual}`,
    );
}

async function assertPinnedVersion(binary) {
  // An explicit absolute executable path plus a sanitized environment keeps
  // PATH and injected Node options from changing the metadata check.
  const environment = { ...process.env, PATH: "" };
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
      `could not execute the pinned Node runtime for version validation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const version = stdout.trim();
  if (version !== `v${PINNED_NODE_VERSION}`)
    fail(
      `pinned Node runtime reported ${version || "no version"}; expected v${PINNED_NODE_VERSION}`,
    );
}

/**
 * Copy the pinned Linux x64 Node runtime from an explicit local distribution.
 *
 * Validation completes before the destination is created. If copying fails
 * after creation, only the destination created by this invocation is removed;
 * an existing destination is always rejected and never overwritten.
 *
 * @param {string} nodeRoot explicit local Node distribution root
 * @param {string} destination new runtime package directory
 * @returns {Promise<{
 *   version: string,
 *   platform: string,
 *   architecture: string,
 *   bytes: number,
 *   files: Array<{path: string, bytes: number, sha256: string}>,
 *   provenance: string,
 * }>}
 */
export async function packageNodeRuntime(nodeRoot, destination) {
  if (typeof nodeRoot !== "string" || nodeRoot.length === 0)
    fail("nodeRoot must be a non-empty path");
  if (typeof destination !== "string" || destination.length === 0)
    fail("destination must be a non-empty path");

  if (
    process.platform !== PINNED_NODE_PLATFORM ||
    process.arch !== PINNED_NODE_ARCHITECTURE
  )
    fail(
      `pinned Node runtime requires ${PINNED_NODE_PLATFORM} ${PINNED_NODE_ARCHITECTURE}; detected ${process.platform} ${process.arch}`,
    );

  const sourceRoot = resolve(nodeRoot);
  const outputRoot = resolve(destination);
  const sourceBinary = join(sourceRoot, NODE_EXECUTABLE_RELATIVE_PATH);
  const sourceLicense = join(sourceRoot, NODE_LICENSE_RELATIVE_PATH);

  // Reject an existing destination before any output-side operation. lstat
  // intentionally treats a destination symlink as existing and unsafe.
  if (await lstatIfPresent(outputRoot))
    fail(
      `destination already exists and will not be overwritten: ${outputRoot}`,
    );

  await requireDirectory(sourceRoot, "Node distribution root");
  await requireDirectory(
    join(sourceRoot, "bin"),
    "Node distribution bin directory",
  );
  await requireRegularFile(sourceBinary, "Node executable");
  await requireRegularFile(sourceLicense, "Node LICENSE");

  // Read and verify both source files completely before creating output. This
  // rejects placeholder executables and unrelated license text in time to
  // leave no destination behind.
  const [binarySha256, licenseSha256] = await Promise.all([
    sha256(sourceBinary),
    sha256(sourceLicense),
  ]);
  assertPinnedDigest(
    binarySha256,
    PINNED_NODE_SHA256,
    "Node executable",
    sourceBinary,
  );
  assertPinnedDigest(
    licenseSha256,
    PINNED_NODE_LICENSE_SHA256,
    "Node LICENSE",
    sourceLicense,
  );
  await assertPinnedVersion(sourceBinary);

  let created = false;
  try {
    await mkdir(outputRoot);
    created = true;
    const packagedBinary = join(outputRoot, NODE_EXECUTABLE_RELATIVE_PATH);
    const packagedLicense = join(outputRoot, NODE_LICENSE_RELATIVE_PATH);
    await mkdir(join(outputRoot, "bin"));
    await copyFile(sourceBinary, packagedBinary);
    await chmod(packagedBinary, 0o755);
    await copyFile(sourceLicense, packagedLicense);

    // Verify the bytes that actually landed in the new package. This closes
    // the gap where a source file could change between preflight and copy.
    await requireRegularFile(packagedBinary, "packaged Node executable");
    await requireRegularFile(packagedLicense, "packaged Node LICENSE");
    const [packagedBinarySha256, packagedLicenseSha256] = await Promise.all([
      sha256(packagedBinary),
      sha256(packagedLicense),
    ]);
    assertPinnedDigest(
      packagedBinarySha256,
      PINNED_NODE_SHA256,
      "packaged Node executable",
      packagedBinary,
    );
    assertPinnedDigest(
      packagedLicenseSha256,
      PINNED_NODE_LICENSE_SHA256,
      "packaged Node LICENSE",
      packagedLicense,
    );
    const files = [
      {
        path: NODE_EXECUTABLE_RELATIVE_PATH,
        bytes: (await lstat(packagedBinary)).size,
        sha256: packagedBinarySha256,
      },
      {
        path: NODE_LICENSE_RELATIVE_PATH,
        bytes: (await lstat(packagedLicense)).size,
        sha256: packagedLicenseSha256,
      },
    ];
    return {
      version: PINNED_NODE_VERSION,
      platform: PINNED_NODE_PLATFORM,
      architecture: PINNED_NODE_ARCHITECTURE,
      bytes: files.reduce((total, file) => total + file.bytes, 0),
      files,
      provenance: NODE_RUNTIME_PROVENANCE,
    };
  } catch (error) {
    if (created) {
      try {
        await rm(outputRoot, { recursive: true, force: true });
      } catch {
        // Preserve the packaging error; cleanup is best effort and scoped to
        // the directory this invocation successfully created.
      }
    }
    throw error;
  }
}
