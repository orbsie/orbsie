import type { ModelCapabilities } from "./model-capabilities";
export const modelModes = [
  {
    label: "Quality",
    id: "openai/gpt-6-astra",
    name: "Astra",
    description: "Complex worlds",
  },
  {
    label: "Balanced",
    id: "openai/gpt-6-luna",
    name: "Luna",
    description: "Everyday creation",
  },
  {
    label: "Budget",
    id: "z-ai/glm-5.3-flash",
    name: "GLM-5.3-Flash",
    description: "Lower cost",
  },
] as const;
// Catalog namespaces differ; these IDs are submitted unchanged to each provider.
const gatewayModelModes = modelModes.map((mode) => ({
  ...mode,
  id: mode.label === "Budget" ? "zai/glm-5.3-flash" : mode.id,
}));
export function modelModesForProvider(provider: string) {
  return provider === "gateway" ? gatewayModelModes : modelModes;
}
export function isRecommendedModel(id: string) {
  return (
    modelModes.some((mode) => mode.id === id) ||
    gatewayModelModes.some((mode) => mode.id === id)
  );
}

const legacyLunaProviderOrder = Object.freeze([
  "OpenAI",
  "Amazon Bedrock",
  "Azure",
]);
const lunaProviderOrder = Object.freeze(["OpenAI", "Amazon Bedrock"]);

export function openrouterProviderRouting(model: string) {
  if (model === "openai/gpt-6-luna")
    return { order: lunaProviderOrder, allow_fallbacks: false };
  if (model === "openai/gpt-5.6-luna")
    return { order: legacyLunaProviderOrder, allow_fallbacks: false };
  return undefined;
}

export type CatalogModel = {
  capabilities?: ModelCapabilities;
  id: string;
  name: string;
  /** Estimated USD per one million tokens; null means unavailable. */
  inputPrice: number | null;
  cachedInputPrice: number | null;
  outputPrice: number | null;
  /** External 3D preference rank; null is unranked, not proof of lower quality. */
  qualityRank: number | null;
};
