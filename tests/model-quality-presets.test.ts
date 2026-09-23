import { describe, expect, it } from "vitest";
import {
  isCurrentCatalogRequest,
  modelQualityOptions,
  parseCatalogModels,
  selectedModelQuality,
} from "../src/lib/model-quality-presets";

const catalog = (ids: string[]) =>
  ids.map((id) => ({
    id,
    name: id,
    inputPrice: null,
    cachedInputPrice: null,
    outputPrice: null,
    qualityRank: null,
  }));

describe("inline model quality presets", () => {
  it("uses each provider's exact catalog IDs, including Gateway Budget", () => {
    const openrouter = modelQualityOptions(
      "openrouter",
      catalog([
        "openai/gpt-6-astra",
        "openai/gpt-6-luna",
        "z-ai/glm-5.3-flash",
      ]),
    );
    const gateway = modelQualityOptions(
      "gateway",
      catalog([
        "openai/gpt-6-astra",
        "openai/gpt-6-luna",
        "zai/glm-5.3-flash",
      ]),
    );
    expect(
      openrouter.map(({ label, model, available }) => [
        label,
        model,
        available,
      ]),
    ).toEqual([
      ["Quality", "openai/gpt-6-astra", true],
      ["Balanced", "openai/gpt-6-luna", true],
      ["Budget", "z-ai/glm-5.3-flash", true],
    ]);
    expect(
      gateway.map(({ label, model, available }) => [label, model, available]),
    ).toEqual([
      ["Quality", "openai/gpt-6-astra", true],
      ["Balanced", "openai/gpt-6-luna", true],
      ["Budget", "zai/glm-5.3-flash", true],
    ]);
  });

  it("keeps exactly three ChatGPT choices catalog-backed and effort-aware", () => {
    const options = modelQualityOptions(
      "chatgpt-hosted",
      [],
      [
        {
          model: "gpt-6-astra",
          supportedReasoningEfforts: ["low", "high"],
          defaultReasoningEffort: "low",
        },
        {
          model: "gpt-6-luna",
          supportedReasoningEfforts: ["low", "medium"],
          defaultReasoningEffort: "low",
        },
      ],
    );
    expect(
      options.map(({ label, model, effort, available }) => [
        label,
        model,
        effort,
        available,
      ]),
    ).toEqual([
      ["Quality", "gpt-6-astra", "high", true],
      ["Balanced", "gpt-6-luna", "medium", true],
      ["Budget", "gpt-6-luna", "low", true],
    ]);
    expect(
      selectedModelQuality("chatgpt-hosted", "gpt-6-luna", "low", options),
    ).toBe("Budget");
    expect(
      selectedModelQuality("chatgpt-hosted", "gpt-6-luna", "high", options),
    ).toBeNull();
  });

  it("keeps unavailable choices disabled and leaves custom selections neutral", () => {
    const options = modelQualityOptions(
      "openrouter",
      catalog(["openai/gpt-6-luna"]),
    );
    expect(options.map(({ available }) => available)).toEqual([
      false,
      true,
      false,
    ]);
    expect(
      selectedModelQuality("openrouter", "custom/model", undefined, options),
    ).toBeNull();
    expect(modelQualityOptions("free", catalog([]))).toEqual([]);
  });

  it("rejects malformed or duplicate catalog rows before exposing choices", () => {
    const valid = catalog(["openai/gpt-6-luna"]);
    expect(parseCatalogModels(valid)).toEqual(valid);
    expect(
      parseCatalogModels([{ ...valid[0], id: "~openai/gpt-6-luna-latest" }]),
    ).not.toBeNull();
    expect(parseCatalogModels([{ ...valid[0], id: "__proto__" }])).toBeNull();
    expect(
      parseCatalogModels([
        ...valid,
        { ...valid[0], id: "openai/gpt-6-luna" },
      ]),
    ).toBeNull();
    expect(
      parseCatalogModels([{ ...valid[0], inputPrice: Number.NaN }]),
    ).toBeNull();
  });

  it("ignores catalog responses from an old request, account, or provider", () => {
    const controller = new AbortController();
    const replacement = new AbortController();
    expect(
      isCurrentCatalogRequest(
        controller,
        controller,
        3,
        3,
        "openrouter",
        "openrouter",
      ),
    ).toBe(true);
    expect(
      isCurrentCatalogRequest(
        controller,
        replacement,
        3,
        3,
        "openrouter",
        "openrouter",
      ),
    ).toBe(false);
    expect(
      isCurrentCatalogRequest(
        controller,
        controller,
        2,
        3,
        "openrouter",
        "openrouter",
      ),
    ).toBe(false);
    expect(
      isCurrentCatalogRequest(
        controller,
        controller,
        3,
        3,
        "gateway",
        "openrouter",
      ),
    ).toBe(false);
    controller.abort();
    expect(
      isCurrentCatalogRequest(
        controller,
        controller,
        3,
        3,
        "openrouter",
        "openrouter",
      ),
    ).toBe(false);
  });
});
