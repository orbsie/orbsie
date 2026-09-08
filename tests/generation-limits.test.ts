import { afterEach, describe, expect, it, vi } from "vitest";
import { generationMaxTokens } from "../src/lib/server/generation-limits";

afterEach(() => vi.unstubAllEnvs());
describe("server-owned generation output budgets", () => {
  it("preserves existing default and free ceilings", () => {
    vi.stubEnv("ORBSIE_GENERATION_MAX_TOKENS", "");
    expect(generationMaxTokens()).toBe(10000);
    expect(generationMaxTokens(true)).toBe(4096);
  });
  it("limits both paid and free calls for restricted local credentials", () => {
    vi.stubEnv("ORBSIE_GENERATION_MAX_TOKENS", "512");
    expect(generationMaxTokens()).toBe(512);
    expect(generationMaxTokens(true)).toBe(512);
    vi.stubEnv("ORBSIE_GENERATION_MAX_TOKENS", "9000");
    expect(generationMaxTokens(true)).toBe(4096);
  });
  it.each(["0", "-1", "512x", "1.5", "10001", "Infinity", " 512"])(
    "rejects invalid configuration %s instead of using a larger fallback",
    (value) => {
      vi.stubEnv("ORBSIE_GENERATION_MAX_TOKENS", value);
      expect(() => generationMaxTokens()).toThrow();
    },
  );
});
