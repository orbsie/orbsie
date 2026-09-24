import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";

const deps = vi.hoisted(() => ({
  auth: vi.fn(),
  session: vi.fn(),
  origin: vi.fn(),
  configured: vi.fn(),
  admit: vi.fn(),
  createManager: vi.fn(),
  createDurable: vi.fn(),
  models: vi.fn(),
  generate: vi.fn(),
  review: vi.fn(),
  HttpError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  DurableError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
  CredentialError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("@/lib/server/auth", () => ({
  getAuth: deps.auth,
  checkOrigin: deps.origin,
  HttpError: deps.HttpError,
  boundedJSON: async (request: Request) => {
    try {
      return await request.json();
    } catch {
      throw new deps.HttpError(400, "Invalid request.");
    }
  },
}));
vi.mock("@/lib/server/chatgpt-host-manager", () => ({
  createChatGPTHostManager: deps.createManager,
}));
vi.mock("@/lib/server/chatgpt-durable-service", () => ({
  createChatGPTDurableService: deps.createDurable,
  ChatGPTDurableServiceError: deps.DurableError,
}));
vi.mock("@/lib/server/chatgpt-credential-vault", () => ({
  ChatGPTCredentialVaultError: deps.CredentialError,
}));
vi.mock("@/lib/server/authoring-run-admission", () => ({
  admitReviewOnlyAuthoringRun: deps.admit,
  authoringReviewConfigured: deps.configured,
}));

import { POST } from "../src/app/api/chatgpt/review/start/route";

const PRIOR_RUN_ID = "11111111-1111-4111-8111-111111111111";
const NEW_RUN_ID = "22222222-2222-4222-8222-222222222222";

function payload(extra: Record<string, unknown> = {}) {
  return {
    priorRunId: PRIOR_RUN_ID,
    model: "gpt-6-luna",
    effort: "low",
    prompt: "Make the saved garden more open.",
    project: blankProject(),
    localModeling: false,
    browserModeling: true,
    selected: "tree-0",
    ...extra,
  };
}

function request(
  body: unknown = payload(),
  options: { origin?: string; path?: string } = {},
) {
  return new Request(
    `https://orbsie.test${options.path ?? "/api/chatgpt/review/start"}`,
    {
      method: "POST",
      headers: {
        origin: options.origin ?? "https://orbsie.test",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function setup() {
  vi.stubEnv("ORBSIE_CHATGPT_HOSTED", "1");
  vi.stubEnv("ORBSIE_CHATGPT_GENERATION", "1");
  deps.configured.mockReturnValue(true);
  deps.origin.mockImplementation((incoming: Request) => {
    if (incoming.headers.get("origin") !== new URL(incoming.url).origin)
      throw new deps.HttpError(
        403,
        "This request must come from your Orbsie app.",
      );
  });
  deps.session.mockResolvedValue({
    user: { id: "guest-owner", isAnonymous: true },
    session: { id: "guest-session" },
  });
  deps.auth.mockReturnValue({ api: { getSession: deps.session } });
  deps.createManager.mockReturnValue({});
  deps.models.mockResolvedValue([
    {
      id: "catalog-gpt-luna",
      model: "gpt-6-luna",
      displayName: "GPT Luna",
      supportedReasoningEfforts: ["low", "medium"],
      defaultReasoningEffort: "low",
      inputModalities: ["text", "image"],
    },
  ]);
  deps.generate.mockResolvedValue(undefined);
  deps.review.mockResolvedValue(undefined);
  deps.createDurable.mockReturnValue({
    models: deps.models,
    generate: deps.generate,
    review: deps.review,
  });
  deps.admit.mockResolvedValue({ runId: NEW_RUN_ID });
}

beforeEach(setup);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("hosted ChatGPT review-only start route", () => {
  it("admits a guest review after model preflight without invoking inference", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      runId: NEW_RUN_ID,
      reviewImageSupported: true,
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Orbsie-Request-Id")).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    expect(deps.models).toHaveBeenCalledWith(
      { ownerId: "guest-owner", sessionId: "guest-session" },
      expect.any(AbortSignal),
      expect.any(Number),
    );
    expect(deps.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        priorRunId: PRIOR_RUN_ID,
        provider: "chatgpt",
        model: "gpt-6-luna",
        effort: "low",
        prompt: "Make the saved garden more open.",
        localModeling: false,
        browserModeling: true,
        selected: "tree-0",
        ownerSession: { ownerId: "guest-owner", sessionId: "guest-session" },
      }),
    );
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.review).not.toHaveBeenCalled();
  });

  it.each([
    ["hosted connection", "ORBSIE_CHATGPT_HOSTED"],
    ["generation", "ORBSIE_CHATGPT_GENERATION"],
  ])("requires the %s feature flag", async (_label, flag) => {
    vi.stubEnv(flag, "0");

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(deps.auth).not.toHaveBeenCalled();
    expect(deps.models).not.toHaveBeenCalled();
    expect(deps.admit).not.toHaveBeenCalled();
  });

  it("rejects disabled review, malformed input, cross-origin requests, and query strings", async () => {
    deps.configured.mockReturnValue(false);
    const disabled = await POST(request());
    deps.configured.mockReturnValue(true);
    const malformed = await POST(
      request(payload({ priorRunId: "not-a-uuid" })),
    );
    const crossOrigin = await POST(
      request(payload(), { origin: "https://other.test" }),
    );
    const query = await POST(
      request(payload(), { path: "/api/chatgpt/review/start?run=prior" }),
    );
    const injectedIdentity = await POST(
      request(payload({ ownerId: "caller" })),
    );

    expect(disabled.status).toBe(503);
    expect(malformed.status).toBe(400);
    expect(crossOrigin.status).toBe(403);
    expect(query.status).toBe(400);
    expect(injectedIdentity.status).toBe(400);
    expect(deps.models).not.toHaveBeenCalled();
    expect(deps.admit).not.toHaveBeenCalled();
  });

  it("rejects disconnected hosts and unavailable models before admission", async () => {
    deps.models.mockResolvedValueOnce(null);
    const disconnected = await POST(request());
    expect(disconnected.status).toBe(409);
    expect(await disconnected.json()).toMatchObject({
      code: "CHATGPT_CONNECTION_REQUIRED",
    });

    deps.models.mockResolvedValueOnce([]);
    const unavailableModel = await POST(request());
    expect(unavailableModel.status).toBe(400);
    expect(deps.admit).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.review).not.toHaveBeenCalled();
  });

  it("redacts host failures and preserves a stale predecessor conflict", async () => {
    deps.models.mockRejectedValueOnce(
      new deps.DurableError("unavailable", "private host credential detail"),
    );
    const unavailable = await POST(request());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain(
      "private host credential detail",
    );
    expect(deps.admit).not.toHaveBeenCalled();

    deps.admit.mockRejectedValueOnce(
      new deps.HttpError(409, "This failed review can no longer be recovered."),
    );
    const stale = await POST(request());
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: "This failed review can no longer be recovered.",
    });
    expect(deps.admit).toHaveBeenCalledOnce();
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.review).not.toHaveBeenCalled();
  });
});
