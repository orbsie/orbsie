import { catalogModels } from "../../../lib/model-catalog";
import { modelRankingMetadata } from "../../../lib/model-rankings";
export async function GET(request: Request) {
  const provider = new URL(request.url).searchParams.get("provider");
  if (!["openrouter", "gateway"].includes(provider ?? ""))
    return Response.json({ error: "Unknown provider" }, { status: 400 });
  try {
    const response = await fetch(
      provider === "gateway"
        ? "https://ai-gateway.vercel.sh/v1/models"
        : "https://openrouter.ai/api/v1/models",
      { next: { revalidate: 3600 }, signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) throw Error("Catalog unavailable");
    const data = await response.json();
    return Response.json({
      models: catalogModels(data.data, provider as "openrouter" | "gateway"),
      ranking: modelRankingMetadata,
      pricing: {
        currency: "USD",
        unit: "per 1M tokens",
        estimated: true,
        note: "Base catalog rates; routing, context tiers, cache eligibility and other fees can change actual cost.",
      },
    });
  } catch {
    return Response.json(
      { models: [], error: "Model catalog is unavailable. Please retry." },
      { status: 502 },
    );
  }
}
