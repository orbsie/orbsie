import type { ModelCapabilities } from "../model-capabilities";
import type { GenerationOutputFormat } from "./generation";
type Provider = "openrouter" | "gateway";

const MAX_OVERRIDE_BYTES = 4096;
const MAX_OVERRIDE_COUNT = 32;
const MAX_OVERRIDE_KEY_LENGTH = 200;
const MAX_OVERRIDE_MODEL_LENGTH = 150;

export class GenerationFormatConfigError extends Error {
  constructor() {
    super("Generation format configuration is invalid.");
    this.name = "GenerationFormatConfigError";
  }
}

function invalidConfig(): never {
  throw new GenerationFormatConfigError();
}

/**
 * Parse a server-only compatibility assertion. The value is deliberately
 * narrow and bounded because it changes the provider request format.
 */
export function parseGenerationFormatOverrides(
  raw = process.env.ORBSIE_GENERATION_FORMAT_OVERRIDES,
): ReadonlyMap<string, GenerationOutputFormat> {
  if (raw === undefined) return new Map();
  if (new TextEncoder().encode(raw).byteLength > MAX_OVERRIDE_BYTES)
    return invalidConfig();
  if (raw.trim() === "") return new Map();

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalidConfig();
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalidConfig();

  const entries = Object.entries(value);
  if (entries.length > MAX_OVERRIDE_COUNT) return invalidConfig();
  const overrides = new Map<string, GenerationOutputFormat>();
  for (const [key, format] of entries) {
    const separator = key.indexOf(":");
    const provider = separator > 0 ? key.slice(0, separator) : "";
    const model = separator > 0 ? key.slice(separator + 1) : "";
    if (
      key.length > MAX_OVERRIDE_KEY_LENGTH ||
      (provider !== "openrouter" && provider !== "gateway") ||
      model.length === 0 ||
      model.length > MAX_OVERRIDE_MODEL_LENGTH ||
      /[\u0000-\u0020\u007f]/.test(model) ||
      (format !== "ndjson" &&
        format !== "json-object" &&
        format !== "json-schema")
    )
      return invalidConfig();
    overrides.set(key, format);
  }
  return overrides;
}

export function resolveGenerationOutputFormat({
  provider,
  model,
  capabilities,
  overrides,
}: {
  provider: Provider;
  model: string;
  capabilities?: ModelCapabilities;
  overrides?: ReadonlyMap<string, GenerationOutputFormat>;
}): GenerationOutputFormat {
  const selectedOverride = (overrides ?? parseGenerationFormatOverrides()).get(
    `${provider}:${model}`,
  );
  if (selectedOverride) return selectedOverride;

  // Gateway format auto-selection stays conservative until its metadata and
  // acceptance establish a supported structured request shape.
  if (provider !== "openrouter") return "ndjson";
  if (capabilities?.jsonObject?.supported === true) return "json-object";
  if (capabilities?.jsonSchema?.supported === true) return "json-schema";
  return "ndjson";
}
