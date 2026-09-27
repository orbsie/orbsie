import { afterEach, expect, it, vi } from "vitest";
import { createFreeProviderAvailability } from "../src/lib/server/free-provider-availability";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function setKey() {
  vi.stubEnv("AI_GATEWAY_API_KEY_FREE", "private-synthetic-shared-key");
}

it("allows a positive balance and caches concurrent and recent checks", async () => {
  setKey();
  let resolveResponse!: (response: Response) => void;
  const diagnostics: unknown[] = [];
  const fetcher = vi.fn(
    () => new Promise<Response>((resolve) => (resolveResponse = resolve)),
  );
  const available = createFreeProviderAvailability({
    fetcher,
    logger: (event) => diagnostics.push(event),
  });

  const first = available();
  const second = available();
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, options] = fetcher.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("https://ai-gateway.vercel.sh/v1/credits");
  expect(new Headers(options.headers).get("Authorization")).toBe(
    "Bearer private-synthetic-shared-key",
  );
  expect(options.cache).toBe("no-store");

  resolveResponse(Response.json({ balance: 0.25 }));
  expect(await Promise.all([first, second])).toEqual([true, true]);
  expect(await available()).toBe(true);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(diagnostics).toEqual([
    { event: "free_provider_credits_probe", reason: "available" },
  ]);
});

it.each([
  ["zero", { balance: 0 }],
  ["negative", { balance: -0.0045 }],
  ["unreadable", { balance: "0.25" }],
  ["missing", { credits: 0.25 }],
])("fails closed for a %s balance response", async (_name, body) => {
  setKey();
  const available = createFreeProviderAvailability({
    fetcher: vi.fn(async () => Response.json(body)),
  });

  expect(await available()).toBe(false);
});

it("fails closed on an unreadable or rejected credit request", async () => {
  setKey();
  const diagnostics: unknown[] = [];
  const malformed = createFreeProviderAvailability({
    fetcher: vi.fn(async () => new Response("not json", { status: 200 })),
    logger: (event) => diagnostics.push(event),
  });
  const rejected = createFreeProviderAvailability({
    fetcher: vi.fn(async () => {
      throw new Error("synthetic network failure");
    }),
    logger: (event) => diagnostics.push(event),
  });
  const denied = createFreeProviderAvailability({
    fetcher: vi.fn(async () => new Response("", { status: 503 })),
    logger: (event) => diagnostics.push(event),
  });

  expect(await malformed()).toBe(false);
  expect(await rejected()).toBe(false);
  expect(await denied()).toBe(false);
  expect(diagnostics).toEqual([
    { event: "free_provider_credits_probe", reason: "malformed_credits_body" },
    { event: "free_provider_credits_probe", reason: "fetch_error" },
    {
      event: "free_provider_credits_probe",
      reason: "upstream_http_failure",
      status: 503,
    },
  ]);
});

it("logs missing keys once per state transition without calling the provider", async () => {
  vi.stubEnv("AI_GATEWAY_API_KEY_FREE", "");
  const diagnostics: unknown[] = [];
  const fetcher = vi.fn();
  const available = createFreeProviderAvailability({
    fetcher,
    logger: (event) => diagnostics.push(event),
  });

  expect(await available()).toBe(false);
  expect(await available()).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
  expect(diagnostics).toEqual([
    { event: "free_provider_credits_probe", reason: "missing_key" },
  ]);
});

it("logs nonpositive balances without including the balance or key", async () => {
  setKey();
  const diagnostics: unknown[] = [];
  const available = createFreeProviderAvailability({
    fetcher: vi.fn(async () => Response.json({ balance: 0 })),
    logger: (event) => diagnostics.push(event),
  });

  expect(await available()).toBe(false);
  expect(diagnostics).toEqual([
    {
      event: "free_provider_credits_probe",
      reason: "nonpositive_balance",
    },
  ]);
  expect(JSON.stringify(diagnostics)).not.toContain(
    "private-synthetic-shared-key",
  );
});

it("suppresses repeated diagnostic states and records an HTTP status change", async () => {
  setKey();
  const diagnostics: unknown[] = [];
  const fetcher = vi
    .fn<() => Promise<Response>>()
    .mockResolvedValueOnce(
      new Response("private-response-body", { status: 503 }),
    )
    .mockResolvedValueOnce(
      new Response("private-response-body", { status: 503 }),
    )
    .mockResolvedValueOnce(
      new Response("private-response-body", { status: 402 }),
    );
  const available = createFreeProviderAvailability({
    fetcher,
    cacheMs: 0,
    logger: (event) => diagnostics.push(event),
  });

  expect(await available()).toBe(false);
  expect(await available()).toBe(false);
  expect(await available()).toBe(false);
  expect(diagnostics).toEqual([
    {
      event: "free_provider_credits_probe",
      reason: "upstream_http_failure",
      status: 503,
    },
    {
      event: "free_provider_credits_probe",
      reason: "upstream_http_failure",
      status: 402,
    },
  ]);
  expect(JSON.stringify(diagnostics)).not.toContain("private-response-body");
});

it("aborts and returns unavailable when the credits request exceeds its timeout", async () => {
  setKey();
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const diagnostics: unknown[] = [];
  const fetcher = vi.fn(
    (
      _url: Parameters<typeof fetch>[0],
      options?: Parameters<typeof fetch>[1],
    ) =>
      new Promise<Response>(() => {
        signal = options?.signal as AbortSignal;
      }),
  );
  const available = createFreeProviderAvailability({
    fetcher,
    timeoutMs: 25,
    logger: (event) => diagnostics.push(event),
  });

  const result = available();
  await vi.advanceTimersByTimeAsync(25);

  expect(await result).toBe(false);
  expect(signal?.aborted).toBe(true);
  expect(diagnostics).toEqual([
    { event: "free_provider_credits_probe", reason: "timeout" },
  ]);
});
