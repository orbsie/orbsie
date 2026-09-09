vi.mock("../src/lib/server/model-preflight", () => ({
  requireGenerationModel: vi.fn(async () => ({})),
}));
vi.mock(
  "@/lib/server/generation-limits",
  async () => import("../src/lib/server/generation-limits"),
);
import { afterEach, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
const quota = vi.hoisted(() => ({
  claim: vi.fn(async () => 2),
  identity: vi.fn(() => ({ cookie: "synthetic-cookie", buckets: [] })),
}));
vi.mock("@/lib/protocol", async () => import("../src/lib/protocol"));
vi.mock("@/lib/server/auth", async () => import("../src/lib/server/auth"));
vi.mock(
  "@/lib/server/generation",
  async () => import("../src/lib/server/generation"),
);
vi.mock("@/lib/server/trial", async () => ({
  ...(await import("../src/lib/server/trial")),
  trialIdentity: quota.identity,
  claimTrial: quota.claim,
}));
import { POST } from "../src/app/api/generate/route";
import { TrialExhausted } from "../src/lib/server/trial";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  quota.claim.mockResolvedValue(2);
});
function request(extra = {}) {
  vi.stubEnv("AI_GATEWAY_API_KEY_FREE", "private-synthetic-shared-key");
  vi.stubEnv("DATABASE_URL", "synthetic");
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic");
  vi.stubEnv("BETTER_AUTH_URL", "https://orbsie.test");
  return new Request("https://orbsie.test/api/generate", {
    method: "POST",
    headers: { origin: "https://orbsie.test" },
    body: JSON.stringify({
      provider: "free",
      prompt: "A tiny orb",
      project: blankProject(),
      ...extra,
    }),
  });
}
it("forces Gateway Luna and server credential despite client overrides, with bounded output", async () => {
  const upstream = vi.fn(
    async (_url: string, _options?: RequestInit) =>
      new Response(
        'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"commit_revision\\",\\"message\\":\\"Ready\\"}\\n"}}]}\n\n',
      ),
  );
  vi.stubGlobal("fetch", upstream);
  const response = await POST(
    request({
      key: "attacker-key",
      model: "expensive-other-model",
      maxTokens: 100000,
    }),
  );
  expect(response.status).toBe(200);
  expect(quota.claim).toHaveBeenCalledOnce();
  const [url, options] = upstream.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions");
  expect(new Headers(options.headers).get("Authorization")).toBe(
    "Bearer private-synthetic-shared-key",
  );
  expect(JSON.parse(options.body as string)).toMatchObject({
    model: "openai/gpt-5.6-luna",
    max_tokens: 4096,
  });
  expect(
    JSON.parse(JSON.parse(options.body as string).messages[1].content)
      .browserModeling,
  ).toBe(false);
  expect(response.headers.get("X-Orbsie-Trial-Remaining")).toBe("2");
  expect(await response.text()).not.toContain("private-synthetic");
  expect(JSON.stringify([...response.headers])).not.toContain(
    "private-synthetic",
  );
});
it("forwards an explicitly advertised browser capability to the shared provider", async () => {
  const upstream = vi.fn(
    async (_url: string, _options?: RequestInit) =>
      new Response(
        'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"commit_revision\\",\\"message\\":\\"Ready\\"}\\n"}}]}\n\n',
      ),
  );
  vi.stubGlobal("fetch", upstream);
  const response = await POST(request({ browserModeling: true }));
  expect(response.status).toBe(200);
  await response.text();
  const options = upstream.mock.calls[0][1] as RequestInit;
  expect(
    JSON.parse(JSON.parse(options.body as string).messages[1].content)
      .browserModeling,
  ).toBe(true);
});
it("never forwards an exhausted fourth prompt", async () => {
  quota.claim.mockRejectedValueOnce(new TrialExhausted());
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  const response = await POST(request());
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({
    code: "FREE_LIMIT_REACHED",
    remaining: 0,
  });
  expect(upstream).not.toHaveBeenCalled();
});
it("leaves anonymous BYOK outside the shared quota", async () => {
  const upstream = vi.fn(async () => new Response("", { status: 401 }));
  vi.stubGlobal("fetch", upstream);
  expect(
    (
      await POST(
        request({
          provider: "openrouter",
          key: "synthetic-own-key",
          model: "openai/gpt-5.6-luna",
        }),
      )
    ).status,
  ).toBe(401);
  expect(quota.claim).not.toHaveBeenCalled();
  expect(upstream).toHaveBeenCalledOnce();
});
it("fails closed before upstream calls when the private credential is unavailable", async () => {
  const req = request();
  vi.stubEnv("AI_GATEWAY_API_KEY_FREE", "");
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  expect((await POST(req)).status).toBe(503);
  expect(upstream).not.toHaveBeenCalled();
  expect(quota.claim).not.toHaveBeenCalled();
});

it("rejects oversized selection metadata before quota admission or inference", async () => {
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  const response = await POST(request({ selected: "x".repeat(430000) }));
  expect(response.status).toBe(400);
  expect(quota.claim).not.toHaveBeenCalled();
  expect(upstream).not.toHaveBeenCalled();
});

it("does not consume a free prompt when model preflight rejects it", async () => {
  const { requireGenerationModel } =
    await import("../src/lib/server/model-preflight");
  const { HttpError } = await import("../src/lib/server/auth");
  vi.mocked(requireGenerationModel).mockRejectedValueOnce(
    new HttpError(400, "Unsupported model"),
  );
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  const response = await POST(request());
  expect(response.status).toBe(400);
  expect(quota.claim).not.toHaveBeenCalled();
  expect(upstream).not.toHaveBeenCalled();
});
