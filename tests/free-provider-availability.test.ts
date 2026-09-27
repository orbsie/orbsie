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
  const fetcher = vi.fn(
    () => new Promise<Response>((resolve) => (resolveResponse = resolve)),
  );
  const available = createFreeProviderAvailability({ fetcher });

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
  const malformed = createFreeProviderAvailability({
    fetcher: vi.fn(async () => new Response("not json", { status: 200 })),
  });
  const rejected = createFreeProviderAvailability({
    fetcher: vi.fn(async () => {
      throw new Error("synthetic network failure");
    }),
  });
  const denied = createFreeProviderAvailability({
    fetcher: vi.fn(async () => new Response("", { status: 503 })),
  });

  expect(await malformed()).toBe(false);
  expect(await rejected()).toBe(false);
  expect(await denied()).toBe(false);
});

it("aborts and returns unavailable when the credits request exceeds its timeout", async () => {
  setKey();
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
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
  });

  const result = available();
  await vi.advanceTimersByTimeAsync(25);

  expect(await result).toBe(false);
  expect(signal?.aborted).toBe(true);
});
