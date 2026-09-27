import { createHash } from "node:crypto";

const CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits";
export const FREE_PROVIDER_CREDITS_TIMEOUT_MS = 2_500;
export const FREE_PROVIDER_CREDITS_CACHE_MS = 10_000;

type AvailabilityCache = {
  fingerprint: string;
  available: boolean;
  expiresAt: number;
};

type DiagnosticReason =
  | "missing_key"
  | "upstream_http_failure"
  | "malformed_credits_body"
  | "nonpositive_balance"
  | "timeout"
  | "fetch_error"
  | "available";

type AvailabilityDiagnostic = {
  event: "free_provider_credits_probe";
  reason: DiagnosticReason;
  status?: number;
};

type ProbeResult = {
  available: boolean;
  diagnostic: AvailabilityDiagnostic;
};

function diagnostic(reason: DiagnosticReason, status?: number) {
  return status === undefined
    ? ({
        event: "free_provider_credits_probe",
        reason,
      } satisfies AvailabilityDiagnostic)
    : ({
        event: "free_provider_credits_probe",
        reason,
        status,
      } satisfies AvailabilityDiagnostic);
}

export function createFreeProviderAvailability(
  options: {
    fetcher?: typeof fetch;
    timeoutMs?: number;
    cacheMs?: number;
    logger?: (event: AvailabilityDiagnostic) => void;
  } = {},
) {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? FREE_PROVIDER_CREDITS_TIMEOUT_MS;
  const cacheMs = options.cacheMs ?? FREE_PROVIDER_CREDITS_CACHE_MS;
  const logger =
    options.logger ?? ((event) => console.info(JSON.stringify(event)));
  let cached: AvailabilityCache | undefined;
  let pending: { fingerprint: string; promise: Promise<boolean> } | undefined;
  let lastLoggedDiagnostic: string | undefined;

  function logDiagnostic(event: AvailabilityDiagnostic) {
    // Log only changes in probe state so repeated requests do not flood logs.
    const signature = `${event.reason}:${event.status ?? ""}`;
    if (signature === lastLoggedDiagnostic) return;
    lastLoggedDiagnostic = signature;
    try {
      logger(event);
    } catch {
      // Diagnostics must never change availability or admission behavior.
    }
  }

  return async function freeProviderAvailable() {
    const key = process.env.AI_GATEWAY_API_KEY_FREE;
    if (!key) {
      logDiagnostic(diagnostic("missing_key"));
      return false;
    }

    const fingerprint = createHash("sha256").update(key).digest("hex");
    if (cached?.fingerprint === fingerprint && cached.expiresAt > Date.now())
      return cached.available;
    if (pending?.fingerprint === fingerprint) return pending.promise;

    const promise = checkCredits(key, fetcher, timeoutMs).then((result) => {
      logDiagnostic(result.diagnostic);
      if (pending?.promise === promise) {
        cached = {
          fingerprint,
          available: result.available,
          expiresAt: Date.now() + cacheMs,
        };
        pending = undefined;
      }
      return result.available;
    });
    pending = { fingerprint, promise };
    return promise;
  };
}

async function checkCredits(
  key: string,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<ProbeResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const request = (async (): Promise<ProbeResult> => {
    let response: Response;
    try {
      response = await fetcher(CREDITS_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      return { available: false, diagnostic: diagnostic("fetch_error") };
    }
    if (!response.ok) {
      return {
        available: false,
        diagnostic: diagnostic("upstream_http_failure", response.status),
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        available: false,
        diagnostic: diagnostic("malformed_credits_body"),
      };
    }
    if (typeof body !== "object" || body === null || !("balance" in body)) {
      return {
        available: false,
        diagnostic: diagnostic("malformed_credits_body"),
      };
    }
    const balance = (body as { balance?: unknown }).balance;
    if (typeof balance !== "number" || !Number.isFinite(balance)) {
      return {
        available: false,
        diagnostic: diagnostic("malformed_credits_body"),
      };
    }
    if (balance <= 0) {
      return {
        available: false,
        diagnostic: diagnostic("nonpositive_balance"),
      };
    }
    return { available: true, diagnostic: diagnostic("available") };
  })();
  const deadline = new Promise<ProbeResult>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve({ available: false, diagnostic: diagnostic("timeout") });
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, deadline]);
  } catch {
    return { available: false, diagnostic: diagnostic("fetch_error") };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

const productionAvailability = createFreeProviderAvailability();

export function freeProviderAvailable() {
  return productionAvailability();
}
