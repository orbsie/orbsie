import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  origin: vi.fn(),
  session: vi.fn(),
  createManager: vi.fn(),
  lease: vi.fn(),
  save: vi.fn(),
  release: vi.fn(),
  begin: vi.fn(),
  bind: vi.fn(),
  completeIntent: vi.fn(),
  admitLegacy: vi.fn(),
  legacyAllowed: vi.fn(),
  cancel: vi.fn(),
  revoke: vi.fn(),
  remember: vi.fn(),
  withAdmission: vi.fn(),
  createRuntime: vi.fn(),
  authoringAdmission: vi.fn(),
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
vi.mock("@/lib/server/chatgpt-credential-vault", () => ({
  leaseChatGPTCredentialCache: state.lease,
  saveChatGPTCredentialCache: state.save,
  releaseChatGPTCredentialLease: state.release,
  rememberChatGPTCredentialCache: state.remember,
  beginChatGPTCredentialIntent: state.begin,
  bindChatGPTCredentialIntentHost: state.bind,
  completeChatGPTCredentialIntent: state.completeIntent,
  admitLegacyChatGPTCredentialIntent: state.admitLegacy,
  canUseLegacyChatGPTHost: state.legacyAllowed,
  withChatGPTCredentialLeaseAdmission: state.withAdmission,
  cancelChatGPTCredentialIntent: state.cancel,
  revokeChatGPTCredentialAuthority: state.revoke,
  revokeChatGPTCredentialAuthorityAndCaptureHosts: state.revoke,
  ChatGPTCredentialVaultError: class extends Error {},
}));
vi.mock("../src/lib/server/chatgpt-credential-vault", () => ({
  leaseChatGPTCredentialCache: state.lease,
  saveChatGPTCredentialCache: state.save,
  releaseChatGPTCredentialLease: state.release,
  rememberChatGPTCredentialCache: state.remember,
  beginChatGPTCredentialIntent: state.begin,
  bindChatGPTCredentialIntentHost: state.bind,
  completeChatGPTCredentialIntent: state.completeIntent,
  admitLegacyChatGPTCredentialIntent: state.admitLegacy,
  canUseLegacyChatGPTHost: state.legacyAllowed,
  withChatGPTCredentialLeaseAdmission: state.withAdmission,
  cancelChatGPTCredentialIntent: state.cancel,
  revokeChatGPTCredentialAuthority: state.revoke,
  revokeChatGPTCredentialAuthorityAndCaptureHosts: state.revoke,
  ChatGPTCredentialVaultError: class extends Error {},
}));
vi.mock("../src/lib/server/chatgpt-runtime", () => ({
  createIsolatedChatGPTRpc: state.createRuntime,
}));
vi.mock("../src/lib/server/authoring-run-admission", () => ({
  admitInitialAuthoringRun: state.authoringAdmission,
}));

import { startChatGPTHostServer } from "../scripts/chatgpt-host-server";
import { GET, POST } from "../src/app/api/chatgpt/[action]/route";
import { POST as GENERATE } from "../src/app/api/chatgpt/generate/route";
import { blankProject } from "../src/lib/protocol";
import {
  createChatGPTDurableService,
  filterPrivateCompletion,
} from "../src/lib/server/chatgpt-durable-service";

const token = "h".repeat(64);
const identity = { ownerId: "owner", sessionId: "session" };
const host = {
  attemptId: "attempt-1",
  sandboxName: "orbsie-chatgpt-attempt-1",
  capability: token,
  artifactDigest: "a".repeat(64),
  expiresAt: new Date(Date.now() + 600_000),
};
const lease = {
  connectionId: "11111111-1111-4111-8111-111111111111",
  connectionVersion: 1,
  expiresAt: new Date(Date.now() + 1_800_000),
  leaseId: "lease-1",
  leaseEpoch: 1,
  leaseUntil: new Date(Date.now() + 600_000),
  cache: new TextEncoder().encode("initial-cache"),
};

class FixtureRuntime {
  readonly initialCache?: Uint8Array;
  readonly listeners = new Set<(value: unknown) => void>();
  readonly closeMock = vi.fn(async () => undefined);
  closed = false;
  accountConnected = false;
  outcome?: "complete" | "error" | "cancel";
  streamOutput?: string;
  turns = 0;

  constructor(initialCache?: Uint8Array) {
    this.initialCache = initialCache && Uint8Array.from(initialCache);
    this.accountConnected = Boolean(initialCache);
  }

  async request(method: string): Promise<unknown> {
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
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "turn/start") {
      this.turns++;
      queueMicrotask(() => {
        const commands = [
          {
            type: "reserve_entity",
            entity: {
              id: "orb-1",
              label: "Orb",
              position: [0, 0, 0],
              scale: [1, 1, 1],
              color: "#abcdef",
              stage: "seed",
            },
          },
          ...(this.outcome === "complete"
            ? [{ type: "commit_revision", message: "Ready" }]
            : []),
        ];
        const delta =
          this.streamOutput ??
          commands.map((value) => JSON.stringify(value)).join("\n");
        this.notify({
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            delta: delta.endsWith("\n") ? delta : `${delta}\n`,
          },
        });
        if (this.outcome !== "cancel")
          this.notify({
            method: "turn/completed",
            params: {
              threadId: "thread-1",
              turn: {
                id: "turn-1",
                status: this.outcome === "error" ? "failed" : "completed",
              },
            },
          });
      });
      return { turn: { id: "turn-1" } };
    }
    if (method === "turn/interrupt") {
      this.notify({
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1", status: "interrupted" },
        },
      });
      return {};
    }
    if (method === "account/login/start")
      return {
        type: "chatgptDeviceCode",
        loginId: "login-1",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.openai.com/codex/device",
      };
    if (method === "account/read")
      return {
        account: {
          type: this.accountConnected ? "chatgpt" : "api",
          label: "fixture",
        },
      };
    if (method === "account/login/cancel" || method === "account/logout")
      return {};
    throw Error(`Unexpected fixture RPC: ${method}`);
  }

  subscribe(listener: (value: unknown) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(value: unknown) {
    if (
      typeof value === "object" &&
      value &&
      (value as { method?: unknown }).method === "account/login/completed" &&
      (value as { params?: { success?: unknown } }).params?.success === true
    )
      this.accountConnected = true;
    for (const listener of this.listeners) listener(value);
  }

  async close() {
    this.closed = true;
    await this.closeMock();
  }

  async getCredentialSnapshot() {
    return {
      cache: new TextEncoder().encode(
        this.initialCache ? "managed-rotated-cache" : "login-rotated-cache",
      ),
    };
  }
}

function request(action: string, init: RequestInit = {}) {
  return new Request(`https://orbsie.test/api/chatgpt/${action}`, {
    ...init,
    headers: { origin: "https://orbsie.test", ...init.headers },
  });
}

function context(action: string) {
  return { params: Promise.resolve({ action }) };
}

async function callHost(port: number, path: string, init: RequestInit = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

function setupAuthoringManager(
  server: Awaited<ReturnType<typeof startChatGPTHostServer>>,
  streamOutput: string,
  mutateGeneration?: (body: string) => string,
  mutateOperation?: (
    operation: string,
    response: Response,
  ) => Response | Promise<Response>,
) {
  const runtimes: FixtureRuntime[] = [];
  state.createRuntime.mockImplementation(
    async (options: { initialCredentialCache?: Uint8Array }) => {
      const runtime = new FixtureRuntime(options.initialCredentialCache);
      runtime.outcome = "complete";
      runtime.streamOutput = streamOutput;
      runtimes.push(runtime);
      return runtime;
    },
  );
  state.lease.mockResolvedValue({
    kind: "leased",
    lease: { ...lease, cache: Uint8Array.from(lease.cache) },
  });
  state.save.mockResolvedValue({ kind: "saved" });
  state.release.mockResolvedValue({ kind: "released" });
  state.withAdmission.mockImplementation(
    async (_identity, _lease, operation: () => Promise<unknown>) => ({
      kind: "admitted",
      value: await operation(),
    }),
  );
  const manager = {
    ensure: vi.fn(async () => host),
    acquireForOperation: vi.fn(async () => host),
    privateOperation: vi.fn(
      async (
        _host,
        operation: string,
        input: unknown,
        options?: {
          signal?: AbortSignal;
          sceneCompletionVersion?: number;
        },
      ) => {
        const response = await callHost(
          server.port,
          `/private/operation/${operation}`,
          {
            method: "POST",
            signal: options?.signal,
            headers: {
              "content-type": "application/json",
              ...(options?.sceneCompletionVersion
                ? { "x-orbsie-scene-completion": "1" }
                : {}),
            },
            body: JSON.stringify(input),
          },
        );
        let output = response;
        if (operation === "generate" && mutateGeneration)
          output = new Response(mutateGeneration(await response.text()), {
            status: response.status,
            headers: response.headers,
          });
        return mutateOperation ? mutateOperation(operation, output) : output;
      },
    ),
    destroyHost: vi.fn(async () => undefined),
    releaseHost: vi.fn(async () => true),
    request: vi.fn(),
    disconnect: vi.fn(async () => true),
  };
  return { manager, runtimes };
}

function completionLineIndex(lines: string[]) {
  const index = lines.findIndex((line) =>
    line.includes('"type":"orbsie.private.scene-completion"'),
  );
  if (index < 0) throw Error("Fixture did not produce a completion record.");
  return index;
}

function mutateCompletionRecord(
  body: string,
  mutate: (record: Record<string, unknown>) => Record<string, unknown>,
) {
  const lines = body.trimEnd().split("\n");
  const index = completionLineIndex(lines);
  lines[index] = JSON.stringify(
    mutate(JSON.parse(lines[index]) as Record<string, unknown>),
  );
  return `${lines.join("\n")}\n`;
}

function removeCompletionRecord(body: string) {
  const lines = body.trimEnd().split("\n");
  lines.splice(completionLineIndex(lines), 1);
  return `${lines.join("\n")}\n`;
}

const authoringStreamMutations = [
  ["missing completion", removeCompletionRecord],
  [
    "duplicate completion",
    (body: string) => {
      const lines = body.trimEnd().split("\n");
      lines.push(lines[completionLineIndex(lines)]!);
      return `${lines.join("\n")}\n`;
    },
  ],
  [
    "wrong operation",
    (body: string) =>
      mutateCompletionRecord(body, (record) => ({
        ...record,
        operationId: "other-operation",
      })),
  ],
  [
    "wrong epoch",
    (body: string) =>
      mutateCompletionRecord(body, (record) => ({ ...record, epoch: 999 })),
  ],
  [
    "wrong project",
    (body: string) =>
      mutateCompletionRecord(body, (record) => ({
        ...record,
        projectId: "other-project",
      })),
  ],
  [
    "malformed completion",
    (body: string) => {
      const lines = body.trimEnd().split("\n");
      lines[completionLineIndex(lines)] =
        '{"type":"orbsie.private.scene-completion"';
      return `${lines.join("\n")}\n`;
    },
  ],
  [
    "bad digest",
    (body: string) =>
      mutateCompletionRecord(body, (record) => ({ ...record, digest: "bad" })),
  ],
  [
    "bad version",
    (body: string) =>
      mutateCompletionRecord(body, (record) => ({ ...record, version: 2 })),
  ],
  [
    "command after completion",
    (body: string) =>
      `${body.trimEnd()}\n${JSON.stringify({ type: "reserve_entity" })}\n`,
  ],
  [
    "error before completion",
    (body: string) => {
      const lines = body.trimEnd().split("\n");
      lines.splice(
        completionLineIndex(lines),
        0,
        JSON.stringify({ error: "provider failed" }),
      );
      return `${lines.join("\n")}\n`;
    },
  ],
] as const;

describe("durable route with the private host controller", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("completes an admitted login, persists its cache, and restores a new runtime", async () => {
    vi.stubEnv("ORBSIE_CHATGPT_HOSTED", "1");
    const runtimes: FixtureRuntime[] = [];
    state.createRuntime.mockImplementation(
      async (options: { initialCredentialCache?: Uint8Array }) => {
        const runtime = new FixtureRuntime(options.initialCredentialCache);
        runtimes.push(runtime);
        return runtime;
      },
    );
    let remembered = false;
    let storedCache = Uint8Array.from(lease.cache);
    state.lease.mockImplementation(async () =>
      remembered
        ? {
            kind: "leased",
            lease: { ...lease, cache: Uint8Array.from(storedCache) },
          }
        : { kind: "missing" },
    );
    state.save.mockImplementation(
      async (_identity, _lease, cache: Uint8Array) => {
        storedCache = Uint8Array.from(cache);
        return { kind: "saved" };
      },
    );
    state.release.mockResolvedValue({ kind: "released" });
    state.begin.mockResolvedValue({ epoch: 1, pendingAttemptId: "pending:1" });
    state.bind.mockResolvedValue({
      epoch: 1,
      pendingAttemptId: host.attemptId,
    });
    state.completeIntent.mockResolvedValue({
      epoch: 1,
      pendingAttemptId: host.attemptId,
    });
    state.admitLegacy.mockRejectedValue(new Error("legacy migration unused"));
    state.legacyAllowed.mockResolvedValue(true);
    state.remember.mockImplementation(async (_identity, cache: Uint8Array) => {
      remembered = true;
      storedCache = Uint8Array.from(cache);
      return {
        connectionId: lease.connectionId,
        connectionVersion: 1,
        expiresAt: lease.expiresAt,
      };
    });
    state.withAdmission.mockImplementation(
      async (_identity, _lease, operation: () => Promise<unknown>) => ({
        kind: "admitted",
        value: await operation(),
      }),
    );

    let started = false;
    const server = await startChatGPTHostServer({
      token,
      hostname: "127.0.0.1",
    });
    const manager = {
      ensure: vi.fn(async () => host),
      acquireForOperation: vi.fn(async () => host),
      read: vi.fn(async () => host),
      request: vi.fn(async (_host, operation: string) => {
        if (operation === "start") {
          started = true;
          return callHost(server.port, "/login/start", { method: "POST" });
        }
        if (operation === "status")
          return callHost(server.port, "/login/status", { method: "GET" });
        throw Error(`Unexpected route RPC: ${operation}`);
      }),
      privateOperation: vi.fn(
        async (
          _host,
          operation: string,
          input: unknown,
          options?: { signal?: AbortSignal },
        ) =>
          callHost(
            server.port,
            operation === "loginSeal"
              ? "/private/login/seal"
              : `/private/operation/${operation}`,
            {
              method: "POST",
              signal: options?.signal,
              headers: { "content-type": "application/json" },
              body: JSON.stringify(input),
            },
          ),
      ),
      disconnect: vi.fn(async () => true),
      captureOwnerHosts: vi.fn(async () => []),
      disconnectCapturedHosts: vi.fn(async () => true),
    };
    state.createManager.mockReturnValue(manager);
    state.auth.mockReturnValue({ api: { getSession: state.session } });
    state.session.mockResolvedValue({
      user: { id: identity.ownerId },
      session: { id: identity.sessionId },
    });
    state.origin.mockImplementation(() => undefined);

    try {
      const startedResponse = await POST(
        request("start", { method: "POST" }),
        context("start"),
      );
      expect(startedResponse.status).toBe(200);
      expect(started).toBe(true);
      expect(runtimes).toHaveLength(1);
      runtimes[0]!.notify({
        method: "account/login/completed",
        params: { loginId: "login-1", success: true },
      });

      const completed = await GET(request("status"), context("status"));
      expect(completed.status).toBe(200);
      expect(await completed.json()).toEqual({
        lifecycle: "completed",
        authStatus: "connected",
      });
      expect(state.completeIntent).toHaveBeenCalledWith(
        identity,
        host.attemptId,
        { signal: expect.any(AbortSignal) },
      );
      expect(state.remember).toHaveBeenCalledOnce();
      expect(Buffer.from(storedCache).toString()).toBe("login-rotated-cache");

      const restored = await GET(request("status"), context("status"));
      expect(restored.status).toBe(200);
      expect(await restored.json()).toEqual({
        lifecycle: "idle",
        authStatus: "connected",
      });
      expect(runtimes).toHaveLength(2);
      expect(Buffer.from(runtimes[1]!.initialCache!).toString()).toBe(
        "login-rotated-cache",
      );
      expect(state.save).toHaveBeenCalled();
      expect(state.release).toHaveBeenCalled();
    } finally {
      await server.close();
      vi.unstubAllEnvs();
    }
  });
});

it.each(["complete", "error", "cancel"] as const)(
  "persists rotated credentials after public generation %s and restores another runtime",
  async (outcome) => {
    vi.stubEnv("ORBSIE_CHATGPT_HOSTED", "1");
    vi.stubEnv("ORBSIE_CHATGPT_GENERATION", "1");
    const runtimes: FixtureRuntime[] = [];
    let storedCache = Uint8Array.from(lease.cache);
    state.createRuntime.mockImplementation(
      async (options: { initialCredentialCache?: Uint8Array }) => {
        const runtime = new FixtureRuntime(options.initialCredentialCache);
        runtime.outcome = outcome;
        runtimes.push(runtime);
        return runtime;
      },
    );
    state.lease.mockImplementation(async () => ({
      kind: "leased",
      lease: { ...lease, cache: Uint8Array.from(storedCache) },
    }));
    state.save.mockImplementation(
      async (_identity, _lease, cache: Uint8Array) => {
        expect(runtimes.at(-1)?.closed).toBe(true);
        storedCache = Uint8Array.from(cache);
        return { kind: "saved" };
      },
    );
    state.release.mockResolvedValue({ kind: "released" });
    state.withAdmission.mockImplementation(
      async (_identity, _lease, operation: () => Promise<unknown>) => ({
        kind: "admitted",
        value: await operation(),
      }),
    );
    state.auth.mockReturnValue({ api: { getSession: state.session } });
    state.session.mockResolvedValue({
      user: { id: identity.ownerId },
      session: { id: identity.sessionId },
    });
    state.origin.mockImplementation(() => undefined);
    const server = await startChatGPTHostServer({
      token,
      hostname: "127.0.0.1",
      allowGeneration: true,
    });
    const manager = {
      ensure: vi.fn(async () => host),
      acquireForOperation: vi.fn(async () => host),
      privateOperation: vi.fn(
        async (
          _host,
          operation: string,
          input: unknown,
          options?: { signal?: AbortSignal },
        ) =>
          callHost(server.port, `/private/operation/${operation}`, {
            method: "POST",
            signal: options?.signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
          }),
      ),
      destroyHost: vi.fn(async () => {
        await server.close();
      }),
      releaseHost: vi.fn(async () => true),
      disconnect: vi.fn(async () => true),
    };
    state.createManager.mockReturnValue(manager);
    try {
      const response = await GENERATE(
        request("generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "gpt-5.6-luna",
            effort: "low",
            prompt: "Create an orb",
            project: blankProject(),
            browserModeling: true,
          }),
        }),
      );
      expect(response.status).toBe(200);
      if (outcome === "cancel") {
        const reader = response.body!.getReader();
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toContain(
          "reserve_entity",
        );
        await reader.cancel("user stopped");
      } else {
        const body = await response.text();
        expect(body).toContain("reserve_entity");
        if (outcome === "complete") expect(body).toContain("commit_revision");
        else {
          expect(body).toContain('"error"');
          expect(body).not.toContain("commit_revision");
        }
        expect(body).not.toContain("managed-rotated-cache");
      }
      expect(state.save).toHaveBeenCalledTimes(1);
      expect(state.release).toHaveBeenCalledTimes(1);
      expect(Buffer.from(storedCache).toString()).toBe("managed-rotated-cache");
      const generated = runtimes.find((runtime) => runtime.turns === 1)!;
      expect(generated.closed).toBe(true);
      const restored = await GET(request("status"), context("status"));
      expect(restored.status).toBe(200);
      expect(await restored.json()).toMatchObject({ authStatus: "connected" });
      expect(runtimes.at(-1)).not.toBe(generated);
      expect(Buffer.from(runtimes.at(-1)!.initialCache!).toString()).toBe(
        "managed-rotated-cache",
      );
      expect(
        runtimes.reduce((total, runtime) => total + runtime.turns, 0),
      ).toBe(1);
      expect(manager.destroyHost).not.toHaveBeenCalled();
    } finally {
      await server.close();
      vi.clearAllMocks();
      vi.unstubAllEnvs();
    }
  },
  15_000,
);

it("negotiates hosted scene authority over private HTTP and strips its record", async () => {
  vi.stubEnv("ORBSIE_CHATGPT_HOSTED", "1");
  vi.stubEnv("ORBSIE_CHATGPT_GENERATION", "1");
  state.auth.mockReturnValue({ api: { getSession: state.session } });
  state.session.mockResolvedValue({
    user: { id: identity.ownerId },
    session: { id: identity.sessionId },
  });
  state.origin.mockImplementation(() => undefined);
  state.createRuntime.mockReset();
  const runtimes: FixtureRuntime[] = [];
  state.createRuntime.mockImplementation(
    async (options: { initialCredentialCache?: Uint8Array }) => {
      const runtime = new FixtureRuntime(options.initialCredentialCache);
      runtime.outcome = "complete";
      runtimes.push(runtime);
      return runtime;
    },
  );
  let storedCache = Uint8Array.from(lease.cache);
  state.lease.mockResolvedValue({
    kind: "leased",
    lease: { ...lease, cache: Uint8Array.from(storedCache) },
  });
  state.save.mockImplementation(
    async (_identity, _lease, cache: Uint8Array) => {
      storedCache = Uint8Array.from(cache);
      return { kind: "saved" };
    },
  );
  state.release.mockResolvedValue({ kind: "released" });
  state.withAdmission.mockImplementation(
    async (_identity, _lease, operation: () => Promise<unknown>) => ({
      kind: "admitted",
      value: await operation(),
    }),
  );
  const complete = vi.fn(async () => undefined);
  const fail = vi.fn(async () => undefined);
  state.authoringAdmission.mockResolvedValue({
    runId: "33333333-3333-4333-8333-333333333333",
    trialRemaining: null,
    complete,
    fail,
    lifecycle: {},
  });
  const server = await startChatGPTHostServer({
    token,
    hostname: "127.0.0.1",
    allowGeneration: true,
  });
  const manager = {
    ensure: vi.fn(async () => host),
    acquireForOperation: vi.fn(async () => host),
    privateOperation: vi.fn(
      async (
        _host,
        operation: string,
        input: unknown,
        options?: {
          signal?: AbortSignal;
          sceneCompletionVersion?: number;
        },
      ) =>
        callHost(server.port, `/private/operation/${operation}`, {
          method: "POST",
          signal: options?.signal,
          headers: {
            "content-type": "application/json",
            ...(options?.sceneCompletionVersion
              ? { "x-orbsie-scene-completion": "1" }
              : {}),
          },
          body: JSON.stringify(input),
        }),
    ),
    destroyHost: vi.fn(async () => undefined),
    releaseHost: vi.fn(async () => true),
    disconnect: vi.fn(async () => true),
  };
  state.createManager.mockReturnValue(manager);
  try {
    const response = await GENERATE(
      request("generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          effort: "low",
          prompt: "Create an orb",
          project: blankProject(),
          browserModeling: true,
          authoringReview: true,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"type":"reserve_entity"');
    expect(body).toContain('"type":"commit_revision"');
    expect(body).not.toContain("orbsie.private.scene-completion");
    expect(state.authoringAdmission).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        projectId: expect.any(String),
        revision: expect.any(Number),
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expect.any(AbortSignal),
    );
    expect(fail).not.toHaveBeenCalled();
    expect(manager.privateOperation.mock.calls.map((call) => call[1])).toEqual([
      "initialize",
      "status",
      "generate",
      "seal",
      "clear",
    ]);
    const generateCall = manager.privateOperation.mock.calls.find(
      (call) => call[1] === "generate",
    )!;
    expect(generateCall[2]).not.toHaveProperty("authoringReview");
    expect(generateCall[3]).toMatchObject({ sceneCompletionVersion: 1 });
    expect(Buffer.from(storedCache).toString()).toBe("managed-rotated-cache");
    expect(runtimes.at(-1)?.closed).toBe(true);
  } finally {
    await server.close();
    vi.unstubAllEnvs();
  }
});

it("stops before model generation when an old host omits negotiation", async () => {
  vi.stubEnv("ORBSIE_CHATGPT_GENERATION", "1");
  state.createRuntime.mockReset();
  const runtimes: FixtureRuntime[] = [];
  state.createRuntime.mockImplementation(
    async (options: { initialCredentialCache?: Uint8Array }) => {
      const runtime = new FixtureRuntime(options.initialCredentialCache);
      runtime.outcome = "complete";
      runtimes.push(runtime);
      return runtime;
    },
  );
  state.lease.mockResolvedValue({
    kind: "leased",
    lease: { ...lease, cache: Uint8Array.from(lease.cache) },
  });
  state.release.mockResolvedValue({ kind: "released" });
  state.withAdmission.mockImplementation(
    async (_identity, _lease, operation: () => Promise<unknown>) => ({
      kind: "admitted",
      value: await operation(),
    }),
  );
  const server = await startChatGPTHostServer({
    token,
    hostname: "127.0.0.1",
    allowGeneration: true,
  });
  const manager = {
    privateOperation: vi.fn(
      async (
        _host,
        operation: string,
        input: unknown,
        options?: {
          signal?: AbortSignal;
          sceneCompletionVersion?: number;
        },
      ) => {
        const response = await callHost(
          server.port,
          `/private/operation/${operation}`,
          {
            method: "POST",
            signal: options?.signal,
            headers: {
              "content-type": "application/json",
              ...(options?.sceneCompletionVersion
                ? { "x-orbsie-scene-completion": "1" }
                : {}),
            },
            body: JSON.stringify(input),
          },
        );
        if (operation === "status" && options?.sceneCompletionVersion) {
          const body = await response.text();
          const headers = new Headers(response.headers);
          headers.delete("x-orbsie-scene-completion");
          return new Response(body, {
            status: response.status,
            headers,
          });
        }
        return response;
      },
    ),
    ensure: vi.fn(async () => host),
    acquireForOperation: vi.fn(async () => host),
    destroyHost: vi.fn(async () => undefined),
    releaseHost: vi.fn(async () => true),
    request: vi.fn(),
    disconnect: vi.fn(async () => true),
  };
  try {
    const durable = createChatGPTDurableService({ manager });
    await expect(
      durable.generate(
        identity,
        {
          model: "gpt-5.6-luna",
          effort: "low",
          prompt: "Create an orb",
          project: blankProject(),
          browserModeling: true,
          localModeling: false,
        },
        undefined,
        undefined,
        { requestId: "request-old-host" },
        {
          complete: vi.fn(async () => undefined),
          fail: vi.fn(async () => undefined),
        },
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(
      manager.privateOperation.mock.calls.map((call: unknown[]) => call[1]),
    ).toEqual(["initialize", "status"]);
    expect(runtimes.at(-1)?.turns).toBe(0);
  } finally {
    await server.close();
    vi.unstubAllEnvs();
  }
});

it.each(authoringStreamMutations)(
  "rejects private HTTP completion mutation: %s",
  async (_label, mutate) => {
    vi.stubEnv("ORBSIE_CHATGPT_GENERATION", "1");
    const server = await startChatGPTHostServer({
      token,
      hostname: "127.0.0.1",
      allowGeneration: true,
    });
    const { manager, runtimes } = setupAuthoringManager(
      server,
      [
        JSON.stringify({
          type: "reserve_entity",
          entity: {
            id: "orb-1",
            label: "Orb",
            position: [0, 0, 0],
            scale: [1, 1, 1],
            color: "#abcdef",
            stage: "seed",
          },
        }),
        JSON.stringify({ type: "commit_revision", message: "Ready" }),
      ].join("\n"),
      mutate,
    );
    const complete = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    try {
      const durable = createChatGPTDurableService({ manager });
      const stream = await durable.generate(
        identity,
        {
          model: "gpt-5.6-luna",
          effort: "low",
          prompt: "Create an orb",
          project: blankProject(),
          browserModeling: true,
          localModeling: false,
        },
        undefined,
        undefined,
        { requestId: `request-mutation-${_label}` },
        { complete, fail },
      );
      const reader = stream!.getReader();
      let publicBody = "";
      let failure: unknown;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          publicBody += new TextDecoder().decode(next.value);
        }
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(publicBody).not.toContain("orbsie.private.scene-completion");
      expect(complete).not.toHaveBeenCalled();
      expect(fail).toHaveBeenCalledOnce();
      expect(runtimes[0]?.turns).toBe(1);
    } finally {
      await server.close();
      vi.unstubAllEnvs();
    }
  },
  15_000,
);

it("rejects an already-aborted negotiated response before reading it", async () => {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode('{"type":"commit_revision"}\n'),
      );
      controller.close();
    },
  });
  const signal = new AbortController();
  signal.abort();
  const complete = vi.fn(async () => undefined);
  const fail = vi.fn(async () => undefined);
  const filtered = filterPrivateCompletion(
    source,
    {
      operationId: "operation-aborted",
      epoch: 1,
      projectId: "project-aborted",
      minimumRevision: 0,
    },
    { complete, fail },
    signal.signal,
  );
  const reader = filtered.getReader();
  await expect(reader.read()).rejects.toMatchObject({
    code: "invalid-response",
  });
  expect(complete).not.toHaveBeenCalled();
  expect(fail).toHaveBeenCalledOnce();
});

it("reports completion-writer rejection without exposing its error", async () => {
  vi.stubEnv("ORBSIE_CHATGPT_GENERATION", "1");
  const server = await startChatGPTHostServer({
    token,
    hostname: "127.0.0.1",
    allowGeneration: true,
  });
  const { manager } = setupAuthoringManager(
    server,
    [
      JSON.stringify({
        type: "reserve_entity",
        entity: {
          id: "orb-1",
          label: "Orb",
          position: [0, 0, 0],
          scale: [1, 1, 1],
          color: "#abcdef",
          stage: "seed",
        },
      }),
      JSON.stringify({ type: "commit_revision", message: "Ready" }),
    ].join("\n"),
  );
  const complete = vi.fn(async () => {
    throw Error("private writer secret");
  });
  const fail = vi.fn(async () => undefined);
  try {
    const durable = createChatGPTDurableService({ manager });
    const stream = await durable.generate(
      identity,
      {
        model: "gpt-5.6-luna",
        effort: "low",
        prompt: "Create an orb",
        project: blankProject(),
        browserModeling: true,
        localModeling: false,
      },
      undefined,
      undefined,
      { requestId: "request-writer-rejection" },
      { complete, fail },
    );
    let publicError: unknown;
    try {
      await new Response(stream!).text();
    } catch (error) {
      publicError = error;
    }
    expect(publicError).toBeInstanceOf(Error);
    expect(publicError).toMatchObject({
      code: "invalid-response",
      message: "ChatGPT managed operation returned an invalid completion.",
    });
    expect((publicError as Error).message).not.toContain(
      "private writer secret",
    );
    expect(complete).toHaveBeenCalledOnce();
    expect(fail).toHaveBeenCalledOnce();
  } finally {
    await server.close();
    vi.unstubAllEnvs();
  }
});

it("keeps accepted authoring completion independent from seal failure", async () => {
  vi.stubEnv("ORBSIE_CHATGPT_GENERATION", "1");
  const server = await startChatGPTHostServer({
    token,
    hostname: "127.0.0.1",
    allowGeneration: true,
  });
  const { manager } = setupAuthoringManager(
    server,
    [
      JSON.stringify({
        type: "reserve_entity",
        entity: {
          id: "orb-1",
          label: "Orb",
          position: [0, 0, 0],
          scale: [1, 1, 1],
          color: "#abcdef",
          stage: "seed",
        },
      }),
      JSON.stringify({ type: "commit_revision", message: "Ready" }),
    ].join("\n"),
    undefined,
    async (operation, response) => {
      if (operation !== "seal") return response;
      return new Response(JSON.stringify({ invalid: true }), {
        status: 200,
        headers: response.headers,
      });
    },
  );
  const complete = vi.fn(async () => undefined);
  const fail = vi.fn(async () => undefined);
  try {
    const durable = createChatGPTDurableService({ manager });
    const stream = await durable.generate(
      identity,
      {
        model: "gpt-5.6-luna",
        effort: "low",
        prompt: "Create an orb",
        project: blankProject(),
        browserModeling: true,
        localModeling: false,
      },
      undefined,
      undefined,
      { requestId: "request-seal-failure" },
      { complete, fail },
    );
    await expect(new Response(stream!).text()).rejects.toThrow();
    expect(complete).toHaveBeenCalledOnce();
    expect(fail).not.toHaveBeenCalled();
  } finally {
    await server.close();
    vi.unstubAllEnvs();
  }
});

it.each([
  ["malformed NDJSON", "not-json\n"],
  ["provider error record", '{"error":"provider failed"}\n'],
] as const)(
  "fails an authoring stream on a private %s before completion",
  async (_label, streamOutput) => {
    vi.stubEnv("ORBSIE_CHATGPT_GENERATION", "1");
    const server = await startChatGPTHostServer({
      token,
      hostname: "127.0.0.1",
      allowGeneration: true,
    });
    const { manager, runtimes } = setupAuthoringManager(server, streamOutput);
    const complete = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    try {
      const durable = createChatGPTDurableService({ manager });
      const stream = await durable.generate(
        identity,
        {
          model: "gpt-5.6-luna",
          effort: "low",
          prompt: "Create an orb",
          project: blankProject(),
          browserModeling: true,
          localModeling: false,
        },
        undefined,
        undefined,
        { requestId: `request-${_label}` },
        { complete, fail },
      );
      await expect(new Response(stream!).text()).rejects.toThrow();
      expect(complete).not.toHaveBeenCalled();
      expect(fail).toHaveBeenCalledOnce();
      expect(runtimes[0]?.turns).toBe(1);
    } finally {
      await server.close();
      vi.unstubAllEnvs();
    }
  },
  15_000,
);

it("aborts a pending private completion and fences late success", async () => {
  vi.stubEnv("ORBSIE_CHATGPT_GENERATION", "1");
  const streamOutput = [
    JSON.stringify({
      type: "reserve_entity",
      entity: {
        id: "orb-1",
        label: "Orb",
        position: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#abcdef",
        stage: "seed",
      },
    }),
    JSON.stringify({ type: "commit_revision", message: "Ready" }),
  ].join("\n");
  const server = await startChatGPTHostServer({
    token,
    hostname: "127.0.0.1",
    allowGeneration: true,
  });
  const { manager } = setupAuthoringManager(server, streamOutput);
  const completionStarted = vi.fn();
  let releaseComplete!: () => void;
  const complete = vi.fn(
    async (_binding: unknown, _completionSignal: AbortSignal) => {
      completionStarted();
      await new Promise<void>((resolve) => {
        releaseComplete = resolve;
      });
    },
  );
  const fail = vi.fn(async () => undefined);
  const abort = new AbortController();
  try {
    const durable = createChatGPTDurableService({ manager });
    const stream = await durable.generate(
      identity,
      {
        model: "gpt-5.6-luna",
        effort: "low",
        prompt: "Create an orb",
        project: blankProject(),
        browserModeling: true,
        localModeling: false,
      },
      abort.signal,
      undefined,
      { requestId: "request-pending-completion" },
      { complete, fail },
    );
    const consumed = new Response(stream!).text();
    await vi.waitFor(() => expect(completionStarted).toHaveBeenCalledOnce());
    abort.abort();
    // Consumer cancellation closes the public body after preserving the
    // already-delivered commands; it must still fence the pending authority
    // write and report failure rather than success.
    await expect(consumed).resolves.toContain("commit_revision");
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]?.[1]).toMatchObject({ aborted: true });
    expect(fail).toHaveBeenCalledOnce();
    releaseComplete();
    await Promise.resolve();
    expect(fail).toHaveBeenCalledOnce();
  } finally {
    await server.close();
    vi.unstubAllEnvs();
  }
});
