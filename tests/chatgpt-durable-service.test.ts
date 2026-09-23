import { afterEach, describe, expect, it, vi } from "vitest";

const vault = vi.hoisted(() => ({
  lease: vi.fn(),
  save: vi.fn(),
  release: vi.fn(),
  remember: vi.fn(),
  begin: vi.fn(),
  readIntent: vi.fn(),
  restartIntent: vi.fn(),
  bind: vi.fn(),
  completeIntent: vi.fn(),
  legacyAllowed: vi.fn(),
  admitLease: vi.fn(),
  cancel: vi.fn(),
  revoke: vi.fn(),
  revokeCapture: vi.fn(),
  admitLegacy: vi.fn(),
  VaultError: class VaultError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("../src/lib/server/chatgpt-credential-vault", () => ({
  leaseChatGPTCredentialCache: vault.lease,
  saveChatGPTCredentialCache: vault.save,
  releaseChatGPTCredentialLease: vault.release,
  rememberChatGPTCredentialCache: vault.remember,
  beginChatGPTCredentialIntent: vault.begin,
  readPendingChatGPTCredentialIntent: vault.readIntent,
  restartExpiredChatGPTCredentialIntent: vault.restartIntent,
  bindChatGPTCredentialIntentHost: vault.bind,
  completeChatGPTCredentialIntent: vault.completeIntent,
  canUseLegacyChatGPTHost: vault.legacyAllowed,
  withChatGPTCredentialLeaseAdmission: vault.admitLease,
  cancelChatGPTCredentialIntent: vault.cancel,
  revokeChatGPTCredentialAuthorityAndCaptureHosts: vault.revokeCapture,
  admitLegacyChatGPTCredentialIntent: vault.admitLegacy,
  ChatGPTCredentialVaultError: vault.VaultError,
}));

import { createChatGPTDurableService } from "../src/lib/server/chatgpt-durable-service";

const identity = { ownerId: "owner", sessionId: "session" };
const generationRequestId = "11111111-1111-4111-8111-111111111111";
const host = {
  attemptId: "attempt",
  sandboxName: "orbsie-chatgpt-attempt",
  capability: "capability",
  artifactDigest: "a".repeat(64),
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

function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function managerFor(
  operation: (name: string, input: unknown) => Response | Promise<Response>,
) {
  const calls: string[] = [];
  return {
    calls,
    manager: {
      ensure: vi.fn(async (): Promise<typeof host> => host),
      acquireForOperation: vi.fn(async () => host),
      privateOperation: vi.fn(async (_host, name, input) => {
        calls.push(name);
        return operation(name, input);
      }),
      request: vi.fn(),
      disconnect: vi.fn(async () => true),
      destroyHost: vi.fn(async () => undefined),
      releaseHost: vi.fn(async () => true),
      read: vi.fn(async (): Promise<typeof host | null> => host),
      captureOwnerHosts: vi.fn(
        async (): Promise<
          {
            ownerId: string;
            sessionId: string;
            attemptId: string;
            sandboxName: string;
          }[]
        > => [],
      ),
    },
  };
}

function setup() {
  vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(32));
  vault.lease.mockResolvedValue({ kind: "leased", lease });
  vault.save.mockResolvedValue({ kind: "saved" });
  vault.release.mockResolvedValue({ kind: "released" });
  vault.begin.mockResolvedValue({ epoch: 1, pendingAttemptId: null });
  vault.readIntent.mockResolvedValue(null);
  vault.restartIntent.mockResolvedValue(null);
  vault.bind.mockResolvedValue({ epoch: 1, pendingAttemptId: host.attemptId });
  vault.completeIntent.mockResolvedValue({
    epoch: 1,
    pendingAttemptId: host.attemptId,
  });
  vault.legacyAllowed.mockResolvedValue(true);
  vault.admitLease.mockImplementation(
    async (
      _identity: unknown,
      _lease: unknown,
      operation: () => Promise<unknown>,
    ) => ({ kind: "admitted", value: await operation() }),
  );
  vault.cancel.mockResolvedValue(true);
  vault.revoke.mockResolvedValue(true);
  vault.revokeCapture.mockResolvedValue({ revoked: true, hosts: [] });
  vault.admitLegacy.mockResolvedValue({
    epoch: 1,
    pendingAttemptId: host.attemptId,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("private durable ChatGPT operation orchestration", () => {
  it("restores, verifies, seals, saves rotated cache, clears, and releases", async () => {
    const sequence = managerFor((name) => {
      if (name === "initialize")
        return json({
          operationId: "operation",
          epoch: 4,
          deadlineAt: expect.any(Number),
        });
      if (name === "status") return json({ status: "connected" });
      if (name === "seal")
        return json({
          operationId: "operation",
          epoch: 4,
          deadlineAt: expect.any(Number),
          expired: false,
          cache: Buffer.from("rotated-cache").toString("base64"),
        });
      return json({ cleared: true });
    });
    // Replace asymmetric matchers in the synthetic private response with the
    // actual binding sent by initialize, while retaining a deterministic fake.
    let initializedDeadline = 0;
    sequence.manager.privateOperation.mockImplementation(
      async (_host, name, input) => {
        sequence.calls.push(name);
        if (name === "initialize") {
          initializedDeadline = input.deadlineAt;
          return json({
            operationId: input.operationId,
            epoch: 4,
            deadlineAt: input.deadlineAt,
          });
        }
        if (name === "status") return json({ status: "connected" });
        if (name === "seal")
          return json({
            operationId: input.operationId,
            epoch: 4,
            deadlineAt: initializedDeadline,
            expired: false,
            cache: Buffer.from("rotated-cache").toString("base64"),
          });
        return json({ cleared: true });
      },
    );
    setup();
    const service = createChatGPTDurableService({
      manager: sequence.manager,
      now: () => Date.now(),
    });
    await expect(service.status(identity)).resolves.toEqual({
      lifecycle: "idle",
      authStatus: "connected",
    });
    expect(sequence.calls).toEqual(["initialize", "status", "seal", "clear"]);
    expect(vault.save).toHaveBeenCalledWith(
      identity,
      lease,
      expect.any(Uint8Array),
      { signal: expect.any(AbortSignal) },
    );
    expect(vault.release).toHaveBeenCalledWith(identity, lease, {
      signal: expect.any(AbortSignal),
    });
  });

  it("destroys the host before releasing a lease when seal is malformed", async () => {
    setup();
    const sequence = managerFor(async (name, input) => {
      const operationInput = input as {
        operationId?: string;
        epoch?: number;
        deadlineAt?: number;
      };
      if (name === "initialize")
        return json({
          operationId: operationInput.operationId,
          epoch: 4,
          deadlineAt: operationInput.deadlineAt,
        });
      return json({
        operationId: "wrong",
        epoch: 4,
        deadlineAt: operationInput.deadlineAt,
        expired: false,
        cache: null,
      });
    });
    const service = createChatGPTDurableService({ manager: sequence.manager });
    await expect(service.status(identity)).rejects.toThrow("invalid seal");
    expect(sequence.manager.destroyHost).toHaveBeenCalledWith(
      host.sandboxName,
      expect.any(AbortSignal),
    );
    expect(vault.release).toHaveBeenCalledWith(identity, lease, {
      signal: expect.any(AbortSignal),
    });
    expect(sequence.calls).toEqual(["initialize", "status", "seal"]);
  });

  it("keeps a missing durable cache on the legacy route", async () => {
    setup();
    vault.lease.mockResolvedValue({ kind: "missing" });
    const sequence = managerFor(async () => json({}));
    const service = createChatGPTDurableService({ manager: sequence.manager });
    await expect(service.models(identity)).resolves.toBeNull();
    expect(sequence.manager.ensure).not.toHaveBeenCalled();
  });

  it("restarts a terminal old challenge under a new intent and host fence", async () => {
    setup();
    const previousHost = {
      ...host,
      attemptId: "old-attempt",
      sandboxName: "orbsie-chatgpt-old-attempt",
    };
    const nextHost = {
      ...host,
      attemptId: "next-attempt",
      sandboxName: "orbsie-chatgpt-next-attempt",
    };
    vault.begin.mockRejectedValueOnce(
      new vault.VaultError("active-connection", "active intent"),
    );
    vault.readIntent.mockResolvedValue({
      epoch: 7,
      pendingAttemptId: previousHost.attemptId,
    });
    vault.restartIntent.mockResolvedValue({
      epoch: 8,
      pendingAttemptId: "pending:8",
    });
    vault.bind.mockResolvedValue({
      epoch: 8,
      pendingAttemptId: nextHost.attemptId,
    });
    const sequence = managerFor(() =>
      json({ lifecycle: "expired", authStatus: "disconnected" }),
    );
    sequence.manager.read.mockResolvedValue(previousHost);
    sequence.manager.captureOwnerHosts.mockResolvedValue([
      {
        ownerId: identity.ownerId,
        sessionId: identity.sessionId,
        attemptId: previousHost.attemptId,
        sandboxName: previousHost.sandboxName,
      },
    ]);
    sequence.manager.ensure.mockResolvedValue(nextHost);
    sequence.manager.request
      .mockResolvedValueOnce(
        json({ lifecycle: "expired", authStatus: "disconnected" }),
      )
      .mockResolvedValueOnce(
        json({ lifecycle: "idle", authStatus: "disconnected" }),
      );

    const service = createChatGPTDurableService({ manager: sequence.manager });
    await expect(service.start(identity)).resolves.toMatchObject({
      host: { attemptId: nextHost.attemptId },
      intent: { epoch: 8, pendingAttemptId: "pending:8" },
    });
    expect(vault.restartIntent).toHaveBeenCalledWith(
      identity,
      { epoch: 7, pendingAttemptId: previousHost.attemptId },
      "terminal-host",
      { signal: undefined },
    );
    expect(sequence.manager.disconnect).toHaveBeenCalledWith(identity);
    expect(sequence.manager.ensure).toHaveBeenCalledTimes(1);
    expect(vault.bind).toHaveBeenCalledWith(identity, 8, nextHost.attemptId, {
      signal: undefined,
    });
  });

  it("routes an unbound reservation through the database expiry fence", async () => {
    setup();
    const nextHost = {
      ...host,
      attemptId: "recovered-attempt",
      sandboxName: "orbsie-chatgpt-recovered-attempt",
    };
    vault.begin.mockRejectedValueOnce(
      new vault.VaultError("active-connection", "active intent"),
    );
    vault.readIntent.mockResolvedValue({
      epoch: 7,
      pendingAttemptId: "pending:7",
    });
    vault.restartIntent.mockResolvedValue({
      epoch: 8,
      pendingAttemptId: "pending:8",
    });
    vault.bind.mockResolvedValue({
      epoch: 8,
      pendingAttemptId: nextHost.attemptId,
    });
    const sequence = managerFor(() =>
      json({ lifecycle: "idle", authStatus: "disconnected" }),
    );
    sequence.manager.ensure.mockResolvedValue(nextHost);
    sequence.manager.request.mockResolvedValue(
      json({ lifecycle: "idle", authStatus: "disconnected" }),
    );
    const service = createChatGPTDurableService({ manager: sequence.manager });

    await expect(service.start(identity)).resolves.toMatchObject({
      host: { attemptId: nextHost.attemptId },
      intent: { epoch: 8, pendingAttemptId: "pending:8" },
    });
    expect(vault.restartIntent).toHaveBeenCalledWith(
      identity,
      { epoch: 7, pendingAttemptId: "pending:7" },
      "abandoned-reservation",
      { signal: undefined },
    );
    expect(sequence.manager.captureOwnerHosts).not.toHaveBeenCalled();
    expect(sequence.manager.ensure).toHaveBeenCalledTimes(1);
    expect(vault.bind).toHaveBeenCalledWith(identity, 8, nextHost.attemptId, {
      signal: undefined,
    });
  });

  it("preserves an unbound reservation when the vault has not aged it out", async () => {
    setup();
    vault.begin.mockRejectedValueOnce(
      new vault.VaultError("active-connection", "active intent"),
    );
    vault.readIntent.mockResolvedValue({
      epoch: 7,
      pendingAttemptId: "pending:7",
    });
    vault.restartIntent.mockResolvedValue(null);
    const sequence = managerFor(() => json({ lifecycle: "idle" }));
    const service = createChatGPTDurableService({ manager: sequence.manager });

    await expect(service.start(identity)).rejects.toMatchObject({
      code: "login-pending",
    });
    expect(vault.restartIntent).toHaveBeenCalledWith(
      identity,
      { epoch: 7, pendingAttemptId: "pending:7" },
      "abandoned-reservation",
      { signal: undefined },
    );
    expect(sequence.manager.ensure).not.toHaveBeenCalled();
  });

  it("keeps a live pending challenge single-owner and exposes a typed conflict", async () => {
    setup();
    const previousHost = {
      ...host,
      attemptId: "old-attempt",
      sandboxName: "orbsie-chatgpt-old-attempt",
    };
    vault.begin.mockRejectedValueOnce(
      new vault.VaultError("active-connection", "active intent"),
    );
    vault.readIntent.mockResolvedValue({
      epoch: 7,
      pendingAttemptId: previousHost.attemptId,
    });
    const sequence = managerFor(async () =>
      json({ lifecycle: "pending", authStatus: "unknown" }),
    );
    sequence.manager.read.mockResolvedValue(previousHost);
    sequence.manager.captureOwnerHosts.mockResolvedValue([
      {
        ownerId: identity.ownerId,
        sessionId: identity.sessionId,
        attemptId: previousHost.attemptId,
        sandboxName: previousHost.sandboxName,
      },
    ]);
    sequence.manager.request.mockResolvedValue(
      json({ lifecycle: "pending", authStatus: "unknown" }),
    );
    const service = createChatGPTDurableService({ manager: sequence.manager });

    await expect(service.start(identity)).rejects.toMatchObject({
      code: "login-pending",
    });
    expect(vault.restartIntent).not.toHaveBeenCalled();
    expect(sequence.manager.disconnect).not.toHaveBeenCalled();
    expect(sequence.manager.ensure).not.toHaveBeenCalled();
  });

  it("reconstructs a deleted provider sandbox once before initializing the same cache", async () => {
    setup();
    let initializedDeadline = 0;
    const sequence = managerFor(async (_name, input) => {
      const operationInput = input as {
        operationId?: string;
        epoch?: number;
        deadlineAt?: number;
      };
      if (_name === "initialize") {
        initializedDeadline = operationInput.deadlineAt!;
        return json({
          operationId: operationInput.operationId,
          epoch: 4,
          deadlineAt: operationInput.deadlineAt,
        });
      }
      if (_name === "status") return json({ status: "connected" });
      if (_name === "seal")
        return json({
          operationId: operationInput.operationId,
          epoch: 4,
          deadlineAt: initializedDeadline,
          expired: false,
          cache: Buffer.from("restored").toString("base64"),
        });
      return json({ cleared: true });
    });
    sequence.manager.acquireForOperation
      .mockRejectedValueOnce(new Error("sandbox no longer exists"))
      .mockResolvedValue(host);
    const service = createChatGPTDurableService({ manager: sequence.manager });
    await expect(service.status(identity)).resolves.toMatchObject({
      authStatus: "connected",
    });
    expect(sequence.manager.destroyHost).toHaveBeenCalledWith(
      host.sandboxName,
      undefined,
    );
    expect(sequence.manager.ensure).toHaveBeenCalledTimes(2);
  });

  it("fences a legacy login cache to its host attempt before saving", async () => {
    setup();
    const sequence = managerFor(async (_name) =>
      json({ cache: Buffer.from("new-login-cache").toString("base64") }),
    );
    const service = createChatGPTDurableService({ manager: sequence.manager });
    await service.migrateLegacyLogin(identity, host);
    expect(vault.admitLegacy).toHaveBeenCalledWith(identity, host.attemptId, {
      signal: undefined,
    });
    expect(vault.remember).toHaveBeenCalledWith(
      identity,
      expect.any(Uint8Array),
      { expectedIntentEpoch: 1, expectedHostAttemptId: host.attemptId },
    );
  });

  it("completes the intent admitted by Start instead of migration admission", async () => {
    setup();
    const sequence = managerFor(async (_name) =>
      json({ cache: Buffer.from("completed-login-cache").toString("base64") }),
    );
    const service = createChatGPTDurableService({ manager: sequence.manager });
    await expect(service.completeAdmittedLogin(identity, host)).resolves.toBe(
      true,
    );
    expect(vault.completeIntent).toHaveBeenCalledWith(
      identity,
      host.attemptId,
      {
        signal: undefined,
      },
    );
    expect(vault.admitLegacy).not.toHaveBeenCalled();
    expect(vault.remember).toHaveBeenCalledWith(
      identity,
      expect.any(Uint8Array),
      { expectedIntentEpoch: 1, expectedHostAttemptId: host.attemptId },
    );
  });

  it("reports revoked intent as unavailable to legacy fallback", async () => {
    setup();
    vault.lease.mockResolvedValue({ kind: "missing" });
    vault.legacyAllowed.mockResolvedValue(false);
    const sequence = managerFor(async () => json({}));
    const service = createChatGPTDurableService({ manager: sequence.manager });
    await expect(service.legacyAccessAllowed(identity)).resolves.toBe(false);
    expect(vault.legacyAllowed).toHaveBeenCalledWith(identity, {
      signal: undefined,
    });
  });

  it("fences a delayed host admission after disconnect before starting a runtime", async () => {
    setup();
    const sequence = managerFor(async (_name, input) => {
      const operationInput = input as {
        operationId?: string;
        epoch?: number;
        deadlineAt?: number;
      };
      return json({
        operationId: operationInput.operationId,
        epoch: 4,
        deadlineAt: operationInput.deadlineAt,
      });
    });
    const ensured = deferred<typeof host>();
    sequence.manager.ensure.mockReturnValueOnce(ensured.promise);
    let revoked = false;
    vault.revokeCapture.mockImplementation(async () => {
      revoked = true;
      return { revoked: true, hosts: [] };
    });
    vault.admitLease.mockImplementation(
      async (_identity, _lease, operation: () => Promise<unknown>) =>
        revoked
          ? { kind: "stale" }
          : { kind: "admitted", value: await operation() },
    );
    const service = createChatGPTDurableService({ manager: sequence.manager });
    const status = service.status(identity);
    await Promise.resolve();
    await expect(service.disconnect(identity)).resolves.toEqual({
      revoked: true,
      hosts: [],
    });
    ensured.resolve(host);
    await expect(status).rejects.toThrow(
      "ChatGPT connection authority is no longer available.",
    );
    expect(sequence.manager.privateOperation).not.toHaveBeenCalledWith(
      expect.anything(),
      "initialize",
      expect.anything(),
      expect.anything(),
    );
    expect(sequence.manager.destroyHost).toHaveBeenCalledWith(
      host.sandboxName,
      undefined,
    );
    expect(vault.release).toHaveBeenCalledWith(identity, lease);
  });

  it("starts one finalization when a generation reader is canceled and upstream cancel stalls", async () => {
    setup();
    const source = new ReadableStream<Uint8Array>({
      cancel: () => new Promise<void>(() => undefined),
    });
    let initializedDeadline = 0;
    const sequence = managerFor(async (_name, input) => {
      const operationInput = input as {
        operationId?: string;
        epoch?: number;
        deadlineAt?: number;
      };
      if (_name === "initialize") {
        initializedDeadline = operationInput.deadlineAt!;
        return json({
          operationId: operationInput.operationId,
          epoch: 4,
          deadlineAt: operationInput.deadlineAt,
        });
      }
      if (_name === "generate")
        return new Response(source, {
          headers: { "content-type": "application/x-ndjson" },
        });
      if (_name === "seal")
        return json({
          operationId: operationInput.operationId,
          epoch: 4,
          deadlineAt: initializedDeadline,
          expired: false,
          cache: Buffer.from("rotated").toString("base64"),
        });
      return json({ cleared: true });
    });
    const service = createChatGPTDurableService({ manager: sequence.manager });
    const stream = await service.generate(identity, { prompt: "bounded" });
    if (!stream) throw Error("expected managed stream");
    await stream.cancel("client abort");
    expect(sequence.calls).toEqual(["initialize", "generate", "seal", "clear"]);
    expect(vault.save).toHaveBeenCalledTimes(1);
    expect(vault.release).toHaveBeenCalledTimes(1);
  });

  it("preserves a hosted transport failure when the generation reader throws", async () => {
    setup();
    const sourceError = Error("private stream detail");
    const source = new ReadableStream<Uint8Array>({
      pull() {
        throw sourceError;
      },
    });
    let initializedDeadline = 0;
    const sequence = managerFor(async (_name, input) => {
      const operationInput = input as {
        operationId?: string;
        epoch?: number;
        deadlineAt?: number;
      };
      if (_name === "initialize") {
        initializedDeadline = operationInput.deadlineAt!;
        return json({
          operationId: operationInput.operationId,
          epoch: 4,
          deadlineAt: operationInput.deadlineAt,
        });
      }
      if (_name === "generate")
        return new Response(source, {
          headers: { "content-type": "application/x-ndjson" },
        });
      if (_name === "seal")
        return json({
          operationId: operationInput.operationId,
          epoch: 4,
          deadlineAt: initializedDeadline,
          expired: false,
          cache: Buffer.from("rotated").toString("base64"),
        });
      return json({ cleared: true });
    });
    const events: unknown[] = [];
    const info = vi
      .spyOn(console, "info")
      .mockImplementation((line?: unknown) => {
        if (typeof line === "string") events.push(JSON.parse(line));
      });
    try {
      const service = createChatGPTDurableService({
        manager: sequence.manager,
      });
      const stream = await service.generate(
        identity,
        { prompt: "bounded" },
        undefined,
        undefined,
        { requestId: generationRequestId },
      );
      if (!stream) throw Error("expected managed stream");
      await expect(stream.getReader().read()).rejects.toBe(sourceError);
      expect(sequence.calls).toEqual([
        "initialize",
        "generate",
        "seal",
        "clear",
      ]);
      expect(vault.save).toHaveBeenCalledTimes(1);
      expect(vault.release).toHaveBeenCalledTimes(1);
      const terminals = events.filter(
        (event) => (event as Record<string, unknown>).event === "terminal",
      );
      expect(terminals).toHaveLength(1);
      expect(terminals[0]).toMatchObject({
        layer: "hosted",
        requestId: generationRequestId,
        terminalReason: "transport-error",
        failureCode: "transport",
        credentialFinalization: "saved",
      });
    } finally {
      info.mockRestore();
    }
  });

  it("emits a hosted terminal when credential acquisition fails", async () => {
    setup();
    const sequence = managerFor(async () => json({}));
    sequence.manager.ensure.mockRejectedValueOnce(
      Error("private host startup detail"),
    );
    const events: unknown[] = [];
    const info = vi
      .spyOn(console, "info")
      .mockImplementation((line?: unknown) => {
        if (typeof line === "string") events.push(JSON.parse(line));
      });
    const service = createChatGPTDurableService({
      manager: sequence.manager,
    });
    await expect(
      service.generate(identity, { prompt: "bounded" }, undefined, undefined, {
        requestId: generationRequestId,
      }),
    ).rejects.toThrow("private host startup detail");
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "terminal",
        layer: "hosted",
        requestId: generationRequestId,
        terminalReason: "transport-error",
        failureCode: "host-unavailable",
      }),
    );
    expect(JSON.stringify(events)).not.toContain("private host startup detail");
    info.mockRestore();
  });
});
