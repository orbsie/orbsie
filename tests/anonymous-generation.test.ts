vi.mock("../src/lib/server/model-preflight", () => ({
  requireGenerationModel: vi.fn(async () => ({})),
}));
vi.mock(
  "@/lib/server/generation-limits",
  async () => import("../src/lib/server/generation-limits"),
);
import { afterEach, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
const authCheck = vi.hoisted(() => vi.fn());
vi.mock("@/lib/protocol", async () => import("../src/lib/protocol"));
vi.mock(
  "@/lib/server/generation",
  async () => import("../src/lib/server/generation"),
);
vi.mock("@/lib/server/auth", async () => {
  const auth = await import("../src/lib/server/auth");
  return {
    ...auth,
    requireUser: async () => {
      authCheck();
      throw new auth.HttpError(401, "Sign in to publish.");
    },
  };
});
vi.mock("@/lib/server/trial", async () => import("../src/lib/server/trial"));
import { POST as generate } from "../src/app/api/generate/route";
import { POST as publish } from "../src/app/api/publish/route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function request(body: unknown, origin = "https://orbsie.test") {
  vi.stubEnv("BETTER_AUTH_URL", "https://orbsie.test");
  return new Request("https://orbsie.test/api/generate", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const input = () => ({
  provider: "openrouter",
  model: "openai/gpt-5.6-luna",
  key: "synthetic-test-key",
  prompt: "One tiny mushroom",
  project: blankProject(),
});
it("streams generation with a supplied key and no Orbsie session", async () => {
  const provider = vi.fn(
    async () =>
      new Response(
        'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"commit_revision\\",\\"message\\":\\"Ready.\\"}\\n"}}]}\n\n',
      ),
  );
  vi.stubGlobal("fetch", provider);
  const response = await generate(request(input()));
  expect(response.status).toBe(200);
  expect(JSON.parse(await response.text())).toEqual({
    type: "commit_revision",
    message: "Ready.",
  });
  expect(authCheck).not.toHaveBeenCalled();
  expect(provider).toHaveBeenCalledOnce();
});
it("requires a provider key even when generation is anonymous", async () => {
  const provider = vi.fn();
  vi.stubGlobal("fetch", provider);
  expect((await generate(request({ ...input(), key: "" }))).status).toBe(400);
  expect(provider).not.toHaveBeenCalled();
});
it("enforces the server output cap despite a larger client-supplied value", async () => {
  vi.stubEnv("ORBSIE_GENERATION_MAX_TOKENS", "512");
  let sent: { max_tokens?: number } = {};
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return new Response("data: [DONE]\n\n");
  });
  const response = await generate(request({ ...input(), maxTokens: 10000 }));
  await response.text();
  expect(sent.max_tokens).toBe(512);
});
it("keeps the origin boundary for anonymous generation", async () => {
  const provider = vi.fn();
  vi.stubGlobal("fetch", provider);
  expect(
    (await generate(request(input(), "https://unrelated.test"))).status,
  ).toBe(403);
  expect(provider).not.toHaveBeenCalled();
});
it("still requires an Orbsie account before publication", async () => {
  const provider = vi.fn();
  vi.stubGlobal("fetch", provider);
  const response = await publish(request({ projectId: "demo", revision: 1 }));
  expect(response.status).toBe(401);
  expect(authCheck).toHaveBeenCalledOnce();
  expect(provider).not.toHaveBeenCalled();
});

for (const [upstream, status, message] of [
  [401, 401, "API key"],
  [402, 402, "payment"],
  [403, 403, "access"],
  [404, 400, "model"],
  [429, 429, "rate limited"],
  [503, 502, "unavailable"],
] as const) {
  it(`preserves an actionable safe provider failure for HTTP ${upstream}`, async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ error: { message: "private upstream diagnostic" } }),
          { status: upstream },
        ),
    );
    const response = await generate(request(input()));
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error).toContain(message);
    expect(body.error).not.toContain("private upstream diagnostic");
    expect(authCheck).not.toHaveBeenCalled();
  });
}

it("does not return raw malformed provider stream diagnostics", async () => {
  vi.stubGlobal(
    "fetch",
    async () => new Response("data: private-upstream-diagnostic\n\n"),
  );
  const response = await generate(request(input()));
  const text = await response.text();
  expect(text).not.toContain("private-upstream");
  expect(text).toContain("invalid scene update");
});
