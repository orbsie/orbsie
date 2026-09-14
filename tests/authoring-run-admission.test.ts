const deps = vi.hoisted(() => ({
  getAuth: vi.fn(),
  trialIdentity: vi.fn(),
  issue: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
}));

vi.mock("../src/lib/server/auth", async () => ({
  ...(await vi.importActual("../src/lib/server/auth")),
  getAuth: deps.getAuth,
}));
vi.mock("../src/lib/server/trial", async () => ({
  ...(await vi.importActual("../src/lib/server/trial")),
  trialIdentity: deps.trialIdentity,
}));
vi.mock("../src/lib/server/authoring-run-ledger", () => ({
  issueAuthoringRun: deps.issue,
  completeInitialAuthoringRun: deps.complete,
  failAuthoringRun: deps.fail,
}));

import { afterEach, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
import { admitInitialAuthoringRun } from "../src/lib/server/authoring-run-admission";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function input(provider: "gateway" | "free" = "gateway") {
  vi.stubEnv("ORBSIE_AUTHORING_REVIEW", "1");
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-secret-value");
  return {
    request: new Request("https://orbsie.test/api/generate"),
    project: blankProject(),
    prompt: "  Make   a garden  ",
    provider,
    model: "openai/gpt-5.6-luna",
    selected: undefined,
    localModeling: false,
    browserModeling: false,
    signal: new AbortController().signal,
    ...(provider === "free"
      ? {
          trialIdentity: {
            identityHash: "a".repeat(64),
            cookie: "orbsie_trial=synthetic",
            buckets: [],
          },
        }
      : {}),
  };
}

function setupIssue() {
  deps.issue.mockResolvedValue({
    runId: "11111111-1111-4111-8111-111111111111",
    phaseToken: "22222222-2222-4222-8222-222222222222",
    trialRemaining: null,
    expiresAt: new Date(),
  });
}

it("uses the signed visitor identity for anonymous linked API runs without charging free quota", async () => {
  setupIssue();
  deps.getAuth.mockReturnValue(null);
  deps.trialIdentity.mockReturnValue({
    identityHash: "b".repeat(64),
    cookie: "orbsie_trial=visitor",
    buckets: [],
  });
  const admission = await admitInitialAuthoringRun(input());
  expect(deps.trialIdentity).toHaveBeenCalledOnce();
  expect(deps.issue).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "gateway",
      identityHash: "b".repeat(64),
    }),
  );
  expect(deps.issue.mock.calls[0][0]).not.toHaveProperty("trialIdentity");
  expect(admission.trialCookie).toBe("orbsie_trial=visitor");
});

it("uses an existing owner/session HMAC for linked API runs", async () => {
  setupIssue();
  deps.getAuth.mockReturnValue({
    api: {
      getSession: vi.fn(async () => ({
        user: { id: "owner-1" },
        session: { id: "session-1" },
      })),
    },
  });
  const admission = await admitInitialAuthoringRun(input());
  expect(deps.trialIdentity).not.toHaveBeenCalled();
  expect(deps.issue.mock.calls[0][0].identityHash).toMatch(/^[0-9a-f]{64}$/);
  expect(admission.trialCookie).toBeUndefined();
});

it("charges free review issuance through the ledger transaction once", async () => {
  setupIssue();
  deps.issue.mockResolvedValueOnce({
    runId: "11111111-1111-4111-8111-111111111111",
    phaseToken: "22222222-2222-4222-8222-222222222222",
    trialRemaining: 0,
    expiresAt: new Date(),
  });
  const admission = await admitInitialAuthoringRun(input("free"));
  expect(deps.issue).toHaveBeenCalledOnce();
  expect(deps.issue.mock.calls[0][0]).toMatchObject({
    provider: "free",
    trialIdentity: expect.objectContaining({ identityHash: "a".repeat(64) }),
  });
  expect(admission.trialRemaining).toBe(0);
});
