const deps = vi.hoisted(() => ({
  getAuth: vi.fn(),
  trialIdentity: vi.fn(),
  issue: vi.fn(),
  issueReviewOnly: vi.fn(),
  readRun: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  admitReview: vi.fn(),
  completeReview: vi.fn(),
}));

vi.mock("../src/lib/server/auth", async () => ({
  ...(await vi.importActual("../src/lib/server/auth")),
  getAuth: deps.getAuth,
}));
vi.mock("../src/lib/server/trial", async () => ({
  ...(await vi.importActual("../src/lib/server/trial")),
  trialIdentity: deps.trialIdentity,
}));
vi.mock("../src/lib/server/authoring-run-ledger", async () => ({
  ...(await vi.importActual("../src/lib/server/authoring-run-ledger")),
  issueAuthoringRun: deps.issue,
  issueReviewOnlyAuthoringRun: deps.issueReviewOnly,
  readAuthoringRun: deps.readRun,
  completeInitialAuthoringRun: deps.complete,
  failAuthoringRun: deps.fail,
  admitAuthoringReview: deps.admitReview,
  completeAuthoringReview: deps.completeReview,
}));

import { afterEach, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
import { createSceneBinding } from "../src/lib/scene-binding";
import {
  authoringRequestFingerprint,
  resolveAuthoringRequestIdentity,
} from "../src/lib/server/authoring-run-identity";
import { TrialExhausted } from "../src/lib/server/trial";
import { AuthoringRunLedgerError } from "../src/lib/server/authoring-run-ledger";
import {
  admitReviewOnlyAuthoringRun,
  admitAuthoringReviewPhase,
  admitInitialAuthoringRun,
} from "../src/lib/server/authoring-run-admission";

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

type RecoveryInput = Parameters<typeof admitReviewOnlyAuthoringRun>[0];

function recoveryInput(
  provider: "gateway" | "free" = "gateway",
): RecoveryInput {
  return {
    ...input(provider),
    priorRunId: "33333333-3333-4333-8333-333333333333",
    ...(provider === "gateway"
      ? { ownerSession: { ownerId: "owner-1", sessionId: "session-1" } }
      : {}),
  };
}

async function matchingPrior(value: RecoveryInput) {
  const scene = await createSceneBinding(value.project);
  const identity = await resolveAuthoringRequestIdentity({
    request: value.request,
    provider: value.provider,
    trialIdentity: value.trialIdentity,
    ownerSession: value.ownerSession,
  });
  return {
    runId: value.priorRunId,
    identityHash: identity.identityHash,
    projectId: value.project.id,
    provider: value.provider,
    model: value.model,
    effort: value.effort ?? null,
    requestFingerprint: authoringRequestFingerprint(value),
    initialRevision: scene.revision,
    initialSceneDigest: scene.digest,
    phase: "failed",
    remainingReviewSlots: 1,
    completedRevision: scene.revision,
    completedSceneBindingDigest: scene.digest,
    live: true,
  };
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

it("retains one exact-token failure fence after review completion", async () => {
  deps.admitReview.mockResolvedValue({
    runId: "11111111-1111-4111-8111-111111111111",
    reviewPhase: "review",
    phaseToken: "22222222-2222-4222-8222-222222222222",
    remainingReviewSlots: 1,
  });
  deps.completeReview.mockResolvedValue({ phase: "completed" });
  deps.fail.mockResolvedValue({ phase: "failed" });
  const project = blankProject();
  const admission = await admitAuthoringReviewPhase({
    ...input(),
    provider: "chatgpt",
    runId: "11111111-1111-4111-8111-111111111111",
    reviewPhase: "review",
    ownerSession: { ownerId: "owner-1", sessionId: "session-1" },
    project,
  });
  const binding = {
    version: 1 as const,
    projectId: project.id,
    revision: project.revision,
    digest: "a".repeat(64),
  };
  await admission.complete(binding, false, new AbortController().signal);
  await admission.fail(Error("release failed"));
  await admission.fail(Error("late duplicate"));
  expect(deps.completeReview).toHaveBeenCalledOnce();
  expect(deps.fail).toHaveBeenCalledOnce();
  expect(deps.fail).toHaveBeenCalledWith(
    expect.objectContaining({
      runId: "11111111-1111-4111-8111-111111111111",
      phaseToken: "22222222-2222-4222-8222-222222222222",
      revision: project.revision,
      sceneBindingDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    }),
  );
});

it("admits a fresh review only for the exact failed scene and request", async () => {
  const value = recoveryInput();
  const prior = await matchingPrior(value);
  deps.readRun.mockResolvedValue(prior);
  deps.issueReviewOnly.mockResolvedValue({
    runId: "44444444-4444-4444-8444-444444444444",
    trialRemaining: null,
    expiresAt: new Date(),
  });

  const admitted = await admitReviewOnlyAuthoringRun(value);

  expect(deps.readRun).toHaveBeenCalledWith(value.priorRunId);
  expect(deps.issueReviewOnly).toHaveBeenCalledWith({
    identityHash: prior.identityHash,
    projectId: value.project.id,
    provider: value.provider,
    model: value.model,
    requestFingerprint: prior.requestFingerprint,
    priorRunId: value.priorRunId,
    initialRevision: prior.completedRevision,
    initialSceneDigest: prior.completedSceneBindingDigest,
  });
  expect(admitted).toEqual({
    runId: "44444444-4444-4444-8444-444444444444",
    trialRemaining: null,
  });
  expect(admitted).not.toHaveProperty("phaseToken");
});

it("rejects a stale scene without issuing or claiming a review run", async () => {
  const value = recoveryInput("free");
  const prior = await matchingPrior(value);
  deps.readRun.mockResolvedValue({
    ...prior,
    completedSceneBindingDigest: "b".repeat(64),
  });

  await expect(admitReviewOnlyAuthoringRun(value)).rejects.toMatchObject({
    status: 409,
    message: "This failed review can no longer be recovered.",
  });
  expect(deps.issueReviewOnly).not.toHaveBeenCalled();
});

it("rejects a different identity, provider, or prompt with the same safe error", async () => {
  for (const mismatch of ["identity", "provider", "prompt"] as const) {
    const value = recoveryInput();
    const prior = await matchingPrior(value);
    deps.readRun.mockResolvedValue({
      ...prior,
      ...(mismatch === "identity" ? { identityHash: "c".repeat(64) } : {}),
      ...(mismatch === "provider" ? { provider: "chatgpt" } : {}),
    });
    const current =
      mismatch === "prompt"
        ? { ...value, prompt: "A different request" }
        : value;

    await expect(admitReviewOnlyAuthoringRun(current)).rejects.toMatchObject({
      status: 409,
      message: "This failed review can no longer be recovered.",
    });
    expect(deps.issueReviewOnly).not.toHaveBeenCalled();
    deps.readRun.mockReset();
  }
});

it.each(["active", "finalized"] as const)(
  "rejects a %s prior run without issuing a replacement",
  async (phase) => {
    const value = recoveryInput();
    deps.readRun.mockResolvedValue({ ...(await matchingPrior(value)), phase });

    await expect(admitReviewOnlyAuthoringRun(value)).rejects.toMatchObject({
      status: 409,
    });
    expect(deps.issueReviewOnly).not.toHaveBeenCalled();
  },
);

it("charges one free claim atomically after validating the prior run", async () => {
  const value = recoveryInput("free");
  deps.readRun.mockResolvedValue(await matchingPrior(value));
  deps.issueReviewOnly.mockResolvedValue({
    runId: "44444444-4444-4444-8444-444444444444",
    trialRemaining: 2,
    expiresAt: new Date(),
  });

  const admitted = await admitReviewOnlyAuthoringRun(value);

  expect(deps.issueReviewOnly).toHaveBeenCalledOnce();
  expect(deps.issueReviewOnly.mock.calls[0][0]).toMatchObject({
    provider: "free",
    trialIdentity: expect.objectContaining({ identityHash: "a".repeat(64) }),
    initialRevision: value.project.revision,
  });
  expect(admitted).toEqual({
    runId: "44444444-4444-4444-8444-444444444444",
    trialRemaining: 2,
    trialCookie: "orbsie_trial=synthetic",
  });
});

it("preserves free trial exhaustion as an HTTP 429", async () => {
  const value = recoveryInput("free");
  deps.readRun.mockResolvedValue(await matchingPrior(value));
  deps.issueReviewOnly.mockRejectedValue(new TrialExhausted());

  await expect(admitReviewOnlyAuthoringRun(value)).rejects.toMatchObject({
    status: 429,
  });
});

it("maps a duplicate recovery conflict to a safe HTTP 409", async () => {
  const value = recoveryInput();
  deps.readRun.mockResolvedValue(await matchingPrior(value));
  deps.issueReviewOnly.mockRejectedValue(
    new AuthoringRunLedgerError(
      "phase-conflict",
      "The stored error must not be exposed.",
    ),
  );

  await expect(admitReviewOnlyAuthoringRun(value)).rejects.toMatchObject({
    status: 409,
    message: "This failed review can no longer be recovered.",
  });
});

it("does not read or issue a prior run after cancellation", async () => {
  const value = recoveryInput();
  const controller = new AbortController();
  controller.abort();

  await expect(
    admitReviewOnlyAuthoringRun({ ...value, signal: controller.signal }),
  ).rejects.toThrow();
  expect(deps.readRun).not.toHaveBeenCalled();
  expect(deps.issueReviewOnly).not.toHaveBeenCalled();

  const duringRead = recoveryInput();
  const readController = new AbortController();
  const prior = await matchingPrior({
    ...duringRead,
    signal: readController.signal,
  });
  deps.readRun.mockImplementation(async () => {
    readController.abort();
    return prior;
  });
  await expect(
    admitReviewOnlyAuthoringRun({
      ...duringRead,
      signal: readController.signal,
    }),
  ).rejects.toThrow();
  expect(deps.issueReviewOnly).not.toHaveBeenCalled();
});
