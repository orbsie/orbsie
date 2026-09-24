const deps = vi.hoisted(() => ({
  preflight: vi.fn(),
  admit: vi.fn(),
  trialEnabled: vi.fn(() => true),
  trialIdentity: vi.fn(),
  configured: vi.fn(() => true),
}));

vi.mock("../src/lib/server/model-preflight", () => ({
  requireGenerationModel: deps.preflight,
}));
vi.mock("../src/lib/server/authoring-run-admission", () => ({
  admitReviewOnlyAuthoringRun: deps.admit,
  authoringReviewConfigured: deps.configured,
}));
vi.mock("../src/lib/server/trial", async () => ({
  ...(await vi.importActual("../src/lib/server/trial")),
  trialEnabled: deps.trialEnabled,
  trialIdentity: deps.trialIdentity,
}));

import { afterEach, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
import { HttpError } from "../src/lib/server/auth";
import { FREE_MODEL, TrialExhausted } from "../src/lib/server/trial";
import { POST } from "../src/app/api/generate/review/start/route";

const PRIOR_RUN_ID = "11111111-1111-4111-8111-111111111111";
const NEW_RUN_ID = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  deps.configured.mockReturnValue(true);
  deps.trialEnabled.mockReturnValue(true);
});

function setup() {
  vi.stubEnv("BETTER_AUTH_URL", "https://orbsie.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-review-secret");
  vi.stubEnv("DATABASE_URL", "synthetic");
  vi.stubEnv("AI_GATEWAY_API_KEY_FREE", "synthetic-free-key");
  vi.stubGlobal("fetch", vi.fn());
  deps.preflight.mockResolvedValue({
    id: FREE_MODEL,
    capabilities: {
      imageInput: { supported: true, source: "catalog" },
    },
  });
  deps.trialIdentity.mockReturnValue({
    identityHash: "a".repeat(64),
    cookie: "orbsie_trial=synthetic",
    buckets: [],
  });
  deps.admit.mockResolvedValue({
    runId: NEW_RUN_ID,
    trialRemaining: 2,
    trialCookie: "orbsie_trial=synthetic",
  });
}

function request(
  provider: "free" | "openrouter" | "gateway" = "free",
  extra: Record<string, unknown> = {},
  options: { origin?: string; path?: string; signal?: AbortSignal } = {},
) {
  const linked = provider !== "free";
  return new Request(
    `https://orbsie.test${options.path ?? "/api/generate/review/start"}`,
    {
      method: "POST",
      ...(options.signal ? { signal: options.signal } : {}),
      headers: {
        origin: options.origin ?? "https://orbsie.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        priorRunId: PRIOR_RUN_ID,
        provider,
        ...(linked
          ? { model: "requested/model", key: "synthetic-provider-key" }
          : {}),
        prompt: "Make a garden",
        project: blankProject(),
        ...extra,
      }),
    },
  );
}

it("starts a free review from the failed run without invoking a provider", async () => {
  setup();
  const response = await POST(request());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    runId: NEW_RUN_ID,
    reviewImageSupported: true,
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Set-Cookie")).toBe("orbsie_trial=synthetic");
  expect(response.headers.get("X-Orbsie-Trial-Remaining")).toBe("2");
  expect(response.headers.get("X-Orbsie-Request-Id")).toMatch(
    /^[0-9a-f-]{36}$/i,
  );
  expect(deps.preflight).toHaveBeenCalledWith(
    "gateway",
    FREE_MODEL,
    expect.any(AbortSignal),
  );
  expect(deps.admit).toHaveBeenCalledWith(
    expect.objectContaining({
      priorRunId: PRIOR_RUN_ID,
      provider: "free",
      model: FREE_MODEL,
      prompt: "Make a garden",
      trialIdentity: expect.objectContaining({ identityHash: "a".repeat(64) }),
    }),
  );
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(["openrouter", "gateway"] as const)(
  "starts a linked %s review with the preflight model ID",
  async (provider) => {
    setup();
    deps.preflight.mockResolvedValueOnce({
      id: "provider/canonical-model",
      capabilities: {
        imageInput: { supported: false, source: "catalog" },
      },
    });
    deps.admit.mockResolvedValueOnce({
      runId: NEW_RUN_ID,
      trialRemaining: null,
    });

    const response = await POST(request(provider, { browserModeling: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      runId: NEW_RUN_ID,
      reviewImageSupported: false,
    });
    expect(response.headers.get("X-Orbsie-Trial-Remaining")).toBeNull();
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(deps.preflight).toHaveBeenCalledWith(
      provider,
      "requested/model",
      expect.any(AbortSignal),
    );
    expect(deps.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        provider,
        model: "provider/canonical-model",
        browserModeling: true,
      }),
    );
    expect(deps.admit).not.toHaveBeenCalledWith(
      expect.objectContaining({ trialIdentity: expect.anything() }),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  },
);

it("rejects disabled authoring review before preflight or admission", async () => {
  setup();
  deps.configured.mockReturnValue(false);

  const response = await POST(request());

  expect(response.status).toBe(503);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(deps.admit).not.toHaveBeenCalled();
});

it("rejects disabled free access before model preflight", async () => {
  setup();
  deps.trialEnabled.mockReturnValue(false);

  const response = await POST(request());

  expect(response.status).toBe(503);
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(deps.admit).not.toHaveBeenCalled();
  expect(deps.trialIdentity).not.toHaveBeenCalled();
});

it("rejects malformed and cross-origin requests", async () => {
  setup();
  const malformed = await POST(request("free", { priorRunId: "not-a-uuid" }));
  const crossOrigin = await POST(
    request("free", {}, { origin: "https://other.test" }),
  );

  expect(malformed.status).toBe(400);
  expect(crossOrigin.status).toBe(403);
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(deps.admit).not.toHaveBeenCalled();
});

it("rejects query parameters and invalid linked credentials", async () => {
  setup();
  const withQuery = await POST(
    request("free", {}, { path: "/api/generate/review/start?run=prior" }),
  );
  const missingKey = await POST(request("gateway", { key: "short" }));

  expect(withQuery.status).toBe(400);
  expect(missingKey.status).toBe(400);
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(deps.admit).not.toHaveBeenCalled();
});

it("returns the safe stale-run conflict from admission", async () => {
  setup();
  deps.admit.mockRejectedValueOnce(
    new HttpError(409, "This failed review can no longer be recovered."),
  );

  const response = await POST(request());

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "This failed review can no longer be recovered.",
  });
  expect(response.headers.get("Set-Cookie")).toBe("orbsie_trial=synthetic");
  expect(deps.preflight).toHaveBeenCalledOnce();
  expect(deps.admit).toHaveBeenCalledOnce();
});

it("returns exhausted free quota as 429 without issuing a review run", async () => {
  setup();
  deps.admit.mockRejectedValueOnce(new TrialExhausted());

  const response = await POST(request());

  expect(response.status).toBe(429);
  expect(response.headers.get("Set-Cookie")).toBe("orbsie_trial=synthetic");
  expect(response.headers.get("X-Orbsie-Trial-Remaining")).toBe("0");
  expect(deps.admit).toHaveBeenCalledOnce();
});

it("does not issue a review run when model preflight fails", async () => {
  setup();
  deps.preflight.mockRejectedValueOnce(
    new HttpError(503, "The model catalog is unavailable."),
  );

  const response = await POST(request());

  expect(response.status).toBe(503);
  expect(deps.admit).not.toHaveBeenCalled();
  expect(deps.trialIdentity).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it("maps a canceled model preflight to 499 without admission", async () => {
  setup();
  const controller = new AbortController();
  deps.preflight.mockImplementationOnce(async (_provider, _model, signal) => {
    controller.abort();
    throw signal.reason;
  });

  const response = await POST(
    request("free", {}, { signal: controller.signal }),
  );

  expect(response.status).toBe(499);
  expect(await response.json()).toEqual({
    error: "The review start was canceled.",
  });
  expect(deps.admit).not.toHaveBeenCalled();
});

it("maps unexpected admission failures to a safe 503", async () => {
  setup();
  deps.admit.mockRejectedValueOnce(
    Error("private database connection details"),
  );

  const response = await POST(request());

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "Authoring review is temporarily unavailable. Retry shortly.",
  });
});
