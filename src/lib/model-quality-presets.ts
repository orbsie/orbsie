import {
  resolveChatGPTPresetOptions,
  type ChatGPTPresetModel,
} from "./chatgpt-model-presets";
import { modelModesForProvider, type CatalogModel } from "./model-modes";

export type ModelQualityLabel = "Quality" | "Balanced" | "Budget";

export type ModelQualityOption = {
  label: ModelQualityLabel;
  available: boolean;
  description: string;
  model: string | null;
  effort?: string | null;
};

export function isCurrentCatalogRequest(
  controller: AbortController,
  activeController: AbortController | null,
  requestGeneration: number,
  currentGeneration: number,
  requestProvider: string,
  activeProvider: string,
) {
  return (
    activeController === controller &&
    !controller.signal.aborted &&
    requestGeneration === currentGeneration &&
    requestProvider === activeProvider
  );
}

function finitePrice(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

/** Keep the inline selector dependent on the bounded server catalog shape. */
export function parseCatalogModels(value: unknown): CatalogModel[] | null {
  if (!Array.isArray(value) || value.length > 512) return null;
  const seen = new Set<string>();
  const parsed: CatalogModel[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return null;
    const model = entry as Record<string, unknown>;
    if (
      typeof model.id !== "string" ||
      model.id.length === 0 ||
      model.id.length > 256 ||
      !/^[~A-Za-z0-9._:/-]+$/.test(model.id) ||
      ["__proto__", "constructor", "prototype"].includes(model.id) ||
      typeof model.name !== "string" ||
      model.name.length === 0 ||
      model.name.length > 256 ||
      !finitePrice(model.inputPrice) ||
      !finitePrice(model.cachedInputPrice) ||
      !finitePrice(model.outputPrice) ||
      (model.qualityRank !== null &&
        (typeof model.qualityRank !== "number" ||
          !Number.isSafeInteger(model.qualityRank) ||
          model.qualityRank < 1)) ||
      seen.has(model.id)
    )
      return null;
    seen.add(model.id);
    parsed.push({
      id: model.id,
      name: model.name,
      inputPrice: model.inputPrice,
      cachedInputPrice: model.cachedInputPrice,
      outputPrice: model.outputPrice,
      qualityRank: model.qualityRank,
      ...(model.capabilities && typeof model.capabilities === "object"
        ? { capabilities: model.capabilities as CatalogModel["capabilities"] }
        : {}),
    });
  }
  return parsed;
}

const descriptions: Record<ModelQualityLabel, string> = {
  Quality: "More room for complex worlds",
  Balanced: "A capable everyday choice",
  Budget: "Faster, lower-cost creation",
};

export function modelQualityOptions(
  provider: string,
  catalog: readonly CatalogModel[],
  chatGPTCatalog: readonly ChatGPTPresetModel[] = [],
): ModelQualityOption[] {
  if (provider === "chatgpt-hosted") {
    return resolveChatGPTPresetOptions(chatGPTCatalog).map((option) => ({
      label: option.label,
      available: option.available,
      description: descriptions[option.label],
      model: option.model,
      effort: option.effort,
    }));
  }
  if (provider === "free") return [];
  return modelModesForProvider(provider).map((mode) => ({
    label: mode.label,
    available: catalog.some((model) => model.id === mode.id),
    description: descriptions[mode.label],
    model: mode.id,
  }));
}

export function selectedModelQuality(
  provider: string,
  model: string,
  effort: string | undefined,
  options: readonly ModelQualityOption[],
): ModelQualityLabel | null {
  const selected = options.find(
    (option) =>
      option.available &&
      option.model === model &&
      (provider !== "chatgpt-hosted" || option.effort === effort),
  );
  return selected?.label ?? null;
}
