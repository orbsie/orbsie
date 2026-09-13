import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  database: vi.fn(),
  open: vi.fn(() => "c".repeat(64)),
}));

vi.mock("../src/lib/server/auth", () => ({
  database: state.database,
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("../src/lib/server/chatgpt-host-capability", () => ({
  openHostCapability: state.open,
  sealHostCapability: vi.fn(),
}));

import {
  CHATGPT_HOST_MAX_LIFETIME_MS,
  renewChatGPTHost,
} from "../src/lib/server/chatgpt-host-registry";

const identity = { ownerId: "owner", sessionId: "session" };
const digest = "d".repeat(64);
const attemptId = "attempt-1";
const minHeadroomMs = 180_000;

function row(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    attempt_id: attemptId,
    sandbox_name: `orbsie-chatgpt-${attemptId}`,
    capability_ciphertext: "ciphertext",
    expires_at: new Date(now + 30_000),
    created_at: new Date(now - 35 * 60_000),
    artifact_digest: digest,
    session_expires_at: new Date(now + 60 * 60_000),
    ...overrides,
  };
}

function clientFor(
  source: Record<string, unknown> | null,
  configure?: (query: ReturnType<typeof vi.fn>) => void,
) {
  const query = vi.fn(async (text: string) => {
    if (text.includes("FROM chatgpt_hosts") && text.includes("FOR UPDATE"))
      return { rows: source ? [source] : [] };
    if (text.startsWith("UPDATE chatgpt_hosts"))
      return { rows: source ? [source] : [] };
    return { rows: [] };
  });
  configure?.(query);
  const client = { query, release: vi.fn() };
  state.database.mockReturnValue({ connect: vi.fn(async () => client) });
  return client;
}

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(32));
  state.open.mockReturnValue("c".repeat(64));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("ChatGPT host registry renewal", () => {
  it("locks the owner/session attempt and caps an extension at the absolute lifetime", async () => {
    const source = row();
    const client = clientFor(source);
    let target!: Date;
    const result = await renewChatGPTHost(identity, attemptId, digest, {
      minHeadroomMs,
      renew: vi.fn(async (_host, requested) => {
        target = requested;
        return new Date(requested.getTime() + 60_000);
      }),
    });
    expect(result.kind).toBe("ready");
    expect(target.getTime()).toBeLessThanOrEqual(
      (source.created_at as Date).getTime() + CHATGPT_HOST_MAX_LIFETIME_MS,
    );
    expect(client.query.mock.calls.map(([text]) => text)).toContain(
      "SET LOCAL lock_timeout = '2000ms'",
    );
    expect(
      client.query.mock.calls.find(([text]) =>
        text.includes("FOR UPDATE"),
      )?.[0],
    ).toContain("FOR UPDATE OF h,s");
  });

  it("serializes concurrent renewal callbacks behind the registry row lock", async () => {
    const source = row({
      created_at: new Date(Date.now() - 60_000),
    });
    let held = false;
    let wake!: () => void;
    const clients = [1, 2].map(() => {
      const query = vi.fn(async (text: string) => {
        if (
          text.includes("FROM chatgpt_hosts") &&
          text.includes("FOR UPDATE")
        ) {
          if (held) await new Promise<void>((resolve) => (wake = resolve));
          held = true;
          return { rows: [source] };
        }
        if (text.startsWith("UPDATE chatgpt_hosts")) return { rows: [source] };
        if (text === "COMMIT") {
          held = false;
          wake?.();
        }
        return { rows: [] };
      });
      return { query, release: vi.fn() };
    });
    state.database.mockReturnValue({
      connect: vi
        .fn()
        .mockResolvedValueOnce(clients[0])
        .mockResolvedValueOnce(clients[1]),
    });
    let active = 0;
    let maximum = 0;
    const renew = vi.fn(async (_host, target: Date) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      active--;
      return target;
    });
    const results = await Promise.all([
      renewChatGPTHost(identity, attemptId, digest, {
        minHeadroomMs,
        renew,
      }),
      renewChatGPTHost(identity, attemptId, digest, {
        minHeadroomMs,
        renew,
      }),
    ]);
    expect(results.every((result) => result.kind === "ready")).toBe(true);
    expect(maximum).toBe(1);
  });

  it("keeps verified headroom without extending or shortening a later registry expiry", async () => {
    const source = row({
      expires_at: new Date(Date.now() + 15 * 60_000),
      created_at: new Date(Date.now() - 60_000),
    });
    const client = clientFor(source);
    const renew = vi.fn(async () => source.expires_at as Date);
    const result = await renewChatGPTHost(identity, attemptId, digest, {
      minHeadroomMs,
      renew,
    });
    expect(result.kind).toBe("ready");
    expect(renew).toHaveBeenCalledOnce();
    const update = (client.query.mock.calls as unknown[][]).find((call) =>
      String(call[0]).startsWith("UPDATE chatgpt_hosts"),
    );
    expect(update).toBeDefined();
    expect((update?.[1] as unknown[])[3]).toEqual(source.expires_at);
  });

  it("refuses an absolute or session cap without enough generation headroom", async () => {
    const source = row({
      created_at: new Date(Date.now() - 39 * 60_000),
      session_expires_at: new Date(Date.now() + 60_000),
    });
    clientFor(source);
    const renew = vi.fn();
    await expect(
      renewChatGPTHost(identity, attemptId, digest, {
        minHeadroomMs,
        renew,
      }),
    ).resolves.toEqual({ kind: "insufficient-headroom" });
    expect(renew).not.toHaveBeenCalled();
  });

  it("does not renew expired sessions, wrong attempts, or stale artifacts", async () => {
    const renew = vi.fn();
    clientFor(row({ session_expires_at: new Date(Date.now() - 1) }));
    await expect(
      renewChatGPTHost(identity, attemptId, digest, { minHeadroomMs, renew }),
    ).resolves.toEqual({ kind: "expired" });

    clientFor(null);
    await expect(
      renewChatGPTHost(identity, "new-attempt", digest, {
        minHeadroomMs,
        renew,
      }),
    ).resolves.toEqual({ kind: "missing" });

    clientFor(row({ artifact_digest: "x".repeat(64) }));
    await expect(
      renewChatGPTHost(identity, attemptId, digest, { minHeadroomMs, renew }),
    ).resolves.toEqual({ kind: "stale" });
    expect(renew).not.toHaveBeenCalled();
  });

  it("rolls back a failed backend extension and a failed database commit", async () => {
    const source = row();
    const client = clientFor(source);
    await expect(
      renewChatGPTHost(identity, attemptId, digest, {
        minHeadroomMs,
        renew: vi.fn(async () => {
          throw Error("provider extension failed");
        }),
      }),
    ).rejects.toThrow("provider extension failed");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");

    const commitClient = clientFor(source, (query) => {
      query.mockImplementation(async (text: string) => {
        if (text.includes("FROM chatgpt_hosts") && text.includes("FOR UPDATE"))
          return { rows: [source] };
        if (text.startsWith("UPDATE chatgpt_hosts")) return { rows: [source] };
        if (text === "COMMIT") throw Error("database commit failed");
        return { rows: [] };
      });
    });
    await expect(
      renewChatGPTHost(identity, attemptId, digest, {
        minHeadroomMs,
        renew: vi.fn(async (_host, requested) => requested),
      }),
    ).rejects.toThrow("database commit failed");
    expect(commitClient.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("rechecks the clock after a delayed backend extension", async () => {
    const base = Date.now();
    let clock = base;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const source = row();
    const client = clientFor(source);
    await expect(
      renewChatGPTHost(identity, attemptId, digest, {
        minHeadroomMs,
        renew: vi.fn(async (_host, requested) => {
          clock = base + 500_000;
          return new Date(base + 600_000);
        }),
      }),
    ).resolves.toEqual({ kind: "insufficient-headroom" });
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("honors an abort after the backend returns and does not authorize the extension", async () => {
    const source = row();
    const client = clientFor(source);
    const controller = new AbortController();
    await expect(
      renewChatGPTHost(identity, attemptId, digest, {
        minHeadroomMs,
        signal: controller.signal,
        renew: vi.fn(async (_host, requested) => {
          controller.abort();
          return requested;
        }),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(
      client.query.mock.calls.some(([text]) => text.startsWith("UPDATE")),
    ).toBe(false);
  });

  it("releases exactly one late pool client when acquisition is aborted", async () => {
    const controller = new AbortController();
    let resolveClient!: (client: { release: () => void }) => void;
    state.database.mockReturnValue({
      connect: () =>
        new Promise<{ release: () => void }>(
          (resolve) => (resolveClient = resolve),
        ),
    });
    const pending = renewChatGPTHost(identity, attemptId, digest, {
      minHeadroomMs,
      signal: controller.signal,
      renew: vi.fn(),
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const release = vi.fn();
    resolveClient({ release });
    await Promise.resolve();
    await Promise.resolve();
    expect(release).toHaveBeenCalledOnce();
  });
});
