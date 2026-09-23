const deps = vi.hoisted(() => ({
  preflight: vi.fn(),
  generate: vi.fn(),
  claim: vi.fn(),
  identity: vi.fn(),
  trialEnabled: vi.fn(() => true),
  configured: vi.fn(() => false),
  admit: vi.fn(),
}));

vi.mock("../src/lib/server/model-preflight", () => ({
  requireGenerationModel: deps.preflight,
}));
vi.mock("../src/lib/server/generation", async () => ({
  ...(await vi.importActual("../src/lib/server/generation")),
  generateCommands: deps.generate,
}));
vi.mock("@/lib/server/trial", async () => ({
  ...(await vi.importActual("@/lib/server/trial")),
  claimTrial: deps.claim,
  trialIdentity: deps.identity,
  trialEnabled: deps.trialEnabled,
}));
vi.mock("@/lib/server/authoring-run-admission", () => ({
  admitInitialAuthoringRun: deps.admit,
  authoringReviewConfigured: deps.configured,
}));

import { afterEach, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
import { FREE_MODEL } from "../src/lib/server/trial";
import { POST } from "../src/app/api/generate/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  deps.configured.mockReturnValue(false);
  deps.trialEnabled.mockReturnValue(true);
});

function request(
  provider: "free" | "gateway" = "free",
  extra: Record<string, unknown> = {},
) {
  vi.stubEnv("BETTER_AUTH_URL", "https://orbsie.test");
  vi.stubEnv("AI_GATEWAY_API_KEY_FREE", "synthetic-shared-key");
  vi.stubEnv("DATABASE_URL", "synthetic");
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-secret-value");
  return new Request("https://orbsie.test/api/generate", {
    method: "POST",
    headers: {
      origin: "https://orbsie.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider,
      model: provider === "free" ? undefined : "openai/gpt-5.6-luna",
      key: provider === "free" ? undefined : "synthetic-provider-key",
      prompt: "Build a small garden",
      project: blankProject(),
      ...extra,
    }),
  });
}

function setup() {
  deps.preflight.mockResolvedValue({
    id: "openai/gpt-5.6-luna",
    capabilities: {
      jsonObject: { supported: false, source: "catalog" },
      jsonSchema: { supported: false, source: "catalog" },
      structuredOutput: { supported: false, source: "catalog" },
    },
  });
  deps.identity.mockReturnValue({
    identityHash: "a".repeat(64),
    cookie: "orbsie_trial=synthetic",
    buckets: [],
  });
  deps.generate.mockResolvedValue(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
  );
}

it("keeps the legacy one-call route when review admission is disabled", async () => {
  setup();
  const response = await POST(request("free", { authoringReview: true }));
  expect(response.status).toBe(503);
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(deps.claim).not.toHaveBeenCalled();
  expect(deps.generate).not.toHaveBeenCalled();
});

it("admits an enabled free run before inference and reports reviewed image capability", async () => {
  setup();
  deps.preflight.mockResolvedValueOnce({
    id: FREE_MODEL,
    capabilities: {
      imageInput: { supported: true, source: "catalog" },
    },
  });
  deps.configured.mockReturnValue(true);
  deps.admit.mockResolvedValue({
    runId: "11111111-1111-4111-8111-111111111111",
    trialRemaining: 1,
    trialCookie: "orbsie_trial=synthetic",
    lifecycle: { onComplete: vi.fn(), onFailure: vi.fn() },
    fail: vi.fn(),
  });
  const response = await POST(request("free", { authoringReview: true }));
  expect(response.status).toBe(200);
  await response.text();
  expect(response.headers.get("X-Orbsie-Authoring-Run-Id")).toBe(
    "11111111-1111-4111-8111-111111111111",
  );
  expect(response.headers.get("X-Orbsie-Trial-Remaining")).toBe("1");
  expect(response.headers.get("X-Orbsie-Review-Image-Supported")).toBe("1");
  expect(deps.claim).not.toHaveBeenCalled();
  expect(deps.admit).toHaveBeenCalledOnce();
  expect(deps.admit.mock.invocationCallOrder[0]).toBeLessThan(
    deps.generate.mock.invocationCallOrder[0],
  );
  expect(deps.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "gateway",
      model: FREE_MODEL,
      lifecycle: expect.any(Object),
    }),
  );
});

it("does not admit a review run when model preflight fails", async () => {
  setup();
  deps.configured.mockReturnValue(true);
  deps.preflight.mockRejectedValueOnce(Error("catalog unavailable"));
  const response = await POST(request("free", { authoringReview: true }));
  expect(response.status).toBe(500);
  expect(deps.admit).not.toHaveBeenCalled();
  expect(deps.claim).not.toHaveBeenCalled();
  expect(deps.generate).not.toHaveBeenCalled();
});

it("links an enabled API run to the existing session without charging free quota", async () => {
  setup();
  deps.configured.mockReturnValue(true);
  deps.admit.mockResolvedValue({
    runId: "22222222-2222-4222-8222-222222222222",
    trialRemaining: null,
    lifecycle: { onComplete: vi.fn(), onFailure: vi.fn() },
    fail: vi.fn(),
  });
  const response = await POST(request("gateway", { authoringReview: true }));
  expect(response.status).toBe(200);
  await response.text();
  expect(deps.claim).not.toHaveBeenCalled();
  expect(deps.admit).toHaveBeenCalledWith(
    expect.objectContaining({ provider: "gateway" }),
  );
  expect(response.headers.get("X-Orbsie-Authoring-Run-Id")).toBe(
    "22222222-2222-4222-8222-222222222222",
  );
  expect(response.headers.get("X-Orbsie-Review-Image-Supported")).toBe("0");
});
