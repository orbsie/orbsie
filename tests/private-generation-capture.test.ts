import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capturePrivateGenerationRejection } from "../src/lib/server/private-generation-capture";

afterEach(() => vi.unstubAllEnvs());

describe("private generation capture", () => {
  it("writes a bounded mode-0600 record only when opted in off Vercel", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orbsie-capture-"));
    try {
      capturePrivateGenerationRejection({ subreason: "json", text: "x" });
      vi.stubEnv("ORBSIE_PRIVATE_PARSER_CAPTURE_DIR", directory);
      vi.stubEnv("VERCEL", "1");
      capturePrivateGenerationRejection({ subreason: "json", text: "x" });
      await expect(stat(join(directory, "rejections.jsonl"))).rejects.toThrow();

      vi.stubEnv("VERCEL", "0");
      capturePrivateGenerationRejection({
        subreason: "command-apply-rejected",
        text: "y".repeat(5000),
        error: new Error("Unknown entity"),
      });
      const file = join(directory, "rejections.jsonl");
      expect(((await stat(file)).mode & 0o777).toString(8)).toBe("600");
      const record = JSON.parse(await readFile(file, "utf8"));
      expect(record).toMatchObject({
        subreason: "command-apply-rejected",
        error: "Unknown entity",
      });
      expect(record.text).toHaveLength(4096);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
