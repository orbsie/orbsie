import { afterEach, describe, expect, it, vi } from "vitest";

const sandbox = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@vercel/sandbox", () => ({
  Sandbox: sandbox,
  APIError: class extends Error {},
}));

const vault = vi.hoisted(() => ({
  lease: vi.fn(),
  save: vi.fn(),
  release: vi.fn(),
  admit: vi.fn(),
}));

vi.mock("../src/lib/server/chatgpt-credential-vault", () => ({
  leaseChatGPTCredentialCache: vault.lease,
  saveChatGPTCredentialCache: vault.save,
  releaseChatGPTCredentialLease: vault.release,
  withChatGPTCredentialLeaseAdmission: vault.admit,
  beginChatGPTCredentialIntent: vi.fn(),
  bindChatGPTCredentialIntentHost: vi.fn(),
  canUseLegacyChatGPTHost: vi.fn(),
  cancelChatGPTCredentialIntent: vi.fn(),
  completeChatGPTCredentialIntent: vi.fn(),
  rememberChatGPTCredentialCache: vi.fn(),
  revokeChatGPTCredentialAuthorityAndCaptureHosts: vi.fn(),
  admitLegacyChatGPTCredentialIntent: vi.fn(),
}));

import { blankProject } from "../src/lib/protocol";
import { createSceneBinding } from "../src/lib/scene-binding";
import {
  PRIVATE_SCENE_REVIEW_HEADER,
  PRIVATE_SCENE_REVIEW_VERSION,
} from "../src/lib/server/chatgpt-scene-review";
import { createChatGPTDurableService } from "../src/lib/server/chatgpt-durable-service";
import { replayChatGPTSceneReview } from "../src/lib/server/chatgpt-scene-review-replay";
import { createChatGPTHostHandler } from "../src/lib/server/chatgpt-host";
import { createChatGPTManagedOperationController } from "../src/lib/server/chatgpt-managed-operation";
import { createChatGPTSandboxBackend } from "../src/lib/server/chatgpt-sandbox-backend";
import type { ChatGPTRuntime } from "../src/lib/server/chatgpt-runtime";

const identity = { ownerId: "owner", sessionId: "session" };
const host = {
  attemptId: "attempt",
  sandboxName: "review-host",
  capability: "private-capability",
  expiresAt: new Date(Date.now() + 600_000),
};
const lease = {
  connectionId: "11111111-1111-4111-8111-111111111111",
  connectionVersion: 1,
  expiresAt: new Date(Date.now() + 1_800_000),
  leaseId: "lease",
  leaseEpoch: 4,
  leaseUntil: new Date(Date.now() + 600_000),
  cache: new TextEncoder().encode("initial-cache"),
};

function json(value: unknown, headers: Record<string, string> = {}) {
  return Response.json(value, { headers });
}

function setup() {
  vi.stubEnv("BETTER_AUTH_SECRET", "review-service-secret");
  vault.lease.mockResolvedValue({ kind: "leased", lease });
  vault.save.mockResolvedValue({ kind: "saved" });
  vault.release.mockResolvedValue({ kind: "released" });
  vault.admit.mockImplementation(
    async (
      _identity: unknown,
      _lease: unknown,
      work: () => Promise<unknown>,
    ) => ({ kind: "admitted", value: await work() }),
  );
}

function input(project = blankProject()) {
  return {
    model: "gpt-5.6-luna",
    effort: "low",
    phase: "review" as const,
    prompt: "Build a small garden",
    project,
    browserModeling: false,
  };
}

async function managerFor(
  result: (value: Record<string, unknown>) => Record<string, unknown>,
) {
  const calls: string[] = [];
  let initializedDeadline = 0;
  const manager = {
    ensure: vi.fn(async () => host),
    acquireForOperation: vi.fn(async () => host),
    privateOperation: vi.fn(async (_host, operation: string, value: any) => {
      calls.push(operation);
      if (operation === "initialize") {
        initializedDeadline = value.deadlineAt;
        return json({
          operationId: value.operationId,
          epoch: lease.leaseEpoch,
          deadlineAt: value.deadlineAt,
        });
      }
      if (operation === "status")
        return json(
          { status: "connected" },
          {
            [PRIVATE_SCENE_REVIEW_HEADER]: String(PRIVATE_SCENE_REVIEW_VERSION),
          },
        );
      if (operation === "review")
        return json(result(value), {
          "content-type": "application/json",
          [PRIVATE_SCENE_REVIEW_HEADER]: String(PRIVATE_SCENE_REVIEW_VERSION),
        });
      if (operation === "seal")
        return json({
          operationId: value.operationId,
          epoch: value.epoch,
          deadlineAt: initializedDeadline,
          expired: false,
          cache: Buffer.from("rotated-cache").toString("base64"),
        });
      return json({ cleared: true });
    }),
    destroyHost: vi.fn(async () => undefined),
    releaseHost: vi.fn(async () => true),
    request: vi.fn(),
    disconnect: vi.fn(async () => true),
  };
  return { calls, manager };
}

class ChainReviewRuntime implements ChatGPTRuntime {
  readonly listeners = new Set<(value: unknown) => void>();
  readonly cache = new TextEncoder().encode("chain-rotated-cache");
  closed = false;
  turnStarted = false;
  private releaseHeldTurnCallback?: () => void;

  constructor(
    private readonly projectId: string,
    private readonly holdTurn = false,
  ) {}

  releaseHeldTurn() {
    this.releaseHeldTurnCallback?.();
    this.releaseHeldTurnCallback = undefined;
  }

  async request(method: string): Promise<unknown> {
    if (method === "account/read")
      return { account: { type: "chatgpt", label: "Synthetic" } };
    if (method === "model/list")
      return {
        data: [
          {
            id: "luna",
            model: "gpt-5.6-luna",
            displayName: "Luna",
            hidden: false,
            supportedReasoningEfforts: [{ reasoningEffort: "low" }],
            defaultReasoningEffort: "low",
          },
        ],
        nextCursor: null,
      };
    if (method === "thread/start") return { thread: { id: "chain-thread" } };
    if (method === "turn/start") {
      this.turnStarted = true;
      if (this.holdTurn)
        await new Promise<void>((resolve) => {
          this.releaseHeldTurnCallback = resolve;
        });
      queueMicrotask(() => {
        const delta = JSON.stringify({
          version: 1,
          projectId: this.projectId,
          reviewedRevision: 0,
          scope: "structural-only",
          verdict: "accept",
          summary: "The scene is ready.",
          issues: [],
          corrections: [],
        });
        for (const listener of this.listeners) {
          listener({
            method: "item/agentMessage/delta",
            params: {
              threadId: "chain-thread",
              turnId: "chain-turn",
              delta,
            },
          });
          listener({
            method: "turn/completed",
            params: {
              threadId: "chain-thread",
              turn: { id: "chain-turn", status: "completed" },
            },
          });
        }
      });
      return { turn: { id: "chain-turn" } };
    }
    if (method === "turn/interrupt") return {};
    throw Error(`Unexpected synthetic RPC: ${method}`);
  }

  subscribe(listener: (value: unknown) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close() {
    this.closed = true;
  }

  async getCredentialSnapshot() {
    return { cache: Uint8Array.from(this.cache) };
  }
}

async function chainFixture(
  projectId: string,
  tamper: "binding" | "epoch" | undefined = undefined,
  holdTurn = false,
) {
  const chainHost = {
    ...host,
    sandboxName: "orbsie-chatgpt-11111111-1111-4111-8111-111111111111",
    capability: "p".repeat(64),
  };
  const runtime = new ChainReviewRuntime(projectId, holdTurn);
  const controller = createChatGPTManagedOperationController({
    createRuntime: vi.fn(async () => runtime),
  });
  const handler = createChatGPTHostHandler({
    session: {
      start: vi.fn(),
      getSnapshot: vi.fn(),
      readAuthStatus: vi.fn(),
      cancel: vi.fn(),
      logout: vi.fn(),
    },
    token: chainHost.capability,
    managedOperation: controller,
  });
  const backend = createChatGPTSandboxBackend({
    artifactDirectory: "/unused-test-artifacts",
  });
  sandbox.get.mockResolvedValue({
    status: "running",
    domain: () => "https://synthetic-chatgpt.test",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const response = await handler(
        new Request(url, {
          method: init.method,
          headers: init.headers,
          body: init.body,
          signal: init.signal,
        }),
      );
      if (tamper !== undefined && url.endsWith("/private/operation/review")) {
        const body = (await response.json()) as Record<string, unknown>;
        if (tamper === "epoch") body.epoch = 999;
        else
          body.binding = {
            ...(body.binding as Record<string, unknown>),
            digest: "f".repeat(64),
          };
        return Response.json(body, { headers: response.headers });
      }
      return response;
    }),
  );
  const manager = {
    ensure: vi.fn(async () => chainHost),
    acquireForOperation: vi.fn(async () => chainHost),
    privateOperation: vi.fn(
      async (
        operationHost: typeof host,
        operation: Parameters<typeof backend.privateOperation>[1],
        value: unknown,
        options?: {
          signal?: AbortSignal;
          correlation?: { requestId: string; clientRunId?: string };
          sceneReviewVersion?: typeof PRIVATE_SCENE_REVIEW_VERSION;
        },
      ) =>
        backend.privateOperation(
          operationHost,
          operation,
          value,
          options?.signal,
          options?.correlation,
          undefined,
          options?.sceneReviewVersion,
        ),
    ),
    destroyHost: vi.fn(async () => undefined),
    releaseHost: vi.fn(async () => true),
    request: vi.fn(),
    disconnect: vi.fn(async () => true),
  };
  return { manager, runtime };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("hosted ChatGPT review durable orchestration", () => {
  it("runs durable review through the real private HTTP managed handler", async () => {
    const project = blankProject();
    const complete = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    try {
      setup();
      const accepted = await chainFixture(project.id);
      const acceptedResult = await createChatGPTDurableService({
        manager: accepted.manager,
      }).review(
        identity,
        input(project),
        new AbortController().signal,
        Date.now() + 120_000,
        undefined,
        async () => ({ complete, fail }),
      );
      expect(acceptedResult.review.verdict).toBe("accept");
      expect(complete).toHaveBeenCalledOnce();
      expect(fail).not.toHaveBeenCalled();
      expect(accepted.runtime.closed).toBe(true);

      vi.unstubAllGlobals();
      vi.clearAllMocks();
      setup();
      const mismatchComplete = vi.fn(async () => undefined);
      const mismatchFail = vi.fn(async () => undefined);
      const mismatched = await chainFixture(project.id, "binding");
      await expect(
        createChatGPTDurableService({ manager: mismatched.manager }).review(
          identity,
          input(project),
          new AbortController().signal,
          Date.now() + 120_000,
          undefined,
          async () => ({
            complete: mismatchComplete,
            fail: mismatchFail,
          }),
        ),
      ).rejects.toMatchObject({ code: "invalid-response" });
      expect(mismatchComplete).not.toHaveBeenCalled();
      expect(mismatchFail).toHaveBeenCalledOnce();
      expect(mismatched.runtime.closed).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects an epoch-tampered response through the real private HTTP chain", async () => {
    const project = blankProject();
    const complete = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    try {
      setup();
      const fixture = await chainFixture(project.id, "epoch");
      await expect(
        createChatGPTDurableService({ manager: fixture.manager }).review(
          identity,
          input(project),
          new AbortController().signal,
          Date.now() + 120_000,
          undefined,
          async () => ({ complete, fail }),
        ),
      ).rejects.toMatchObject({ code: "invalid-response" });
      expect(complete).not.toHaveBeenCalled();
      expect(fail).toHaveBeenCalledOnce();
      expect(vault.release).toHaveBeenCalledOnce();
      expect(fixture.runtime.closed).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("aborts after admission while the private response is held", async () => {
    setup();
    const project = blankProject();
    const fixture = await chainFixture(project.id, undefined, true);
    const controller = new AbortController();
    let admittedResolve!: () => void;
    const admitted = new Promise<void>((resolve) => {
      admittedResolve = resolve;
    });
    const complete = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    const pending = createChatGPTDurableService({
      manager: fixture.manager,
    }).review(
      identity,
      input(project),
      controller.signal,
      Date.now() + 120_000,
      undefined,
      async () => {
        admittedResolve();
        return { complete, fail };
      },
    );
    await admitted;
    await vi.waitFor(() => expect(fixture.runtime.turnStarted).toBe(true));
    controller.abort(Error("client aborted"));
    fixture.runtime.releaseHeldTurn();
    await expect(pending).rejects.toThrow();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
    expect(vault.release).toHaveBeenCalledOnce();
    expect(fixture.runtime.closed).toBe(true);
  });

  it("preflights before admission, replays a verified accept, and cleans the lease", async () => {
    setup();
    const project = blankProject();
    const binding = await createSceneBinding(project);
    const fixture = await managerFor((value) => ({
      type: "orbsie.private.scene-review",
      version: 1,
      operationId: value.operationId,
      epoch: value.epoch,
      review: {
        version: 1,
        projectId: project.id,
        reviewedRevision: project.revision,
        scope: "structural-only",
        verdict: "accept",
        summary: "The garden is ready.",
        issues: [],
        corrections: [],
      },
      corrections: [],
      binding: {
        version: binding.version,
        projectId: binding.projectId,
        revision: binding.revision,
        digest: binding.digest,
      },
    }));
    const order: string[] = [];
    const complete = vi.fn(async () => {
      order.push("complete");
    });
    const fail = vi.fn(async () => undefined);
    const service = createChatGPTDurableService({ manager: fixture.manager });
    const result = await service.review(
      identity,
      { ...input(project), operationId: "spoofed-operation", epoch: 999 },
      new AbortController().signal,
      Date.now() + 120_000,
      undefined,
      async () => {
        order.push("admit");
        return { complete, fail };
      },
    );
    expect(result.review.verdict).toBe("accept");
    expect(result.corrections).toEqual([]);
    expect(result.binding).toEqual(binding);
    expect(order).toEqual(["admit", "complete"]);
    expect(fail).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual([
      "initialize",
      "status",
      "review",
      "seal",
      "clear",
    ]);
    const reviewCall = fixture.manager.privateOperation.mock.calls.find(
      (call) => call[1] === "review",
    );
    expect(reviewCall?.[2]).toMatchObject({
      epoch: lease.leaseEpoch,
    });
    expect(reviewCall?.[2]).not.toHaveProperty(
      "operationId",
      "spoofed-operation",
    );
    expect(vault.save).toHaveBeenCalledOnce();
    expect(vault.release).toHaveBeenCalledOnce();
  });

  it("rejects a claimed binding that does not match the web replay", async () => {
    setup();
    const project = blankProject();
    const binding = await createSceneBinding(project);
    const fixture = await managerFor((value) => ({
      type: "orbsie.private.scene-review",
      version: 1,
      operationId: value.operationId,
      epoch: value.epoch,
      review: {
        version: 1,
        projectId: project.id,
        reviewedRevision: project.revision,
        scope: "structural-only",
        verdict: "accept",
        summary: "Ready.",
        issues: [],
        corrections: [],
      },
      corrections: [],
      binding: {
        version: binding.version,
        projectId: binding.projectId,
        revision: binding.revision,
        digest: "f".repeat(64),
      },
    }));
    const complete = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    const service = createChatGPTDurableService({ manager: fixture.manager });
    await expect(
      service.review(
        identity,
        input(project),
        new AbortController().signal,
        Date.now() + 120_000,
        undefined,
        async () => ({ complete, fail }),
      ),
    ).rejects.toThrow("invalid binding");
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
    expect(vault.release).toHaveBeenCalledOnce();
  });

  it("replays a revision and completes the admitted phase with the new binding", async () => {
    setup();
    const project = blankProject();
    project.entities.push({
      id: "flower",
      label: "Flower",
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#6ead60",
      stage: "ready",
    });
    const review = {
      version: 1 as const,
      projectId: project.id,
      reviewedRevision: project.revision,
      scope: "structural-only" as const,
      verdict: "revise" as const,
      summary: "The flower needs a brighter color.",
      issues: [{ summary: "The flower is too muted.", entityIds: ["flower"] }],
      corrections: [
        { type: "set_material" as const, id: "flower", color: "#ff44aa" },
      ],
    };
    const replayed = await replayChatGPTSceneReview({
      result: { review },
      project,
      prompt: input(project).prompt,
      browserModeling: false,
      phase: "review",
      scope: "structural-only",
      signal: new AbortController().signal,
    });
    const fixture = await managerFor((value) => ({
      type: "orbsie.private.scene-review",
      version: 1,
      operationId: value.operationId,
      epoch: value.epoch,
      review,
      corrections: replayed.corrections,
      binding: {
        version: replayed.binding.version,
        projectId: replayed.binding.projectId,
        revision: replayed.binding.revision,
        digest: replayed.binding.digest,
      },
    }));
    const complete = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    const result = await createChatGPTDurableService({
      manager: fixture.manager,
    }).review(
      identity,
      input(project),
      new AbortController().signal,
      Date.now() + 120_000,
      undefined,
      async () => ({ complete, fail }),
    );
    expect(result.review.verdict).toBe("revise");
    expect(result.corrections).toEqual(replayed.corrections);
    expect(result.binding).toEqual(replayed.binding);
    expect(complete).toHaveBeenCalledWith(
      replayed.binding,
      false,
      expect.any(AbortSignal),
    );
    expect(fail).not.toHaveBeenCalled();
  });

  it("completes a final review as partial without applying another correction", async () => {
    setup();
    const project = blankProject();
    const binding = await createSceneBinding(project);
    const review = {
      version: 1 as const,
      projectId: project.id,
      reviewedRevision: project.revision,
      scope: "structural-only" as const,
      verdict: "revise" as const,
      summary: "One issue remains for a later pass.",
      issues: [
        { summary: "The composition still needs polish.", entityIds: [] },
      ],
      corrections: [],
    };
    const fixture = await managerFor((value) => ({
      type: "orbsie.private.scene-review",
      version: 1,
      operationId: value.operationId,
      epoch: value.epoch,
      review,
      corrections: [],
      binding: {
        version: binding.version,
        projectId: binding.projectId,
        revision: binding.revision,
        digest: binding.digest,
      },
    }));
    const complete = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    const result = await createChatGPTDurableService({
      manager: fixture.manager,
    }).review(
      identity,
      { ...input(project), phase: "final-review" },
      new AbortController().signal,
      Date.now() + 120_000,
      undefined,
      async () => ({ complete, fail }),
    );
    expect(result.review.verdict).toBe("revise");
    expect(result.corrections).toEqual([]);
    expect(result.binding).toEqual(binding);
    expect(complete).toHaveBeenCalledWith(
      binding,
      false,
      expect.any(AbortSignal),
    );
    expect(fail).not.toHaveBeenCalled();
  });

  it("rejects a private correction batch that differs from web replay", async () => {
    setup();
    const project = blankProject();
    project.entities.push({
      id: "flower",
      label: "Flower",
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#6ead60",
      stage: "ready",
    });
    const review = {
      version: 1 as const,
      projectId: project.id,
      reviewedRevision: project.revision,
      scope: "structural-only" as const,
      verdict: "revise" as const,
      summary: "The flower needs a brighter color.",
      issues: [{ summary: "The flower is too muted.", entityIds: ["flower"] }],
      corrections: [
        { type: "set_material" as const, id: "flower", color: "#ff44aa" },
      ],
    };
    const replayed = await replayChatGPTSceneReview({
      result: { review },
      project,
      prompt: input(project).prompt,
      browserModeling: false,
      phase: "review",
      scope: "structural-only",
      signal: new AbortController().signal,
    });
    const fixture = await managerFor((value) => ({
      type: "orbsie.private.scene-review",
      version: 1,
      operationId: value.operationId,
      epoch: value.epoch,
      review,
      corrections: [replayed.corrections[0]],
      binding: {
        version: replayed.binding.version,
        projectId: replayed.binding.projectId,
        revision: replayed.binding.revision,
        digest: replayed.binding.digest,
      },
    }));
    const complete = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    await expect(
      createChatGPTDurableService({ manager: fixture.manager }).review(
        identity,
        input(project),
        new AbortController().signal,
        Date.now() + 120_000,
        undefined,
        async () => ({ complete, fail }),
      ),
    ).rejects.toMatchObject({ code: "invalid-response" });
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
  });

  it("rejects review issues for another entity or scope", async () => {
    const project = blankProject();
    const review = {
      version: 1 as const,
      projectId: project.id,
      reviewedRevision: project.revision,
      scope: "visual+structural" as const,
      verdict: "revise" as const,
      summary: "There is an issue.",
      issues: [{ summary: "Unknown object.", entityIds: ["missing"] }],
      corrections: [],
    };
    await expect(
      replayChatGPTSceneReview({
        result: { review },
        project,
        prompt: input(project).prompt,
        browserModeling: false,
        phase: "final-review",
        scope: "structural-only",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("scene review response is invalid");
  });

  it("rejects a stale host before ledger admission", async () => {
    setup();
    const stale = new Error("old host");
    const fixture = await managerFor(() => ({}));
    fixture.manager.ensure.mockRejectedValueOnce(stale);
    const admit = vi.fn(async () => ({
      complete: vi.fn(),
      fail: vi.fn(),
    }));
    const service = createChatGPTDurableService({ manager: fixture.manager });
    await expect(
      service.review(
        identity,
        input(),
        new AbortController().signal,
        Date.now() + 120_000,
        undefined,
        admit,
      ),
    ).rejects.toThrow("old host");
    expect(admit).not.toHaveBeenCalled();
    expect(vault.release).toHaveBeenCalledOnce();
  });

  it("rejects a disconnected managed account before ledger admission", async () => {
    setup();
    const fixture = await managerFor(() => ({}));
    const privateOperation =
      fixture.manager.privateOperation.getMockImplementation()!;
    fixture.manager.privateOperation.mockImplementation(
      async (_host: unknown, operation: string, value: any) => {
        if (operation === "status")
          return json(
            { status: "disconnected" },
            {
              [PRIVATE_SCENE_REVIEW_HEADER]: String(
                PRIVATE_SCENE_REVIEW_VERSION,
              ),
            },
          );
        return privateOperation(_host, operation, value);
      },
    );
    const admit = vi.fn(async () => ({
      complete: vi.fn(),
      fail: vi.fn(),
    }));
    await expect(
      createChatGPTDurableService({ manager: fixture.manager }).review(
        identity,
        input(),
        new AbortController().signal,
        Date.now() + 120_000,
        undefined,
        admit,
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(admit).not.toHaveBeenCalled();
    expect(
      fixture.manager.privateOperation.mock.calls.map((call) => call[1]),
    ).toEqual(["initialize", "status"]);
    expect(vault.release).toHaveBeenCalledOnce();
  });

  it("fails the admitted phase when seal finalization fails", async () => {
    setup();
    const project = blankProject();
    const binding = await createSceneBinding(project);
    const fixture = await managerFor((value) => ({
      type: "orbsie.private.scene-review",
      version: 1,
      operationId: value.operationId,
      epoch: value.epoch,
      review: {
        version: 1,
        projectId: project.id,
        reviewedRevision: project.revision,
        scope: "structural-only",
        verdict: "accept",
        summary: "Ready.",
        issues: [],
        corrections: [],
      },
      corrections: [],
      binding: {
        version: binding.version,
        projectId: binding.projectId,
        revision: binding.revision,
        digest: binding.digest,
      },
    }));
    const privateOperation =
      fixture.manager.privateOperation.getMockImplementation()!;
    fixture.manager.privateOperation.mockImplementation(
      async (_host: unknown, operation: string, value: any) => {
        if (operation === "seal") return json({ malformed: true });
        return privateOperation(_host, operation, value);
      },
    );
    const complete = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    const service = createChatGPTDurableService({ manager: fixture.manager });
    await expect(
      service.review(
        identity,
        input(project),
        new AbortController().signal,
        Date.now() + 120_000,
        undefined,
        async () => ({ complete, fail }),
      ),
    ).rejects.toMatchObject({ code: "finalization" });
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
    expect(fixture.manager.destroyHost).toHaveBeenCalledWith(
      host.sandboxName,
      expect.any(AbortSignal),
    );
    expect(vault.release).toHaveBeenCalledOnce();
  });

  it("fails and cleans up when the credential lease is revoked during save", async () => {
    setup();
    vault.save.mockResolvedValueOnce({ kind: "stale" });
    const project = blankProject();
    const binding = await createSceneBinding(project);
    const fixture = await managerFor((value) => ({
      type: "orbsie.private.scene-review",
      version: 1,
      operationId: value.operationId,
      epoch: value.epoch,
      review: {
        version: 1,
        projectId: project.id,
        reviewedRevision: project.revision,
        scope: "structural-only",
        verdict: "accept",
        summary: "Ready.",
        issues: [],
        corrections: [],
      },
      corrections: [],
      binding: {
        version: binding.version,
        projectId: binding.projectId,
        revision: binding.revision,
        digest: binding.digest,
      },
    }));
    const complete = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    await expect(
      createChatGPTDurableService({ manager: fixture.manager }).review(
        identity,
        input(project),
        new AbortController().signal,
        Date.now() + 120_000,
        undefined,
        async () => ({ complete, fail }),
      ),
    ).rejects.toMatchObject({ code: "finalization" });
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
    expect(fixture.manager.destroyHost).toHaveBeenCalledOnce();
    expect(vault.release).toHaveBeenCalledOnce();
  });

  it("compensates a completed ledger phase when lease release fails", async () => {
    setup();
    const project = blankProject();
    const binding = await createSceneBinding(project);
    const fixture = await managerFor((value) => ({
      type: "orbsie.private.scene-review",
      version: 1,
      operationId: value.operationId,
      epoch: value.epoch,
      review: {
        version: 1,
        projectId: project.id,
        reviewedRevision: project.revision,
        scope: "structural-only",
        verdict: "accept",
        summary: "Ready.",
        issues: [],
        corrections: [],
      },
      corrections: [],
      binding: {
        version: binding.version,
        projectId: binding.projectId,
        revision: binding.revision,
        digest: binding.digest,
      },
    }));
    vault.release
      .mockResolvedValueOnce({ kind: "busy" })
      .mockResolvedValueOnce({ kind: "released" });
    const complete = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    await expect(
      createChatGPTDurableService({ manager: fixture.manager }).review(
        identity,
        input(project),
        new AbortController().signal,
        Date.now() + 120_000,
        undefined,
        async () => ({ complete, fail }),
      ),
    ).rejects.toMatchObject({ code: "finalization" });
    expect(complete).toHaveBeenCalledOnce();
    expect(fail).toHaveBeenCalledOnce();
    expect(vault.release).toHaveBeenCalledTimes(2);
  });
});
