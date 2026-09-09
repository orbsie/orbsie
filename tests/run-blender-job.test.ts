import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const script = join(process.cwd(), "scripts/run-blender-job.mjs");
const roots: string[] = [];

function temporary() {
  const root = mkdtempSync(join(tmpdir(), "orbsie-agent-blender-test-"));
  roots.push(root);
  return root;
}

function validJob() {
  return {
    version: 1,
    parts: [{ id: "box", shape: "box", color: "#ffffff" }],
  };
}

function run(args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    timeout: 15_000,
  });
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("offline Blender job CLI", () => {
  it("prints help without requiring a runtime", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("JOB.json NEW_OUTPUT_DIRECTORY");
    expect(result.stderr).toBe("");
  });

  it("rejects an oversized input before creating output", () => {
    const root = temporary();
    const input = join(root, "job.json");
    const output = join(root, "output");
    writeFileSync(input, `{"version":1,"padding":"${"x".repeat(512 * 1024)}"}`);
    const result = run([input, output]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("512 KiB");
    expect(existsSync(output)).toBe(false);
  });

  it("preserves an existing destination and refuses to run", () => {
    const root = temporary();
    const input = join(root, "job.json");
    const output = join(root, "output");
    writeFileSync(input, JSON.stringify(validJob()));
    mkdirSync(output);
    writeFileSync(join(output, "sentinel"), "keep me\n");
    const result = run([input, output]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("already exists");
    expect(readFileSync(join(output, "sentinel"), "utf8")).toBe("keep me\n");
  });

  it("rejects invalid typed jobs and removes its own partial output", () => {
    const root = temporary();
    const input = join(root, "job.json");
    const output = join(root, "output");
    writeFileSync(input, JSON.stringify({ version: 1, parts: [] }));
    const result = run([input, output]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/invalid|at least one|parts/i);
    expect(existsSync(output)).toBe(false);
  });
});
