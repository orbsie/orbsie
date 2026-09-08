import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { copyPythonNotices } from "../scripts/blender-python-notices.mjs";

const repoRoot = process.cwd();
function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "orbsie-python-notices-root-"));
  const bundle = join(root, "bundle");
  const site = join(
    bundle,
    "share/blender/python/lib/python3.10/site-packages",
  );
  cpSync(join(repoRoot, "third_party"), join(root, "third_party"), {
    recursive: true,
  });
  mkdirSync(site, { recursive: true });
  const manifest = JSON.parse(
    readFileSync(
      join(root, "third_party/blender-python-notices/manifest.json"),
      "utf8",
    ),
  );
  for (const [index, entry] of manifest.entries()) {
    const suffix = index === 0 ? ".dist-info" : ".egg-info";
    const metadataDirectory = join(
      site,
      `${entry.name}-${entry.version}-fixture${suffix}`,
    );
    mkdirSync(metadataDirectory);
    writeFileSync(
      join(
        metadataDirectory,
        suffix === ".dist-info" ? "METADATA" : "PKG-INFO",
      ),
      `Metadata-Version: 2.1\nName: ${entry.name}\nVersion: ${entry.version}\n`,
    );
  }
  return { root, bundle, site, manifest };
}

function writeManifest(root: string, manifest: unknown) {
  writeFileSync(
    join(root, "third_party/blender-python-notices/manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function cleanup(root: string) {
  rmSync(root, { recursive: true, force: true });
}

describe("blender Python release notices", () => {
  it("copies all checked-in notices and records exact provenance", () => {
    const fixture = createFixture();
    try {
      const records = copyPythonNotices(fixture.root, fixture.bundle);
      expect(records).toHaveLength(11);

      const outputManifestPath = join(
        fixture.bundle,
        "licenses/python/manifest.json",
      );
      const outputManifest = JSON.parse(
        readFileSync(outputManifestPath, "utf8"),
      );
      expect(outputManifest.schema).toBe("orbsie.blender-python-notices/v1");
      expect(outputManifest.sourceManifest).toBe(
        "third_party/blender-python-notices/manifest.json",
      );
      expect(outputManifest.sourceManifestSha256).toBe(
        sha256(
          readFileSync(
            join(
              fixture.root,
              "third_party/blender-python-notices/manifest.json",
            ),
          ),
        ),
      );
      expect(outputManifest.pythonSite).toBe(
        "share/blender/python/lib/python3.10/site-packages",
      );
      expect(outputManifest.records).toEqual(records);
      for (const record of records) {
        const bundled = join(fixture.bundle, record.bundled);
        expect(existsSync(bundled)).toBe(true);
        expect(sha256(readFileSync(bundled))).toBe(record.sha256);
        expect(record.metadata.path).toContain(
          "share/blender/python/lib/python3.10/site-packages/",
        );
      }
    } finally {
      cleanup(fixture.root);
    }
  });

  it("rejects changed notice bytes before copying", () => {
    const fixture = createFixture();
    try {
      writeFileSync(
        join(
          fixture.root,
          "third_party/blender-python-notices/autopep8-1.6.0/LICENSE",
        ),
        "tampered\n",
      );
      expect(() => copyPythonNotices(fixture.root, fixture.bundle)).toThrow(
        /notice bytes changed/,
      );
      expect(existsSync(join(fixture.bundle, "licenses"))).toBe(false);
    } finally {
      cleanup(fixture.root);
    }
  });

  it("rejects bundled metadata version mismatches before writing output", () => {
    const fixture = createFixture();
    try {
      writeFileSync(
        join(fixture.site, "Cython-0.29.30-fixture.dist-info/METADATA"),
        "Metadata-Version: 2.1\nName: Cython\nVersion: 99.0\n",
      );
      expect(() => copyPythonNotices(fixture.root, fixture.bundle)).toThrow(
        /does not match notice/,
      );
      expect(existsSync(join(fixture.bundle, "licenses"))).toBe(false);
    } finally {
      cleanup(fixture.root);
    }
  });

  it("rejects manifest paths that escape the checked-in notice tree", () => {
    const fixture = createFixture();
    try {
      fixture.manifest[0].notices[0].path = "../outside-license";
      writeManifest(fixture.root, fixture.manifest);
      expect(() => copyPythonNotices(fixture.root, fixture.bundle)).toThrow(
        /not a safe relative path/,
      );
    } finally {
      cleanup(fixture.root);
    }
  });

  it("rejects source parent symlinks that escape the checked-in tree", () => {
    const fixture = createFixture();
    const outside = mkdtempSync(
      join(tmpdir(), "orbsie-python-notices-outside-"),
    );
    try {
      const sourceDirectory = join(
        fixture.root,
        "third_party/blender-python-notices/autopep8-1.6.0",
      );
      const outsideDirectory = join(outside, "autopep8-1.6.0");
      mkdirSync(outsideDirectory);
      cpSync(sourceDirectory, outsideDirectory, { recursive: true });
      rmSync(sourceDirectory, { recursive: true, force: true });
      symlinkSync(outsideDirectory, sourceDirectory);
      expect(() => copyPythonNotices(fixture.root, fixture.bundle)).toThrow(
        /escapes its allowed root/,
      );
    } finally {
      cleanup(fixture.root);
      cleanup(outside);
    }
  });

  it("rejects symlinked bundle output directories and manifests", () => {
    const fixture = createFixture();
    const outside = mkdtempSync(
      join(tmpdir(), "orbsie-python-notices-output-"),
    );
    try {
      symlinkSync(outside, join(fixture.bundle, "licenses"));
      expect(() => copyPythonNotices(fixture.root, fixture.bundle)).toThrow(
        /bundle licenses directory must not be a symlink/,
      );

      rmSync(join(fixture.bundle, "licenses"), { force: true });
      mkdirSync(join(fixture.bundle, "licenses/python"), { recursive: true });
      const outputManifest = join(
        fixture.bundle,
        "licenses/python/manifest.json",
      );
      const outsideManifest = join(outside, "manifest.json");
      writeFileSync(outsideManifest, "sentinel\n");
      symlinkSync(outsideManifest, outputManifest);
      expect(() => copyPythonNotices(fixture.root, fixture.bundle)).toThrow(
        /output manifest must not be a symlink/,
      );
      expect(readFileSync(outsideManifest, "utf8")).toBe("sentinel\n");
    } finally {
      cleanup(fixture.root);
      cleanup(outside);
    }
  });

  it("rejects provenance URLs outside the pinned HTTPS hosts", () => {
    const fixture = createFixture();
    try {
      fixture.manifest[0].archiveURL =
        "https://files.pythonhosted.org.evil.test/archive";
      writeManifest(fixture.root, fixture.manifest);
      expect(() => copyPythonNotices(fixture.root, fixture.bundle)).toThrow(
        /outside the allowed HTTPS host/,
      );
    } finally {
      cleanup(fixture.root);
    }
  });
});
