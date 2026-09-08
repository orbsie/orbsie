import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogModels,
  pricePerMillion,
  qualityRank,
} from "../src/lib/model-catalog";
import {
  modelModes,
  modelModesForProvider,
  isRecommendedModel,
} from "../src/lib/model-modes";
import { GET } from "../src/app/api/models/route";

afterEach(() => vi.unstubAllGlobals());
describe("model catalog estimates", () => {
  it("converts provider token rates without treating unavailable cached prices as free", () => {
    const [router] = catalogModels(
      [
        {
          id: "test/model",
          supported_parameters: ["tools"],
          pricing: { prompt: "0.00001", completion: "0.00005" },
        },
      ],
      "openrouter",
    );
    expect(router).toMatchObject({
      inputPrice: 10,
      cachedInputPrice: null,
      outputPrice: 50,
      qualityRank: null,
    });
    const [gateway] = catalogModels(
      [
        {
          id: "test/model",
          type: "language",
          pricing: {
            input: "0.000002",
            input_cache_read: "0.0000002",
            output: "0.00001",
          },
        },
      ],
      "gateway",
    );
    expect(gateway).toMatchObject({
      inputPrice: 2,
      outputPrice: 10,
    });
    expect(gateway.cachedInputPrice).toBeCloseTo(0.2);
    expect(pricePerMillion("0")).toBe(0);
    for (const invalid of [
      undefined,
      null,
      "",
      " ",
      -1,
      "-0.5",
      true,
      "unknown",
      Infinity,
      "1e309",
    ])
      expect(pricePerMillion(invalid)).toBeNull();
  });
  it("uses the same evidence order across catalogs and places unranked names alphabetically last", () => {
    const ids = [
      "unknown/zebra",
      "anthropic/claude-opus-5",
      "unknown/alpha",
      "moonshotai/kimi-k3",
      "anthropic/claude-fable-5.1",
      "openai/gpt-6-astra",
    ];
    const data = ids.map((id) => ({
      id,
      supported_parameters: ["tools"],
      type: "language",
    }));
    const expected = [
      "moonshotai/kimi-k3",
      "anthropic/claude-fable-5.1",
      "anthropic/claude-opus-5",
      "openai/gpt-6-astra",
      "unknown/alpha",
      "unknown/zebra",
    ];
    for (const provider of ["openrouter", "gateway"] as const)
      expect(catalogModels(data, provider).map((model) => model.id)).toEqual(
        expected,
      );
    expect(qualityRank("openai/gpt-6-astra")).toBeNull();
  });
  it("maps documented provider namespaces for ranking while retaining the request ID", () => {
    const [model] = catalogModels([{ id: "spacexai/grok-4.6" }], "gateway");
    expect(model.id).toBe("spacexai/grok-4.6");
    expect(model.qualityRank).toBe(qualityRank("x-ai/grok-4.6"));
    expect(qualityRank("zai/glm-5.1")).toBe(qualityRank("z-ai/glm-5.1"));
    expect(qualityRank("anthropic/claude-opus-5-unverified")).toBeNull();
  });
  it("retains compatibility filtering and skips malformed rows", () => {
    expect(
      catalogModels(
        [
          null,
          {},
          { id: "image", type: "image" },
          { id: "language", type: "language", pricing: null },
        ],
        "gateway",
      ).map((model) => model.id),
    ).toEqual(["language"]);
    expect(
      catalogModels(
        [{ id: "no-tools" }, { id: "tools", supported_parameters: ["tools"] }],
        "openrouter",
      ).map((model) => model.id),
    ).toEqual(["no-tools", "tools"]);
    expect(modelModes.map((mode) => mode.id)).toEqual([
      "openai/gpt-6-astra",
      "openai/gpt-5.6-luna",
      "z-ai/glm-5.3-flash",
    ]);
  });
  it("resolves the Budget preset using each provider's exact model ID", () => {
    const router = modelModesForProvider("openrouter");
    const gateway = modelModesForProvider("gateway");
    expect(router.map(({ label, id }) => [label, id])).toEqual([
      ["Quality", "openai/gpt-6-astra"],
      ["Balanced", "openai/gpt-5.6-luna"],
      ["Budget", "z-ai/glm-5.3-flash"],
    ]);
    expect(gateway.map(({ id }) => id)).toEqual([
      "openai/gpt-6-astra",
      "openai/gpt-5.6-luna",
      "zai/glm-5.3-flash",
    ]);
    for (const provider of ["openrouter", "gateway"] as const) {
      const modes = modelModesForProvider(provider);
      const models = catalogModels(
        modes.map(({ id }) => ({
          id,
          type: "language",
          supported_parameters: ["tools"],
        })),
        provider,
      );
      for (const mode of modes) {
        expect(models.some(({ id }) => id === mode.id)).toBe(true);
        expect(isRecommendedModel(mode.id)).toBe(true);
      }
    }
    expect(isRecommendedModel("z-ai/glm-5.3-flash:batch")).toBe(false);
  });
  it("excludes async batch variants even when they advertise tool support", () => {
    const data = [
      {
        id: "openai/gpt-6-astra:batch",
        supported_parameters: ["tools"],
        type: "language",
      },
    ];
    expect(catalogModels(data, "openrouter")).toEqual([]);
    expect(catalogModels(data, "gateway")).toEqual([]);
  });
  it("returns estimated pricing and ranking provenance from the public catalog route", async () => {
    const fetcher = vi.fn(async (_url: string, _options?: RequestInit) =>
      Response.json({
        data: [
          {
            id: "moonshotai/kimi-k3",
            supported_parameters: ["tools"],
            pricing: {
              prompt: "0.000001",
              input_cache_read: "0",
              completion: "0.000002",
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(
      new Request("http://localhost/api/models?provider=openrouter"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.models[0]).toMatchObject({
      inputPrice: 1,
      cachedInputPrice: 0,
      outputPrice: 2,
      qualityRank: 1,
    });
    expect(body.ranking).toMatchObject({
      benchmark: "Design Arena — models / 3d",
      snapshotDate: "2026-09-07",
      sourceUrl: "https://openrouter.ai/api/v1/models",
    });
    expect(body.pricing).toMatchObject({
      estimated: true,
      unit: "per 1M tokens",
    });
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://openrouter.ai/api/v1/models",
    );
  });
});

it("declares streaming text without requiring native tools and excludes nontext output", () => {
  const models = catalogModels(
    [
      {
        id: "text",
        architecture: { output_modalities: ["text"] },
        supported_parameters: [],
      },
      {
        id: "image",
        architecture: { output_modalities: ["image"] },
        supported_parameters: ["tools"],
      },
      { id: "unknown" },
    ],
    "openrouter",
  );
  expect(models.map((model) => model.id)).toEqual(["text", "unknown"]);
  expect(models[0].capabilities).toMatchObject({
    text: { supported: true, source: "catalog" },
    streamingText: { supported: true, source: "provider-contract" },
    tools: { supported: false },
  });
  expect(models[1].capabilities?.streamingText.supported).toBe("unknown");
});
it("keeps unknown Gateway capabilities distinct from advertised support", () => {
  const [model] = catalogModels(
    [{ id: "language", type: "language" }],
    "gateway",
  );
  expect(model.capabilities).toMatchObject({
    text: { supported: true },
    streamingText: { supported: "unknown" },
    tools: { supported: "unknown" },
    structuredOutput: { supported: "unknown" },
  });
});
