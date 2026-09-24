import { describe, expect, it, vi } from "vitest";
import { preflightGenerationOrigin } from "../scripts/verify-live-authoring-review.mjs";

describe("live authoring origin preflight", () => {
  it("posts malformed JSON only to the configured loopback origin and accepts the parser 400", async () => {
    const response = new Response(null, { status: 400 });
    const readText = vi.spyOn(response, "text");
    const readJSON = vi.spyOn(response, "json");
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url).toBe("http://127.0.0.1:3100/api/generate");
      expect(options).toMatchObject({
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:3100",
          "Content-Type": "application/json",
        },
        body: "{",
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return response;
    });

    await expect(
      preflightGenerationOrigin("http://127.0.0.1:3100", fetchImpl),
    ).resolves.toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readText).not.toHaveBeenCalled();
    expect(readJSON).not.toHaveBeenCalled();
  });

  it("reports an origin rejection explicitly without reading the response", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }));

    await expect(
      preflightGenerationOrigin("http://localhost:3100", fetchImpl),
    ).rejects.toMatchObject({
      code: "generation-origin-preflight-rejected",
      status: 403,
    });
  });

  it("refuses non-loopback targets before making a request", async () => {
    const fetchImpl = vi.fn();

    await expect(
      preflightGenerationOrigin("https://example.com", fetchImpl),
    ).rejects.toMatchObject({
      code: "loopback-origin-required-for-preflight",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
