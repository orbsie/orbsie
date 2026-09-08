import { execFile as execFileCallback } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  packageNodeRuntime,
  PINNED_NODE_LICENSE_SHA256,
  PINNED_NODE_SHA256,
  PINNED_NODE_VERSION,
} from "../scripts/node-runtime-package.mjs";

const execFile = promisify(execFileCallback);
const pinnedNodeRoot = "/home/marcos/.local/share/pnpm/nodejs/22.22.0";
const pinnedNodeBinary = join(pinnedNodeRoot, "bin/node");
const pinnedNodeLicense = join(pinnedNodeRoot, "LICENSE");

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "orbsie-node-runtime-source-"));
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin/node"), Buffer.from("placeholder node\n"));
  return root;
}

function outputPath() {
  return join(
    mkdtempSync(join(tmpdir(), "orbsie-node-runtime-output-")),
    "package",
  );
}

describe("Node runtime packaging", () => {
  it("rejects a wrong executable hash before creating output", async () => {
    const source = fixtureRoot();
    writeFileSync(join(source, "LICENSE"), "license\n");
    const destination = outputPath();
    try {
      await expect(packageNodeRuntime(source, destination)).rejects.toThrow(
        new RegExp(`expected ${PINNED_NODE_SHA256}`),
      );
      expect(existsSync(destination)).toBe(false);
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(destination, { recursive: true, force: true });
      rmSync(join(destination, ".."), { recursive: true, force: true });
    }
  });

  it("rejects a missing LICENSE before creating output", async () => {
    const source = fixtureRoot();
    const destination = outputPath();
    try {
      await expect(packageNodeRuntime(source, destination)).rejects.toThrow(
        /LICENSE.*regular file.*symlink/i,
      );
      expect(existsSync(destination)).toBe(false);
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(destination, { recursive: true, force: true });
      rmSync(join(destination, ".."), { recursive: true, force: true });
    }
  });

  it.skipIf(!existsSync(pinnedNodeBinary))(
    "rejects an unrelated LICENSE before creating output",
    async () => {
      const source = fixtureRoot();
      const destination = outputPath();
      copyFileSync(pinnedNodeBinary, join(source, "bin/node"));
      writeFileSync(join(source, "LICENSE"), "unrelated license\n");
      try {
        await expect(packageNodeRuntime(source, destination)).rejects.toThrow(
          new RegExp(`expected ${PINNED_NODE_LICENSE_SHA256}`),
        );
        expect(existsSync(destination)).toBe(false);
      } finally {
        rmSync(source, { recursive: true, force: true });
        rmSync(destination, { recursive: true, force: true });
        rmSync(join(destination, ".."), { recursive: true, force: true });
      }
    },
  );

  it("rejects an existing destination without overwriting it", async () => {
    const source = fixtureRoot();
    const destinationParent = mkdtempSync(
      join(tmpdir(), "orbsie-node-runtime-output-"),
    );
    const destination = join(destinationParent, "package");
    mkdirSync(destination);
    writeFileSync(join(destination, "keep.txt"), "keep\n");
    try {
      await expect(packageNodeRuntime(source, destination)).rejects.toThrow(
        /destination already exists/i,
      );
      expect(readFileSync(join(destination, "keep.txt"), "utf8")).toBe(
        "keep\n",
      );
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(destinationParent, { recursive: true, force: true });
    }
  });

  it.skipIf(!existsSync(pinnedNodeBinary) || !existsSync(pinnedNodeLicense))(
    "packages only the pinned files and runs the packaged binary with an empty PATH",
    async () => {
      const destination = outputPath();
      try {
        const manifest = await packageNodeRuntime(pinnedNodeRoot, destination);
        const binary = join(destination, "bin/node");

        expect(manifest).toEqual({
          version: PINNED_NODE_VERSION,
          platform: "linux",
          architecture: "x64",
          bytes: 123405064 + 143299,
          files: [
            {
              path: "bin/node",
              bytes: 123405064,
              sha256: PINNED_NODE_SHA256,
            },
            {
              path: "LICENSE",
              bytes: 143299,
              sha256: PINNED_NODE_LICENSE_SHA256,
            },
          ],
          provenance: "pinned-local-installation",
        });
        expect(readdirSync(destination).sort()).toEqual(["LICENSE", "bin"]);
        expect(readdirSync(join(destination, "bin"))).toEqual(["node"]);
        expect(readFileSync(join(destination, "LICENSE"))).toEqual(
          readFileSync(pinnedNodeLicense),
        );
        expect(statSync(binary).mode & 0o777).toBe(0o755);
        expect(lstatSync(binary).isSymbolicLink()).toBe(false);

        const environment: NodeJS.ProcessEnv = { ...process.env, PATH: "" };
        delete environment.NODE_OPTIONS;
        delete environment.NODE_PATH;
        const result = await execFile(binary, ["--version"], {
          env: environment,
        });
        expect(result.stdout.trim()).toBe(`v${PINNED_NODE_VERSION}`);
      } finally {
        rmSync(destination, { recursive: true, force: true });
        rmSync(join(destination, ".."), { recursive: true, force: true });
      }
    },
  );
});
