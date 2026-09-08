import { execFile as execFileCallback } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildTreeIntegrity,
  composeDistributionIntegrityEntries,
  copyApplicationTree,
  copyRuntimeTree,
  removeCreatedOutput,
  validateRuntimeTree,
} from "../scripts/assemble-modeling-distribution.mjs";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const assembler = join(repoRoot, "scripts/assemble-modeling-distribution.mjs");
const pinnedNodeRoot = resolve(
  process.env.ORBSIE_NODE_DISTRIBUTION ??
    "/home/marcos/.local/share/pnpm/nodejs/22.22.0",
);
const pinnedNodeBinary = join(pinnedNodeRoot, "bin/node");
const pinnedNodeLicense = join(pinnedNodeRoot, "LICENSE");
const officialRuntime =
  process.env.ORBSIE_TEST_BLENDER_RUNTIME_DIR ||
  "/tmp/orbsie-blender-runtime-official-4.0.2-tree-v2";
const hasPinnedNode =
  existsSync(pinnedNodeBinary) && existsSync(pinnedNodeLicense);
const hasOfficialRuntime = existsSync(officialRuntime);

function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), "orbsie-assemble-test-"));
}

function validApplication(root: string) {
  mkdirSync(join(root, "licenses"), { recursive: true });
  mkdirSync(join(root, "node/bin"), { recursive: true });
  copyFileSync(pinnedNodeBinary, join(root, "node/bin/node"));
  copyFileSync(pinnedNodeLicense, join(root, "node/LICENSE"));
  writeFileSync(join(root, "companion.mjs"), "process.exit(0);\n");
  writeFileSync(join(root, "blender-modeling.py"), "# trusted fixture\n");
  writeFileSync(join(root, "README.txt"), "fixture\n");
  writeFileSync(join(root, "orbsie-builder"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(root, "orbsie-builder"), 0o751);
  writeFileSync(join(root, "licenses/Orbsie-LICENSE"), "Apache-2.0\n");
  writeFileSync(join(root, "licenses/Zod-LICENSE"), "MIT\n");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      schema: "orbsie.modeling-companion-package/v1",
      status: "application-and-node-bundled",
      runtimeIncluded: false,
      nodeIncluded: true,
    }) + "\n",
  );
}

async function expectFailure(args: string[], pattern: RegExp) {
  let failure: any;
  try {
    await execFile(process.execPath, [assembler, ...args], {
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

describe("offline modeling distribution assembly", () => {
  it.skipIf(!hasPinnedNode)(
    "rejects an application payload with an unexpected file before creating output",
    async () => {
      const root = fixtureRoot();
      const application = join(root, "application");
      const runtime = join(root, "runtime");
      const output = join(root, "distribution");
      mkdirSync(application);
      mkdirSync(runtime);
      validApplication(application);
      writeFileSync(
        join(application, "unexpected-secret.txt"),
        "do not ship\n",
      );
      try {
        await expectFailure(
          [
            output,
            "--application-root",
            application,
            "--runtime-root",
            runtime,
          ],
          /unexpected payload paths.*unexpected-secret\.txt/i,
        );
        expect(existsSync(output)).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!hasPinnedNode)(
    "rejects an application launcher without execute permission",
    async () => {
      const root = fixtureRoot();
      const application = join(root, "application");
      const runtime = join(root, "runtime");
      const output = join(root, "distribution");
      mkdirSync(application);
      mkdirSync(runtime);
      validApplication(application);
      chmodSync(join(application, "orbsie-builder"), 0o644);
      try {
        await expectFailure(
          [
            output,
            "--application-root",
            application,
            "--runtime-root",
            runtime,
          ],
          /orbsie-builder must be executable/i,
        );
        expect(existsSync(output)).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("preserves an existing output before reading either input", async () => {
    const root = fixtureRoot();
    const output = join(root, "existing-output");
    mkdirSync(output);
    writeFileSync(join(output, "keep.txt"), "keep me\n");
    try {
      await expectFailure(
        [
          output,
          "--application-root",
          join(root, "missing-application"),
          "--runtime-root",
          join(root, "missing-runtime"),
        ],
        /output already exists/i,
      );
      expect(readFileSync(join(output, "keep.txt"), "utf8")).toBe("keep me\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects canonical overlap between output and a selected input", async () => {
    const root = fixtureRoot();
    const application = join(root, "application");
    const runtime = join(root, "runtime");
    const output = join(application, "distribution");
    mkdirSync(application);
    mkdirSync(runtime);
    try {
      await expectFailure(
        [output, "--application-root", application, "--runtime-root", runtime],
        /canonical paths must not overlap/i,
      );
      expect(existsSync(output)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasPinnedNode)(
    "rejects an application root symlink and runtime symlinks that escape",
    async () => {
      const root = fixtureRoot();
      const application = join(root, "application");
      const applicationLink = join(root, "application-link");
      const runtime = join(root, "runtime");
      const output = join(root, "distribution");
      mkdirSync(application);
      mkdirSync(runtime);
      validApplication(application);
      symlinkSync(application, applicationLink);
      try {
        await expectFailure(
          [
            output,
            "--application-root",
            applicationLink,
            "--runtime-root",
            runtime,
          ],
          /application root must be a real directory/i,
        );
        expect(existsSync(output)).toBe(false);

        rmSync(applicationLink);
        symlinkSync("/tmp", join(runtime, "escape"));
        await expectFailure(
          [
            output,
            "--application-root",
            application,
            "--runtime-root",
            runtime,
          ],
          /runtime symlink escapes/i,
        );
        expect(existsSync(output)).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!hasPinnedNode)(
    "requires the selected runtime to pass the existing resolver",
    async () => {
      const root = fixtureRoot();
      const application = join(root, "application");
      const runtime = join(root, "runtime");
      const output = join(root, "distribution");
      mkdirSync(application);
      mkdirSync(runtime);
      validApplication(application);
      writeFileSync(
        join(runtime, "manifest.json"),
        JSON.stringify({
          schema: "orbsie.blender-runtime/v1",
          status: "candidate",
        }),
      );
      try {
        await expectFailure(
          [
            output,
            "--application-root",
            application,
            "--runtime-root",
            runtime,
          ],
          /source runtime did not pass resolveBlenderRuntime/i,
        );
        expect(existsSync(output)).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("composes application and runtime entries with the runtime root directory", () => {
    const entries = composeDistributionIntegrityEntries(
      [
        {
          path: "companion.mjs",
          kind: "file",
          mode: 0o644,
          bytes: 4,
          sha256: "a".repeat(64),
        },
      ],
      [
        {
          path: "manifest.json",
          kind: "file",
          mode: 0o644,
          bytes: 8,
          sha256: "b".repeat(64),
        },
      ],
      0o755,
    );
    expect(entries).toEqual([
      {
        path: "companion.mjs",
        kind: "file",
        mode: 0o644,
        bytes: 4,
        sha256: "a".repeat(64),
      },
      { path: "runtime", kind: "directory", mode: 0o755 },
      {
        path: "runtime/manifest.json",
        kind: "file",
        mode: 0o644,
        bytes: 8,
        sha256: "b".repeat(64),
      },
    ]);
  });

  it("copies read-only directories after their children and accepts symlinked ancestors", async () => {
    const root = fixtureRoot();
    const applicationSource = join(root, "application-source");
    const applicationDestination = join(root, "application-destination");
    const runtimeSource = join(root, "runtime-source");
    const runtimeDestination = join(root, "runtime-destination");
    const realIntegrityRoot = join(root, "real-integrity-root");
    const integrityParentLink = join(root, "integrity-parent-link");
    const cycleRoot = join(root, "cycle-root");
    const cycleParentLink = join(root, "cycle-parent-link");
    mkdirSync(applicationSource);
    mkdirSync(applicationDestination);
    mkdirSync(join(applicationSource, "readonly"));
    writeFileSync(join(applicationSource, "readonly/file.txt"), "kept\n");
    chmodSync(join(applicationSource, "readonly"), 0o555);
    mkdirSync(runtimeSource);
    mkdirSync(join(runtimeSource, "readonly"));
    writeFileSync(join(runtimeSource, "readonly/file.txt"), "kept\n");
    symlinkSync("file.txt", join(runtimeSource, "readonly/link"));
    chmodSync(join(runtimeSource, "readonly"), 0o555);
    mkdirSync(realIntegrityRoot);
    writeFileSync(join(realIntegrityRoot, "target.txt"), "target\n");
    symlinkSync("target.txt", join(realIntegrityRoot, "link"));
    symlinkSync(root, integrityParentLink);
    mkdirSync(cycleRoot);
    symlinkSync(".", join(cycleRoot, "cycle"));
    symlinkSync(root, cycleParentLink);
    try {
      await copyApplicationTree(applicationSource, applicationDestination);
      expect(
        readFileSync(join(applicationDestination, "readonly/file.txt"), "utf8"),
      ).toBe("kept\n");
      expect(
        statSync(join(applicationDestination, "readonly")).mode & 0o777,
      ).toBe(0o555);

      await copyRuntimeTree(runtimeSource, runtimeDestination);
      expect(readlinkSync(join(runtimeDestination, "readonly/link"))).toBe(
        "file.txt",
      );
      expect(statSync(join(runtimeDestination, "readonly")).mode & 0o777).toBe(
        0o555,
      );

      const entries = await buildTreeIntegrity(
        join(integrityParentLink, "real-integrity-root"),
      );
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "link",
            kind: "symlink",
            target: "target.txt",
          }),
        ]),
      );
      await expect(
        validateRuntimeTree({
          path: join(cycleParentLink, "cycle-root"),
          canonical: cycleRoot,
        }),
      ).rejects.toThrow(/ancestor cycle/i);
    } finally {
      if (existsSync(join(applicationSource, "readonly")))
        chmodSync(join(applicationSource, "readonly"), 0o755);
      if (existsSync(join(runtimeSource, "readonly")))
        chmodSync(join(runtimeSource, "readonly"), 0o755);
      if (existsSync(join(applicationDestination, "readonly")))
        chmodSync(join(applicationDestination, "readonly"), 0o755);
      if (existsSync(join(runtimeDestination, "readonly")))
        chmodSync(join(runtimeDestination, "readonly"), 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes a read-only partial output without following symlinks", async () => {
    const root = fixtureRoot();
    const partial = join(root, "partial-output");
    mkdirSync(join(partial, "runtime/readonly"), { recursive: true });
    writeFileSync(join(partial, "runtime/readonly/file.txt"), "partial\n");
    symlinkSync("/tmp", join(partial, "runtime/external-link"));
    chmodSync(join(partial, "runtime/readonly"), 0o555);
    try {
      await removeCreatedOutput(partial);
      expect(existsSync(partial)).toBe(false);
    } finally {
      if (existsSync(join(partial, "runtime/readonly")))
        chmodSync(join(partial, "runtime/readonly"), 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasPinnedNode || !hasOfficialRuntime)(
    "assembles the verified runtime when the official runtime is present (clearly skipped when absent)",
    async () => {
      const root = fixtureRoot();
      const application = join(root, "application");
      const output = join(root, "distribution");
      mkdirSync(application);
      validApplication(application);
      try {
        const result = await execFile(
          process.execPath,
          [
            assembler,
            output,
            "--application-root",
            application,
            "--runtime-root",
            officialRuntime,
          ],
          { cwd: repoRoot, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 },
        );
        expect(result.stdout).toMatch(/"status":\s*"candidate"/);
        const manifest = JSON.parse(
          readFileSync(join(output, "manifest.json"), "utf8"),
        );
        expect(manifest.status).toBe("candidate");
        expect(manifest.candidate).toBe(true);
        expect(manifest.portable).toBe(false);
        expect(manifest.releaseCertified).toBe(false);
        expect(manifest.gates).toEqual({
          nativeDependencies: "open",
          licenses: "open",
          correspondingSource: "open",
          cleanHostProvenance: "open",
        });
        expect(manifest.networkRequests).toBe(0);
        expect(manifest.providerCalls).toBe(0);
        expect(readdirSync(output).sort()).toEqual([
          "README.txt",
          "blender-modeling.py",
          "companion.mjs",
          "licenses",
          "manifest.json",
          "node",
          "orbsie-builder",
          "package.json",
          "runtime",
        ]);
        expect(statSync(join(output, "orbsie-builder")).mode & 0o777).toBe(
          0o751,
        );
        const nodeEnvironment: NodeJS.ProcessEnv = { ...process.env, PATH: "" };
        delete nodeEnvironment.NODE_OPTIONS;
        delete nodeEnvironment.NODE_PATH;
        const nodeVersion = await execFile(
          join(output, "node/bin/node"),
          ["--version"],
          { env: nodeEnvironment },
        );
        expect(nodeVersion.stdout.trim()).toBe("v22.22.0");
        expect(manifest.integrity.entryCount).toBeGreaterThan(0);
        expect(manifest.integrity.treeSha256).toMatch(/^[a-f0-9]{64}$/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
