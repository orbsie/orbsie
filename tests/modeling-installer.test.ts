import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildTreeIntegrity } from "../scripts/assemble-modeling-distribution.mjs";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packager = join(repoRoot, "scripts/package-modeling-installer.mjs");

function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), "orbsie-installer-test-"));
}

function removeFixture(root: string) {
  for (const candidateName of [
    "candidate",
    "candidate input",
    "relocated modeling candidate",
    "partial destination",
  ]) {
    const readOnly = join(root, `${candidateName}/runtime/share`);
    if (existsSync(readOnly)) chmodSync(readOnly, 0o755);
  }
  rmSync(root, { recursive: true, force: true });
}

function writeExecutable(path: string, source: string) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

async function writeCandidate(root: string) {
  mkdirSync(join(root, "node/bin"), { recursive: true });
  mkdirSync(join(root, "runtime/bin"), { recursive: true });
  mkdirSync(join(root, "runtime/share"), { recursive: true });
  writeFileSync(join(root, "README.txt"), "Synthetic candidate only.\n");
  writeFileSync(join(root, "companion.mjs"), "synthetic companion\n");
  writeExecutable(
    join(root, "node/bin/node"),
    '#!/bin/sh\nset -eu\n[ "$1" = "$PWD/companion.mjs" ]\nprintf \'bundled:%s\\n\' "$2"\n',
  );
  writeFileSync(join(root, "node/LICENSE"), "Synthetic license.\n");
  writeExecutable(
    join(root, "orbsie-builder"),
    '#!/bin/sh\nset -eu\ncase "$0" in /*) launcher="$0" ;; *) launcher="$PWD/$0" ;; esac\nCDPATH= cd -P -- "${launcher%/*}"\nunset NODE_OPTIONS NODE_PATH\nexec "$PWD/node/bin/node" "$PWD/companion.mjs" "$@"\n',
  );
  writeFileSync(join(root, "runtime/bin/tool"), "runtime tool\n");
  chmodSync(join(root, "runtime/bin/tool"), 0o751);
  writeFileSync(join(root, "runtime/share/data"), "runtime data\n");
  chmodSync(join(root, "runtime/share"), 0o555);
  symlinkSync("bin/tool", join(root, "runtime/tool-link"));

  const entries = await buildTreeIntegrity(root);
  const manifest = {
    schema: "orbsie.modeling-distribution/v1",
    status: "candidate",
    candidate: true,
    portable: false,
    releaseCertified: false,
    application: { path: "." },
    runtime: { path: "runtime", verified: true },
    integrity: {
      schema: "orbsie.modeling-distribution/tree-integrity/v1",
      excluded: ["manifest.json"],
      entryCount: entries.length,
      treeSha256: createHash("sha256")
        .update(JSON.stringify(entries))
        .digest("hex"),
      entries,
    },
  };
  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

async function expectFailure(args: string[], pattern: RegExp) {
  let failure: any;
  try {
    await execFile(process.execPath, [packager, ...args], {
      cwd: repoRoot,
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    failure = error;
  }
  expect(failure?.code).toBe(1);
  expect(`${failure?.stderr || ""}${failure?.stdout || ""}`).toMatch(pattern);
}

describe("synthetic Linux x64 modeling candidate installer", () => {
  it("packages and installs a candidate through paths with spaces", async () => {
    const root = fixtureRoot();
    const candidate = join(root, "candidate input");
    const installer = join(root, "candidate installer.run");
    const destination = join(root, "installed modeling candidate");
    mkdirSync(candidate);
    try {
      await writeCandidate(candidate);
      await execFile(process.execPath, [packager, candidate, installer], {
        cwd: repoRoot,
        timeout: 60_000,
      });
      await execFile(installer, [destination], {
        cwd: root,
        timeout: 60_000,
      });
      expect(lstatSync(join(destination, "orbsie-builder")).mode & 0o111).toBe(
        0o111,
      );
      expect(
        lstatSync(join(destination, "runtime/bin/tool")).mode & 0o777,
      ).toBe(0o751);
      expect(readlinkSync(join(destination, "runtime/tool-link"))).toBe(
        "bin/tool",
      );
      const relocated = join(root, "relocated modeling candidate");
      renameSync(destination, relocated);
      const launched = await execFile(
        join(relocated, "orbsie-builder"),
        ["probe"],
        {
          cwd: relocated,
          env: { ...process.env, PATH: "", HOME: join(root, "home") },
        },
      );
      expect(launched.stdout.trim()).toBe("bundled:probe");
    } finally {
      removeFixture(root);
    }
  });

  it("rejects a corrupt payload without creating its destination", async () => {
    const root = fixtureRoot();
    const candidate = join(root, "candidate");
    const installer = join(root, "valid.run");
    const corrupt = join(root, "corrupt.run");
    const destination = join(root, "should-not-exist");
    mkdirSync(candidate);
    try {
      await writeCandidate(candidate);
      await execFile(process.execPath, [packager, candidate, installer], {
        cwd: repoRoot,
        timeout: 60_000,
      });
      const bytes = readFileSync(installer);
      bytes[bytes.length - 1] ^= 1;
      writeFileSync(corrupt, bytes, { mode: 0o755 });
      await expect(
        execFile(corrupt, [destination], { cwd: root, timeout: 60_000 }),
      ).rejects.toMatchObject({ code: 1 });
      expect(existsSync(destination)).toBe(false);
    } finally {
      removeFixture(root);
    }
  });

  it("preserves an existing destination and rejects a tampered candidate tree", async () => {
    const root = fixtureRoot();
    const candidate = join(root, "candidate");
    const installer = join(root, "candidate.run");
    const destination = join(root, "existing");
    mkdirSync(candidate);
    mkdirSync(destination);
    writeFileSync(join(destination, "keep.txt"), "keep\n");
    try {
      await writeCandidate(candidate);
      await execFile(process.execPath, [packager, candidate, installer], {
        cwd: repoRoot,
        timeout: 60_000,
      });
      await expectFailure(
        [candidate, installer],
        /installer output already exists/i,
      );
      await expect(
        execFile(installer, [destination], { cwd: root, timeout: 60_000 }),
      ).rejects.toMatchObject({ code: 1 });
      expect(readFileSync(join(destination, "keep.txt"), "utf8")).toBe(
        "keep\n",
      );
      writeFileSync(join(candidate, "runtime/share/data"), "tampered\n");
      const tamperedInstaller = join(root, "tampered.run");
      await expectFailure(
        [candidate, tamperedInstaller],
        /candidate files, modes, symlinks, or hashes do not match/i,
      );
      expect(existsSync(tamperedInstaller)).toBe(false);
    } finally {
      removeFixture(root);
    }
  });

  it("cleans read-only partial destinations after a post-copy failure", async () => {
    const root = fixtureRoot();
    const candidate = join(root, "candidate");
    const installer = join(root, "candidate.run");
    const destination = join(root, "partial destination");
    const sentinel = join(root, "existing sentinel");
    const tools = join(root, "tools");
    mkdirSync(candidate);
    mkdirSync(sentinel);
    writeFileSync(join(sentinel, "keep.txt"), "keep\n");
    mkdirSync(tools);
    writeExecutable(
      join(tools, "cp"),
      '#!/bin/sh\nset -eu\n/bin/cp "$@"\nexit 1\n',
    );
    try {
      await writeCandidate(candidate);
      await execFile(process.execPath, [packager, candidate, installer], {
        cwd: repoRoot,
        timeout: 60_000,
      });
      await expect(
        execFile(installer, [destination], {
          cwd: root,
          env: {
            ...process.env,
            PATH: `${tools}:/usr/bin:/bin`,
            HOME: join(root, "home"),
          },
          timeout: 60_000,
        }),
      ).rejects.toMatchObject({ code: 1 });
      expect(existsSync(destination)).toBe(false);
      expect(readFileSync(join(sentinel, "keep.txt"), "utf8")).toBe("keep\n");
      expect(
        readdirSync(root).some((name) => name.startsWith(".orbsie-installer.")),
      ).toBe(false);
    } finally {
      removeFixture(root);
    }
  });
});
