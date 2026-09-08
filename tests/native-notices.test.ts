import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectNativeNotices,
  main,
  parseLdd,
  writeManifest,
} from "../scripts/inventory-native-notices.mjs";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("native dependency notice inventory", () => {
  it("parses resolved paths, spaces, loader entries, and not-found libraries", () => {
    const entries = parseLdd(
      [
        "linux-vdso.so.1 (0x00007f00)",
        "libscene.so => /opt/Blender Runtime/lib scene.so (0x1234)",
        "libmissing.so => not found",
        "/lib64/ld-linux-x86-64.so.2 (0x5678)",
      ].join("\n"),
    );

    expect(entries).toEqual([
      expect.objectContaining({
        soname: "linux-vdso.so.1",
        path: null,
        status: "unresolved",
        reason: "no-filesystem-path",
      }),
      expect.objectContaining({
        soname: "libscene.so",
        path: "/opt/Blender Runtime/lib scene.so",
        status: "resolved",
      }),
      expect.objectContaining({
        soname: "libmissing.so",
        path: null,
        status: "unresolved",
        reason: "not-found",
      }),
      expect.objectContaining({
        soname: "/lib64/ld-linux-x86-64.so.2",
        path: "/lib64/ld-linux-x86-64.so.2",
        status: "resolved",
      }),
    ]);
  });

  it("bounds ldd entries before returning an unbounded dependency list", () => {
    const output = Array.from(
      { length: 2049 },
      (_, index) =>
        `lib${index}.so => /lib/lib${index}.so (0x${index.toString(16)})`,
    ).join("\n");
    expect(() => parseLdd(output)).toThrow(/more than 2048 entries/);
  });

  it("records multiarch ownership, merged-usr aliases, metadata, and notice hashes", async () => {
    const calls: Array<{ command: string; args: string[]; options: unknown }> =
      [];
    const realpaths: Record<string, string> = {
      "/opt/Blender Runtime/blender": "/opt/Blender Runtime/blender",
      "/lib/x86_64-linux-gnu/libscene.so.1":
        "/usr/lib/x86_64-linux-gnu/libscene.so.1",
      "/usr/share/doc/libscene/copyright": "/srv/docs/libscene/copyright",
    };
    const run = async (command: string, args: string[], options: unknown) => {
      calls.push({ command, args, options });
      expect(command).toBe("dpkg-query");
      expect(options).toEqual(expect.not.objectContaining({ shell: true }));
      if (args[0] === "-S") {
        const path = args[1];
        if (path === "/opt/Blender Runtime/blender")
          return { stdout: "blender:amd64: /opt/Blender Runtime/blender\n" };
        if (path === "/lib/x86_64-linux-gnu/libscene.so.1")
          return {
            stdout:
              "libscene:amd64: /lib/x86_64-linux-gnu/libscene.so.1\nwrong:amd64: /lib/x86_64-linux-gnu/libscene.so.2\n",
          };
        if (path === "/usr/lib/x86_64-linux-gnu/libscene.so.1")
          return {
            stdout: "libscene:amd64: /usr/lib/x86_64-linux-gnu/libscene.so.1\n",
          };
        throw Object.assign(new Error("not owned"), { code: "ENOENT" });
      }
      expect(args[0]).toBe("-W");
      const packageName = args[2];
      if (packageName === "blender:amd64")
        return { stdout: "blender:amd64\t4.0.2\tblender\t4.0.2\tamd64\n" };
      return { stdout: "libscene:amd64\t1.2.3\tlibscene\t1.2.3\tamd64\n" };
    };
    const readFile = async (path: string) => {
      expect(path).toBe("/srv/docs/libscene/copyright");
      return Buffer.from("libscene copyright\n");
    };
    const result = await collectNativeNotices(
      [
        { path: "/opt/Blender Runtime/blender", kind: "binary" },
        {
          path: "/lib/x86_64-linux-gnu/libscene.so.1",
          kind: "dependency",
          soname: "libscene.so.1",
        },
      ],
      {
        run,
        readFile,
        realpath: async (path: string) => realpaths[path] || path,
      },
    );

    const scene = result.files.find(
      (entry) => entry.path === "/lib/x86_64-linux-gnu/libscene.so.1",
    );
    expect(result.packages.some((record) => record.package === "wrong")).toBe(
      false,
    );
    expect(scene?.canonicalPath).toBe(
      "/usr/lib/x86_64-linux-gnu/libscene.so.1",
    );
    expect(scene?.owner).toMatchObject({
      package: "libscene",
      architecture: "amd64",
      packageWithArchitecture: "libscene:amd64",
    });
    expect(result.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          package: "libscene",
          architecture: "amd64",
          metadata: expect.objectContaining({
            version: "1.2.3",
            sourcePackage: "libscene",
            sourceVersion: "1.2.3",
          }),
          notice: expect.objectContaining({
            status: "resolved",
            path: "/srv/docs/libscene/copyright",
            bytes: 19,
            sha256: digest("libscene copyright\n"),
          }),
        }),
      ]),
    );
    expect(
      calls.some(
        ({ args }) =>
          args[0] === "-S" && args[1] === "/lib/x86_64-linux-gnu/libscene.so.1",
      ),
    ).toBe(true);
    expect(
      calls.some(
        ({ args }) =>
          args[0] === "-S" &&
          args[1] === "/usr/lib/x86_64-linux-gnu/libscene.so.1",
      ),
    ).toBe(true);
    expect(
      calls.some(({ args }) => args.includes("/opt/Blender Runtime/blender")),
    ).toBe(true);
  });

  it("keeps missing dependencies, owners, metadata, and notices explicit", async () => {
    const result = await collectNativeNotices(
      [
        { path: "/opt/blender", kind: "binary" },
        {
          path: "/opt/missing lib.so",
          kind: "dependency",
          soname: "libmissing.so",
        },
        {
          path: null,
          kind: "dependency",
          soname: "libnotfound.so",
          reason: "not-found",
        },
        { path: "/opt/no-notice.so", kind: "dependency" },
      ],
      {
        run: async (command: string, args: string[]) => {
          if (command !== "dpkg-query") throw new Error("unexpected command");
          if (args[0] === "-S" && args[1] === "/opt/no-notice.so")
            return { stdout: "no-notice:amd64: /opt/no-notice.so\n" };
          if (args[0] === "-W")
            throw Object.assign(new Error("package disappeared"), {
              code: "ENOENT",
            });
          throw Object.assign(new Error("not owned"), { code: "ENOENT" });
        },
        readFile: async () => {
          throw Object.assign(new Error("missing copyright"), {
            code: "ENOENT",
          });
        },
        realpath: async (path: string) => path,
      },
    );

    expect(result.unresolved.dependencies).toEqual([
      expect.objectContaining({
        soname: "libnotfound.so",
        reason: "not-found",
      }),
    ]);
    expect(result.unresolved.owners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/opt/blender" }),
        expect.objectContaining({ path: "/opt/missing lib.so" }),
      ]),
    );
    expect(result.unresolved.notices).toEqual([
      expect.objectContaining({ package: "no-notice", reason: "not-found" }),
    ]);
    expect(result.packages[0].metadata).toMatchObject({
      status: "unresolved",
      reason: "package-metadata-not-found",
    });
  });

  it("rejects an existing output before invoking ldd and preserves its bytes", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbsie-native-notices-test-"));
    const output = join(root, "existing manifest.json");
    writeFileSync(output, "keep me\n");
    try {
      await expect(
        main(["--binary", "/opt/Blender Runtime/blender", "--output", output]),
      ).rejects.toThrow(/output already exists/i);
      expect(readFileSync(output, "utf8")).toBe("keep me\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses exclusive creation for a new manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbsie-native-notices-test-"));
    const output = join(root, "manifest.json");
    try {
      await writeManifest(output, { systemInventoryOnly: true });
      expect(existsSync(output)).toBe(true);
      await expect(
        writeManifest(output, { overwritten: true }),
      ).rejects.toThrow(/output already exists/i);
      expect(readFileSync(output, "utf8")).toContain("systemInventoryOnly");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
