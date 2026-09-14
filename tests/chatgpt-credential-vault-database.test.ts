import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("../src/lib/server/auth", () => ({ database: state.database }));

import {
  leaseChatGPTCredentialCache,
  readChatGPTCredentialCache,
  rememberChatGPTCredentialCache,
  revokeChatGPTCredentialConnection,
  saveChatGPTCredentialCache,
} from "../src/lib/server/chatgpt-credential-vault";

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
