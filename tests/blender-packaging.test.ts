import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  assertArchiveLinkTarget,
  assertContainedPath,
  assertDisposableOutputPath,
  copyDirectory,
  isPathContained,
  PINNED_OFFICIAL_ARCHIVES,
  validateArchiveEntries,
} from "../scripts/package-blender-runtime.mjs";

describe("Blender packaging path boundaries", () => {
  it("pins the supported official archive to its authoritative digest", () => {
    expect(PINNED_OFFICIAL_ARCHIVES["blender-4.0.2-linux-x64.tar.xz"]).toBe(
      "5583a5588736da8858c522ef17fff5d73be59c47a6fe91ad29c6f3263e22086a",
    );
  });

  it("requires replace targets to be disposable direct tmp children", () => {
    const valid = join(tmpdir(), "orbsie-blender-runtime-packaging-test");
    expect(assertDisposableOutputPath(valid)).toBe(valid);

    const outside = mkdtempSync(join(tmpdir(), "orbsie-packaging-parent-"));
    const link = join(tmpdir(), "orbsie-blender-runtime-parent-link");
    try {
      symlinkSync(outside, link);
      expect(() =>
        assertDisposableOutputPath(join(link, "orbsie-blender-runtime-escape")),
      ).toThrow(/direct child/);
    } finally {
      rmSync(link, { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
    expect(() =>
      assertDisposableOutputPath(join(tmpdir(), "unrelated-output")),
    ).toThrow(/disposable Orbsie prefix/);
  });

  it("rejects archive traversal and symlink targets outside extraction", () => {
    expect(() => validateArchiveEntries(["blender/../outside"])).toThrow(
      /unsafe path/,
    );
    expect(() => validateArchiveEntries(["/outside"])).toThrow(/unsafe path/);
    expect(() =>
      assertArchiveLinkTarget(
        "/tmp/orbsie-release",
        "/tmp/orbsie-release/lib/link",
        "../../../../etc/passwd",
      ),
    ).toThrow(/escapes/);
    expect(
      assertArchiveLinkTarget(
        "/tmp/orbsie-release",
        "/tmp/orbsie-release/lib/link",
        "../python",
      ),
    ).toBe("/tmp/orbsie-release/python");
  });

  it("rejects external and cyclic symlinks while dereferencing an archive tree", () => {
    const root = mkdtempSync(join(tmpdir(), "orbsie-archive-tree-"));
    const source = join(root, "source");
    const destination = join(root, "destination");
    mkdirSync(source);
    writeFileSync(join(source, "inside.txt"), "inside\n");
    try {
      symlinkSync(".", join(source, "cycle"));
      expect(() =>
        copyDirectory(source, destination, {
          dereference: true,
          containmentRoot: root,
        }),
      ).toThrow(/cyclic/);
      rmSync(join(source, "cycle"));
      symlinkSync("/etc/passwd", join(source, "outside"));
      expect(() =>
        copyDirectory(source, destination, {
          dereference: true,
          containmentRoot: root,
        }),
      ).toThrow(/escapes/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps license namespaces inside the bundle", () => {
    const bundle = "/tmp/orbsie-blender-runtime-test";
    const external = join(bundle, "licenses", "external-numpy", "LICENSE");
    expect(isPathContained(bundle, external)).toBe(true);
    expect(() =>
      assertContainedPath(bundle, `${bundle}/licenses/../../escape`),
    ).toThrow(/escapes/);
  });
});
