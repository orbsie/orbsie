import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
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
  copyOfficialReleaseNotices,
  isPathContained,
  PINNED_OFFICIAL_ARCHIVES,
  validateArchiveEntries,
} from "../scripts/package-blender-runtime.mjs";

describe("Blender packaging path boundaries", () => {
  it("preserves both top-level official release notices verbatim and fails when one is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "orbsie-notices-"));
    const source = join(root, "source");
    const bundle = join(root, "bundle");
    mkdirSync(source);
    mkdirSync(bundle);
    try {
      writeFileSync(join(source, "copyright.txt"), "Copyright notice\n");
      expect(() => copyOfficialReleaseNotices(source, bundle)).toThrow(
        /readme.html/,
      );
      writeFileSync(
        join(source, "readme.html"),
        "<p>Release documentation</p>\n",
      );
      const records = copyOfficialReleaseNotices(source, bundle);
      expect(records).toHaveLength(2);
      for (const record of records) {
        expect(readFileSync(join(bundle, record.bundled))).toEqual(
          readFileSync(record.source),
        );
        expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
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

  it("relocates contained links and preserves them through a bundle move", () => {
    const root = mkdtempSync(join(tmpdir(), "orbsie-relocated-links-"));
    const source = join(root, "source");
    const destination = join(root, "destination");
    const moved = join(root, "moved");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "target.txt"), "contained\n");
    symlinkSync("target.txt", join(source, "relative"));
    symlinkSync(join(source, "target.txt"), join(source, "absolute"));
    try {
      copyDirectory(source, destination, {
        containmentRoot: source,
        relocateSymlinks: true,
      });

      expect(lstatSync(join(destination, "relative")).isSymbolicLink()).toBe(
        true,
      );
      expect(lstatSync(join(destination, "absolute")).isSymbolicLink()).toBe(
        true,
      );
      expect(readlinkSync(join(destination, "relative"))).toBe("target.txt");
      expect(readlinkSync(join(destination, "absolute"))).toBe("target.txt");

      // A package may be moved as a unit; no link may point back to the
      // temporary extraction directory.
      rmSync(moved, { recursive: true, force: true });
      renameSync(destination, moved);
      expect(readFileSync(join(moved, "relative"), "utf8")).toBe("contained\n");
      expect(readFileSync(join(moved, "absolute"), "utf8")).toBe("contained\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects escaped, dangling, and ancestor-cycle links during relocation", () => {
    const root = mkdtempSync(join(tmpdir(), "orbsie-relocated-link-errors-"));
    const source = join(root, "source");
    const outside = join(root, "outside.txt");
    mkdirSync(source, { recursive: true });
    writeFileSync(outside, "outside\n");
    try {
      symlinkSync(outside, join(source, "escape"));
      expect(() =>
        copyDirectory(source, join(root, "escape-destination"), {
          containmentRoot: source,
          relocateSymlinks: true,
        }),
      ).toThrow(/escapes/);

      rmSync(join(source, "escape"));
      symlinkSync("missing.txt", join(source, "dangling"));
      expect(() =>
        copyDirectory(source, join(root, "dangling-destination"), {
          containmentRoot: source,
          relocateSymlinks: true,
        }),
      ).toThrow(/unresolvable/);

      rmSync(join(source, "dangling"));
      symlinkSync(".", join(source, "cycle"));
      expect(() =>
        copyDirectory(source, join(root, "cycle-destination"), {
          containmentRoot: source,
          relocateSymlinks: true,
        }),
      ).toThrow(/cyclic/);
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
