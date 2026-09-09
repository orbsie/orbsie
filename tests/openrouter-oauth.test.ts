import { expect, it, vi } from "vitest";
import {
  consumeOpenRouterOAuthCallback,
  createOpenRouterCodeChallenge,
  exchangeOpenRouterCode,
  OPENROUTER_OAUTH_TTL_MS,
  startOpenRouterOAuth,
  type OpenRouterOAuthCallback,
  type OpenRouterOAuthTransaction,
} from "../src/lib/openrouter-oauth";

const origin = "https://orbsie.test";

it("creates the RFC 7636 S256 challenge known vector", async () => {
  await expect(
    createOpenRouterCodeChallenge(
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    ),
  ).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

it("starts a same-origin callback transaction with PKCE authorization URL", async () => {
  const started = await startOpenRouterOAuth(origin, {
    now: 1_700_000_000_000,
  });
  const transaction = started.transaction;
  const authorization = new URL(started.authorizationUrl);
  expect(authorization.origin).toBe("https://openrouter.ai");
  expect(authorization.pathname).toBe("/auth");
  expect(authorization.searchParams.get("callback_url")).toBe(
    transaction.callbackUrl,
  );
  expect(authorization.searchParams.get("code_challenge")).toBe(
    transaction.challenge,
  );
  expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
  expect(new URL(transaction.callbackUrl).origin).toBe(origin);
  expect(new URL(transaction.callbackUrl).pathname).toBe("/");
  expect(transaction.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(transaction.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(transaction.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

it("allows loopback HTTP development origins but rejects other insecure origins", async () => {
  await expect(
    startOpenRouterOAuth("http://localhost:3000", { now: 1_700_000_000_000 }),
  ).resolves.toMatchObject({
    transaction: {
      callbackUrl: expect.stringContaining("http://localhost:3000/"),
    },
  });
  await expect(
    startOpenRouterOAuth("http://192.168.1.10:3000", {
      now: 1_700_000_000_000,
    }),
  ).rejects.toThrow("valid app origin");
});

async function transaction(now = 1_700_000_000_000) {
  return (await startOpenRouterOAuth(origin, { now })).transaction;
}

function callbackUrl(
  transaction: OpenRouterOAuthTransaction,
  code = "code-123",
) {
  const url = new URL(transaction.callbackUrl);
  url.searchParams.set("code", code);
  return url;
}

it("consumes a matching callback and binds it to the transaction", async () => {
  const now = 1_700_000_000_000;
  const transactionValue = await transaction(now);
  const consumed = consumeOpenRouterOAuthCallback(
    callbackUrl(transactionValue),
    transactionValue,
    now + 1,
  );
  expect(consumed.code).toBe("code-123");
  expect(consumed.transaction).toBe(transactionValue);
});

it.each([
  ["missing code", (url: URL) => url.searchParams.delete("code")],
  [
    "mismatched state",
    (url: URL) => url.searchParams.set("state", "x".repeat(43)),
  ],
  ["wrong origin", (url: URL) => url],
])("rejects %s callback", async (name, mutate) => {
  const now = 1_700_000_000_000;
  const transactionValue = await transaction(now);
  const url = callbackUrl(transactionValue);
  if (name === "wrong origin") {
    url.hostname = "other.test";
  } else mutate(url);
  expect(() =>
    consumeOpenRouterOAuthCallback(url, transactionValue, now + 1),
  ).toThrow();
});

it("rejects expired, future, and overlong authorization codes", async () => {
  const now = 1_700_000_000_000;
  const transactionValue = await transaction(now);
  expect(() =>
    consumeOpenRouterOAuthCallback(
      callbackUrl(transactionValue),
      transactionValue,
      now + OPENROUTER_OAUTH_TTL_MS + 1,
    ),
  ).toThrow(/expired/);
  const future = await transaction(now + 2);
  expect(() =>
    consumeOpenRouterOAuthCallback(callbackUrl(future), future, now),
  ).toThrow(/expired/);
  expect(() =>
    consumeOpenRouterOAuthCallback(
      callbackUrl(transactionValue, "x".repeat(2049)),
      transactionValue,
      now + 1,
    ),
  ).toThrow(/authorization code/);
});

function validCallback(): Promise<OpenRouterOAuthCallback> {
  return transaction(Date.now()).then((value) => ({
    code: "auth-code",
    transaction: value,
  }));
}

it("exchanges through the fixed HTTPS endpoint with the exact PKCE payload", async () => {
  const callback = await validCallback();
  const fetcher = vi.fn<typeof fetch>(
    async (_url, _init) =>
      new Response(JSON.stringify({ key: "sk-or-v1-12345678" })),
  );
  await expect(exchangeOpenRouterCode({ callback, fetcher })).resolves.toBe(
    "sk-or-v1-12345678",
  );
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://openrouter.ai/api/v1/auth/keys");
  expect(init?.method).toBe("POST");
  expect(init?.redirect).toBe("error");
  expect(init?.headers).toEqual({ "Content-Type": "application/json" });
  expect(JSON.parse(String(init?.body))).toEqual({
    code: callback.code,
    code_verifier: callback.transaction.verifier,
    code_challenge_method: "S256",
  });
});

it("sanitizes provider failures and malformed key responses", async () => {
  const callback = await validCallback();
  const failing = vi.fn<typeof fetch>(
    async () => new Response("private provider diagnostic", { status: 403 }),
  );
  await expect(
    exchangeOpenRouterCode({ callback, fetcher: failing }),
  ).rejects.toThrow("could not be completed");
  const malformed = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ key: "" })),
  );
  await expect(
    exchangeOpenRouterCode({ callback, fetcher: malformed }),
  ).rejects.toThrow("invalid key response");
  const implausible = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ key: "short-key" })),
  );
  await expect(
    exchangeOpenRouterCode({ callback, fetcher: implausible }),
  ).rejects.toThrow("invalid key response");
  const control = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ key: "sk-or-v1-1234567\n" })),
  );
  await expect(
    exchangeOpenRouterCode({ callback, fetcher: control }),
  ).rejects.toThrow("invalid key response");
});
