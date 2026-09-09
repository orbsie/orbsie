// Uses connection-local temporary tables and rolls back. No persistent writes.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Client } from "pg";

if (!process.env.DATABASE_URL)
  throw Error("Set DATABASE_URL for temporary-table verification.");
const directory = await mkdtemp(resolve(".vercel/registry-probe-"));
const client = new Client({ connectionString: process.env.DATABASE_URL });
const originalSecret = process.env.BETTER_AUTH_SECRET;
try {
  const outfile = join(directory, "registry.mjs");
  await build({
    entryPoints: ["src/lib/server/chatgpt-host-registry.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    plugins: [
      {
        name: "temporary-database",
        setup(api) {
          api.onResolve({ filter: /^\.\/auth$/ }, () => ({
            path: "auth",
            namespace: "test-db",
          }));
          api.onLoad({ filter: /.*/, namespace: "test-db" }, () => ({
            contents:
              "export const database=()=>globalThis.__orbsieRegistryDb; export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }",
            loader: "js",
          }));
        },
      },
    ],
  });
  await client.connect();
  await client.query("BEGIN");
  await client.query(
    'CREATE TEMP TABLE "user" (id text PRIMARY KEY); CREATE TEMP TABLE "session" (id text PRIMARY KEY, "userId" text, "expiresAt" timestamptz);',
  );
  const schema = (
    await readFile("scripts/chatgpt-host-schema.sql", "utf8")
  ).replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE");
  await client.query(schema);
  await client.query(
    `INSERT INTO "user" VALUES ('alice'),('bob'); INSERT INTO "session" VALUES ('alice-session','alice',now()+interval '1 hour');`,
  );
  globalThis.__orbsieRegistryDb = client;
  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
  const registry = await import(pathToFileURL(outfile).href);
  const owner = { ownerId: "alice", sessionId: "alice-session" };
  const other = { ...owner, ownerId: "bob" };
  assert.equal(await registry.claimChatGPTHost(other), null);
  const claims = await Promise.all([
    registry.claimChatGPTHost(owner),
    registry.claimChatGPTHost(owner),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  const claim = claims.find(Boolean);
  const capability = randomBytes(32).toString("hex");
  assert.equal(
    await registry.completeChatGPTHost(
      other,
      claim.attemptId,
      "orbsie-chatgpt-test",
      capability,
    ),
    false,
  );
  assert.equal(
    await registry.completeChatGPTHost(
      owner,
      claim.attemptId,
      "orbsie-chatgpt-test",
      capability,
    ),
    true,
  );
  assert.equal(await registry.readChatGPTHost(other), null);
  assert.equal((await registry.readChatGPTHost(owner)).capability, capability);
  const stored = await client.query(
    "SELECT capability_ciphertext FROM chatgpt_hosts",
  );
  assert.ok(!stored.rows[0].capability_ciphertext.includes(capability));
  assert.equal(await registry.releaseChatGPTHost(owner, randomUUID()), false);
  assert.equal(
    await registry.releaseChatGPTHost(other, claim.attemptId),
    false,
  );
  await client.query(
    "UPDATE chatgpt_hosts SET expires_at=now()-interval '1 second'",
  );
  assert.equal(await registry.readChatGPTHost(owner), null);
  assert.equal(await registry.claimChatGPTHost(owner), null);
  assert.equal(await registry.readExpiredChatGPTHost(other), null);
  assert.deepEqual(await registry.readExpiredChatGPTHost(owner), {
    attemptId: claim.attemptId,
    sandboxName: `orbsie-chatgpt-${claim.attemptId}`,
  });
  assert.equal(await registry.releaseChatGPTHost(owner, claim.attemptId), true);
  assert.ok(await registry.claimChatGPTHost(owner));
  console.log(
    JSON.stringify(
      {
        passed: true,
        realPostgres: true,
        temporaryTablesOnly: true,
        ownerIsolation: true,
        duplicateClaimRejected: true,
        encryptedCapabilityRoundTrip: true,
        expiredHostRejected: true,
        staleReleaseRejected: true,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await client.query("ROLLBACK");
  } catch {}
  await client.end();
  delete globalThis.__orbsieRegistryDb;
  if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = originalSecret;
  await rm(directory, { recursive: true, force: true });
}
