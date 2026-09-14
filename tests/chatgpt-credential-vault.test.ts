import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("../src/lib/server/auth", () => ({ database: state.database }));

import {
  CHATGPT_CREDENTIAL_LEASE_MIN_HEADROOM_MS,
  CHATGPT_CREDENTIAL_LEASE_MS,
  CHATGPT_CREDENTIAL_MAX_CACHE_BYTES,
  CHATGPT_CREDENTIAL_RETENTION_MS,
  ChatGPTCredentialVaultError,
  leaseChatGPTCredentialCache,
  openChatGPTCredentialCache,
  readChatGPTCredentialCache,
  rememberChatGPTCredentialCache,
  releaseChatGPTCredentialLease,
  revokeChatGPTCredentialConnection,
  saveChatGPTCredentialCache,
  sealChatGPTCredentialCache,
} from "../src/lib/server/chatgpt-credential-vault";

const owner = "owner-a";
const session = "session-a";
const actor = { ownerId: owner, sessionId: session };
const secret = "s".repeat(32);
const context = {
  ownerId: owner,
  connectionId: "11111111-1111-4111-8111-111111111111",
  connectionVersion: 1,
};

type FakeConnection = {
  id: string;
  owner_id: string;
  connection_version: number;
  expires_at: Date;
  revoked_at: Date | null;
};
type FakeVault = {
  ciphertext: string;
  lease_id: string | null;
  lease_epoch: number;
  lease_until: Date | null;
};

function fakeDatabase() {
  let sessionValid = true;
  let connection: FakeConnection | null = null;
  let vault: FakeVault | null = null;
  const clients: Array<{
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  }> = [];
  const makeClient = () => {
    const query = vi.fn(async (text: string, params: unknown[] = []) => {
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK")
        return { rows: [] };
      if (text.startsWith("SET LOCAL")) return { rows: [] };
      if (text.startsWith("SELECT clock_timestamp()"))
        return { rows: [{ now: new Date() }] };
      if (text.includes('FROM "session"'))
        return sessionValid
          ? { rows: [{ expires_at: new Date(Date.now() + 60 * 60 * 1000) }] }
          : { rows: [] };
      if (
        text.includes(
          "SELECT id,expires_at FROM chatgpt_credential_connections",
        )
      )
        return {
          rows: connection && !connection.revoked_at ? [connection] : [],
        };
      if (text.startsWith("INSERT INTO chatgpt_credential_connections")) {
        if (connection && !connection.revoked_at) return { rows: [] };
        connection = {
          id: String(params[0]),
          owner_id: String(params[1]),
          connection_version: Number(params[2]),
          expires_at: new Date(String(params[3])),
          revoked_at: null,
        };
        return { rows: [connection] };
      }
      if (text.startsWith("INSERT INTO chatgpt_credential_vault")) {
        vault = {
          ciphertext: String(params[2]),
          lease_id: null,
          lease_epoch: 0,
          lease_until: null,
        };
        return { rows: [] };
      }
      if (text.startsWith("SELECT c.id,c.owner_id")) {
        const saveLookup = text.includes("WHERE c.id=$1 AND c.owner_id=$2");
        const requested = saveLookup
          ? null
          : params[1] == null
            ? null
            : String(params[1]);
        const requestedOwner = String(params[saveLookup ? 1 : 0]);
        if (
          !connection ||
          !vault ||
          requestedOwner !== connection.owner_id ||
          connection.revoked_at ||
          (requested && requested !== connection.id)
        )
          return { rows: [] };
        return {
          rows: [
            {
              ...connection,
              ...vault,
              session_expires_at: new Date(Date.now() + 60 * 60 * 1000),
            },
          ],
        };
      }
      if (text.startsWith("SELECT id,owner_id,connection_version")) {
        const requested = params[1] == null ? null : String(params[1]);
        if (
          !connection ||
          String(params[0]) !== connection.owner_id ||
          connection.revoked_at ||
          (requested && requested !== connection.id)
        )
          return { rows: [] };
        return { rows: [connection] };
      }
      if (
        text.startsWith("UPDATE chatgpt_credential_vault") &&
        text.includes("SET lease_id=$1")
      ) {
        if (!vault) return { rows: [] };
        vault.lease_id = String(params[0]);
        vault.lease_epoch = Number(params[1]);
        vault.lease_until = new Date(String(params[2]));
        return { rows: [] };
      }
      if (text.startsWith("UPDATE chatgpt_credential_vault SET ciphertext")) {
        if (vault) vault.ciphertext = String(params[0]);
        return { rows: [] };
      }
      if (text.includes("SET lease_id=NULL")) {
        const matches =
          vault &&
          vault.lease_id === String(params[2]) &&
          vault.lease_epoch === Number(params[3]) &&
          connection &&
          !connection.revoked_at;
        if (matches && vault) {
          vault.lease_id = null;
          vault.lease_until = null;
          return { rows: [{ connection_id: connection!.id }] };
        }
        return { rows: [] };
      }
      if (text.startsWith("UPDATE chatgpt_credential_connections")) {
        if (connection && connection.id === String(params[0])) {
          connection.revoked_at = new Date();
          connection.connection_version++;
        }
        return { rows: [] };
      }
      if (text.startsWith("DELETE FROM chatgpt_credential_vault")) {
        vault = null;
        return { rows: [] };
      }
      throw Error(`Unhandled fake query: ${text}`);
    });
    const client = { query, release: vi.fn() };
    clients.push(client);
    return client;
  };
  state.database.mockReturnValue({ connect: vi.fn(makeClient) });
  return {
    clients,
    invalidateSession: () => {
      sessionValid = false;
    },
    expireConnection: () => {
      if (connection) connection.expires_at = new Date(Date.now() - 1);
    },
    tamper: () => {
      if (vault) vault.ciphertext = "v1.invalid";
    },
  };
}

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", secret);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("ChatGPT credential vault encryption", () => {
  it("uses a purpose-separated authenticated envelope bound to owner and version", () => {
    const cache = new TextEncoder().encode("managed-cache-v1");
    const sealed = sealChatGPTCredentialCache(cache, context, secret);
    expect(sealed).not.toContain("managed-cache-v1");
    expect(openChatGPTCredentialCache(sealed, context, secret)).toEqual(
      Buffer.from(cache),
    );
    expect(() =>
      openChatGPTCredentialCache(
        sealed,
        { ...context, ownerId: "owner-b" },
        secret,
      ),
    ).toThrowError(ChatGPTCredentialVaultError);
    expect(() =>
      openChatGPTCredentialCache(
        sealed,
        { ...context, connectionVersion: 2 },
        secret,
      ),
    ).toThrowError(ChatGPTCredentialVaultError);
    expect(() =>
      openChatGPTCredentialCache(`${sealed}x`, context, secret),
    ).toThrow("could not be verified");
  });

  it("rejects empty and oversized opaque caches", () => {
    expect(() =>
      sealChatGPTCredentialCache(new Uint8Array(), context, secret),
    ).toThrow("cache");
    expect(() =>
      sealChatGPTCredentialCache(
        new Uint8Array(CHATGPT_CREDENTIAL_MAX_CACHE_BYTES + 1),
        context,
        secret,
      ),
    ).toThrow("exceeds its size limit");
  });
});

describe("ChatGPT credential vault lifecycle", () => {
  it("remembers, leases, saves, releases, and revokes without exposing ciphertext", async () => {
    const fake = fakeDatabase();
    const initial = new TextEncoder().encode("cache-before-refresh");
    const refreshed = new TextEncoder().encode("cache-after-refresh");
    const connection = await rememberChatGPTCredentialCache(actor, initial);
    expect(connection.connectionVersion).toBe(1);
    expect(connection.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(connection.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + CHATGPT_CREDENTIAL_RETENTION_MS,
    );
    expect(await readChatGPTCredentialCache(actor)).toMatchObject({
      connectionId: connection.connectionId,
      connectionVersion: 1,
    });
    const leased = await leaseChatGPTCredentialCache(
      actor,
      connection.connectionId,
    );
    expect(leased.kind).toBe("leased");
    if (leased.kind !== "leased") throw Error("expected lease");
    expect(leased.lease.cache).toEqual(Buffer.from(initial));
    expect(leased.lease.leaseUntil.getTime()).toBeGreaterThan(Date.now());
    expect(leased.lease.leaseUntil.getTime()).toBeLessThanOrEqual(
      Date.now() + CHATGPT_CREDENTIAL_LEASE_MS,
    );
    expect(
      await saveChatGPTCredentialCache(actor, leased.lease, refreshed),
    ).toEqual({ kind: "saved" });
    expect(await releaseChatGPTCredentialLease(actor, leased.lease)).toEqual({
      kind: "released",
    });
    const refreshedLease = await leaseChatGPTCredentialCache(
      actor,
      connection.connectionId,
    );
    expect(refreshedLease.kind).toBe("leased");
    if (refreshedLease.kind === "leased")
      expect(refreshedLease.lease.cache).toEqual(Buffer.from(refreshed));
    expect(
      await revokeChatGPTCredentialConnection(actor, connection.connectionId),
    ).toBe(true);
    expect(await readChatGPTCredentialCache(actor)).toBeNull();
    expect(
      await saveChatGPTCredentialCache(actor, leased.lease, initial),
    ).toEqual({ kind: "missing" });
    expect(
      fake.clients.every(({ release }) => release.mock.calls.length === 1),
    ).toBe(true);
  });

  it("fences an active lease and rejects foreign, expired, tampered, and unauthorized access", async () => {
    const fake = fakeDatabase();
    const initial = new TextEncoder().encode("cache");
    const connection = await rememberChatGPTCredentialCache(actor, initial);
    const first = await leaseChatGPTCredentialCache(
      actor,
      connection.connectionId,
    );
    expect(first.kind).toBe("leased");
    const second = await leaseChatGPTCredentialCache(
      actor,
      connection.connectionId,
    );
    expect(second).toEqual({ kind: "busy" });
    expect(
      await readChatGPTCredentialCache({
        ownerId: "owner-b",
        sessionId: "session-b",
      }),
    ).toBeNull();
    fake.invalidateSession();
    await expect(readChatGPTCredentialCache(actor)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("does not decrypt a tampered cache or retain an expired lease", async () => {
    const fake = fakeDatabase();
    const connection = await rememberChatGPTCredentialCache(
      actor,
      new TextEncoder().encode("cache"),
    );
    fake.tamper();
    await expect(
      leaseChatGPTCredentialCache(actor, connection.connectionId),
    ).rejects.toMatchObject({
      code: "tampered-cache",
    });
    // Recreate the fake state for the expiry branch after the tamper check.
    state.database.mockReset();
    const secondFake = fakeDatabase();
    const second = await rememberChatGPTCredentialCache(
      actor,
      new TextEncoder().encode("cache"),
    );
    secondFake.expireConnection();
    expect(
      await leaseChatGPTCredentialCache(actor, second.connectionId),
    ).toEqual({ kind: "expired" });
  });

  it("keeps the lease headroom contract above generation duration plus cleanup margin", () => {
    expect(CHATGPT_CREDENTIAL_LEASE_MIN_HEADROOM_MS).toBeGreaterThanOrEqual(
      3 * 60 * 1000,
    );
    expect(CHATGPT_CREDENTIAL_LEASE_MS).toBeGreaterThan(
      CHATGPT_CREDENTIAL_LEASE_MIN_HEADROOM_MS,
    );
  });
});

describe("credential finalization cancellation", () => {
  const lease = {
    connectionId: context.connectionId,
    connectionVersion: 1,
    leaseId: "lease",
    leaseEpoch: 1,
  };

  it("rejects a stalled pool acquisition and releases the late client without writing", async () => {
    let resolveClient!: (client: unknown) => void;
    const pending = new Promise((resolve) => {
      resolveClient = resolve;
    });
    state.database.mockReturnValue({ connect: () => pending });
    const controller = new AbortController();
    const operation = saveChatGPTCredentialCache(
      actor,
      lease,
      new TextEncoder().encode("rotated"),
      { signal: controller.signal },
    );
    const rejection = expect(operation).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejection;
    const client = { query: vi.fn(), release: vi.fn() };
    resolveClient(client);
    await Promise.resolve();
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.query).not.toHaveBeenCalled();
  });

  it("destroys a stalled transaction on cancellation without a late commit", async () => {
    let rejectQuery!: (error: Error) => void;
    const client = {
      query: vi.fn((sql: string) =>
        sql.includes('FROM "session"')
          ? new Promise((_resolve, reject) => {
              rejectQuery = reject;
            })
          : Promise.resolve({ rows: [] }),
      ),
      release: vi.fn((destroy?: boolean) => {
        if (destroy) rejectQuery(new Error("connection destroyed"));
      }),
    };
    state.database.mockReturnValue({ connect: async () => client });
    const controller = new AbortController();
    const operation = saveChatGPTCredentialCache(
      actor,
      lease,
      new TextEncoder().encode("rotated"),
      { signal: controller.signal },
    );
    const rejection = expect(operation).rejects.toThrow("connection destroyed");
    await vi.waitFor(() => expect(rejectQuery).toBeTypeOf("function"));
    controller.abort();
    await rejection;
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(client.query).not.toHaveBeenCalledWith("COMMIT");
    expect(
      client.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE")),
    ).toBe(false);
  });
});
