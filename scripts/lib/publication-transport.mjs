import { PublicationAcceptanceError } from "./publication-acceptance.mjs";

function parseResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

/** Build the authenticated API request exactly as the live publisher does. */
export function publicationRequestInit(base, init = {}) {
  return {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      ...(init.cookie ? { Cookie: init.cookie } : {}),
    },
    redirect: "error",
  };
}

/** Shared HTTP transport for live publication and same-account resume flows. */
export function createPublicationTransport(base, fetchImpl = fetch) {
  return {
    async request(path, init = {}, label) {
      let response;
      try {
        response = await fetchImpl(
          `${base}${path}`,
          publicationRequestInit(base, init),
        );
      } catch (error) {
        throw new PublicationAcceptanceError(
          `${label} network request failed.`,
          { cause: error },
        );
      }
      const text = await response.text();
      return {
        response,
        status: response.status,
        ok: response.ok,
        body: parseResponse(text),
      };
    },

    async publicGet(url, label) {
      let response;
      try {
        response = await fetchImpl(url, {
          redirect: "error",
          credentials: "omit",
          headers: { "User-Agent": "OrbsiePublicationAcceptance/1.0" },
        });
      } catch (error) {
        throw new PublicationAcceptanceError(
          `${label} network request failed.`,
          { cause: error },
        );
      }
      return { status: response.status, text: await response.text() };
    },
  };
}
