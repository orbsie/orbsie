import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { PoolClient } from "pg";
import { database } from "./auth";

export const CHATGPT_CREDENTIAL_VAULT_PURPOSE =
  "orbsie-chatgpt-credential-vault-v1";
export const CHATGPT_CREDENTIAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const CHATGPT_CREDENTIAL_MAX_CACHE_BYTES = 64 * 1024;
/** A generation may run for three minutes; retain five minutes of cleanup margin. */
export const CHATGPT_CREDENTIAL_LEASE_MS = 10 * 60 * 1000;
export const CHATGPT_CREDENTIAL_LEASE_MIN_HEADROOM_MS = 3 * 60 * 1000;
const CHATGPT_CREDENTIAL_LOCK_TIMEOUT_MS = 2_000;
const CHATGPT_CREDENTIAL_STATEMENT_TIMEOUT_MS = 15_000;
const CIPHER_VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const MAX_SEALED_BYTES =
  CHATGPT_CREDENTIAL_MAX_CACHE_BYTES + IV_BYTES + AUTH_TAG_BYTES;

export type ChatGPTCredentialVaultActor = {
  ownerId: string;
  sessionId: string;
};

export type ChatGPTCredentialConnection = {
  connectionId: string;
  connectionVersion: number;
  expiresAt: Date;
};

export type ChatGPTCredentialLease = ChatGPTCredentialConnection & {
  leaseId: string;
  leaseEpoch: number;
  leaseUntil: Date;
  cache: Uint8Array;
};

export type ChatGPTCredentialLeaseResult =
  | { kind: "leased"; lease: ChatGPTCredentialLease }
  | { kind: "missing" | "expired" | "busy" | "insufficient-headroom" };

export type ChatGPTCredentialSaveResult =
  { kind: "saved" } | { kind: "stale" | "missing" | "expired" };

export type ChatGPTCredentialReleaseResult =
  { kind: "released" } | { kind: "stale" | "missing" };

export class ChatGPTCredentialVaultError extends Error {
  constructor(
    public readonly code:
      "invalid-input" | "unauthorized" | "active-connection" | "tampered-cache",
    message: string,
  ) {
    super(message);
    this.name = "ChatGPTCredentialVaultError";
  }
}

export type ChatGPTCredentialCacheContext = {
  ownerId: string;
  connectionId: string;
  connectionVersion: number;
};
type Context = ChatGPTCredentialCacheContext;

type ConnectionRow = {
  id: string;
  owner_id: string;
  connection_version: number;
  expires_at: Date | string;
  revoked_at: Date | string | null;
};

type VaultRow = ConnectionRow & {
  session_expires_at?: Date | string;
  ciphertext: string;
  lease_id: string | null;
  lease_epoch: number;
  lease_until: Date | string | null;
};

const invalid = (message = "ChatGPT credential vault input is invalid.") =>
  new ChatGPTCredentialVaultError("invalid-input", message);
const unauthorized = () =>
  new ChatGPTCredentialVaultError(
    "unauthorized",
    "The ChatGPT connection is not available for this session.",
  );
const activeConnection = () =>
  new ChatGPTCredentialVaultError(
    "active-connection",
    "A ChatGPT connection is already remembered for this account.",
  );
const tamperedCache = () =>
  new ChatGPTCredentialVaultError(
    "tampered-cache",
    "The remembered ChatGPT connection could not be verified.",
  );

function secret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || Buffer.byteLength(value) < KEY_BYTES)
    throw Error("ChatGPT credential vault encryption is not configured.");
  return value;
}

function validPart(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    /^[\x20-\x7e]+$/.test(value)
  );
}

function checkedContext(value: unknown): asserts value is Context {
  if (!value || typeof value !== "object") throw invalid();
  const context = value as Partial<Context>;
  if (
    !validPart(context.ownerId) ||
    !/^[0-9a-f-]{36}$/.test(context.connectionId ?? "") ||
    typeof context.connectionVersion !== "number" ||
    !Number.isSafeInteger(context.connectionVersion) ||
    context.connectionVersion < 1
  )
    throw invalid();
}

function cacheBuffer(value: Uint8Array): Buffer {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > CHATGPT_CREDENTIAL_MAX_CACHE_BYTES
  )
    throw invalid(
      value?.byteLength > CHATGPT_CREDENTIAL_MAX_CACHE_BYTES
        ? "ChatGPT managed credential cache exceeds its size limit."
        : "ChatGPT managed credential cache cannot be empty.",
    );
  const cache = Buffer.from(value);
  return cache;
}

function deriveKey(value: string) {
  if (typeof value !== "string" || Buffer.byteLength(value) < KEY_BYTES)
    throw invalid();
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(value),
      Buffer.alloc(0),
      Buffer.from(CHATGPT_CREDENTIAL_VAULT_PURPOSE),
      KEY_BYTES,
    ),
  );
}

function aad(context: Context) {
  return Buffer.from(
    JSON.stringify([
      CHATGPT_CREDENTIAL_VAULT_PURPOSE,
      CIPHER_VERSION,
      context.ownerId,
      context.connectionId,
      context.connectionVersion,
    ]),
  );
}

function encode(value: Buffer) {
  return value
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decode(value: unknown) {
  if (typeof value !== "string" || !value.startsWith(`${CIPHER_VERSION}.`))
    throw tamperedCache();
  const encoded = value.slice(CIPHER_VERSION.length + 1);
  if (
    encoded.length > Math.ceil((MAX_SEALED_BYTES * 4) / 3) + 4 ||
    !/^[A-Za-z0-9_-]+$/.test(encoded)
  )
    throw tamperedCache();
  const raw = Buffer.from(
    encoded.replaceAll("-", "+").replaceAll("_", "/"),
    "base64",
  );
  if (
    raw.length < IV_BYTES + AUTH_TAG_BYTES + 1 ||
    raw.length > MAX_SEALED_BYTES ||
    encode(raw) !== encoded
  )
    throw tamperedCache();
  return raw;
}

/** Encrypt opaque app-owned managed-runtime bytes; never call this with browser data. */
export function sealChatGPTCredentialCache(
  value: Uint8Array,
  context: Context,
  encryptionSecret = secret(),
) {
  const cache = cacheBuffer(value);
  checkedContext(context);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(encryptionSecret), iv);
  cipher.setAAD(aad(context));
  const ciphertext = Buffer.concat([cipher.update(cache), cipher.final()]);
  return `${CIPHER_VERSION}.${encode(
    Buffer.concat([iv, ciphertext, cipher.getAuthTag()]),
  )}`;
}

export function openChatGPTCredentialCache(
  value: string,
  context: Context,
  encryptionSecret = secret(),
) {
  try {
    checkedContext(context);
    const raw = decode(value);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(encryptionSecret),
      raw.subarray(0, IV_BYTES),
    );
    decipher.setAAD(aad(context));
    decipher.setAuthTag(raw.subarray(raw.length - AUTH_TAG_BYTES));
    const cache = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES, raw.length - AUTH_TAG_BYTES)),
      decipher.final(),
    ]);
    return cacheBuffer(cache);
  } catch (error) {
    if (error instanceof ChatGPTCredentialVaultError) throw error;
    throw tamperedCache();
  }
}

function dateValue(value: unknown): Date | null {
  const date =
    value instanceof Date ? new Date(value) : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

async function currentClock(client: PoolClient) {
  const result = await client.query<{ now: Date }>(
    "SELECT clock_timestamp() AS now",
  );
  const now = dateValue(result.rows[0]?.now);
  if (!now) throw Error("ChatGPT credential vault clock is unavailable.");
  return now;
}

function actorValue(actor: ChatGPTCredentialVaultActor) {
  if (!validPart(actor.ownerId) || !validPart(actor.sessionId)) throw invalid();
  return actor;
}

function connectionIdValue(value: string | undefined) {
  if (value !== undefined && !/^[0-9a-f-]{36}$/.test(value)) throw invalid();
  return value;
}

async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await database().connect();
  let begun = false;
  try {
    await client.query("BEGIN");
    begun = true;
    await client.query(
      `SET LOCAL lock_timeout = '${CHATGPT_CREDENTIAL_LOCK_TIMEOUT_MS}ms'`,
    );
    await client.query(
      `SET LOCAL statement_timeout = '${CHATGPT_CREDENTIAL_STATEMENT_TIMEOUT_MS}ms'`,
    );
    const value = await fn(client);
    await client.query("COMMIT");
    begun = false;
    return value;
  } catch (error) {
    if (begun) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function requireActiveSession(
  client: PoolClient,
  actor: ChatGPTCredentialVaultActor,
) {
  const result = await client.query<{ expires_at: Date | string }>(
    `SELECT "expiresAt" AS expires_at FROM "session"
     WHERE id=$1 AND "userId"=$2 AND "expiresAt">clock_timestamp()
     FOR UPDATE`,
    [actor.sessionId, actor.ownerId],
  );
  if (!result.rows.length) throw unauthorized();
  const expiresAt = dateValue(result.rows[0]?.expires_at);
  if (!expiresAt) throw unauthorized();
  return expiresAt;
}

function assertSessionCurrent(expiresAt: Date, now: Date) {
  if (expiresAt.getTime() <= now.getTime()) throw unauthorized();
}

function connectionView(row: ConnectionRow): ChatGPTCredentialConnection {
  const expiresAt = dateValue(row.expires_at);
  if (!expiresAt) throw tamperedCache();
  return {
    connectionId: row.id,
    connectionVersion: row.connection_version,
    expiresAt,
  };
}

function leaseView(row: VaultRow, cache: Uint8Array): ChatGPTCredentialLease {
  const leaseUntil = dateValue(row.lease_until);
  if (!leaseUntil || !row.lease_id) throw tamperedCache();
  return {
    ...connectionView(row),
    leaseId: row.lease_id,
    leaseEpoch: row.lease_epoch,
    leaseUntil,
    cache,
  };
}

export async function rememberChatGPTCredentialCache(
  actorInput: ChatGPTCredentialVaultActor,
  cacheInput: Uint8Array,
) {
  const actor = actorValue(actorInput);
  const cache = cacheBuffer(cacheInput);
  const connectionId = randomUUID();
  const connectionVersion = 1;
  const ciphertext = sealChatGPTCredentialCache(cache, {
    ownerId: actor.ownerId,
    connectionId,
    connectionVersion,
  });

  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    const current = await client.query<{
      id: string;
      expires_at: Date | string;
    }>(
      `SELECT id,expires_at FROM chatgpt_credential_connections
       WHERE owner_id=$1 AND revoked_at IS NULL
       FOR UPDATE`,
      [actor.ownerId],
    );
    const currentNow = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, currentNow);
    for (const row of current.rows) {
      const currentExpiresAt = dateValue(row.expires_at);
      if (
        !currentExpiresAt ||
        currentExpiresAt.getTime() > currentNow.getTime()
      )
        throw activeConnection();
      await client.query(
        `UPDATE chatgpt_credential_connections
         SET revoked_at=COALESCE(revoked_at,clock_timestamp()),
             connection_version=connection_version+1,updated_at=clock_timestamp()
         WHERE id=$1 AND owner_id=$2`,
        [row.id, actor.ownerId],
      );
      await client.query(
        "DELETE FROM chatgpt_credential_vault WHERE connection_id=$1",
        [row.id],
      );
    }
    const expiresAt = new Date(
      currentNow.getTime() + CHATGPT_CREDENTIAL_RETENTION_MS,
    );
    const inserted = await client.query<ConnectionRow>(
      `INSERT INTO chatgpt_credential_connections
       (id,owner_id,connection_version,expires_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING
       RETURNING id,owner_id,connection_version,expires_at,revoked_at`,
      [connectionId, actor.ownerId, connectionVersion, expiresAt],
    );
    if (!inserted.rows.length) throw activeConnection();
    await client.query(
      `INSERT INTO chatgpt_credential_vault
       (connection_id,owner_id,ciphertext)
       VALUES ($1,$2,$3)`,
      [connectionId, actor.ownerId, ciphertext],
    );
    return connectionView(inserted.rows[0]);
  });
}

/** Read connection metadata; decrypted cache bytes are returned only by a lease. */
export async function readChatGPTCredentialCache(
  actorInput: ChatGPTCredentialVaultActor,
  connectionIdInput?: string,
) {
  const actor = actorValue(actorInput);
  const connectionId = connectionIdValue(connectionIdInput);
  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    const result = await client.query<VaultRow>(
      `SELECT c.id,c.owner_id,c.connection_version,c.expires_at,c.revoked_at
       FROM chatgpt_credential_connections c
       JOIN chatgpt_credential_vault v
         ON v.connection_id=c.id AND v.owner_id=c.owner_id
       WHERE c.owner_id=$1 AND c.revoked_at IS NULL
         AND c.expires_at>clock_timestamp()
         AND ($2::uuid IS NULL OR c.id=$2)
       FOR UPDATE OF c,v`,
      [actor.ownerId, connectionId ?? null],
    );
    const row = result.rows[0];
    if (!row) return null;
    const currentNow = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, currentNow);
    const expiresAt = dateValue(row.expires_at);
    if (!expiresAt || expiresAt.getTime() <= currentNow.getTime()) {
      await client.query(
        `UPDATE chatgpt_credential_connections
         SET revoked_at=COALESCE(revoked_at,clock_timestamp()),
             connection_version=connection_version+1,updated_at=clock_timestamp()
         WHERE id=$1 AND owner_id=$2`,
        [row.id, actor.ownerId],
      );
      await client.query(
        "DELETE FROM chatgpt_credential_vault WHERE connection_id=$1",
        [row.id],
      );
      return null;
    }
    return connectionView(row);
  });
}

export async function leaseChatGPTCredentialCache(
  actorInput: ChatGPTCredentialVaultActor,
  connectionIdInput?: string,
): Promise<ChatGPTCredentialLeaseResult> {
  const actor = actorValue(actorInput);
  const connectionId = connectionIdValue(connectionIdInput);
  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    const result = await client.query<VaultRow>(
      `SELECT c.id,c.owner_id,c.connection_version,c.expires_at,c.revoked_at,
              s."expiresAt" AS session_expires_at,
              v.ciphertext,v.lease_id,v.lease_epoch,v.lease_until
       FROM chatgpt_credential_connections c
       JOIN "session" s ON s.id=$3 AND s."userId"=c.owner_id
       JOIN chatgpt_credential_vault v
         ON v.connection_id=c.id AND v.owner_id=c.owner_id
       WHERE c.owner_id=$1 AND c.revoked_at IS NULL
         AND ($2::uuid IS NULL OR c.id=$2)
       FOR UPDATE OF c,v`,
      [actor.ownerId, connectionId ?? null, actor.sessionId],
    );
    const row = result.rows[0];
    if (!row) return { kind: "missing" };
    const currentNow = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, currentNow);
    const expiresAt = dateValue(row.expires_at);
    const sessionExpiryFromRow = dateValue(row.session_expires_at);
    // The session row can expire while this transaction waits on the
    // connection lock. It is an authorization failure, not an expired
    // connection, and must leave the lease and ciphertext untouched.
    if (
      !sessionExpiryFromRow ||
      sessionExpiryFromRow.getTime() <= currentNow.getTime()
    )
      throw unauthorized();
    if (!expiresAt || expiresAt.getTime() <= currentNow.getTime()) {
      await client.query(
        `UPDATE chatgpt_credential_connections
         SET revoked_at=COALESCE(revoked_at,clock_timestamp()),
             connection_version=connection_version+1,updated_at=clock_timestamp()
         WHERE id=$1 AND owner_id=$2`,
        [row.id, actor.ownerId],
      );
      await client.query(
        "DELETE FROM chatgpt_credential_vault WHERE connection_id=$1",
        [row.id],
      );
      return { kind: "expired" };
    }
    const leaseUntil = dateValue(row.lease_until);
    if (leaseUntil && leaseUntil.getTime() > currentNow.getTime())
      return { kind: "busy" };
    if (
      Math.min(
        expiresAt.getTime() - currentNow.getTime(),
        sessionExpiryFromRow.getTime() - currentNow.getTime(),
      ) < CHATGPT_CREDENTIAL_LEASE_MIN_HEADROOM_MS
    )
      return { kind: "insufficient-headroom" };
    const connection = connectionView(row);
    const cache = openChatGPTCredentialCache(row.ciphertext, {
      ownerId: actor.ownerId,
      connectionId: connection.connectionId,
      connectionVersion: connection.connectionVersion,
    });
    const leaseId = randomUUID();
    const nextEpoch = row.lease_epoch + 1;
    const nextLeaseUntil = new Date(
      Math.min(
        currentNow.getTime() + CHATGPT_CREDENTIAL_LEASE_MS,
        expiresAt.getTime(),
        sessionExpiryFromRow.getTime(),
      ),
    );
    await client.query(
      `UPDATE chatgpt_credential_vault
       SET lease_id=$1,lease_epoch=$2,lease_until=$3,updated_at=clock_timestamp()
       WHERE connection_id=$4 AND owner_id=$5`,
      [leaseId, nextEpoch, nextLeaseUntil, row.id, actor.ownerId],
    );
    return {
      kind: "leased",
      lease: leaseView(
        {
          ...row,
          lease_id: leaseId,
          lease_epoch: nextEpoch,
          lease_until: nextLeaseUntil,
        },
        cache,
      ),
    };
  });
}

export async function saveChatGPTCredentialCache(
  actorInput: ChatGPTCredentialVaultActor,
  lease: Pick<
    ChatGPTCredentialLease,
    "connectionId" | "connectionVersion" | "leaseId" | "leaseEpoch"
  >,
  cacheInput: Uint8Array,
): Promise<ChatGPTCredentialSaveResult> {
  const actor = actorValue(actorInput);
  const cache = cacheBuffer(cacheInput);
  checkedContext({
    ownerId: actor.ownerId,
    connectionId: lease.connectionId,
    connectionVersion: lease.connectionVersion,
  });
  if (
    !validPart(lease.leaseId) ||
    !Number.isSafeInteger(lease.leaseEpoch) ||
    lease.leaseEpoch < 1
  )
    throw invalid();
  const ciphertext = sealChatGPTCredentialCache(cache, {
    ownerId: actor.ownerId,
    connectionId: lease.connectionId,
    connectionVersion: lease.connectionVersion,
  });
  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    const result = await client.query<VaultRow>(
      `SELECT c.id,c.owner_id,c.connection_version,c.expires_at,c.revoked_at,
              v.ciphertext,v.lease_id,v.lease_epoch,v.lease_until
       FROM chatgpt_credential_connections c
       JOIN chatgpt_credential_vault v
         ON v.connection_id=c.id AND v.owner_id=c.owner_id
       WHERE c.id=$1 AND c.owner_id=$2 AND c.revoked_at IS NULL
       FOR UPDATE OF c,v`,
      [lease.connectionId, actor.ownerId],
    );
    const row = result.rows[0];
    if (!row) return { kind: "missing" };
    const currentNow = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, currentNow);
    const expiresAt = dateValue(row.expires_at);
    const leaseUntil = dateValue(row.lease_until);
    if (!expiresAt || expiresAt.getTime() <= currentNow.getTime()) {
      await client.query(
        `UPDATE chatgpt_credential_connections
         SET revoked_at=COALESCE(revoked_at,clock_timestamp()),
             connection_version=connection_version+1,updated_at=clock_timestamp()
         WHERE id=$1 AND owner_id=$2`,
        [row.id, actor.ownerId],
      );
      await client.query(
        "DELETE FROM chatgpt_credential_vault WHERE connection_id=$1",
        [row.id],
      );
      return { kind: "expired" };
    }
    if (
      row.connection_version !== lease.connectionVersion ||
      row.lease_id !== lease.leaseId ||
      row.lease_epoch !== lease.leaseEpoch ||
      !leaseUntil ||
      leaseUntil.getTime() <= currentNow.getTime()
    )
      return { kind: "stale" };
    await client.query(
      `UPDATE chatgpt_credential_vault SET ciphertext=$1,updated_at=clock_timestamp()
       WHERE connection_id=$2 AND owner_id=$3 AND lease_id=$4 AND lease_epoch=$5`,
      [
        ciphertext,
        lease.connectionId,
        actor.ownerId,
        lease.leaseId,
        lease.leaseEpoch,
      ],
    );
    return { kind: "saved" };
  });
}

export async function releaseChatGPTCredentialLease(
  actorInput: ChatGPTCredentialVaultActor,
  lease: Pick<
    ChatGPTCredentialLease,
    "connectionId" | "leaseId" | "leaseEpoch"
  >,
): Promise<ChatGPTCredentialReleaseResult> {
  const actor = actorValue(actorInput);
  connectionIdValue(lease.connectionId);
  if (
    !validPart(lease.leaseId) ||
    !Number.isSafeInteger(lease.leaseEpoch) ||
    lease.leaseEpoch < 1
  )
    throw invalid();
  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    const result = await client.query<VaultRow>(
      `SELECT c.id,c.owner_id,c.connection_version,c.expires_at,c.revoked_at,
              v.ciphertext,v.lease_id,v.lease_epoch,v.lease_until
       FROM chatgpt_credential_connections c
       JOIN chatgpt_credential_vault v
         ON v.connection_id=c.id AND v.owner_id=c.owner_id
       WHERE c.owner_id=$1 AND c.id=$2 AND c.revoked_at IS NULL
       FOR UPDATE OF c,v`,
      [actor.ownerId, lease.connectionId],
    );
    const row = result.rows[0];
    if (!row) return { kind: "stale" };
    const currentNow = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, currentNow);
    if (row.lease_id !== lease.leaseId || row.lease_epoch !== lease.leaseEpoch)
      return { kind: "stale" };
    await client.query(
      `UPDATE chatgpt_credential_vault
       SET lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
       WHERE connection_id=$1 AND owner_id=$2 AND lease_id=$3 AND lease_epoch=$4`,
      [lease.connectionId, actor.ownerId, lease.leaseId, lease.leaseEpoch],
    );
    return { kind: "released" };
  });
}

/** Revoke authority atomically; the tombstone remains for stale-save fencing. */
export async function revokeChatGPTCredentialConnection(
  actorInput: ChatGPTCredentialVaultActor,
  connectionIdInput?: string,
) {
  const actor = actorValue(actorInput);
  const connectionId = connectionIdValue(connectionIdInput);
  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    const result = await client.query<ConnectionRow>(
      `SELECT id,owner_id,connection_version,expires_at,revoked_at
       FROM chatgpt_credential_connections
       WHERE owner_id=$1 AND revoked_at IS NULL
       AND ($2::uuid IS NULL OR id=$2)
       FOR UPDATE`,
      [actor.ownerId, connectionId ?? null],
    );
    const row = result.rows[0];
    if (!row) return false;
    const currentNow = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, currentNow);
    await client.query(
      `UPDATE chatgpt_credential_connections
       SET revoked_at=COALESCE(revoked_at,clock_timestamp()),
           connection_version=connection_version+1,updated_at=clock_timestamp()
       WHERE id=$1 AND owner_id=$2`,
      [row.id, actor.ownerId],
    );
    await client.query(
      "DELETE FROM chatgpt_credential_vault WHERE connection_id=$1",
      [row.id],
    );
    return true;
  });
}
