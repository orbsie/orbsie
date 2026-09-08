export type GenerationConnection = {
  provider: string;
  model: string;
  key: string;
  url?: string;
};

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
  if (
    !local &&
    !["free", "openrouter", "gateway"].includes(connection.provider)
  )
    throw Error("Choose a supported AI connection.");
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
