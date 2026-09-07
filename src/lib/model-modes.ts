export const modelModes = [
  {
    label: "Quality",
    id: "openai/gpt-6-astra",
    name: "Astra",
    description: "Complex worlds",
  },
  {
    label: "Balanced",
    id: "openai/gpt-5.6-sol",
    name: "Sol",
    description: "Everyday creation",
  },
  {
    label: "Budget",
    id: "openai/gpt-5.6-luna",
    name: "Luna",
    description: "Lower cost",
  },
] as const;
export function isRecommendedModel(id: string) {
  return modelModes.some((mode) => mode.id === id);
}
