const deps = vi.hoisted(() => ({
  preflight: vi.fn(),
  admit: vi.fn(),
  execute: vi.fn(),
  trialEnabled: vi.fn(() => true),
  trialIdentity: vi.fn(),
  configured: vi.fn(() => true),
}));

vi.mock("../src/lib/server/model-preflight", () => ({
  requireGenerationModel: deps.preflight,
}));
vi.mock("../src/lib/server/authoring-run-admission", () => ({
  admitAuthoringReviewPhase: deps.admit,
  authoringReviewConfigured: deps.configured,
}));
vi.mock("../src/lib/server/scene-review-execution", async () => ({
  ...(await vi.importActual("../src/lib/server/scene-review-execution")),
  executeSceneReview: deps.execute,
}));
vi.mock("../src/lib/server/trial", async () => ({
  ...(await vi.importActual("../src/lib/server/trial")),
  trialEnabled: deps.trialEnabled,
  trialIdentity: deps.trialIdentity,
}));

import { afterEach, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
import { FREE_MODEL } from "../src/lib/server/trial";
import { POST } from "../src/app/api/generate/review/route";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  deps.configured.mockReturnValue(true);
  deps.trialEnabled.mockReturnValue(true);
});

function setup() {
  vi.stubEnv("BETTER_AUTH_URL", "https://orbsie.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-review-secret");
  vi.stubEnv("AI_GATEWAY_API_KEY_FREE", "synthetic-free-key");
  deps.preflight.mockResolvedValue({
    id: "openai/gpt-5.6-luna",
    capabilities: {
      text: { supported: true, source: "catalog" },
      streamingText: { supported: true, source: "catalog" },
      tools: { supported: false, source: "catalog" },
      structuredOutput: { supported: false, source: "catalog" },
      jsonObject: { supported: false, source: "catalog" },
      jsonSchema: { supported: false, source: "catalog" },
      imageInput: { supported: false, source: "catalog" },
    },
  });
  deps.trialIdentity.mockReturnValue({
    identityHash: "a".repeat(64),
    cookie: "orbsie_trial=synthetic",
    buckets: [],
  });
  deps.admit.mockResolvedValue({
    runId: "11111111-1111-4111-8111-111111111111",
    remainingReviewSlots: 1,
    trialCookie: "orbsie_trial=synthetic",
    complete: vi.fn(),
    fail: vi.fn(),
  });
  deps.execute.mockResolvedValue({
    review: {
      version: 1,
      projectId: "new-world",
      reviewedRevision: 0,
      scope: "structural-only",
      verdict: "accept",
      summary: "The scene is coherent.",
      issues: [],
      corrections: [],
    },
    corrections: [],
    binding: {
      version: 1,
      projectId: "new-world",
      revision: 0,
      digest: "b".repeat(64),
    },
  });
}

function request(body: Record<string, unknown>, clientRunId?: string) {
  return new Request("https://orbsie.test/api/generate/review", {
    method: "POST",
    headers: {
      origin: "https://orbsie.test",
      "Content-Type": "application/json",
      ...(clientRunId ? { "X-Orbsie-Client-Run-Id": clientRunId } : {}),
    },
    body: JSON.stringify({
      runId: "11111111-1111-4111-8111-111111111111",
      phase: "review",
      provider: "free",
      prompt: "Make a garden",
      project: blankProject(),
      ...body,
    }),
  });
}

it("preflights and admits free review without charging the trial again", async () => {
  setup();
  const response = await POST(request({}));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    scope: "structural-only",
    remainingCalls: 0,
    digest: "b".repeat(64),
  });
  expect(deps.trialIdentity).toHaveBeenCalledOnce();
  expect(deps.admit).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "free",
      model: FREE_MODEL,
      trialIdentity: expect.objectContaining({ identityHash: "a".repeat(64) }),
    }),
  );
  expect(deps.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "gateway",
      model: FREE_MODEL,
      key: "synthetic-free-key",
    }),
  );
});

it("emits correlated allowlisted review admission and terminal diagnostics", async () => {
  setup();
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const clientRunId = "22222222-2222-4222-8222-222222222222";
  try {
    const response = await POST(request({}, clientRunId));
    expect(response.status).toBe(200);
    const events = info.mock.calls
      .map(([line]) => {
        try {
          return JSON.parse(String(line)) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .filter((event) => event?.event === "authoring-review");
    const genericEvents = info.mock.calls
      .map(([line]) => {
        try {
          return JSON.parse(String(line)) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .filter(
        (event): event is Record<string, unknown> => event?.layer === "route",
      );
    expect(events).toHaveLength(2);
    expect(genericEvents.some((event) => event.event === "phase")).toBe(true);
    expect(genericEvents).toContainEqual(
      expect.objectContaining({
        event: "terminal",
        terminalReason: "completed",
      }),
    );
    expect(events[0]).toMatchObject({
      schemaVersion: 1,
      event: "authoring-review",
      state: "admission",
      requestId: response.headers.get("X-Orbsie-Request-Id"),
      clientRunId,
      phase: "review",
      callIndex: 2,
      scope: "structural-only",
      outcome: "admitted",
    });
    expect(events[1]).toMatchObject({
      state: "terminal",
      requestId: response.headers.get("X-Orbsie-Request-Id"),
      clientRunId,
      phase: "review",
      callIndex: 2,
      scope: "structural-only",
      outcome: "accepted",
    });
    const diagnostics = JSON.stringify(events);
    expect(diagnostics).not.toContain("Make a garden");
    expect(diagnostics).not.toContain("synthetic-free-key");
    expect(diagnostics).not.toContain("phaseToken");
    expect(diagnostics).not.toContain("new-world");
  } finally {
    info.mockRestore();
  }
});

it("emits a sanitized failed terminal diagnostic after admission", async () => {
  setup();
  deps.execute.mockRejectedValueOnce(
    new Error("raw-provider-diagnostic synthetic-free-key"),
  );
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    const response = await POST(
      request({}, "33333333-3333-4333-8333-333333333333"),
    );
    expect(response.status).toBe(502);
    const events = info.mock.calls
      .map(([line]) => {
        try {
          return JSON.parse(String(line)) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .filter((event) => event?.event === "authoring-review");
    const genericEvents = info.mock.calls
      .map(([line]) => {
        try {
          return JSON.parse(String(line)) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .filter(
        (event): event is Record<string, unknown> => event?.layer === "route",
      );
    expect(events).toHaveLength(2);
    expect(genericEvents).toContainEqual(
      expect.objectContaining({
        event: "terminal",
        terminalReason: "provider-error",
        failureCode: "host-unavailable",
        httpStatus: 502,
      }),
    );
    expect(events[0]).toMatchObject({
      state: "admission",
      phase: "review",
      callIndex: 2,
      scope: "structural-only",
      outcome: "admitted",
    });
    expect(events[1]).toMatchObject({
      state: "terminal",
      phase: "review",
      callIndex: 2,
      scope: "structural-only",
      outcome: "failed",
    });
    const diagnostics = JSON.stringify(events);
    expect(diagnostics).not.toContain("raw-provider-diagnostic");
    expect(diagnostics).not.toContain("synthetic-free-key");
    expect(diagnostics).not.toContain("Make a garden");
    expect(diagnostics).not.toContain("new-world");
  } finally {
    info.mockRestore();
  }
});

it("records final review as the third call with a partial terminal outcome", async () => {
  setup();
  deps.execute.mockResolvedValueOnce({
    review: {
      version: 1,
      projectId: "new-world",
      reviewedRevision: 0,
      scope: "structural-only",
      verdict: "revise",
      summary: "A remaining defect is visible.",
      issues: [{ summary: "The path is unclear.", entityIds: [] }],
      corrections: [],
    },
    corrections: [],
    binding: {
      version: 1,
      projectId: "new-world",
      revision: 0,
      digest: "b".repeat(64),
    },
  });
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    const response = await POST(
      request(
        {
          phase: "final-review",
          provider: "openrouter",
          model: "openai/gpt-5.6-luna",
          key: "synthetic-provider-key",
        },
        "44444444-4444-4444-8444-444444444444",
      ),
    );
    expect(response.status).toBe(200);
    const events = info.mock.calls
      .map(([line]) => {
        try {
          return JSON.parse(String(line)) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .filter((event) => event?.event === "authoring-review");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      state: "admission",
      phase: "final-review",
      callIndex: 3,
      scope: "structural-only",
      outcome: "admitted",
    });
    expect(events[1]).toMatchObject({
      state: "terminal",
      phase: "final-review",
      callIndex: 3,
      scope: "structural-only",
      outcome: "partial",
    });
  } finally {
    info.mockRestore();
  }
});

it("rejects unsupported images before ledger admission", async () => {
  setup();
  const response = await POST(
    request({
      reviewImage: {
        projectId: "new-world",
        revision: 0,
        renderer: "software",
        width: 1,
        height: 1,
        image: png,
      },
    }),
  );
  expect(response.status).toBe(400);
  expect(deps.admit).not.toHaveBeenCalled();
  expect(deps.execute).not.toHaveBeenCalled();
});

it("binds the paid provider and preserves the final-review verdict-only boundary", async () => {
  setup();
  deps.preflight.mockResolvedValueOnce({
    id: "openai/gpt-5.6-luna",
    capabilities: {
      text: { supported: true, source: "catalog" },
      streamingText: { supported: true, source: "catalog" },
      tools: { supported: false, source: "catalog" },
      structuredOutput: { supported: false, source: "catalog" },
      jsonObject: { supported: true, source: "catalog" },
      jsonSchema: { supported: false, source: "catalog" },
      imageInput: { supported: false, source: "catalog" },
    },
  });
  deps.admit.mockResolvedValueOnce({
    remainingReviewSlots: 0,
    complete: vi.fn(),
    fail: vi.fn(),
  });
  deps.execute.mockResolvedValueOnce({
    review: {
      version: 1,
      projectId: "new-world",
      reviewedRevision: 0,
      scope: "structural-only",
      verdict: "revise",
      summary: "A remaining defect is visible.",
      issues: [{ summary: "The path is unclear.", entityIds: [] }],
      corrections: [],
    },
    corrections: [],
    binding: {
      version: 1,
      projectId: "new-world",
      revision: 0,
      digest: "b".repeat(64),
    },
  });
  const response = await POST(
    request({
      phase: "final-review",
      provider: "openrouter",
      model: "openai/gpt-5.6-luna",
      key: "synthetic-provider-key",
    }),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).remainingCalls).toBe(0);
  expect(deps.admit).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "openrouter",
    }),
  );
  expect(deps.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "openrouter",
      phase: "final-review",
      outputFormat: "json-object",
      effort: "low",
    }),
  );
});

it("rejects unknown or oversized structural observations before admission", async () => {
  setup();
  const unknown = await POST(
    request({
      structuralObservations: {
        projectId: "new-world",
        revision: 0,
        unexpected: true,
      },
    }),
  );
  expect(unknown.status).toBe(400);
  expect(deps.admit).not.toHaveBeenCalled();
  expect(deps.execute).not.toHaveBeenCalled();

  vi.clearAllMocks();
  setup();
  const project = blankProject();
  const oversized = await POST(
    request({
      project,
      structuralObservations: {
        projectId: project.id,
        revision: project.revision,
        renderer: "software",
        bounds: Array.from({ length: 160 }, (_, index) => ({
          entityId: `entity-${index}`,
          min: [-1000, -1000, -1000],
          max: [1000, 1000, 1000],
        })),
        supports: Array.from({ length: 160 }, (_, index) => ({
          entityId: `entity-${index}`,
          supportEntityId: null,
          grounded: true,
        })),
        errors: Array.from({ length: 32 }, () => "x".repeat(500)),
      },
    }),
  );
  expect(oversized.status).toBe(400);
  expect(deps.admit).not.toHaveBeenCalled();
  expect(deps.execute).not.toHaveBeenCalled();
});
