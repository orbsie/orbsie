import { afterEach, describe, expect, it, vi } from "vitest";
import { modelCapabilities } from "../src/lib/model-capabilities";
import {
  parseGenerationFormatOverrides,
  resolveGenerationOutputFormat,
} from "../src/lib/server/generation-output-format";

afterEach(() => vi.unstubAllEnvs());

function model(provider: "openrouter" | "gateway", parameters?: string[]) {
  return modelCapabilities(
    provider === "gateway"
      ? {
          id: "openai/gpt-5.6-luna",
          type: "language",
          supported_parameters: parameters,
        }
      : { id: "openai/gpt-5.6-luna", supported_parameters: parameters },
    provider,
  );
}

describe("generation output format selection", () => {
  it("uses json-object only when OpenRouter advertises response_format", () => {
    const capabilities = model("openrouter", ["response_format"]);
    expect(
      resolveGenerationOutputFormat({
        provider: "openrouter",
        model: "openai/gpt-5.6-luna",
        capabilities,
      }),
    ).toBe("json-object");
    expect(capabilities.jsonSchema?.supported).toBe(false);
  });

  it("uses json-schema when response_format is absent but structured_outputs is advertised", () => {
    const capabilities = model("openrouter", ["structured_outputs"]);
    expect(
      resolveGenerationOutputFormat({
        provider: "openrouter",
        model: "openai/gpt-5.6-luna",
        capabilities,
      }),
    ).toBe("json-schema");
    expect(capabilities.jsonObject?.supported).toBe(false);
  });

  it("keeps unknown and unsupported catalogs on NDJSON", () => {
    expect(
      resolveGenerationOutputFormat({
        provider: "openrouter",
        model: "openai/gpt-5.6-luna",
        capabilities: model("openrouter", ["tools"]),
      }),
    ).toBe("ndjson");
    expect(
      resolveGenerationOutputFormat({
        provider: "openrouter",
        model: "openai/gpt-5.6-luna",
        capabilities: model("openrouter"),
      }),
    ).toBe("ndjson");
    expect(
      resolveGenerationOutputFormat({
        provider: "gateway",
        model: "openai/gpt-5.6-luna",
        capabilities: model("gateway", [
          "response_format",
          "structured_outputs",
        ]),
      }),
    ).toBe("ndjson");
  });

  it("accepts exact operator assertions, including an explicit Gateway assertion", () => {
    vi.stubEnv(
      "ORBSIE_GENERATION_FORMAT_OVERRIDES",
      '{"gateway:openai/gpt-5.6-luna":"json-schema"}',
    );
    const overrides = parseGenerationFormatOverrides();
    expect(
      resolveGenerationOutputFormat({
        provider: "gateway",
        model: "openai/gpt-5.6-luna",
        overrides,
      }),
    ).toBe("json-schema");
    expect(
      resolveGenerationOutputFormat({
        provider: "gateway",
        model: "openai/gpt-6-astra",
        overrides,
      }),
    ).toBe("ndjson");
  });

  it("rejects malformed or unbounded override configuration without exposing its contents", () => {
    for (const raw of [
      "not-json",
      "[]",
      '{"openrouter:model":"yaml"}',
      '{"wrong:model":"json-object"}',
      `{"openrouter:${"m".repeat(151)}":"json-object"}`,
      " ".repeat(4097),
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 33 }, (_, index) => [
            `openrouter:model-${index}`,
            "ndjson",
          ]),
        ),
      ),
    ]) {
      expect(() => parseGenerationFormatOverrides(raw)).toThrow(
        "Generation format configuration is invalid.",
      );
      expect(() => parseGenerationFormatOverrides(raw)).not.toThrow(raw);
    }
  });
});
