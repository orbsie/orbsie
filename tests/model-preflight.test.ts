import { afterEach, expect, it, vi } from "vitest";
import { requireGenerationModel } from "../src/lib/server/model-preflight";
afterEach(() => vi.unstubAllGlobals());
it("checks the exact provider model without sending credentials", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      data: [
        {
          id: "actual/model",
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
          supported_parameters: ["tools"],
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(
    (
      await requireGenerationModel(
        "openrouter",
        "actual/model",
        new AbortController().signal,
      )
    ).id,
  ).toBe("actual/model");
  expect(fetcher.mock.calls[0]).toEqual([
    "https://openrouter.ai/api/v1/models",
    expect.objectContaining({ next: { revalidate: 3600 } }),
  ]);
  expect(fetcher.mock.calls[0][1]).not.toHaveProperty("headers");
});
it("rejects unavailable or non-language choices without inference", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ data: [{ id: "image/model", type: "image" }] }),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    requireGenerationModel(
      "gateway",
      "image/model",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    requireGenerationModel(
      "gateway",
      "missing/model",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("fails clearly when catalog verification is unavailable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response("", { status: 503 })),
  );
  await expect(
    requireGenerationModel("gateway", "a/model", new AbortController().signal),
  ).rejects.toMatchObject({ status: 503 });
});
