import type { CatalogModel } from "./model-modes";
import { modelQualityRanks } from "./model-rankings";

type Provider = "openrouter" | "gateway";
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}
export function pricePerMillion(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    return null;
  const amount = Number(value) * 1_000_000;
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}
export function qualityRank(id: string): number | null {
  // These are provider namespace aliases only. Preserve the actual request ID.
  const rankedId = id
    .replace(/^zai\//, "z-ai/")
    .replace(/^spacexai\//, "x-ai/");
  return Object.hasOwn(modelQualityRanks, rankedId)
    ? modelQualityRanks[rankedId]
    : null;
}
export function catalogModels(
  data: unknown,
  provider: Provider,
): CatalogModel[] {
  if (!Array.isArray(data)) throw Error("Invalid catalog");
  const models: CatalogModel[] = [];
  for (const value of data) {
    const model = record(value);
    if (typeof model.id !== "string" || !model.id.trim()) continue;
    const supported =
      provider === "gateway"
        ? model.type === undefined || model.type === "language"
        : Array.isArray(model.supported_parameters) &&
          model.supported_parameters.includes("tools");
    // Batch variants require an asynchronous batch submission, not this live relay.
    if (!supported || model.id.endsWith(":batch")) continue;
    const prices = record(model.pricing);
    models.push({
      id: model.id,
      name:
        typeof model.name === "string" && model.name.trim()
          ? model.name
          : model.id,
      inputPrice: pricePerMillion(
        prices[provider === "gateway" ? "input" : "prompt"],
      ),
      cachedInputPrice: pricePerMillion(prices.input_cache_read),
      outputPrice: pricePerMillion(
        prices[provider === "gateway" ? "output" : "completion"],
      ),
      qualityRank: qualityRank(model.id),
    });
  }
  return models.sort(
    (a, b) =>
      (a.qualityRank ?? Infinity) - (b.qualityRank ?? Infinity) ||
      a.name.localeCompare(b.name, "en") ||
      a.id.localeCompare(b.id, "en"),
  );
}
