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
