import { execFile as execFileCallback } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const GIT_TIMEOUT_MS = 5000;
const SHA_PATTERN = /^[0-9a-f]{7,64}$/i;
export const HARNESS_REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** @typedef {(command: string, args: string[], options: object) => Promise<{stdout?: string}>} GitRunner */

function normalizedSHA(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return SHA_PATTERN.test(candidate) ? candidate : null;
}

/**
 * Read the optional operator-supplied identity of the tested application.
 *
 * The harness checkout and the tested application can be different builds, so
 * this value is deliberately never inferred from the local harness checkout.
 */
export function parseApplicationSourceCommit(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate)
    return {
      sourceCommit: null,
      status: "unrecorded",
    };
  if (!SHA_PATTERN.test(candidate))
    throw new Error(
      "ORBSIE_APP_SOURCE_COMMIT must be a hexadecimal commit SHA (7-64 characters).",
    );
  return {
    sourceCommit: candidate,
    status: "operator-supplied-unverified",
  };
}

/**
 * Capture only the local harness checkout identity. Git output is consumed in
 * memory and only the validated SHA and dirty flag are returned.
 *
 * @param {{cwd?: string, runGit?: GitRunner}} [options]
 */
export async function collectHarnessCheckout({
  cwd = HARNESS_REPOSITORY_ROOT,
  runGit = execFile,
} = {}) {
  const options = {
    cwd,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  };
  try {
    const [headResult, statusResult] = await Promise.all([
      runGit("git", ["rev-parse", "--verify", "HEAD"], options),
      runGit(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=all"],
        options,
      ),
    ]);
    const checkoutSHA = normalizedSHA(headResult?.stdout);
    if (!checkoutSHA)
      return {
        checkoutSHA: null,
        dirty: null,
        status: "unavailable",
      };
    return {
      checkoutSHA,
      dirty: String(statusResult?.stdout ?? "").length > 0,
      status: "available",
    };
  } catch {
    return {
      checkoutSHA: null,
      dirty: null,
      status: "unavailable",
    };
  }
}

/**
 * @param {{appSourceCommit?: string | {sourceCommit: string | null, status: string}, cwd?: string, runGit?: GitRunner, checkedAt?: string}} [options]
 */
export async function collectProviderBrowserE2EProvenance({
  appSourceCommit = process.env.ORBSIE_APP_SOURCE_COMMIT,
  cwd = HARNESS_REPOSITORY_ROOT,
  runGit,
  checkedAt = new Date().toISOString(),
} = {}) {
  const application =
    appSourceCommit && typeof appSourceCommit === "object"
      ? appSourceCommit
      : parseApplicationSourceCommit(appSourceCommit);
  return {
    checkedAt,
    harness: await collectHarnessCheckout({ cwd, runGit }),
    application,
  };
}
