import { createHash } from "node:crypto";

const CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits";
export const FREE_PROVIDER_CREDITS_TIMEOUT_MS = 2_500;
export const FREE_PROVIDER_CREDITS_CACHE_MS = 10_000;

type AvailabilityCache = {
  fingerprint: string;
  available: boolean;
  expiresAt: number;
};

export function createFreeProviderAvailability(
  options: {
    fetcher?: typeof fetch;
    timeoutMs?: number;
    cacheMs?: number;
  } = {},
) {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? FREE_PROVIDER_CREDITS_TIMEOUT_MS;
  const cacheMs = options.cacheMs ?? FREE_PROVIDER_CREDITS_CACHE_MS;
  let cached: AvailabilityCache | undefined;
  let pending: { fingerprint: string; promise: Promise<boolean> } | undefined;

  return async function freeProviderAvailable() {
    const key = process.env.AI_GATEWAY_API_KEY_FREE;
    if (!key) return false;

    const fingerprint = createHash("sha256").update(key).digest("hex");
    if (cached?.fingerprint === fingerprint && cached.expiresAt > Date.now())
      return cached.available;
    if (pending?.fingerprint === fingerprint) return pending.promise;

    const promise = checkCredits(key, fetcher, timeoutMs).then((available) => {
      if (pending?.promise === promise) {
        cached = {
          fingerprint,
          available,
          expiresAt: Date.now() + cacheMs,
        };
        pending = undefined;
      }
      return available;
    });
    pending = { fingerprint, promise };
    return promise;
  };
}

async function checkCredits(
  key: string,
  fetcher: typeof fetch,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const request = (async () => {
    const response = await fetcher(CREDITS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return false;

    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("balance" in body))
      return false;
    const balance = (body as { balance?: unknown }).balance;
    return (
      typeof balance === "number" && Number.isFinite(balance) && balance > 0
    );
  })();
  const deadline = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve(false);
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, deadline]);
  } catch {
    return false;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

const productionAvailability = createFreeProviderAvailability();

export function freeProviderAvailable() {
  return productionAvailability();
}
