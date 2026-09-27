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

type JsonKind =
  "array" | "boolean" | "null" | "number" | "object" | "string" | "unreadable";

type CreditsBodySchema = {
  jsonKind: JsonKind;
  keys?: string[];
  balanceKind?: JsonKind;
  dataKeys?: string[];
  creditsKeys?: string[];
};

type AvailabilityDiagnostic = {
  event: "free_provider_credits_probe";
  reason: DiagnosticReason;
  status?: number;
  schema?: CreditsBodySchema;
};

type ProbeResult = {
  available: boolean;
  diagnostic: AvailabilityDiagnostic;
};

const MAX_SCHEMA_KEYS_PER_OBJECT = 8;
const MAX_SCHEMA_KEY_LENGTH = 32;
const MAX_BALANCE_STRING_LENGTH = 512;
const ASCII_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DECIMAL_BALANCE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

type ParsedBalance = { valid: true; value: number } | { valid: false };

function diagnostic(
  reason: DiagnosticReason,
  status?: number,
  schema?: CreditsBodySchema,
): AvailabilityDiagnostic {
  return {
    event: "free_provider_credits_probe",
    reason,
    ...(status === undefined ? {} : { status }),
    ...(schema === undefined ? {} : { schema }),
  };
}

function jsonKind(value: unknown): JsonKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "object":
      return "object";
    case "string":
      return "string";
    default:
      return "unreadable";
  }
}

function boundedIdentifierKeys(value: unknown): string[] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;

  try {
    return Object.keys(value)
      .filter((key) => ASCII_IDENTIFIER.test(key))
      .slice(0, MAX_SCHEMA_KEYS_PER_OBJECT)
      .map((key) => key.slice(0, MAX_SCHEMA_KEY_LENGTH));
  } catch {
    return undefined;
  }
}

function safeHasOwn(value: unknown, key: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  try {
    return Object.hasOwn(value, key);
  } catch {
    return false;
  }
}

function safeProperty(value: unknown, key: string): unknown {
  if (!safeHasOwn(value, key)) return undefined;
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function creditsBodySchema(value: unknown): CreditsBodySchema {
  const kind = jsonKind(value);
  if (kind !== "object") return { jsonKind: kind };

  const keys = boundedIdentifierKeys(value) ?? [];
  const schema: CreditsBodySchema = { jsonKind: kind, keys };
  if (safeHasOwn(value, "balance")) {
    schema.balanceKind = jsonKind(safeProperty(value, "balance"));
  }
  for (const name of ["data", "credits"] as const) {
    const nestedKeys = boundedIdentifierKeys(safeProperty(value, name));
    if (nestedKeys !== undefined) {
      schema[name === "data" ? "dataKeys" : "creditsKeys"] = nestedKeys;
    }
  }
  return schema;
}

function parseCreditsBalance(value: unknown): ParsedBalance {
  if (typeof value === "number") {
    return Number.isFinite(value) ? { valid: true, value } : { valid: false };
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_BALANCE_STRING_LENGTH ||
    !DECIMAL_BALANCE.test(value)
  ) {
    return { valid: false };
  }

  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? { valid: true, value: parsed }
    : { valid: false };
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
    const schemaSignature =
      event.reason === "malformed_credits_body"
        ? JSON.stringify(event.schema)
        : "";
    const signature = `${event.reason}:${event.status ?? ""}:${schemaSignature}`;
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
        diagnostic: diagnostic("malformed_credits_body", undefined, {
          jsonKind: "unreadable",
        }),
      };
    }
    if (typeof body !== "object" || body === null || !("balance" in body)) {
      return {
        available: false,
        diagnostic: diagnostic(
          "malformed_credits_body",
          undefined,
          creditsBodySchema(body),
        ),
      };
    }
    const parsedBalance = parseCreditsBalance(
      (body as { balance?: unknown }).balance,
    );
    if (!parsedBalance.valid) {
      return {
        available: false,
        diagnostic: diagnostic(
          "malformed_credits_body",
          undefined,
          creditsBodySchema(body),
        ),
      };
    }
    if (parsedBalance.value <= 0) {
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
