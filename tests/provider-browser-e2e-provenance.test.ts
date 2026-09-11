import { describe, expect, it, vi } from "vitest";
import {
  collectHarnessCheckout,
  collectProviderBrowserE2EProvenance,
  HARNESS_REPOSITORY_ROOT,
  parseApplicationSourceCommit,
} from "../scripts/lib/provider-browser-e2e-provenance.mjs";
import { emptyReport } from "../scripts/provider-browser-e2e.mjs";

const baseConfig = {
  provider: "openrouter",
  baseOrigin: "http://127.0.0.1:3000",
  expectedModel: "openai/gpt-5.6-luna",
  keyScope: "local-only",
  outputCap: 512,
  requireGeometryEdit: false,
  publication: false,
  cloudRecovery: false,
  interruptedRecovery: false,
  interruptionMethod: "stop",
  applicationSource: parseApplicationSourceCommit(undefined),
};

describe("provider browser E2E provenance", () => {
  it("records a valid app SHA as operator-supplied and unverified", () => {
    expect(parseApplicationSourceCommit("ABCDEF1")).toEqual({
      sourceCommit: "ABCDEF1",
      status: "operator-supplied-unverified",
    });
  });

  it("rejects an invalid app SHA before it can enter a report", () => {
    expect(() => parseApplicationSourceCommit("not-a-commit")).toThrow(
      /hexadecimal commit SHA/,
    );
  });

  it("marks an omitted app SHA as unrecorded", () => {
    expect(parseApplicationSourceCommit(undefined)).toEqual({
      sourceCommit: null,
      status: "unrecorded",
    });
    const report = emptyReport(baseConfig, {
      checkedAt: "2026-09-10T00:00:00.000Z",
      harness: {
        checkoutSHA: "a".repeat(40),
        dirty: false,
        status: "available",
      },
      application: parseApplicationSourceCommit(undefined),
    });
    expect(report.checkedAt).toBe("2026-09-10T00:00:00.000Z");
    expect(report.provenance.application).toEqual({
      sourceCommit: null,
      status: "unrecorded",
    });
  });

  it("records one clean local checkout and keeps git failures unknown", async () => {
    const runGit = vi.fn(async (_command: string, args: string[]) =>
      args[0] === "rev-parse"
        ? { stdout: "b".repeat(40) + "\n" }
        : { stdout: "" },
    );
    await expect(
      collectProviderBrowserE2EProvenance({
        appSourceCommit: "c".repeat(40),
        checkedAt: "2026-09-10T00:00:01.000Z",
        cwd: "/tmp/not-used-by-the-stub",
        runGit,
      }),
    ).resolves.toEqual({
      checkedAt: "2026-09-10T00:00:01.000Z",
      harness: {
        checkoutSHA: "b".repeat(40),
        dirty: false,
        status: "available",
      },
      application: {
        sourceCommit: "c".repeat(40),
        status: "operator-supplied-unverified",
      },
    });
    expect(runGit).toHaveBeenCalledTimes(2);

    const defaultCwds: unknown[] = [];
    const dirty = await collectHarnessCheckout({
      runGit: vi.fn(
        async (_command: string, args: string[], options: { cwd?: string }) => {
          defaultCwds.push(options.cwd);
          return args[0] === "rev-parse"
            ? { stdout: "d".repeat(40) + "\n" }
            : {
                stdout: " M scripts/provider-browser-e2e.mjs\n?? private.env\n",
              };
        },
      ),
    });
    expect(defaultCwds).toEqual([
      HARNESS_REPOSITORY_ROOT,
      HARNESS_REPOSITORY_ROOT,
    ]);
    expect(dirty).toEqual({
      checkoutSHA: "d".repeat(40),
      dirty: true,
      status: "available",
    });
    expect(JSON.stringify(dirty)).not.toContain("private.env");

    const unavailable = await collectHarnessCheckout({
      cwd: "/tmp/outside-a-checkout",
      runGit: vi.fn(async () => {
        throw new Error("not a git checkout");
      }),
    });
    expect(unavailable).toEqual({
      checkoutSHA: null,
      dirty: null,
      status: "unavailable",
    });
  });
});
