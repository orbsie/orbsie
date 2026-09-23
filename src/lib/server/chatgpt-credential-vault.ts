import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { PoolClient } from "pg";
import { database } from "./auth";
import {
  chatGPTHostCleanupTarget,
  type ChatGPTHostCleanupTarget,
} from "./chatgpt-host-registry";

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
  | {
      kind:
        "missing" | "expired" | "busy" | "insufficient-headroom" | "revoked";
    };

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

export type ChatGPTCredentialIntent = {
  epoch: number;
  pendingAttemptId: string | null;
};

export type ChatGPTCredentialIntentRecoverySource =
  "host-missing" | "terminal-host";

export type ChatGPTCredentialRememberOptions = {
  expectedIntentEpoch?: number;
  expectedHostAttemptId?: string;
};

export type ChatGPTCredentialRevocation = {
  revoked: boolean;
  hosts: ChatGPTHostCleanupTarget[];
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

async function connectBounded(signal?: AbortSignal): Promise<PoolClient> {
  signal?.throwIfAborted();
  const pending = database().connect();
  if (!signal) return pending;
  return new Promise<PoolClient>((resolve, reject) => {
    let settled = false;
    const finish = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      if (settled) return;
      settled = true;
      finish();
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    pending.then(
      (client) => {
        if (settled) {
          client.release();
          return;
        }
        settled = true;
        finish();
        resolve(client);
      },
      (error) => {
        if (settled) return;
        settled = true;
        finish();
        reject(error);
      },
    );
  });
}

function actorValue(actor: ChatGPTCredentialVaultActor) {
  if (!validPart(actor.ownerId) || !validPart(actor.sessionId)) throw invalid();
  return actor;
}

function connectionIdValue(value: string | undefined) {
  if (value !== undefined && !/^[0-9a-f-]{36}$/.test(value)) throw invalid();
  return value;
}

function intentEpochValue(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw invalid();
  return value as number;
}

function attemptIdValue(value: string | undefined) {
  if (value !== undefined && !/^[A-Za-z0-9_-]{1,256}$/.test(value))
    throw invalid();
  return value;
}

async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  signal?: AbortSignal,
) {
  const client = await connectBounded(signal);
  let begun = false;
  let discarded = false;
  const abort = () => {
    if (discarded) return;
    discarded = true;
    // Destroy this checked-out connection: a queued query or pool wait must
    // not outlive credential-finalization authority and later commit a write.
    client.release(true);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    await client.query("BEGIN");
    begun = true;
    await client.query(
      `SET LOCAL lock_timeout = '${CHATGPT_CREDENTIAL_LOCK_TIMEOUT_MS}ms'`,
    );
    await client.query(
      `SET LOCAL statement_timeout = '${CHATGPT_CREDENTIAL_STATEMENT_TIMEOUT_MS}ms'`,
    );
    signal?.throwIfAborted();
    const value = await fn(client);
    signal?.throwIfAborted();
    await client.query("COMMIT");
    begun = false;
    return value;
  } catch (error) {
    if (begun && !discarded)
      await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!discarded) client.release();
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

/** Serialize all connection-intent and vault mutations for an owner. */
async function lockOwner(
  client: PoolClient,
  actor: ChatGPTCredentialVaultActor,
) {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM "user" WHERE id=$1 FOR UPDATE`,
    [actor.ownerId],
  );
  if (!result.rows.length) throw unauthorized();
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
  options: ChatGPTCredentialRememberOptions = {},
) {
  const actor = actorValue(actorInput);
  const cache = cacheBuffer(cacheInput);
  const expectedIntentEpoch =
    options.expectedIntentEpoch === undefined
      ? undefined
      : intentEpochValue(options.expectedIntentEpoch);
  const expectedHostAttemptId = attemptIdValue(options.expectedHostAttemptId);
  if (expectedIntentEpoch === undefined && expectedHostAttemptId !== undefined)
    throw invalid();
  const connectionId = randomUUID();
  const connectionVersion = 1;
  const ciphertext = sealChatGPTCredentialCache(cache, {
    ownerId: actor.ownerId,
    connectionId,
    connectionVersion,
  });

  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    if (expectedIntentEpoch !== undefined) await lockOwner(client, actor);
    if (expectedIntentEpoch !== undefined) {
      const intent = await client.query<{
        epoch: number;
        pending_attempt_id: string | null;
        revoked_at: Date | string | null;
      }>(
        `SELECT epoch,pending_attempt_id,revoked_at FROM chatgpt_credential_intents
         WHERE owner_id=$1 FOR UPDATE`,
        [actor.ownerId],
      );
      const row = intent.rows[0];
      if (
        !row ||
        row.epoch !== expectedIntentEpoch ||
        row.pending_attempt_id !== (expectedHostAttemptId ?? null) ||
        row.revoked_at
      )
        throw unauthorized();
    }
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
    const inserted =
      expectedIntentEpoch === undefined
        ? await client.query<ConnectionRow>(
            `INSERT INTO chatgpt_credential_connections
             (id,owner_id,connection_version,expires_at)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT DO NOTHING
             RETURNING id,owner_id,connection_version,expires_at,revoked_at`,
            [connectionId, actor.ownerId, connectionVersion, expiresAt],
          )
        : await client.query<ConnectionRow>(
            `INSERT INTO chatgpt_credential_connections
             (id,owner_id,connection_version,expires_at,intent_epoch,host_attempt_id)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT DO NOTHING
             RETURNING id,owner_id,connection_version,expires_at,revoked_at`,
            [
              connectionId,
              actor.ownerId,
              connectionVersion,
              expiresAt,
              expectedIntentEpoch,
              expectedHostAttemptId ?? null,
            ],
          );
    if (!inserted.rows.length) throw activeConnection();
    await client.query(
      `INSERT INTO chatgpt_credential_vault
       (connection_id,owner_id,ciphertext)
       VALUES ($1,$2,$3)`,
      [connectionId, actor.ownerId, ciphertext],
    );
    if (expectedIntentEpoch !== undefined) {
      await client.query(
        `UPDATE chatgpt_credential_intents
         SET pending_attempt_id=NULL,updated_at=clock_timestamp()
         WHERE owner_id=$1 AND epoch=$2 AND pending_attempt_id=$3`,
        [actor.ownerId, expectedIntentEpoch, expectedHostAttemptId ?? null],
      );
    }
    return connectionView(inserted.rows[0]);
  });
}

/**
 * Complete a login explicitly admitted by Start. A missing intent is returned
 * to let the caller use the migration-only path for legacy logins; a revoked
 * or differently-bound intent is never replaced.
 */
export async function completeChatGPTCredentialIntent(
  actorInput: ChatGPTCredentialVaultActor,
  attemptIdInput: string,
  options: { signal?: AbortSignal } = {},
) {
  const actor = actorValue(actorInput);
  const attemptId = attemptIdValue(attemptIdInput);
  if (!attemptId) throw invalid();
  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    await lockOwner(client, actor);
    const result = await client.query<{
      epoch: number;
      pending_attempt_id: string | null;
      revoked_at: Date | string | null;
    }>(
      `SELECT epoch,pending_attempt_id,revoked_at
       FROM chatgpt_credential_intents WHERE owner_id=$1 FOR UPDATE`,
      [actor.ownerId],
    );
    const now = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, now);
    const row = result.rows[0];
    if (!row) return null;
    if (row.revoked_at || row.pending_attempt_id !== attemptId)
      throw unauthorized();
    return { epoch: row.epoch, pendingAttemptId: attemptId };
  }, options.signal);
}

/** Check whether a legacy runtime may still be consulted during migration. */
export async function canUseLegacyChatGPTHost(
  actorInput: ChatGPTCredentialVaultActor,
  options: { signal?: AbortSignal } = {},
) {
  const actor = actorValue(actorInput);
  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    await lockOwner(client, actor);
    const result = await client.query<{ revoked_at: Date | string | null }>(
      `SELECT revoked_at FROM chatgpt_credential_intents
       WHERE owner_id=$1 FOR UPDATE`,
      [actor.ownerId],
    );
    const now = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, now);
    return !result.rows[0]?.revoked_at;
  }, options.signal);
}

/**
 * Admit an explicit device-login attempt. The owner intent row is the fence
 * for a connection that does not exist yet, so Disconnect can invalidate it
 * before a late login callback tries to remember its cache.
 */
export async function beginChatGPTCredentialIntent(
  actorInput: ChatGPTCredentialVaultActor,
  options: { signal?: AbortSignal } = {},
): Promise<ChatGPTCredentialIntent> {
  const actor = actorValue(actorInput);
  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    await lockOwner(client, actor);
    const intent = await client.query<{
      epoch: number;
      pending_attempt_id: string | null;
    }>(
      `SELECT epoch,pending_attempt_id FROM chatgpt_credential_intents
       WHERE owner_id=$1 FOR UPDATE`,
      [actor.ownerId],
    );
    const active = await client.query<{ id: string }>(
      `SELECT id FROM chatgpt_credential_connections
       WHERE owner_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()
       FOR UPDATE`,
      [actor.ownerId],
    );
    const currentNow = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, currentNow);
    if (active.rows.length || intent.rows[0]?.pending_attempt_id)
      throw activeConnection();
    const epoch = (intent.rows[0]?.epoch ?? 0) + 1;
    const reservation = `pending:${epoch}`;
    await client.query(
      `INSERT INTO chatgpt_credential_intents(owner_id,epoch,pending_attempt_id,revoked_at,updated_at)
       VALUES ($1,$2,$3,NULL,clock_timestamp())
       ON CONFLICT(owner_id) DO UPDATE SET epoch=EXCLUDED.epoch,
         pending_attempt_id=EXCLUDED.pending_attempt_id,revoked_at=NULL,updated_at=clock_timestamp()`,
      [actor.ownerId, epoch, reservation],
    );
    return { epoch, pendingAttemptId: reservation };
  }, options.signal);
}

/** Read the current bound login intent without changing owner authority. */
export async function readPendingChatGPTCredentialIntent(
  actorInput: ChatGPTCredentialVaultActor,
  options: { signal?: AbortSignal } = {},
): Promise<ChatGPTCredentialIntent | null> {
  const actor = actorValue(actorInput);
  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    await lockOwner(client, actor);
    const intent = await client.query<{
      epoch: number;
      pending_attempt_id: string | null;
      revoked_at: Date | string | null;
    }>(
      `SELECT epoch,pending_attempt_id,revoked_at
       FROM chatgpt_credential_intents WHERE owner_id=$1 FOR UPDATE`,
      [actor.ownerId],
    );
    const now = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, now);
    const row = intent.rows[0];
    if (!row || row.revoked_at || !row.pending_attempt_id) return null;
    return {
      epoch: row.epoch,
      pendingAttemptId: row.pending_attempt_id,
    };
  }, options.signal);
}

/**
 * Atomically retire a proven-unrecoverable login and reserve its replacement.
 * The epoch and attempt comparison makes Disconnect, another Start, and late
 * completion callbacks serialize against this transition.
 */
export async function restartExpiredChatGPTCredentialIntent(
  actorInput: ChatGPTCredentialVaultActor,
  expected: { epoch: number; pendingAttemptId: string },
  source: ChatGPTCredentialIntentRecoverySource,
  options: { signal?: AbortSignal } = {},
): Promise<ChatGPTCredentialIntent | null> {
  const actor = actorValue(actorInput);
  const epoch = intentEpochValue(expected.epoch);
  const pendingAttemptId = attemptIdValue(expected.pendingAttemptId);
  if (
    !pendingAttemptId ||
    pendingAttemptId === `pending:${epoch}` ||
    (source !== "host-missing" && source !== "terminal-host")
  )
    throw invalid();
  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    await lockOwner(client, actor);
    const result = await client.query<{
      epoch: number;
      pending_attempt_id: string | null;
      revoked_at: Date | string | null;
    }>(
      `SELECT epoch,pending_attempt_id,revoked_at
       FROM chatgpt_credential_intents WHERE owner_id=$1 FOR UPDATE`,
      [actor.ownerId],
    );
    const now = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, now);
    const row = result.rows[0];
    if (
      !row ||
      row.epoch !== epoch ||
      row.pending_attempt_id !== pendingAttemptId ||
      row.revoked_at
    )
      return null;

    const connections = await client.query<{ id: string }>(
      `SELECT id FROM chatgpt_credential_connections
       WHERE owner_id=$1 AND revoked_at IS NULL AND expires_at>$2
       FOR UPDATE`,
      [actor.ownerId, now],
    );
    if (connections.rows.length) throw activeConnection();

    const hosts = await client.query<{
      attempt_id: string;
      expires_at: Date | string;
    }>(
      `SELECT attempt_id,expires_at FROM chatgpt_hosts
       WHERE owner_id=$1 FOR UPDATE`,
      [actor.ownerId],
    );
    const currentHosts = hosts.rows.filter((host) => {
      const expiresAt = dateValue(host.expires_at);
      return !expiresAt || expiresAt.getTime() > now.getTime();
    });
    const matchingHosts = currentHosts.filter(
      (host) => host.attempt_id === pendingAttemptId,
    );
    if (
      currentHosts.some((host) => host.attempt_id !== pendingAttemptId) ||
      (source === "host-missing" && matchingHosts.length > 0) ||
      (source === "terminal-host" && matchingHosts.length > 1)
    )
      return null;

    const nextEpoch = epoch + 1;
    if (!Number.isSafeInteger(nextEpoch)) throw invalid();
    const reservation = `pending:${nextEpoch}`;
    const updated = await client.query(
      `UPDATE chatgpt_credential_intents
       SET epoch=$4,pending_attempt_id=$5,updated_at=clock_timestamp()
       WHERE owner_id=$1 AND epoch=$2 AND pending_attempt_id=$3
         AND revoked_at IS NULL
       RETURNING epoch`,
      [actor.ownerId, epoch, pendingAttemptId, nextEpoch, reservation],
    );
    if (!updated.rows.length) return null;
    return { epoch: nextEpoch, pendingAttemptId: reservation };
  }, options.signal);
}

/** Bind a newly admitted host attempt to the still-pending owner intent. */
export async function bindChatGPTCredentialIntentHost(
  actorInput: ChatGPTCredentialVaultActor,
  epochInput: number,
  attemptIdInput: string,
  options: { signal?: AbortSignal } = {},
) {
  const actor = actorValue(actorInput);
  const epoch = intentEpochValue(epochInput);
  const attemptId = attemptIdValue(attemptIdInput);
  if (!attemptId) throw invalid();
  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    await lockOwner(client, actor);
    const intent = await client.query<{
      epoch: number;
      pending_attempt_id: string | null;
    }>(
      `SELECT epoch,pending_attempt_id FROM chatgpt_credential_intents
       WHERE owner_id=$1 FOR UPDATE`,
      [actor.ownerId],
    );
    const now = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, now);
    const row = intent.rows[0];
    if (!row || row.epoch !== epoch) throw unauthorized();
    if (
      row.pending_attempt_id &&
      row.pending_attempt_id !== attemptId &&
      row.pending_attempt_id !== `pending:${epoch}`
    )
      throw activeConnection();
    await client.query(
      `UPDATE chatgpt_credential_intents SET pending_attempt_id=$1,updated_at=clock_timestamp()
       WHERE owner_id=$2 AND epoch=$3`,
      [attemptId, actor.ownerId, epoch],
    );
    return { epoch, pendingAttemptId: attemptId };
  }, options.signal);
}

/** Migration-only admission for a verified legacy login started before this fence existed. */
export async function admitLegacyChatGPTCredentialIntent(
  actorInput: ChatGPTCredentialVaultActor,
  attemptIdInput: string,
  options: { signal?: AbortSignal } = {},
) {
  const actor = actorValue(actorInput);
  const attemptId = attemptIdValue(attemptIdInput);
  if (!attemptId) throw invalid();
  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    await lockOwner(client, actor);
    const intent = await client.query<{ epoch: number }>(
      `SELECT epoch FROM chatgpt_credential_intents WHERE owner_id=$1 FOR UPDATE`,
      [actor.ownerId],
    );
    const active = await client.query<{ id: string }>(
      `SELECT id FROM chatgpt_credential_connections
       WHERE owner_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()
       FOR UPDATE`,
      [actor.ownerId],
    );
    const currentNow = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, currentNow);
    if (active.rows.length) throw activeConnection();
    if (intent.rows.length) throw unauthorized();
    await client.query(
      `INSERT INTO chatgpt_credential_intents(owner_id,epoch,pending_attempt_id,updated_at)
       VALUES ($1,1,$2,clock_timestamp())`,
      [actor.ownerId, attemptId],
    );
    return { epoch: 1, pendingAttemptId: attemptId };
  }, options.signal);
}

/** Cancel a newly admitted login without revoking a previously remembered connection. */
export async function cancelChatGPTCredentialIntent(
  actorInput: ChatGPTCredentialVaultActor,
  epochInput?: number,
) {
  const actor = actorValue(actorInput);
  const epoch =
    epochInput === undefined ? undefined : intentEpochValue(epochInput);
  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    await lockOwner(client, actor);
    const intent = await client.query<{ epoch: number }>(
      `SELECT epoch FROM chatgpt_credential_intents WHERE owner_id=$1 FOR UPDATE`,
      [actor.ownerId],
    );
    const row = intent.rows[0];
    if (!row || (epoch !== undefined && row.epoch !== epoch)) return false;
    const active = await client.query<{ id: string }>(
      `SELECT id FROM chatgpt_credential_connections
       WHERE owner_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()
       FOR UPDATE`,
      [actor.ownerId],
    );
    if (active.rows.length) return false;
    const now = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, now);
    await client.query(
      `UPDATE chatgpt_credential_intents
       SET epoch=epoch+1,pending_attempt_id=NULL,revoked_at=clock_timestamp(),updated_at=clock_timestamp()
       WHERE owner_id=$1 AND epoch=$2`,
      [actor.ownerId, row.epoch],
    );
    return true;
  });
}

/** Revoke authority and capture every owner host under one owner fence. */
export async function revokeChatGPTCredentialAuthorityAndCaptureHosts(
  actorInput: ChatGPTCredentialVaultActor,
): Promise<ChatGPTCredentialRevocation> {
  const actor = actorValue(actorInput);
  return transaction(async (client) => {
    const sessionExpiresAt = await requireActiveSession(client, actor);
    await lockOwner(client, actor);
    const intent = await client.query<{ epoch: number }>(
      `SELECT epoch FROM chatgpt_credential_intents WHERE owner_id=$1 FOR UPDATE`,
      [actor.ownerId],
    );
    const now = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, now);
    const hosts = await client.query<{
      owner_id: string;
      session_id: string;
      attempt_id: string;
      sandbox_name: string | null;
    }>(
      `SELECT owner_id,session_id,attempt_id,sandbox_name
       FROM chatgpt_hosts WHERE owner_id=$1 FOR UPDATE`,
      [actor.ownerId],
    );
    if (intent.rows.length) {
      await client.query(
        `UPDATE chatgpt_credential_intents
         SET epoch=epoch+1,pending_attempt_id=NULL,revoked_at=clock_timestamp(),updated_at=clock_timestamp()
         WHERE owner_id=$1`,
        [actor.ownerId],
      );
    } else {
      await client.query(
        `INSERT INTO chatgpt_credential_intents(owner_id,epoch,revoked_at,updated_at)
         VALUES ($1,1,clock_timestamp(),clock_timestamp())`,
        [actor.ownerId],
      );
    }
    const connections = await client.query<{ id: string }>(
      `SELECT id FROM chatgpt_credential_connections
       WHERE owner_id=$1 AND revoked_at IS NULL FOR UPDATE`,
      [actor.ownerId],
    );
    for (const row of connections.rows) {
      await client.query(
        `UPDATE chatgpt_credential_connections
         SET revoked_at=clock_timestamp(),connection_version=connection_version+1,updated_at=clock_timestamp()
         WHERE id=$1 AND owner_id=$2`,
        [row.id, actor.ownerId],
      );
      await client.query(
        `DELETE FROM chatgpt_credential_vault WHERE connection_id=$1`,
        [row.id],
      );
    }
    return {
      revoked: connections.rows.length > 0,
      hosts: hosts.rows.map(chatGPTHostCleanupTarget),
    };
  });
}

/** Revoke remembered authority before any remote logout or sandbox cleanup. */
export async function revokeChatGPTCredentialAuthority(
  actorInput: ChatGPTCredentialVaultActor,
) {
  return (await revokeChatGPTCredentialAuthorityAndCaptureHosts(actorInput))
    .revoked;
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
  options: { signal?: AbortSignal } = {},
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
    if (!row) {
      const intent = await client.query<{ revoked_at: Date | string | null }>(
        `SELECT revoked_at FROM chatgpt_credential_intents
         WHERE owner_id=$1 FOR UPDATE`,
        [actor.ownerId],
      );
      const missingNow = await currentClock(client);
      assertSessionCurrent(sessionExpiresAt, missingNow);
      return intent.rows[0]?.revoked_at
        ? { kind: "revoked" }
        : { kind: "missing" };
    }
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
  }, options.signal);
}

/**
 * Hold the owner/connection fence while admitting a refresh-capable runtime.
 * Disconnect uses the same owner lock, so it either revokes before admission
 * or waits until the private initialize has completed and can capture it.
 */
export async function withChatGPTCredentialLeaseAdmission<T>(
  actorInput: ChatGPTCredentialVaultActor,
  lease: Pick<
    ChatGPTCredentialLease,
    "connectionId" | "connectionVersion" | "leaseId" | "leaseEpoch"
  >,
  operation: () => Promise<T>,
  options: { signal?: AbortSignal } = {},
): Promise<
  { kind: "admitted"; value: T } | { kind: "missing" | "expired" | "stale" }
> {
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
    await lockOwner(client, actor);
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
    const now = await currentClock(client);
    assertSessionCurrent(sessionExpiresAt, now);
    const expiresAt = dateValue(row.expires_at);
    const leaseUntil = dateValue(row.lease_until);
    if (!expiresAt || expiresAt.getTime() <= now.getTime())
      return { kind: "expired" };
    if (
      row.connection_version !== lease.connectionVersion ||
      row.lease_id !== lease.leaseId ||
      row.lease_epoch !== lease.leaseEpoch ||
      !leaseUntil ||
      leaseUntil.getTime() <= now.getTime()
    )
      return { kind: "stale" };
    options.signal?.throwIfAborted();
    const value = await operation();
    options.signal?.throwIfAborted();
    return { kind: "admitted", value };
  }, options.signal);
}

export async function saveChatGPTCredentialCache(
  actorInput: ChatGPTCredentialVaultActor,
  lease: Pick<
    ChatGPTCredentialLease,
    "connectionId" | "connectionVersion" | "leaseId" | "leaseEpoch"
  >,
  cacheInput: Uint8Array,
  options: { signal?: AbortSignal } = {},
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
  }, options.signal);
}

export async function releaseChatGPTCredentialLease(
  actorInput: ChatGPTCredentialVaultActor,
  lease: Pick<
    ChatGPTCredentialLease,
    "connectionId" | "leaseId" | "leaseEpoch"
  >,
  options: { signal?: AbortSignal } = {},
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
  }, options.signal);
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
