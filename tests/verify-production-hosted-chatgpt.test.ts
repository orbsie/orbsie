import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyRequest } from "../scripts/verify-production-hosted-chatgpt.mjs";

const script = resolve(
  process.cwd(),
  "scripts/verify-production-hosted-chatgpt.mjs",
);
const liveOptIn = "ORBSIE_PRODUCTION_CHATGPT_E2E";
const statePathEnv = "ORBSIE_PRODUCTION_CHATGPT_STORAGE_STATE";
const originEnv = "ORBSIE_PRODUCTION_CHATGPT_URL";

function run(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("production hosted ChatGPT verifier guards", () => {
  it("admits the editor's catalog and project reads while rejecting writes", () => {
    for (const pathname of ["/api/models", "/api/projects"]) {
      expect(
        classifyRequest({
          origin: "https://orbsie.com",
          pathname,
          method: "GET",
        }),
      ).toBe("allowed");
      expect(
        classifyRequest({
          origin: "https://orbsie.com",
          pathname,
          method: "POST",
        }),
      ).toBe("api-write-or-unknown-read-blocked");
    }
  });
  it("has a no-network preflight that declares inference unavailable", () => {
    const result = run(["--preflight"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      preflight: "passed",
      origin: "https://orbsie.com",
      model: "gpt-6-luna",
      serviceTier: "default",
      outputTokenCeiling: 4096,
      providerOutputCeilingEnforced: false,
      inferenceAllowed: false,
    });
  });

  it("requires explicit opt-in before inspecting any private state", () => {
    const result = run(["test-run"], {
      [liveOptIn]: "",
      [statePathEnv]: "/path/that/must/not/be-inspected",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("live-opt-in-required");
    expect(result.stderr).not.toContain("private-storage-state-unavailable");
  });

  it("accepts only the exact production origin and an outside mode-0600 state file", async () => {
    const directory = await mkdtemp(
      resolve(tmpdir(), "orbsie-production-state-"),
    );
    const statePath = resolve(directory, "state.json");
    try {
      await writeFile(statePath, "{}\n", { mode: 0o600 });
      await chmod(statePath, 0o600);
      const good = run(["--configuration-preflight", "guard-test"], {
        [liveOptIn]: "1",
        [statePathEnv]: statePath,
      });
      expect(good.status).toBe(0);
      expect(JSON.parse(good.stdout)).toMatchObject({
        preflight: "passed",
        origin: "https://orbsie.com",
        privateStateValidated: true,
        inferenceAllowed: false,
      });
      expect(good.stdout).not.toContain(statePath);

      const wrongOrigin = run(["--configuration-preflight", "guard-test"], {
        [liveOptIn]: "1",
        [statePathEnv]: statePath,
        [originEnv]: "https://orbsie.vercel.app/",
      });
      expect(wrongOrigin.status).toBe(1);
      expect(wrongOrigin.stderr).toContain("production-origin-must-match");

      await chmod(statePath, 0o644);
      const loosePermissions = run(
        ["--configuration-preflight", "guard-test"],
        { [liveOptIn]: "1", [statePathEnv]: statePath },
      );
      expect(loosePermissions.status).toBe(1);
      expect(loosePermissions.stderr).toContain(
        "private-storage-state-must-be-mode-0600",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
