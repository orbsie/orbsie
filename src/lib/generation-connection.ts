export type GenerationConnection = {
  provider: string;
  model: string;
  key: string;
  effort?: string;
  url?: string;
};

export function isGenerationReady(connection: GenerationConnection): boolean {
  if (connection.provider === "free") return true;
  if (connection.provider === "chatgpt-hosted")
    return Boolean(connection.model.trim() && connection.effort?.trim());
  return Boolean(connection.key.trim() && connection.model.trim());
}

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

export function readCompanionLink(
  hash: string,
): { url: string; token: string } | null {
  if (!hash.startsWith("#chatgpt=")) return null;
  try {
    if (hash.length > 2048) throw Error();
    const value = JSON.parse(decodeURIComponent(hash.slice(9)));
    if (
      typeof value.token !== "string" ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(value.token)
    )
      throw Error();
    return { url: companionOrigin(value.url), token: value.token };
  } catch {
    throw Error(
      "This local ChatGPT connection link is invalid. Open a new link from the companion.",
    );
  }
}

export function generationRequest(
  connection: GenerationConnection,
  payload: object,
): { url: string; init: RequestInit } {
  const local = connection.provider === "chatgpt-local";
  const hosted = connection.provider === "chatgpt-hosted";
  if (
    !local &&
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
    url: local
      ? `${companionOrigin(connection.url ?? "")}/generate`
      : "/api/generate",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(local ? { Authorization: `Bearer ${connection.key}` } : {}),
      },
      // The companion capability is never sent to the hosted application or model.
      body: JSON.stringify(
        local
          ? payload
          : {
              ...payload,
              provider: connection.provider,
              model: connection.model,
              key: connection.key,
            },
      ),
      ...(local
        ? { credentials: "omit", mode: "cors", redirect: "error" }
        : {}),
    },
  };
}
