import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("../src/lib/server/auth", () => ({ database: state.database }));

import {
  beginChatGPTCredentialIntent,
  CHATGPT_CREDENTIAL_INTENT_RESERVATION_STALE_MS,
  openChatGPTCredentialCache,
  bindChatGPTCredentialIntentHost,
  leaseChatGPTCredentialCache,
  readChatGPTCredentialCache,
  rememberChatGPTCredentialCache,
  revokeChatGPTCredentialAuthorityAndCaptureHosts,
  revokeChatGPTCredentialAuthority,
  revokeChatGPTCredentialConnection,
  saveChatGPTCredentialCache,
  withChatGPTCredentialLeaseAdmission,
} from "../src/lib/server/chatgpt-credential-vault";
import { createChatGPTDurableService } from "../src/lib/server/chatgpt-durable-service";
import { readChatGPTHost } from "../src/lib/server/chatgpt-host-registry";

const runDatabaseTest =
  process.env.RUN_CHATGPT_CREDENTIAL_VAULT_DATABASE === "1";

function waitForPoolCapacity(pool: Pool) {
  const deadline = Date.now() + 2_000;
  return new Promise<void>((resolve, reject) => {
    const check = () => {
      if (pool.totalCount >= 2) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("The vault pool did not open independent clients."));
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}

async function waitForDatabaseLock(setup: Pool, pids: number[]): Promise<void> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    const result = await setup.query<{ wait_event_type: string | null }>(
      `SELECT wait_event_type FROM pg_stat_activity WHERE pid=ANY($1::int[])`,
      [pids],
    );
    if (result.rows.some((row) => row.wait_event_type === "Lock")) return;
    if (Date.now() >= deadline)
      throw new Error("The vault transaction did not reach the row lock.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function insertWithRequiredSchemaValues(
  pool: Pool,
  table: "user" | "session",
  values: Record<string, unknown>,
) {
  const columns = await pool.query<{
    column_name: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `SELECT column_name,is_nullable,column_default
     FROM information_schema.columns
     WHERE table_schema=current_schema() AND table_name=$1
     ORDER BY ordinal_position`,
    [table],
  );
  const required = columns.rows.filter(
    (column) => column.is_nullable === "NO" && !column.column_default,
  );
  if (required.some((column) => !(column.column_name in values)))
    throw Error(
      "The synthetic ChatGPT fixture does not cover the required schema.",
    );
  const names = required.map((column) => {
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(column.column_name))
      throw Error(
        "The synthetic ChatGPT fixture found an invalid column name.",
      );
    return `"${column.column_name}"`;
  });
  await pool.query(
    `INSERT INTO "${table}"(${names.join(",")}) VALUES (${required
      .map((_, index) => `$${index + 1}`)
      .join(",")})`,
    required.map((column) => values[column.column_name]),
  );
}

it.runIf(runDatabaseTest)(
  "reclaims only an aged unbound reservation with no current owner authority",
  async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw Error("DATABASE_URL is required for this test.");
    const setup = new Pool({ connectionString: databaseUrl, max: 4 });
    const realPool = new Pool({ connectionString: databaseUrl, max: 4 });
    state.database.mockReturnValue(realPool);
    const ownerId = `orphan-reservation-${randomUUID()}`;
    const sessionId = `orphan-session-${randomUUID()}`;
    const actor = { ownerId, sessionId };
    const nextAttemptId = randomUUID();
    const nextHost = {
      attemptId: nextAttemptId,
      sandboxName: `orbsie-chatgpt-${nextAttemptId}`,
      capability: "synthetic-capability",
      artifactDigest: "a".repeat(64),
      expiresAt: new Date(Date.now() + 600_000),
    };
    const manager = {
      ensure: vi.fn(async () => nextHost),
      request: vi.fn(async () =>
        Response.json({ lifecycle: "idle", authStatus: "disconnected" }),
      ),
      privateOperation: vi.fn(async () => Response.json({})),
      disconnect: vi.fn(async () => true),
      captureOwnerHosts: vi.fn(async () => []),
      read: vi.fn(async () => nextHost),
    };
    try {
      await setup.query(
        `CREATE TABLE IF NOT EXISTS "user" (id text PRIMARY KEY)`,
      );
      await setup.query(
        `CREATE TABLE IF NOT EXISTS "session" (
           id text PRIMARY KEY,
           "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
           "expiresAt" timestamptz NOT NULL
         )`,
      );
      await setup.query(
        await readFile("scripts/chatgpt-credential-schema.sql", "utf8"),
      );
      await setup.query(
        await readFile("scripts/chatgpt-host-schema.sql", "utf8"),
      );
      const fixtureNow = new Date();
      await insertWithRequiredSchemaValues(setup, "user", {
        id: ownerId,
        name: "Orphan reservation fixture",
        email: `${ownerId}@example.test`,
        emailVerified: false,
        updatedAt: fixtureNow,
      });
      await insertWithRequiredSchemaValues(setup, "session", {
        id: sessionId,
        userId: ownerId,
        expiresAt: new Date(fixtureNow.getTime() + 60 * 60 * 1000),
        token: randomUUID(),
        updatedAt: fixtureNow,
      });
      await setup.query(
        `INSERT INTO chatgpt_credential_intents(owner_id,epoch,pending_attempt_id)
         VALUES ($1,7,'pending:7')`,
        [ownerId],
      );

      const service = createChatGPTDurableService({ manager });
      // A fresh placeholder is a live reservation, even when Start has not
      // bound a host yet. The service must not provision over it.
      await expect(service.start(actor)).rejects.toMatchObject({
        code: "login-pending",
      });
      expect(manager.ensure).not.toHaveBeenCalled();

      // Once old enough, a current owner claim still blocks replacement.
      await setup.query(
        `UPDATE chatgpt_credential_intents
         SET updated_at=clock_timestamp() - ($2::int * interval '1 millisecond')
         WHERE owner_id=$1`,
        [ownerId, CHATGPT_CREDENTIAL_INTENT_RESERVATION_STALE_MS + 1_000],
      );
      const claimedAttemptId = randomUUID();
      await setup.query(
        `INSERT INTO chatgpt_hosts
           (session_id,owner_id,attempt_id,state,expires_at)
         VALUES ($1,$2,$3,'provisioning',clock_timestamp()+interval '5 minutes')`,
        [sessionId, ownerId, claimedAttemptId],
      );
      await expect(service.start(actor)).rejects.toMatchObject({
        code: "login-pending",
      });
      expect(manager.ensure).not.toHaveBeenCalled();
      await setup.query(
        `DELETE FROM chatgpt_hosts WHERE owner_id=$1 AND attempt_id=$2`,
        [ownerId, claimedAttemptId],
      );

      // A remembered connection remains authoritative even when its intent
      // placeholder is stale; it is retained on the rejected restart.
      const remembered = await rememberChatGPTCredentialCache(
        actor,
        new TextEncoder().encode("remembered-before-orphan-recovery"),
      );
      await expect(service.start(actor)).rejects.toMatchObject({
        code: "active-connection",
      });
      expect(manager.ensure).not.toHaveBeenCalled();
      await expect(readChatGPTCredentialCache(actor)).resolves.toMatchObject({
        connectionId: remembered.connectionId,
        connectionVersion: 1,
      });

      await expect(
        revokeChatGPTCredentialConnection(actor, remembered.connectionId),
      ).resolves.toBe(true);
      await expect(service.start(actor)).resolves.toMatchObject({
        host: { attemptId: nextAttemptId },
        intent: { epoch: 8, pendingAttemptId: "pending:8" },
      });
      expect(manager.ensure).toHaveBeenCalledTimes(1);
      const persisted = await setup.query(
        `SELECT epoch,pending_attempt_id FROM chatgpt_credential_intents WHERE owner_id=$1`,
        [ownerId],
      );
      expect(persisted.rows).toEqual([
        { epoch: 8, pending_attempt_id: nextAttemptId },
      ]);
      await expect(
        rememberChatGPTCredentialCache(
          actor,
          new TextEncoder().encode("late-orphan-callback"),
          {
            expectedIntentEpoch: 7,
            expectedHostAttemptId: randomUUID(),
          },
        ),
      ).rejects.toMatchObject({ code: "unauthorized" });
    } finally {
      await setup
        .query(`DELETE FROM "user" WHERE id=$1`, [ownerId])
        .catch(() => undefined);
      await setup.end();
      await realPool.end();
    }
  },
  30_000,
);

it.runIf(runDatabaseTest)(
  "restarts an expired host intent at the database/service boundary and fences late saves",
  async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw Error("DATABASE_URL is required for this test.");
    const setup = new Pool({ connectionString: databaseUrl, max: 4 });
    const realPool = new Pool({ connectionString: databaseUrl, max: 4 });
    state.database.mockReturnValue(realPool);
    const ownerId = `expired-intent-${randomUUID()}`;
    const sessionId = `expired-session-${randomUUID()}`;
    const actor = { ownerId, sessionId };
    const previousAttemptId = randomUUID();
    const nextAttemptId = randomUUID();
    const nextHost = {
      attemptId: nextAttemptId,
      sandboxName: `orbsie-chatgpt-${nextAttemptId}`,
      capability: "synthetic-capability",
      artifactDigest: "a".repeat(64),
      expiresAt: new Date(Date.now() + 600_000),
    };
    let currentAttemptId = previousAttemptId;
    let statusCalls = 0;
    const manager = {
      ensure: vi.fn(async () => {
        currentAttemptId = nextAttemptId;
        return nextHost;
      }),
      request: vi.fn(async () => {
        statusCalls++;
        return Response.json(
          statusCalls === 1
            ? { lifecycle: "idle", authStatus: "disconnected" }
            : { lifecycle: "pending", authStatus: "unknown" },
        );
      }),
      privateOperation: vi.fn(async () => Response.json({})),
      disconnect: vi.fn(async (target: { sessionId: string }) => {
        if (target.sessionId === sessionId)
          await setup.query(
            `DELETE FROM chatgpt_hosts WHERE session_id=$1 AND owner_id=$2 AND attempt_id=$3`,
            [sessionId, ownerId, previousAttemptId],
          );
        return true;
      }),
      captureOwnerHosts: vi.fn(async () => [
        {
          ownerId,
          sessionId,
          attemptId: currentAttemptId,
          sandboxName: `orbsie-chatgpt-${currentAttemptId}`,
        },
      ]),
      read: vi.fn(async () =>
        currentAttemptId === nextAttemptId ? nextHost : null,
      ),
    };
    try {
      await setup.query(
        `CREATE TABLE IF NOT EXISTS "user" (id text PRIMARY KEY)`,
      );
      await setup.query(
        `CREATE TABLE IF NOT EXISTS "session" (
           id text PRIMARY KEY,
           "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
           "expiresAt" timestamptz NOT NULL
         )`,
      );
      await setup.query(
        await readFile("scripts/chatgpt-credential-schema.sql", "utf8"),
      );
      await setup.query(
        await readFile("scripts/chatgpt-host-schema.sql", "utf8"),
      );
      const fixtureNow = new Date();
      await insertWithRequiredSchemaValues(setup, "user", {
        id: ownerId,
        name: "Expired challenge fixture",
        email: `${ownerId}@example.test`,
        emailVerified: false,
        updatedAt: fixtureNow,
      });
      await insertWithRequiredSchemaValues(setup, "session", {
        id: sessionId,
        userId: ownerId,
        expiresAt: new Date(fixtureNow.getTime() + 60 * 60 * 1000),
        token: randomUUID(),
        updatedAt: fixtureNow,
      });
      await setup.query(
        `INSERT INTO chatgpt_credential_intents(owner_id,epoch,pending_attempt_id)
         VALUES ($1,7,$2)`,
        [ownerId, previousAttemptId],
      );
      await setup.query(
        `INSERT INTO chatgpt_hosts
           (session_id,owner_id,attempt_id,state,sandbox_name,capability_ciphertext,artifact_digest,expires_at)
         VALUES ($1,$2,$3,'ready',$4,'synthetic-capability',$5,clock_timestamp()-interval '1 second')`,
        [
          sessionId,
          ownerId,
          previousAttemptId,
          `orbsie-chatgpt-${previousAttemptId}`,
          "a".repeat(64),
        ],
      );

      const service = createChatGPTDurableService({ manager });
      expect(await readChatGPTHost(actor)).toBeNull();
      await expect(service.status(actor)).resolves.toBeNull();
      await expect(service.start(actor)).resolves.toMatchObject({
        host: { attemptId: nextAttemptId },
        intent: { epoch: 8, pendingAttemptId: "pending:8" },
      });
      expect(manager.ensure).toHaveBeenCalledTimes(1);
      expect(manager.disconnect).toHaveBeenCalledWith(actor);
      const intent = await setup.query(
        `SELECT epoch,pending_attempt_id FROM chatgpt_credential_intents WHERE owner_id=$1`,
        [ownerId],
      );
      expect(intent.rows).toEqual([
        { epoch: 8, pending_attempt_id: nextAttemptId },
      ]);
      await expect(service.start(actor)).rejects.toMatchObject({
        code: "login-pending",
      });
      expect(manager.ensure).toHaveBeenCalledTimes(1);
      expect(manager.disconnect).toHaveBeenCalledTimes(1);
      await expect(
        rememberChatGPTCredentialCache(
          actor,
          new TextEncoder().encode("late"),
          {
            expectedIntentEpoch: 7,
            expectedHostAttemptId: previousAttemptId,
          },
        ),
      ).rejects.toMatchObject({ code: "unauthorized" });

      await service.disconnect(actor);
      await expect(
        rememberChatGPTCredentialCache(
          actor,
          new TextEncoder().encode("late"),
          {
            expectedIntentEpoch: 8,
            expectedHostAttemptId: nextAttemptId,
          },
        ),
      ).rejects.toMatchObject({ code: "unauthorized" });
      const disconnected = await setup.query(
        `SELECT epoch,pending_attempt_id,revoked_at FROM chatgpt_credential_intents WHERE owner_id=$1`,
        [ownerId],
      );
      expect(disconnected.rows[0]).toMatchObject({
        epoch: 9,
        pending_attempt_id: null,
      });
      expect(disconnected.rows[0]?.revoked_at).not.toBeNull();

      const previousConnection = await rememberChatGPTCredentialCache(
        actor,
        new TextEncoder().encode("remembered-before-restart"),
      );
      currentAttemptId = previousAttemptId;
      await setup.query(
        `UPDATE chatgpt_credential_intents
         SET epoch=10,pending_attempt_id=$2,revoked_at=NULL WHERE owner_id=$1`,
        [ownerId, previousAttemptId],
      );
      await expect(service.start(actor)).rejects.toMatchObject({
        code: "active-connection",
      });
      expect(manager.ensure).toHaveBeenCalledTimes(1);
      expect(manager.disconnect).toHaveBeenCalledTimes(1);
      await expect(readChatGPTCredentialCache(actor)).resolves.toMatchObject({
        connectionId: previousConnection.connectionId,
        connectionVersion: 1,
      });
    } finally {
      await setup
        .query(`DELETE FROM "user" WHERE id=$1`, [ownerId])
        .catch(() => undefined);
      await setup.end();
      await realPool.end();
    }
  },
  30_000,
);

it.runIf(runDatabaseTest)(
  "serializes real refresh leases and fences revoke, expiry, and session races",
  async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw Error("DATABASE_URL is required for this test.");

    const setup = new Pool({ connectionString: databaseUrl, max: 4 });
    const realPool = new Pool({ connectionString: databaseUrl, max: 4 });
    const runtimeClients: PoolClient[] = [];
    realPool.on("connect", (client) => runtimeClients.push(client));
    state.database.mockReturnValue(realPool);

    const ownerId = `vault-test-${randomUUID()}`;
    const sessionId = `vault-session-${randomUUID()}`;
    const otherSessionId = `vault-other-session-${randomUUID()}`;
    const expiringSessionId = `vault-expiring-session-${randomUUID()}`;
    const testActor = { ownerId, sessionId };
    const otherActor = { ownerId, sessionId: otherSessionId };
    let locker: PoolClient | undefined;
    let lockHeld = false;
    let failureConstraint: string | undefined;
    try {
      await setup.query(
        `CREATE TABLE IF NOT EXISTS "user" (id text PRIMARY KEY)`,
      );
      await setup.query(
        `CREATE TABLE IF NOT EXISTS "session" (
           id text PRIMARY KEY,
           "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
           "expiresAt" timestamptz NOT NULL
         )`,
      );
      await setup.query(
        await readFile("scripts/chatgpt-credential-schema.sql", "utf8"),
      );
      await setup.query(
        await readFile("scripts/chatgpt-host-schema.sql", "utf8"),
      );
      await setup.query(`INSERT INTO "user"(id) VALUES ($1)`, [ownerId]);
      await setup.query(
        `INSERT INTO "session"(id,"userId","expiresAt")
         VALUES ($1,$2,clock_timestamp()+interval '1 hour'),
                ($3,$2,clock_timestamp()+interval '1 hour'),
                ($4,$2,clock_timestamp()+interval '1 hour')`,
        [sessionId, ownerId, otherSessionId, expiringSessionId],
      );

      const initial = new TextEncoder().encode("initial-cache");
      const connection = await rememberChatGPTCredentialCache(
        testActor,
        initial,
      );
      const stored = await setup.query<{
        ciphertext: string;
        lease_epoch: number;
        lease_id: string | null;
      }>(
        `SELECT ciphertext,lease_epoch,lease_id
         FROM chatgpt_credential_vault WHERE connection_id=$1`,
        [connection.connectionId],
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]?.ciphertext).not.toContain("initial-cache");
      expect(stored.rows[0]?.lease_epoch).toBe(0);
      expect(stored.rows[0]?.lease_id).toBeNull();
      expect(await readChatGPTCredentialCache(testActor)).toMatchObject({
        connectionId: connection.connectionId,
        connectionVersion: 1,
      });

      // Hold the connection row so both real transactions must be checked out
      // and wait independently before one commits the fenced lease.
      locker = await setup.connect();
      await locker.query("BEGIN");
      await locker.query(
        `SELECT id FROM chatgpt_credential_connections WHERE id=$1 FOR UPDATE`,
        [connection.connectionId],
      );
      lockHeld = true;
      const leasePromise = Promise.all([
        leaseChatGPTCredentialCache(testActor, connection.connectionId),
        leaseChatGPTCredentialCache(otherActor, connection.connectionId),
      ]);
      await waitForPoolCapacity(realPool);
      expect(realPool.idleCount).toBe(0);
      await locker.query("COMMIT");
      lockHeld = false;
      const leases = await leasePromise;
      expect(leases.map((value) => value.kind).sort()).toEqual([
        "busy",
        "leased",
      ]);
      const backendPids = await Promise.all(
        runtimeClients.map(async (client) => {
          const result = await client.query<{ pid: number }>(
            "SELECT pg_backend_pid() AS pid",
          );
          return Number(result.rows[0]?.pid);
        }),
      );
      expect(new Set(backendPids).size).toBeGreaterThanOrEqual(2);

      const actualLeaseRow = await setup.query<{
        ciphertext: string;
        lease_epoch: number;
        lease_id: string | null;
      }>(
        `SELECT ciphertext,lease_epoch,lease_id
         FROM chatgpt_credential_vault WHERE connection_id=$1`,
        [connection.connectionId],
      );
      expect(actualLeaseRow.rows[0]?.lease_epoch).toBe(1);
      expect(actualLeaseRow.rows[0]?.lease_id).not.toBeNull();
      const leased = leases.find((value) => value.kind === "leased");
      if (!leased || leased.kind !== "leased") throw Error("expected lease");

      expect(
        await revokeChatGPTCredentialConnection(
          testActor,
          connection.connectionId,
        ),
      ).toBe(true);
      expect(
        await saveChatGPTCredentialCache(
          otherActor,
          leased.lease,
          new TextEncoder().encode("late-refresh"),
        ),
      ).toEqual({ kind: "missing" });
      const revoked = await setup.query<{
        revoked_at: Date;
        connection_version: number;
      }>(
        `SELECT revoked_at,connection_version
         FROM chatgpt_credential_connections WHERE id=$1`,
        [connection.connectionId],
      );
      expect(revoked.rows[0]?.revoked_at).not.toBeNull();
      expect(revoked.rows[0]?.connection_version).toBeGreaterThan(1);
      const deletedVault = await setup.query(
        `SELECT 1 FROM chatgpt_credential_vault WHERE connection_id=$1`,
        [connection.connectionId],
      );
      expect(deletedVault.rows).toEqual([]);

      // An expired active row is tombstoned atomically so a new remember can
      // replace it without waiting for an unrelated cleanup job.
      const expiring = await rememberChatGPTCredentialCache(
        testActor,
        new TextEncoder().encode("expiring-cache"),
      );
      await setup.query(
        `UPDATE chatgpt_credential_connections
         SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,
        [expiring.connectionId],
      );
      const replacement = await rememberChatGPTCredentialCache(
        testActor,
        new TextEncoder().encode("replacement-cache"),
      );
      expect(replacement.connectionId).not.toBe(expiring.connectionId);
      expect(
        await saveChatGPTCredentialCache(
          otherActor,
          leased.lease,
          new TextEncoder().encode("late-after-reconnect"),
        ),
      ).toEqual({ kind: "missing" });
      const replacementCiphertext = await setup.query<{ ciphertext: string }>(
        `SELECT ciphertext FROM chatgpt_credential_vault WHERE connection_id=$1`,
        [replacement.connectionId],
      );
      expect(replacementCiphertext.rows[0]?.ciphertext).not.toContain(
        "late-after-reconnect",
      );

      // Hold the connection lock while a session with a short remaining
      // lifetime waits. The operation must re-read the session expiry after
      // the wait and roll back without changing the lease or ciphertext.
      await setup.query(
        `UPDATE "session" SET "expiresAt"=clock_timestamp()+interval '500 milliseconds'
         WHERE id=$1`,
        [expiringSessionId],
      );
      await locker.query("BEGIN");
      await locker.query(
        `SELECT id FROM chatgpt_credential_connections WHERE id=$1 FOR UPDATE`,
        [replacement.connectionId],
      );
      lockHeld = true;
      const waitingLease = leaseChatGPTCredentialCache(
        { ownerId, sessionId: expiringSessionId },
        replacement.connectionId,
      );
      await waitForDatabaseLock(setup, backendPids);
      const beforeExpiredWait = await setup.query<{
        ciphertext: string;
        lease_epoch: number;
        lease_id: string | null;
      }>(
        `SELECT v.ciphertext,v.lease_epoch,v.lease_id
         FROM chatgpt_credential_vault v WHERE v.connection_id=$1`,
        [replacement.connectionId],
      );
      await new Promise((resolve) => setTimeout(resolve, 600));
      await locker.query("COMMIT");
      lockHeld = false;
      await expect(waitingLease).rejects.toMatchObject({
        code: "unauthorized",
      });
      const afterExpiredWait = await setup.query<{
        ciphertext: string;
        lease_epoch: number;
        lease_id: string | null;
      }>(
        `SELECT v.ciphertext,v.lease_epoch,v.lease_id
         FROM chatgpt_credential_vault v WHERE v.connection_id=$1`,
        [replacement.connectionId],
      );
      expect(afterExpiredWait.rows).toEqual(beforeExpiredWait.rows);

      await setup.query(`DELETE FROM "session" WHERE id=$1`, [
        expiringSessionId,
      ]);
      await expect(
        readChatGPTCredentialCache({ ownerId, sessionId: expiringSessionId }),
      ).rejects.toMatchObject({ code: "unauthorized" });

      await revokeChatGPTCredentialConnection(
        testActor,
        replacement.connectionId,
      );
      failureConstraint = `chatgpt_vault_test_reject_${randomUUID().replaceAll(
        "-",
        "",
      )}`;
      await setup.query(
        `ALTER TABLE chatgpt_credential_vault
         ADD CONSTRAINT "${failureConstraint}" CHECK (false) NOT VALID`,
      );
      await expect(
        rememberChatGPTCredentialCache(
          testActor,
          new TextEncoder().encode("rollback-cache"),
        ),
      ).rejects.toThrow();
      await setup.query(
        `ALTER TABLE chatgpt_credential_vault
         DROP CONSTRAINT "${failureConstraint}"`,
      );
      failureConstraint = undefined;
      const orphanedConnections = await setup.query(
        `SELECT id FROM chatgpt_credential_connections
         WHERE owner_id=$1 AND revoked_at IS NULL`,
        [ownerId],
      );
      expect(orphanedConnections.rows).toEqual([]);
      const orphanedVault = await setup.query(
        `SELECT connection_id FROM chatgpt_credential_vault
         WHERE owner_id=$1`,
        [ownerId],
      );
      expect(orphanedVault.rows).toEqual([]);
      const recovered = await rememberChatGPTCredentialCache(
        testActor,
        new TextEncoder().encode("recovered-cache"),
      );
      expect(recovered.connectionId).toBeTruthy();
    } finally {
      if (failureConstraint)
        await setup
          .query(
            `ALTER TABLE chatgpt_credential_vault
             DROP CONSTRAINT IF EXISTS "${failureConstraint}"`,
          )
          .catch(() => undefined);
      if (lockHeld && locker)
        await locker.query("ROLLBACK").catch(() => undefined);
      locker?.release();
      await setup
        .query(`DELETE FROM chatgpt_credential_connections WHERE owner_id=$1`, [
          ownerId,
        ])
        .catch(() => undefined);
      await setup
        .query(`DELETE FROM "session" WHERE "userId"=$1`, [ownerId])
        .catch(() => undefined);
      await setup
        .query(`DELETE FROM "user" WHERE id=$1`, [ownerId])
        .catch(() => undefined);
      await setup.end();
      await realPool.end();
    }
  },
  30_000,
);

it.runIf(runDatabaseTest)(
  "fences concurrent initial login remember against disconnect and preserves the tombstone",
  async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw Error("DATABASE_URL is required for this test.");
    const setup = new Pool({ connectionString: databaseUrl, max: 4 });
    const realPool = new Pool({ connectionString: databaseUrl, max: 4 });
    state.database.mockReturnValue(realPool);
    const ownerId = `intent-test-${randomUUID()}`;
    const freshOwnerId = `intent-fresh-${randomUUID()}`;
    const firstSession = `intent-session-${randomUUID()}`;
    const secondSession = `intent-other-${randomUUID()}`;
    const actor = { ownerId, sessionId: firstSession };
    try {
      await setup.query(
        `CREATE TABLE IF NOT EXISTS "user" (id text PRIMARY KEY)`,
      );
      await setup.query(
        `CREATE TABLE IF NOT EXISTS "session" (
           id text PRIMARY KEY,
           "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
           "expiresAt" timestamptz NOT NULL
         )`,
      );
      await setup.query(
        await readFile("scripts/chatgpt-credential-schema.sql", "utf8"),
      );
      await setup.query(
        await readFile("scripts/chatgpt-host-schema.sql", "utf8"),
      );
      await setup.query(`INSERT INTO "user"(id) VALUES ($1)`, [ownerId]);
      await setup.query(`INSERT INTO "user"(id) VALUES ($1)`, [freshOwnerId]);
      await setup.query(
        `INSERT INTO "session"(id,"userId","expiresAt")
         VALUES ($1,$3,clock_timestamp()+interval '1 hour'),
                ($2,$3,clock_timestamp()+interval '1 hour')`,
        [firstSession, secondSession, ownerId],
      );
      const results = await Promise.allSettled([
        beginChatGPTCredentialIntent(actor),
        beginChatGPTCredentialIntent({ ownerId, sessionId: secondSession }),
      ]);
      const admitted = results.filter(
        (
          result,
        ): result is PromiseFulfilledResult<{
          epoch: number;
          pendingAttemptId: string | null;
        }> => result.status === "fulfilled",
      );
      expect(admitted).toHaveLength(1);
      const rejected = results.filter((result) => result.status === "rejected");
      expect(rejected).toHaveLength(1);
      await bindChatGPTCredentialIntentHost(
        actor,
        admitted[0]!.value.epoch,
        "attempt-race",
      );

      const remember = rememberChatGPTCredentialCache(
        actor,
        new TextEncoder().encode("race-cache"),
        {
          expectedIntentEpoch: admitted[0]!.value.epoch,
          expectedHostAttemptId: "attempt-race",
        },
      );
      const disconnectActor = { ownerId, sessionId: secondSession };
      const disconnect = revokeChatGPTCredentialAuthority(disconnectActor);
      const race = await Promise.allSettled([remember, disconnect]);
      expect(race[1]).toMatchObject({ status: "fulfilled" });
      const active = await setup.query(
        `SELECT id FROM chatgpt_credential_connections
         WHERE owner_id=$1 AND revoked_at IS NULL`,
        [ownerId],
      );
      expect(active.rows).toEqual([]);
      const stored = await setup.query(
        `SELECT v.connection_id FROM chatgpt_credential_vault v
         JOIN chatgpt_credential_connections c ON c.id=v.connection_id
         WHERE c.owner_id=$1`,
        [ownerId],
      );
      expect(stored.rows).toEqual([]);
      const intent = await setup.query<{
        epoch: number;
        revoked_at: Date | null;
      }>(
        `SELECT epoch,revoked_at FROM chatgpt_credential_intents WHERE owner_id=$1`,
        [ownerId],
      );
      expect(intent.rows[0]?.epoch).toBeGreaterThan(admitted[0]!.value.epoch);
      expect(intent.rows[0]?.revoked_at).not.toBeNull();
      // An explicit new Start can issue a later epoch, while restore/status
      // never creates one implicitly from the tombstone.
      const next = await beginChatGPTCredentialIntent(actor);
      expect(next.epoch).toBeGreaterThan(admitted[0]!.value.epoch);
      const freshSessionId = `intent-fresh-session-${randomUUID()}`;
      await setup.query(
        `INSERT INTO "session"(id,"userId","expiresAt")
         VALUES ($1,$2,clock_timestamp()+interval '1 hour')`,
        [freshSessionId, freshOwnerId],
      );
      const freshActor = { ownerId: freshOwnerId, sessionId: freshSessionId };
      await expect(revokeChatGPTCredentialAuthority(freshActor)).resolves.toBe(
        false,
      );
      await expect(
        beginChatGPTCredentialIntent(freshActor),
      ).resolves.toMatchObject({ epoch: 2 });
    } finally {
      await setup
        .query(`DELETE FROM "user" WHERE id=$1`, [ownerId])
        .catch(() => undefined);
      await setup
        .query(`DELETE FROM "user" WHERE id=$1`, [freshOwnerId])
        .catch(() => undefined);
      await setup.end();
      await realPool.end();
    }
  },
  30_000,
);

it.runIf(runDatabaseTest)(
  "serializes runtime admission with disconnect in both orderings",
  async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw Error("DATABASE_URL is required for this test.");
    const setup = new Pool({ connectionString: databaseUrl, max: 4 });
    const realPool = new Pool({ connectionString: databaseUrl, max: 4 });
    state.database.mockReturnValue(realPool);
    const ownerId = `admission-test-${randomUUID()}`;
    const firstSession = `admission-session-${randomUUID()}`;
    const secondSession = `admission-other-${randomUUID()}`;
    const firstActor = { ownerId, sessionId: firstSession };
    const secondActor = { ownerId, sessionId: secondSession };
    try {
      await setup.query(
        `CREATE TABLE IF NOT EXISTS "user" (id text PRIMARY KEY)`,
      );
      await setup.query(
        `CREATE TABLE IF NOT EXISTS "session" (
           id text PRIMARY KEY,
           "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
           "expiresAt" timestamptz NOT NULL
         )`,
      );
      await setup.query(
        await readFile("scripts/chatgpt-credential-schema.sql", "utf8"),
      );
      await setup.query(
        await readFile("scripts/chatgpt-host-schema.sql", "utf8"),
      );
      await setup.query(`INSERT INTO "user"(id) VALUES ($1)`, [ownerId]);
      await setup.query(
        `INSERT INTO "session"(id,"userId","expiresAt")
         VALUES ($1,$3,clock_timestamp()+interval '1 hour'),
                ($2,$3,clock_timestamp()+interval '1 hour')`,
        [firstSession, secondSession, ownerId],
      );
      const capturedAttemptId = randomUUID();
      await setup.query(
        `INSERT INTO chatgpt_hosts
         (session_id,owner_id,attempt_id,state,sandbox_name,capability_ciphertext,expires_at)
         VALUES ($1,$2,$3,'ready',$4,'synthetic-capability',clock_timestamp()+interval '1 hour')`,
        [
          secondSession,
          ownerId,
          capturedAttemptId,
          `orbsie-chatgpt-${capturedAttemptId}`,
        ],
      );

      const connection = await rememberChatGPTCredentialCache(
        firstActor,
        new TextEncoder().encode("admission-cache"),
      );
      const leased = await leaseChatGPTCredentialCache(
        firstActor,
        connection.connectionId,
      );
      if (leased.kind !== "leased") throw Error("expected an admission lease");

      // Verify real pg cancellation during a blocked save, not only a fake
      // client's release callback: the aborted transaction must never commit.
      const pid = await realPool.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const locker = await setup.connect();
      try {
        await locker.query("BEGIN");
        await locker.query('SELECT id FROM "session" WHERE id=$1 FOR UPDATE', [
          firstSession,
        ]);
        const controller = new AbortController();
        const saving = saveChatGPTCredentialCache(
          firstActor,
          leased.lease,
          new TextEncoder().encode("must-not-be-saved"),
          { signal: controller.signal },
        );
        const rejectedSave = expect(saving).rejects.toBeDefined();
        await waitForDatabaseLock(setup, [pid.rows[0]!.pid]);
        controller.abort();
        await rejectedSave;
        await locker.query("ROLLBACK");
        const stored = await setup.query<{ ciphertext: string }>(
          "SELECT ciphertext FROM chatgpt_credential_vault WHERE connection_id=$1",
          [connection.connectionId],
        );
        expect(
          Buffer.from(
            openChatGPTCredentialCache(stored.rows[0]!.ciphertext, {
              ownerId,
              connectionId: connection.connectionId,
              connectionVersion: connection.connectionVersion,
            }),
          ).toString(),
        ).toBe("admission-cache");
      } finally {
        await locker.query("ROLLBACK").catch(() => undefined);
        locker.release();
      }

      const started = deferred<void>();
      const release = deferred<void>();
      const admission = withChatGPTCredentialLeaseAdmission(
        firstActor,
        leased.lease,
        async () => {
          started.resolve();
          await release.promise;
          return "runtime-started";
        },
      );
      await started.promise;

      let disconnectSettled = false;
      const disconnect = revokeChatGPTCredentialAuthorityAndCaptureHosts(
        secondActor,
      ).then((value) => {
        disconnectSettled = true;
        return value;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(disconnectSettled).toBe(false);
      release.resolve();
      await expect(admission).resolves.toEqual({
        kind: "admitted",
        value: "runtime-started",
      });
      await expect(disconnect).resolves.toMatchObject({
        revoked: true,
        hosts: [
          expect.objectContaining({
            sessionId: secondSession,
            attemptId: capturedAttemptId,
            sandboxName: `orbsie-chatgpt-${capturedAttemptId}`,
          }),
        ],
      });

      // A stale lease obtained before a completed Disconnect cannot admit a
      // new refresh-capable runtime. Start creates a new fenced epoch first.
      const next = await beginChatGPTCredentialIntent(firstActor);
      await bindChatGPTCredentialIntentHost(
        firstActor,
        next.epoch,
        "admission-next",
      );
      const nextConnection = await rememberChatGPTCredentialCache(
        firstActor,
        new TextEncoder().encode("next-cache"),
        {
          expectedIntentEpoch: next.epoch,
          expectedHostAttemptId: "admission-next",
        },
      );
      const staleLease = await leaseChatGPTCredentialCache(
        firstActor,
        nextConnection.connectionId,
      );
      if (staleLease.kind !== "leased") throw Error("expected next lease");
      await expect(
        revokeChatGPTCredentialAuthorityAndCaptureHosts(secondActor),
      ).resolves.toMatchObject({ revoked: true });
      let calledAfterDisconnect = false;
      await expect(
        withChatGPTCredentialLeaseAdmission(
          firstActor,
          staleLease.lease,
          async () => {
            calledAfterDisconnect = true;
            return "must-not-start";
          },
        ),
      ).resolves.toEqual({ kind: "missing" });
      expect(calledAfterDisconnect).toBe(false);
    } finally {
      await setup
        .query(`DELETE FROM "user" WHERE id=$1`, [ownerId])
        .catch(() => undefined);
      await setup.end();
      await realPool.end();
    }
  },
  30_000,
);
