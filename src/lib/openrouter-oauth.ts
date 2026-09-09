const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
const OPENROUTER_KEY_EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
const OAUTH_METHOD = "S256" as const;
export const OPENROUTER_OAUTH_TTL_MS = 10 * 60 * 1000;
const MAX_AUTH_CODE_LENGTH = 2048;
const MAX_RESPONSE_BYTES = 16 * 1024;
const DEFAULT_EXCHANGE_TIMEOUT_MS = 10_000;

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const verifierPattern = /^[A-Za-z0-9._~-]{43,128}$/;

export class OpenRouterOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterOAuthError";
  }
}

export type OpenRouterOAuthTransaction = {
  state: string;
  verifier: string;
  challenge: string;
  callbackUrl: string;
  createdAt: number;
};

export type OpenRouterOAuthCallback = {
  code: string;
  transaction: OpenRouterOAuthTransaction;
};

type CryptoSource = Pick<Crypto, "getRandomValues" | "subtle">;

function oauthFailure(message: string): OpenRouterOAuthError {
  return new OpenRouterOAuthError(message);
}

function base64Url(bytes: Uint8Array): string {
  if (typeof btoa !== "function")
    throw oauthFailure("OpenRouter sign-in is unavailable in this browser.");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function cryptoSource(source?: CryptoSource): CryptoSource {
  const value = source ?? globalThis.crypto;
  if (!value?.getRandomValues || !value.subtle)
    throw oauthFailure("OpenRouter sign-in is unavailable in this browser.");
  return value;
}

function randomToken(source: CryptoSource): string {
  const bytes = new Uint8Array(32);
  source.getRandomValues(bytes);
  return base64Url(bytes);
}

function normalizedOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw oauthFailure("OpenRouter sign-in requires a valid app origin.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.origin === "null" ||
    url.username ||
    url.password ||
    (url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw oauthFailure("OpenRouter sign-in requires a valid app origin.");
  return url.origin;
}

function validTimestamp(value: unknown, now: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value <= now &&
    now - value <= OPENROUTER_OAUTH_TTL_MS
  );
}

function validateTransaction(
  transaction: OpenRouterOAuthTransaction,
  now: number,
): URL {
  if (
    !transaction ||
    !tokenPattern.test(transaction.state) ||
    !verifierPattern.test(transaction.verifier) ||
    !tokenPattern.test(transaction.challenge) ||
    !validTimestamp(transaction.createdAt, now)
  )
    throw oauthFailure("The OpenRouter sign-in attempt has expired.");
  let callback: URL;
  try {
    callback = new URL(transaction.callbackUrl);
  } catch {
    throw oauthFailure("The OpenRouter sign-in attempt is invalid.");
  }
  if (
    !["https:", "http:"].includes(callback.protocol) ||
    callback.origin === "null" ||
    callback.pathname !== "/" ||
    callback.searchParams.get("orbsie_oauth") !== "openrouter" ||
    callback.searchParams.get("state") !== transaction.state
  )
    throw oauthFailure("The OpenRouter sign-in attempt is invalid.");
  return callback;
}

function checkedCode(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_AUTH_CODE_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw oauthFailure("OpenRouter returned an invalid authorization code.");
  return value;
}

/** Compute the RFC 7636 S256 challenge without retaining the verifier. */
export async function createOpenRouterCodeChallenge(
  verifier: string,
  source?: CryptoSource,
): Promise<string> {
  if (!verifierPattern.test(verifier))
    throw oauthFailure("The OpenRouter sign-in verifier is invalid.");
  const digest = await cryptoSource(source).subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

export async function startOpenRouterOAuth(
  origin: string,
  options: { now?: number; crypto?: CryptoSource } = {},
): Promise<{
  authorizationUrl: string;
  transaction: OpenRouterOAuthTransaction;
}> {
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now))
    throw oauthFailure("OpenRouter sign-in could not start.");
  const source = cryptoSource(options.crypto);
  const state = randomToken(source);
  const verifier = randomToken(source);
  const challenge = await createOpenRouterCodeChallenge(verifier, source);
  const callback = new URL("/", normalizedOrigin(origin));
  callback.searchParams.set("orbsie_oauth", "openrouter");
  callback.searchParams.set("state", state);
  const transaction = {
    state,
    verifier,
    challenge,
    callbackUrl: callback.toString(),
    createdAt: now,
  } satisfies OpenRouterOAuthTransaction;
  const authorization = new URL(OPENROUTER_AUTH_URL);
  authorization.searchParams.set("callback_url", transaction.callbackUrl);
  authorization.searchParams.set("code_challenge", challenge);
  authorization.searchParams.set("code_challenge_method", OAUTH_METHOD);
  return {
    authorizationUrl: authorization.toString(),
    transaction,
  };
}

export function consumeOpenRouterOAuthCallback(
  input: string | URL,
  transaction: OpenRouterOAuthTransaction,
  now = Date.now(),
): OpenRouterOAuthCallback {
  const expected = validateTransaction(transaction, now);
  let callback: URL;
  try {
    callback = new URL(input.toString(), expected.origin);
  } catch {
    throw oauthFailure("The OpenRouter callback is invalid.");
  }
  if (
    callback.origin !== expected.origin ||
    callback.pathname !== expected.pathname ||
    callback.searchParams.get("orbsie_oauth") !== "openrouter" ||
    callback.searchParams.get("state") !== transaction.state ||
    callback.searchParams.getAll("state").length !== 1
  )
    throw oauthFailure("The OpenRouter callback did not match this sign-in.");
  if (callback.searchParams.has("error"))
    throw oauthFailure("OpenRouter sign-in was canceled.");
  if (callback.searchParams.getAll("code").length !== 1)
    throw oauthFailure("OpenRouter did not return an authorization code.");
  return { code: checkedCode(callback.searchParams.get("code")), transaction };
}

async function boundedText(response: Response): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES)
      throw oauthFailure("OpenRouter returned an oversized response.");
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let finished = false;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        finished = true;
        break;
      }
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES)
        throw oauthFailure("OpenRouter returned an oversized response.");
      chunks.push(next.value);
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function exchangeOpenRouterCode({
  callback,
  fetcher = fetch,
  signal,
  now = Date.now(),
  timeoutMs = DEFAULT_EXCHANGE_TIMEOUT_MS,
}: {
  callback: OpenRouterOAuthCallback;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  now?: number;
  timeoutMs?: number;
}): Promise<string> {
  validateTransaction(callback.transaction, now);
  const code = checkedCode(callback.code);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw oauthFailure("OpenRouter sign-in could not start.");
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetcher(OPENROUTER_KEY_EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: callback.transaction.verifier,
        code_challenge_method: OAUTH_METHOD,
      }),
      redirect: "error",
      signal: requestSignal,
    });
  } catch {
    throw oauthFailure("OpenRouter sign-in could not be completed.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw oauthFailure("OpenRouter sign-in could not be completed.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await boundedText(response));
  } catch (error) {
    if (error instanceof OpenRouterOAuthError) throw error;
    throw oauthFailure("OpenRouter returned an invalid key response.");
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as { key?: unknown }).key !== "string" ||
    !(payload as { key: string }).key ||
    !(payload as { key: string }).key.startsWith("sk-or-") ||
    (payload as { key: string }).key.length < 16 ||
    (payload as { key: string }).key.length > 512 ||
    (payload as { key: string }).key.trim() !==
      (payload as { key: string }).key ||
    /[\u0000-\u001f\u007f]/.test((payload as { key: string }).key)
  )
    throw oauthFailure("OpenRouter returned an invalid key response.");
  return (payload as { key: string }).key;
}
