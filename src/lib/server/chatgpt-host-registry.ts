import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { database, HttpError } from "./auth";
import {
  openHostCapability,
  sealHostCapability,
} from "./chatgpt-host-capability";

export const CHATGPT_HOST_IDLE_LIFETIME_MS = 10 * 60 * 1000;
export const CHATGPT_HOST_MAX_LIFETIME_MS = 40 * 60 * 1000;
const RENEWAL_LOCK_TIMEOUT_MS = 2_000;
const RENEWAL_STATEMENT_TIMEOUT_MS = 35_000;
const READ_STATEMENT_TIMEOUT_MS = 35_000;
type Identity = { ownerId: string; sessionId: string };
function secret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || Buffer.byteLength(value) < 32)
    throw new HttpError(503, "ChatGPT host encryption is not configured.");
  return value;
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

async function readChatGPTHostWithSignal(
  identity: Identity,
  signal: AbortSignal,
) {
  const client = await connectBounded(signal);
  let transaction = false;
  try {
    await client.query("BEGIN");
    transaction = true;
    await client.query(
      `SET LOCAL statement_timeout = '${READ_STATEMENT_TIMEOUT_MS}ms'`,
    );
    signal.throwIfAborted();
    const result = await client.query(
      `SELECT h.attempt_id,h.sandbox_name,h.capability_ciphertext,h.expires_at,h.artifact_digest
       FROM chatgpt_hosts h JOIN "session" s ON s.id=h.session_id AND s."userId"=h.owner_id
       WHERE h.session_id=$1 AND h.owner_id=$2 AND h.state='ready'
       AND h.expires_at>now() AND s."expiresAt">now()`,
      [identity.sessionId, identity.ownerId],
    );
    signal.throwIfAborted();
    await client.query("COMMIT");
    transaction = false;
    return result;
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Atomic claim; an expired row is retained until its runtime is cleaned up. */
export async function claimChatGPTHost(identity: Identity) {
  secret();
  const attemptId = randomUUID();
  const expiresAt = new Date(Date.now() + CHATGPT_HOST_IDLE_LIFETIME_MS);
  const result = await database().query(
    `INSERT INTO chatgpt_hosts(session_id,owner_id,attempt_id,state,expires_at)
     SELECT id,"userId",$3,'provisioning',LEAST($4,"expiresAt") FROM "session"
     WHERE id=$1 AND "userId"=$2 AND "expiresAt">now()
     ON CONFLICT(session_id) DO NOTHING RETURNING attempt_id,expires_at`,
    [identity.sessionId, identity.ownerId, attemptId, expiresAt],
  );
  return result.rows.length
    ? { attemptId, expiresAt: result.rows[0].expires_at as Date }
    : null;
}

export type ChatGPTHostRenewalHost = {
  attemptId: string;
  sandboxName: string;
  capability: string;
  expiresAt: Date;
  artifactDigest: string;
};

export type ChatGPTHostRenewalResult =
  | { kind: "ready"; host: ChatGPTHostRenewalHost }
  | { kind: "missing" | "expired" | "insufficient-headroom" | "stale" };

type RenewalRow = {
  attempt_id: string;
  sandbox_name: string;
  capability_ciphertext: string;
  expires_at: Date;
  created_at: Date;
  artifact_digest: string | null;
  session_expires_at: Date;
};

function dateValue(value: unknown): Date | null {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function renewalResult(
  row: RenewalRow,
  identity: Identity,
  expectedArtifactDigest: string,
): ChatGPTHostRenewalResult {
  if (
    row.artifact_digest !== expectedArtifactDigest ||
    !/^[a-f0-9]{64}$/.test(row.artifact_digest ?? "") ||
    row.sandbox_name !== `orbsie-chatgpt-${row.attempt_id}`
  )
    return { kind: "stale" };
  const capability = openHostCapability(
    row.capability_ciphertext,
    { ...identity, attemptId: row.attempt_id },
    secret(),
  );
  return {
    kind: "ready",
    host: {
      attemptId: row.attempt_id,
      sandboxName: row.sandbox_name,
      capability,
      expiresAt: row.expires_at,
      artifactDigest: expectedArtifactDigest,
    },
  };
}

/**
 * Lock a ready host and coordinate a bounded backend extension with the
 * registry update. The backend callback runs while the owner/session row is
 * locked, so logout and another generation cannot race the same attempt.
 */
export async function renewChatGPTHost(
  identity: Identity,
  attemptId: string,
  expectedArtifactDigest: string,
  options: {
    minHeadroomMs: number;
    signal?: AbortSignal;
    renew(
      host: ChatGPTHostRenewalHost,
      targetExpiresAt: Date,
      signal?: AbortSignal,
    ): Promise<Date>;
  },
): Promise<ChatGPTHostRenewalResult> {
  if (!Number.isSafeInteger(options.minHeadroomMs) || options.minHeadroomMs < 1)
    throw new Error("ChatGPT generation headroom is invalid.");
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(attemptId)) return { kind: "missing" };
  if (!/^[a-f0-9]{64}$/.test(expectedArtifactDigest)) return { kind: "stale" };

  const renewalSignal =
    options.signal ?? AbortSignal.timeout(RENEWAL_STATEMENT_TIMEOUT_MS);
  renewalSignal.throwIfAborted();
  const client = await connectBounded(renewalSignal);
  let transaction = false;
  try {
    renewalSignal.throwIfAborted();
    await client.query("BEGIN");
    transaction = true;
    await client.query(
      `SET LOCAL lock_timeout = '${RENEWAL_LOCK_TIMEOUT_MS}ms'`,
    );
    await client.query(
      `SET LOCAL statement_timeout = '${RENEWAL_STATEMENT_TIMEOUT_MS}ms'`,
    );
    const result = await client.query<RenewalRow>(
      `SELECT h.attempt_id,h.sandbox_name,h.capability_ciphertext,h.expires_at,
              h.created_at,h.artifact_digest,s."expiresAt" AS session_expires_at
       FROM chatgpt_hosts h
       JOIN "session" s ON s.id=h.session_id AND s."userId"=h.owner_id
       WHERE h.session_id=$1 AND h.owner_id=$2 AND h.attempt_id=$3 AND h.state='ready'
       FOR UPDATE OF h,s`,
      [identity.sessionId, identity.ownerId, attemptId],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("COMMIT");
      transaction = false;
      return { kind: "missing" };
    }

    // Date.now() is deliberately read after the row lock. PostgreSQL's
    // transaction-start now() can be stale after waiting for another owner.
    const now = Date.now();
    const hostExpiresAt = dateValue(row.expires_at);
    const createdAt = dateValue(row.created_at);
    const sessionExpiresAt = dateValue(row.session_expires_at);
    if (!hostExpiresAt || !createdAt || !sessionExpiresAt) {
      await client.query("COMMIT");
      transaction = false;
      return { kind: "expired" };
    }
    if (hostExpiresAt.getTime() <= now || sessionExpiresAt.getTime() <= now) {
      await client.query("COMMIT");
      transaction = false;
      return { kind: "expired" };
    }
    const checked = renewalResult(
      {
        ...row,
        expires_at: hostExpiresAt,
        created_at: createdAt,
        session_expires_at: sessionExpiresAt,
      },
      identity,
      expectedArtifactDigest,
    );
    if (checked.kind !== "ready") {
      await client.query("COMMIT");
      transaction = false;
      return checked;
    }

    const productDeadline = createdAt.getTime() + CHATGPT_HOST_MAX_LIFETIME_MS;
    const targetMs = Math.min(
      now + CHATGPT_HOST_IDLE_LIFETIME_MS,
      productDeadline,
      sessionExpiresAt.getTime(),
    );
    if (targetMs - now < options.minHeadroomMs) {
      await client.query("COMMIT");
      transaction = false;
      return { kind: "insufficient-headroom" };
    }

    renewalSignal.throwIfAborted();
    const actualExpiresAt = await options.renew(
      checked.host,
      new Date(targetMs),
      renewalSignal,
    );
    const verifiedActual = dateValue(actualExpiresAt);
    if (!verifiedActual || verifiedActual.getTime() < targetMs)
      throw new Error("ChatGPT host expiry could not be verified.");

    // Registry authorization never outlives the real runtime, the product
    // cap, or the owning Better Auth session. Keep an existing later expiry
    // only when the backend confirms it still exists.
    const commitNow = Date.now();
    if (
      verifiedActual.getTime() <= commitNow ||
      sessionExpiresAt.getTime() <= commitNow
    ) {
      await client.query("ROLLBACK");
      transaction = false;
      return { kind: "expired" };
    }
    const committedMs = Math.min(
      Math.max(hostExpiresAt.getTime(), targetMs),
      verifiedActual.getTime(),
      productDeadline,
      sessionExpiresAt.getTime(),
    );
    if (committedMs - commitNow < options.minHeadroomMs) {
      await client.query("ROLLBACK");
      transaction = false;
      return { kind: "insufficient-headroom" };
    }
    renewalSignal.throwIfAborted();
    const updated = await client.query(
      `UPDATE chatgpt_hosts h SET expires_at=$4
       WHERE h.session_id=$1 AND h.owner_id=$2 AND h.attempt_id=$3
         AND h.state='ready'
       RETURNING h.attempt_id,h.sandbox_name,h.capability_ciphertext,
                 h.expires_at,h.artifact_digest`,
      [identity.sessionId, identity.ownerId, attemptId, new Date(committedMs)],
    );
    if (updated.rows.length !== 1) {
      await client.query("ROLLBACK");
      transaction = false;
      return { kind: "missing" };
    }
    renewalSignal.throwIfAborted();
    await client.query("COMMIT");
    transaction = false;
    return {
      kind: "ready",
      host: {
        ...checked.host,
        expiresAt: new Date(committedMs),
      },
    };
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Only the current, unexpired reservation can become ready. */
export async function completeChatGPTHost(
  identity: Identity,
  attemptId: string,
  sandboxName: string,
  capability: string,
  artifactDigest: string,
) {
  if (!/^orbsie-chatgpt-[a-z0-9-]{1,80}$/.test(sandboxName))
    throw new HttpError(400, "Invalid ChatGPT host name.");
  if (!/^[a-f0-9]{64}$/.test(artifactDigest))
    throw new HttpError(400, "Invalid ChatGPT artifact digest.");
  const ciphertext = sealHostCapability(
    capability,
    { ...identity, attemptId },
    secret(),
  );
  const result = await database().query(
    `UPDATE chatgpt_hosts h SET state='ready',sandbox_name=$4,capability_ciphertext=$5,artifact_digest=$6
     FROM "session" s WHERE h.session_id=$1 AND h.owner_id=$2 AND h.attempt_id=$3
     AND h.state='provisioning' AND h.expires_at>now()
     AND s.id=h.session_id AND s."userId"=h.owner_id AND s."expiresAt">now()
     RETURNING h.attempt_id`,
    [
      identity.sessionId,
      identity.ownerId,
      attemptId,
      sandboxName,
      ciphertext,
      artifactDigest,
    ],
  );
  return result.rows.length === 1;
}

/** Internal only. Never serialize this result to a browser response. */
export async function readChatGPTHost(
  identity: Identity,
  options: { signal?: AbortSignal } = {},
) {
  const result = options.signal
    ? await readChatGPTHostWithSignal(identity, options.signal)
    : await database().query(
        `SELECT h.attempt_id,h.sandbox_name,h.capability_ciphertext,h.expires_at,h.artifact_digest
         FROM chatgpt_hosts h JOIN "session" s ON s.id=h.session_id AND s."userId"=h.owner_id
         WHERE h.session_id=$1 AND h.owner_id=$2 AND h.state='ready'
         AND h.expires_at>now() AND s."expiresAt">now()`,
        [identity.sessionId, identity.ownerId],
      );
  const row = result.rows[0];
  if (!row) return null;
  return {
    attemptId: row.attempt_id as string,
    sandboxName: row.sandbox_name as string,
    expiresAt: row.expires_at as Date,
    artifactDigest:
      typeof row.artifact_digest === "string" ? row.artifact_digest : null,
    capability: openHostCapability(
      row.capability_ciphertext,
      { ...identity, attemptId: row.attempt_id },
      secret(),
    ),
  };
}

/** Cleanup metadata only; never decrypt an expired host capability. */
export async function readExpiredChatGPTHost(identity: Identity) {
  const result = await database().query(
    `SELECT attempt_id FROM chatgpt_hosts
     WHERE session_id=$1 AND owner_id=$2 AND expires_at<=now()`,
    [identity.sessionId, identity.ownerId],
  );
  const row = result.rows[0];
  if (!row) return null;
  // Provisioning failures may have no stored name or capability yet.
  return {
    attemptId: row.attempt_id as string,
    sandboxName: `orbsie-chatgpt-${row.attempt_id}`,
  };
}

/** Session teardown also covers provisioning and expired hosts without decrypting credentials. */
export async function readSessionChatGPTHost(identity: Identity) {
  const result = await database().query(
    `SELECT attempt_id FROM chatgpt_hosts WHERE session_id=$1 AND owner_id=$2`,
    [identity.sessionId, identity.ownerId],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (!/^[a-z0-9-]{1,80}$/.test(row.attempt_id))
    throw new Error("Invalid ChatGPT cleanup metadata.");
  return {
    attemptId: row.attempt_id as string,
    sandboxName: `orbsie-chatgpt-${row.attempt_id}`,
  };
}

/** Call only after runtime deletion; attempt matching protects a newer host. */
export async function releaseChatGPTHost(
  identity: Identity,
  attemptId: string,
) {
  const result = await database().query(
    `DELETE FROM chatgpt_hosts WHERE session_id=$1 AND owner_id=$2 AND attempt_id=$3 RETURNING attempt_id`,
    [identity.sessionId, identity.ownerId, attemptId],
  );
  return result.rows.length === 1;
}
