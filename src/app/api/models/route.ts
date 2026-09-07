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
      models: data.data
        .filter(
          (m: {
            id: string;
            supported_parameters?: string[];
            type?: string;
          }) =>
            provider === "gateway"
              ? m.type === undefined || m.type === "language"
              : m.supported_parameters?.includes("tools"),
        )
        .map((m: { id: string; name?: string }) => ({
          id: m.id,
          name: m.name ?? m.id,
        })),
    });
  } catch {
    return Response.json(
      { models: [], error: "Model catalog is unavailable. Please retry." },
      { status: 502 },
    );
  }
}
