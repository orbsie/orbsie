import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  BLENDER_RUNTIME_ENV,
  resolveBlenderRuntime,
} from "../scripts/blender-runtime";
import { runBlenderModelingJob } from "../scripts/blender-modeling";

const packagedRuntime = "/tmp/orbsie-blender-runtime-official-4.0.2";

describe("packaged Blender runtime", () => {
  it.skipIf(!existsSync(packagedRuntime))(
    "validates the official release prototype manifest and bundled Python",
    () => {
      const previous = process.env[BLENDER_RUNTIME_ENV];
      process.env[BLENDER_RUNTIME_ENV] = packagedRuntime;
      try {
        const runtime = resolveBlenderRuntime();
        expect(runtime.kind).toBe("packaged");
        expect(runtime.version).toBe("4.0.2");
        expect(runtime.pythonVersion).toBe("python3.10");
        expect(runtime.numpySite).toContain(
          "/share/blender/python/lib/python3.10/site-packages",
        );
      } finally {
        if (previous === undefined) delete process.env[BLENDER_RUNTIME_ENV];
        else process.env[BLENDER_RUNTIME_ENV] = previous;
      }
    },
  );

  it("rejects a configured runtime without a manifest", () => {
    const previous = process.env[BLENDER_RUNTIME_ENV];
    process.env[BLENDER_RUNTIME_ENV] =
      "/tmp/does-not-contain-a-blender-runtime";
    try {
      expect(() => resolveBlenderRuntime()).toThrow(/packaged Blender runtime/);
    } finally {
      if (previous === undefined) delete process.env[BLENDER_RUNTIME_ENV];
      else process.env[BLENDER_RUNTIME_ENV] = previous;
    }
  });

  it("rejects a manifest that does not identify the official release prototype", () => {
    const root = mkdtempSync(join(tmpdir(), "orbsie-blender-runtime-invalid-"));
    const previous = process.env[BLENDER_RUNTIME_ENV];
    process.env[BLENDER_RUNTIME_ENV] = root;
    try {
      writeFileSync(
        join(root, "manifest.json"),
        JSON.stringify({
          schema: "orbsie.blender-runtime/v1",
          status: "installed-system-package-prototype",
        }),
      );
      expect(() => resolveBlenderRuntime()).toThrow(
        /not an official release prototype/,
      );
    } finally {
      if (previous === undefined) delete process.env[BLENDER_RUNTIME_ENV];
      else process.env[BLENDER_RUNTIME_ENV] = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an official-looking runtime version without a compiled release pin", () => {
    const root = mkdtempSync(join(tmpdir(), "orbsie-blender-runtime-unknown-"));
    const previous = process.env[BLENDER_RUNTIME_ENV];
    process.env[BLENDER_RUNTIME_ENV] = root;
    try {
      writeFileSync(
        join(root, "manifest.json"),
        JSON.stringify({
          schema: "orbsie.blender-runtime/v1",
          status: "official-release-tarball-prototype",
          source: {
            kind: "official-release-tarball",
            blenderVersion: "9.9.9",
            archive: {
              downloaded: true,
              sha256: "a".repeat(64),
              pinnedSha256: "a".repeat(64),
            },
          },
        }),
      );
      expect(() => resolveBlenderRuntime()).toThrow(
        /not an explicitly pinned official runtime/,
      );
    } finally {
      if (previous === undefined) delete process.env[BLENDER_RUNTIME_ENV];
      else process.env[BLENDER_RUNTIME_ENV] = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!existsSync(packagedRuntime))(
    "runs a typed modeling job through the packaged runtime",
    async () => {
      const previous = process.env[BLENDER_RUNTIME_ENV];
      process.env[BLENDER_RUNTIME_ENV] = packagedRuntime;
      try {
        const result = await runBlenderModelingJob({
          version: 1,
          parts: [
            {
              id: "packaged-box",
              shape: "box",
              position: [1, 2, 3],
              color: "#3567ab",
              bevel: 0.05,
            },
          ],
        });
        expect(result.blenderVersion).toBe("4.0.2");
        expect(result.glb.byteLength).toBeGreaterThan(0);
        expect(result.glb.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
        expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(result.objects).toEqual([
          expect.objectContaining({ id: "packaged-box", shape: "box" }),
        ]);
      } finally {
        if (previous === undefined) delete process.env[BLENDER_RUNTIME_ENV];
        else process.env[BLENDER_RUNTIME_ENV] = previous;
      }
    },
  );
});
