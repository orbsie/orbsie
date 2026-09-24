import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  session: vi.fn(),
  origin: vi.fn(),
  configured: vi.fn(() => true),
  admit: vi.fn(),
  review: vi.fn(),
  createManager: vi.fn(),
  createDurable: vi.fn(),
  DurableError: class DurableError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("@/lib/server/auth", () => ({
  getAuth: state.auth,
  checkOrigin: state.origin,
  boundedJSON: (request: Request) => request.json(),
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/server/chatgpt-host-manager", () => ({
  createChatGPTHostManager: state.createManager,
}));
vi.mock("@/lib/server/chatgpt-durable-service", () => ({
  createChatGPTDurableService: state.createDurable,
  ChatGPTDurableServiceError: state.DurableError,
}));
vi.mock("@/lib/server/authoring-run-admission", () => ({
  admitAuthoringReviewPhase: state.admit,
  authoringReviewConfigured: state.configured,
}));

import { blankProject } from "../src/lib/protocol";
import { authoringReviewDiagnosticFailureKinds } from "../src/lib/server/authoring-review-observability";
import { POST } from "../src/app/api/chatgpt/review/route";

const runId = "11111111-1111-4111-8111-111111111111";

function request(
  body: Record<string, unknown>,
  clientRunId?: string,
  signal?: AbortSignal,
) {
  return new Request("https://orbsie.test/api/chatgpt/review", {
    method: "POST",
    headers: {
      origin: "https://orbsie.test",
      "content-type": "application/json",
      ...(clientRunId ? { "x-orbsie-client-run-id": clientRunId } : {}),
    },
    body: JSON.stringify({
      runId,
      phase: "review",
      model: "gpt-6-luna",
      effort: "low",
      prompt: "Build a garden",
      project: blankProject(),
      browserModeling: false,
      ...body,
    }),
    signal,
  });
}

beforeEach(() => {
  vi.stubEnv("ORBSIE_CHATGPT_HOSTED", "1");
  vi.stubEnv("ORBSIE_CHATGPT_GENERATION", "1");
  vi.stubEnv("BETTER_AUTH_SECRET", "route-review-secret");
  state.origin.mockImplementation(() => undefined);
  state.session.mockResolvedValue({
    user: { id: "owner" },
    session: { id: "session" },
  });
  state.auth.mockReturnValue({ api: { getSession: state.session } });
  state.createManager.mockReturnValue({});
  state.admit.mockResolvedValue({
    runId,
    reviewPhase: "review",
    remainingReviewSlots: 1,
    complete: vi.fn(),
    fail: vi.fn(),
  });
  state.review.mockImplementation(
    async (
      _identity: unknown,
      input: { project: { id: string; revision: number } },
      _signal: AbortSignal,
      _deadline: number,
      _correlation: unknown,
      admit: () => Promise<unknown>,
    ) => {
      await admit();
      return {
        review: {
          version: 1,
          projectId: input.project.id,
          reviewedRevision: input.project.revision,
          scope: "structural-only",
          verdict: "accept",
          summary: "The scene is ready.",
          issues: [],
          corrections: [],
        },
        corrections: [],
        binding: {
          version: 1,
          projectId: input.project.id,
          revision: input.project.revision,
          digest: "a".repeat(64),
        },
      };
    },
  );
  state.createDurable.mockReturnValue({ review: state.review });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  state.configured.mockReturnValue(true);
});

describe("hosted ChatGPT review route", () => {
  it("returns the admitted remaining budget for both correction reviews", async () => {
    state.review.mockImplementation(
      async (
        _identity: unknown,
        input: { project: { id: string; revision: number } },
        _signal: AbortSignal,
        _deadline: number,
        _correlation: unknown,
        admit: () => Promise<unknown>,
      ) => {
        await admit();
        return {
          review: {
            version: 1,
            projectId: input.project.id,
            reviewedRevision: input.project.revision,
            scope: "structural-only",
            verdict: "revise",
            summary: "The scene needs a color correction.",
            issues: [{ summary: "Wrong sky color.", entityIds: [] }],
            corrections: [{ type: "set_environment", sky: "#aabbff" }],
          },
          corrections: [
            { type: "set_environment", sky: "#aabbff" },
            { type: "commit_revision", message: "Corrected the sky." },
          ],
          binding: {
            version: 1,
            projectId: input.project.id,
            revision: input.project.revision + 2,
            digest: "a".repeat(64),
          },
        };
      },
    );
    for (const remainingReviewSlots of [2, 1]) {
      state.admit.mockResolvedValueOnce({
        runId,
        reviewPhase: "review",
        remainingReviewSlots,
        complete: vi.fn(),
        fail: vi.fn(),
      });
      const response = await POST(request({}));
      expect(response.status).toBe(200);
      expect((await response.json()).remainingCalls).toBe(remainingReviewSlots);
    }
  });

  it("authenticates a guest-capable session and returns the typed review shape", async () => {
    const clientRunId = "22222222-2222-4222-8222-222222222222";
    const response = await POST(request({}, clientRunId));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Orbsie-Review-Failure-Kind")).toBeNull();
    expect(await response.json()).toMatchObject({
      review: { verdict: "accept", scope: "structural-only" },
      corrections: [],
      binding: { revision: 0, digest: "a".repeat(64) },
      revision: 0,
      digest: "a".repeat(64),
      scope: "structural-only",
      remainingCalls: 0,
    });
    expect(response.headers.get("x-orbsie-request-id")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(state.review).toHaveBeenCalledWith(
      { ownerId: "owner", sessionId: "session" },
      expect.not.objectContaining({ runId: expect.anything() }),
      expect.any(AbortSignal),
      expect.any(Number),
      expect.objectContaining({ clientRunId }),
      expect.any(Function),
    );
    expect(state.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "chatgpt",
        ownerSession: { ownerId: "owner", sessionId: "session" },
      }),
    );
  });

  it("rejects observations for another scene before durable review admission", async () => {
    const project = blankProject();
    const response = await POST(
      request({
        project,
        structuralObservations: {
          projectId: "another-scene",
          revision: project.revision,
          renderer: "software",
        },
      }),
    );
    expect(response.status).toBe(400);
    expect(state.review).not.toHaveBeenCalled();
    expect(state.admit).not.toHaveBeenCalled();
  });

  it("marks admitted provider failures with an allowlisted terminal diagnostic", async () => {
    const fail = vi.fn(async () => {
      throw Error("database secret");
    });
    state.admit.mockResolvedValueOnce({
      runId,
      reviewPhase: "review",
      remainingReviewSlots: 1,
      complete: vi.fn(),
      fail,
    });
    state.review.mockImplementationOnce(
      async (
        _identity: unknown,
        _input: unknown,
        _signal: AbortSignal,
        _deadline: number,
        _correlation: unknown,
        admit: () => Promise<unknown>,
      ) => {
        await admit();
        throw Error("provider secret");
      },
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const response = await POST(request({}));
      expect(response.status).toBe(502);
      const responseBody = await response.json();
      expect(responseBody).toEqual({
        error: "The ChatGPT scene review could not be completed.",
      });
      const failureKind = response.headers.get("X-Orbsie-Review-Failure-Kind");
      expect(authoringReviewDiagnosticFailureKinds).toContain(failureKind);
      expect(failureKind).toBe("unknown");
      const events = info.mock.calls
        .map(([line]) => {
          try {
            return JSON.parse(String(line)) as Record<string, unknown>;
          } catch {
            return undefined;
          }
        })
        .filter((event) => event?.event === "authoring-review");
      expect(events).toContainEqual(
        expect.objectContaining({
          state: "terminal",
          outcome: "failed",
          failureKind,
        }),
      );
      expect(JSON.stringify(events)).not.toContain("provider secret");
      expect(JSON.stringify(responseBody)).not.toContain("provider secret");
      expect(fail).toHaveBeenCalledOnce();
    } finally {
      info.mockRestore();
    }
  });

  it("does not mark a failure that happens before review admission", async () => {
    state.configured.mockReturnValueOnce(false);

    const response = await POST(request({}));

    expect(response.status).toBe(503);
    expect(response.headers.get("X-Orbsie-Review-Failure-Kind")).toBeNull();
    expect(state.admit).not.toHaveBeenCalled();
  });

  it("marks admitted cancellation safely", async () => {
    const controller = new AbortController();
    state.admit.mockResolvedValueOnce({
      runId,
      reviewPhase: "review",
      remainingReviewSlots: 1,
      complete: vi.fn(),
      fail: vi.fn(async () => undefined),
    });
    state.review.mockImplementationOnce(
      async (
        _identity: unknown,
        _input: unknown,
        _signal: AbortSignal,
        _deadline: number,
        _correlation: unknown,
        admit: () => Promise<unknown>,
      ) => {
        await admit();
        controller.abort();
        throw Error("private provider body");
      },
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const response = await POST(request({}, undefined, controller.signal));
      expect(response.status).toBe(499);
      expect(response.headers.get("X-Orbsie-Review-Failure-Kind")).toBe(
        "route-aborted",
      );
      expect(await response.json()).toEqual({
        error: "The scene review was canceled.",
      });
      const events = info.mock.calls
        .map(([line]) => {
          try {
            return JSON.parse(String(line)) as Record<string, unknown>;
          } catch {
            return undefined;
          }
        })
        .filter((event) => event?.event === "authoring-review");
      expect(events).toContainEqual(
        expect.objectContaining({
          state: "terminal",
          outcome: "cancelled",
          failureKind: "route-aborted",
        }),
      );
      expect(JSON.stringify(events)).not.toContain("private provider body");
    } finally {
      info.mockRestore();
    }
  });
});
