import { catalogModels } from "../model-catalog";
import { modelSupportsGeneration } from "../model-capabilities";
import { HttpError } from "./auth";

/** Public metadata only: never forward a user's credential to catalog requests. */
export async function requireGenerationModel(
  provider: "openrouter" | "gateway",
  modelId: string,
  signal: AbortSignal,
) {
  let models;
  try {
    const response = await fetch(
      provider === "openrouter"
        ? "https://openrouter.ai/api/v1/models"
        : "https://ai-gateway.vercel.sh/v1/models",
      {
        next: { revalidate: 3600 },
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      },
    );
    if (!response.ok) throw Error("Catalog unavailable");
    const data = await response.json();
    models = catalogModels(data.data, provider);
  } catch {
    throw new HttpError(
      503,
      "Your provider's model catalog could not be checked. Retry shortly; no generation was started.",
    );
  }
  const model = models.find((model) => model.id === modelId);
  if (!model || !modelSupportsGeneration(model))
    throw new HttpError(
      400,
      "This model does not support the current world-generation connection. Choose a supported model in Advanced.",
    );
  return model;
}
