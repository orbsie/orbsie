import { randomUUID } from "node:crypto";
import { database, HttpError } from "./auth";
import {
  openHostCapability,
  sealHostCapability,
} from "./chatgpt-host-capability";

const HOST_LIFETIME_MS = 10 * 60 * 1000;
type Identity = { ownerId: string; sessionId: string };
function secret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || Buffer.byteLength(value) < 32)
    throw new HttpError(503, "ChatGPT host encryption is not configured.");
  return value;
}

/** Atomic claim; an expired row is retained until its runtime is cleaned up. */
export async function claimChatGPTHost(identity: Identity) {
  secret();
  const attemptId = randomUUID();
  const expiresAt = new Date(Date.now() + HOST_LIFETIME_MS);
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

/** Only the current, unexpired reservation can become ready. */
export async function completeChatGPTHost(
  identity: Identity,
  attemptId: string,
  sandboxName: string,
  capability: string,
) {
  if (!/^orbsie-chatgpt-[a-z0-9-]{1,80}$/.test(sandboxName))
    throw new HttpError(400, "Invalid ChatGPT host name.");
  const ciphertext = sealHostCapability(
    capability,
    { ...identity, attemptId },
    secret(),
  );
  const result = await database().query(
    `UPDATE chatgpt_hosts h SET state='ready',sandbox_name=$4,capability_ciphertext=$5
     FROM "session" s WHERE h.session_id=$1 AND h.owner_id=$2 AND h.attempt_id=$3
     AND h.state='provisioning' AND h.expires_at>now()
     AND s.id=h.session_id AND s."userId"=h.owner_id AND s."expiresAt">now()
     RETURNING h.attempt_id`,
    [identity.sessionId, identity.ownerId, attemptId, sandboxName, ciphertext],
  );
  return result.rows.length === 1;
}

/** Internal only. Never serialize this result to a browser response. */
export async function readChatGPTHost(identity: Identity) {
  const result = await database().query(
    `SELECT h.attempt_id,h.sandbox_name,h.capability_ciphertext,h.expires_at
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
