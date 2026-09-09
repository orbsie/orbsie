export type GenerationConnection = {
  provider: string;
  model: string;
  key: string;
  effort?: string;
};

export function isGenerationReady(connection: GenerationConnection): boolean {
  if (connection.provider === "free") return true;
  if (connection.provider === "chatgpt-hosted")
    return Boolean(connection.model.trim() && connection.effort?.trim());
  if (!["openrouter", "gateway"].includes(connection.provider)) return false;
  return Boolean(connection.key.trim() && connection.model.trim());
}

/** Loopback validation retained for the historical Blender transport. */
export function companionOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error("Use the connection link from your local Orbsie companion.");
  return url.origin;
}

export function generationRequest(
  connection: GenerationConnection,
  payload: object,
): { url: string; init: RequestInit } {
  const hosted = connection.provider === "chatgpt-hosted";
  if (
    !hosted &&
    !["free", "openrouter", "gateway"].includes(connection.provider)
  )
    throw Error("Choose a supported AI connection.");
  if (!isGenerationReady(connection) && connection.provider !== "free")
    throw Error("Choose a complete AI connection.");
  if (hosted) {
    const source = payload as Record<string, unknown>;
    const hostedPayload = {
      model: connection.model,
      effort: connection.effort,
      prompt: source.prompt,
      project: source.project,
      ...(typeof source.selected === "string"
        ? { selected: source.selected }
        : {}),
      browserModeling: source.browserModeling === true,
      localModeling: false,
    };
    return {
      url: "/api/chatgpt/generate",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        body: JSON.stringify(hostedPayload),
      },
    };
  }
  return {
    url: "/api/generate",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...payload,
        provider: connection.provider,
        model: connection.model,
        key: connection.key,
      }),
    },
  };
}
