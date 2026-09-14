import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { PoolClient } from "pg";
import { database, HttpError } from "./auth";

export const FREE_MODEL = "openai/gpt-5.6-luna";
export const TRIAL_LIMIT = 3;
const COOKIE = "orbsie_trial";
export function trialEnabled() {
  return !!(
    process.env.AI_GATEWAY_API_KEY_FREE &&
    process.env.DATABASE_URL &&
    process.env.BETTER_AUTH_SECRET
  );
}
function digest(value: string) {
  return createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(`orbsie-trial:${value}`)
    .digest("hex");
}
export function trialIdentity(request: Request) {
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const [candidate, signature] = (value ?? "").split(".");
  const valid =
    /^[0-9a-f-]{36}$/.test(candidate ?? "") &&
    /^[0-9a-f]{64}$/.test(signature ?? "") &&
    timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(digest(candidate), "hex"),
    );
  const id = valid ? candidate : randomUUID();
  const rawIP =
    process.env.VERCEL === "1"
      ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim()
      : "127.0.0.1";
  // Fail closed if the trusted deployment header is unavailable. Never use a client-selected identity header.
  if (!rawIP || !isIP(rawIP))
    throw new HttpError(
      503,
      "Free prompts are temporarily unavailable. Connect your provider to continue.",
    );
  const day = new Date().toISOString().slice(0, 10);
  const configured = Number(process.env.FREE_PROMPTS_DAILY_LIMIT ?? 100);
  const dailyLimit =
    Number.isSafeInteger(configured) && configured > 0 ? configured : 100;
  return {
    identityHash: digest(id),
    cookie: `${COOKIE}=${id}.${digest(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
    buckets: [
      { key: `visitor:${digest(id)}`, limit: TRIAL_LIMIT },
      { key: `network:${day}:${digest(rawIP)}`, limit: TRIAL_LIMIT },
      { key: `global:${day}`, limit: dailyLimit },
    ],
  };
}
// The legacy one-call API accepts the small test/adapter shape that predates
// the ledger. New authoring-run issuance always receives identityHash from the
// server-created value returned by trialIdentity.
export type TrialIdentity = Omit<
  ReturnType<typeof trialIdentity>,
  "identityHash"
> & {
  identityHash?: string;
};
export class TrialExhausted extends HttpError {
  constructor() {
    super(
      429,
      "Your free prompts are used. Connect a provider or join the Orbsie Plus waitlist.",
    );
  }
}
function assertGlobalUnits(globalUnits: number) {
  if (!Number.isSafeInteger(globalUnits) || globalUnits < 1 || globalUnits > 3)
    throw new RangeError("Global trial units must be an integer from 1 to 3.");
}
function remaining(
  identity: TrialIdentity,
  counts: Map<string, number>,
  globalUnits: number,
) {
  return Math.max(
    0,
    Math.min(
      ...identity.buckets.map((bucket) => {
        const available = bucket.limit - (counts.get(bucket.key) ?? 0);
        return bucket.key.startsWith("global:")
          ? Math.floor(available / globalUnits)
          : available;
      }),
    ),
  );
}
export async function trialRemaining(identity: TrialIdentity, globalUnits = 1) {
  assertGlobalUnits(globalUnits);
  const result = await database().query<{ bucket: string; used: number }>(
    "SELECT bucket, used FROM orbsie_trial_usage WHERE bucket = ANY($1::text[])",
    [identity.buckets.map((b) => b.key)],
  );
  const counts = new Map(result.rows.map((row) => [row.bucket, row.used]));
  return remaining(identity, counts, globalUnits);
}
/**
 * Claim the legacy visitor/network buckets using a caller-owned transaction.
 * Global inference units are deliberately separate from prompt units: a free
 * authoring run charges one visitor and network prompt while reserving up to
 * three units from the shared daily ceiling.
 */
export async function claimTrialInTransaction(
  client: PoolClient,
  identity: TrialIdentity,
  globalUnits = 1,
) {
  assertGlobalUnits(globalUnits);
  // Every caller takes locks in the same order, including the daily shared-spend ceiling.
  const buckets = [...identity.buckets].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  for (const bucket of buckets) {
    await client.query(
      "INSERT INTO orbsie_trial_usage(bucket) VALUES ($1) ON CONFLICT DO NOTHING",
      [bucket.key],
    );
    const result = await client.query<{ used: number }>(
      "SELECT used FROM orbsie_trial_usage WHERE bucket=$1 FOR UPDATE",
      [bucket.key],
    );
    const increment = bucket.key.startsWith("global:") ? globalUnits : 1;
    if (!result.rows[0] || result.rows[0].used + increment > bucket.limit)
      throw new TrialExhausted();
  }
  const updated = await client.query<{ bucket: string; used: number }>(
    "UPDATE orbsie_trial_usage SET used=used+CASE WHEN bucket LIKE 'global:%' THEN $2 ELSE 1 END, updated_at=now() WHERE bucket = ANY($1::text[]) RETURNING bucket, used",
    [buckets.map((b) => b.key), globalUnits],
  );
  const counts = new Map(updated.rows.map((row) => [row.bucket, row.used]));
  return remaining(identity, counts, globalUnits);
}
export async function withDatabaseTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
  options: {
    signal?: AbortSignal;
    lockTimeoutMs?: number;
    statementTimeoutMs?: number;
    acquireTimeoutMs?: number;
  } = {},
) {
  const timeouts = validateTransactionTimeouts(options);
  const clientPromise = database().connect();
  const client = await acquireDatabaseClient(clientPromise, {
    signal: options.signal,
    acquireTimeoutMs: timeouts.acquireTimeoutMs,
  });
  let releaseError: Error | undefined;
  try {
    await client.query("BEGIN");
    if (timeouts.lockTimeoutMs !== undefined)
      await client.query(
        `SET LOCAL lock_timeout = '${timeouts.lockTimeoutMs}ms'`,
      );
    if (timeouts.statementTimeoutMs !== undefined)
      await client.query(
        `SET LOCAL statement_timeout = '${timeouts.statementTimeoutMs}ms'`,
      );
    if (options.signal?.aborted)
      throw options.signal.reason ?? Error("Transaction cancelled.");
    const result = await work(client);
    if (options.signal?.aborted)
      throw options.signal.reason ?? Error("Transaction cancelled.");
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      releaseError =
        rollbackError instanceof Error
          ? rollbackError
          : Error("Database transaction rollback failed.");
    }
    throw error;
  } finally {
    // A client that could not roll back may still hold an open transaction;
    // evict it instead of returning it to the pool for another request.
    client.release(releaseError);
  }
}

async function acquireDatabaseClient(
  clientPromise: Promise<PoolClient>,
  options: {
    signal?: AbortSignal;
    acquireTimeoutMs?: number;
  },
) {
  const pending = clientPromise;
  const boundedAcquire =
    options.acquireTimeoutMs === undefined
      ? undefined
      : boundedTimeout(options.acquireTimeoutMs);
  if (options.signal?.aborted) {
    void pending.then((client) => client.release()).catch(() => undefined);
    throw options.signal.reason ?? Error("Transaction cancelled.");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbort: (() => void) | undefined;
  const guards: Promise<never>[] = [];
  if (boundedAcquire !== undefined)
    guards.push(
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Database connection acquisition timed out.")),
          boundedAcquire,
        );
      }),
    );
  if (options.signal) {
    guards.push(
      new Promise<never>((_, reject) => {
        const abort = () =>
          reject(options.signal!.reason ?? Error("Transaction cancelled."));
        if (options.signal!.aborted) abort();
        else {
          options.signal!.addEventListener("abort", abort, { once: true });
          removeAbort = () =>
            options.signal!.removeEventListener("abort", abort);
        }
      }),
    );
  }
  try {
    return await Promise.race([pending, ...guards]);
  } catch (error) {
    // The guard may lose the race to a client that has already resolved but
    // whose result was never returned. Consume that result and release it in
    // every rejected acquisition path, including pre-aborted signals.
    void pending.then((client) => client.release()).catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    removeAbort?.();
  }
}

function validateTransactionTimeouts(options: {
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  acquireTimeoutMs?: number;
}) {
  return {
    lockTimeoutMs:
      options.lockTimeoutMs === undefined
        ? undefined
        : boundedTimeout(options.lockTimeoutMs),
    statementTimeoutMs:
      options.statementTimeoutMs === undefined
        ? undefined
        : boundedTimeout(options.statementTimeoutMs),
    acquireTimeoutMs:
      options.acquireTimeoutMs === undefined
        ? undefined
        : boundedTimeout(options.acquireTimeoutMs),
  };
}

function boundedTimeout(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 60_000)
    throw new RangeError("Database transaction timeout is invalid.");
  return value;
}
export async function claimTrial(identity: TrialIdentity) {
  return withDatabaseTransaction((client) =>
    claimTrialInTransaction(client, identity, 1),
  );
}
/** Clear visitor/network usage rows last claimed within the fixed 5-minute window. */
export async function resetRecentTrialUsage() {
  return withDatabaseTransaction(async (client) => {
    const result = await client.query<{ bucket: string }>(
      "DELETE FROM orbsie_trial_usage WHERE (bucket LIKE 'visitor:%' OR bucket LIKE 'network:%') AND updated_at >= now() - interval '5 minutes' RETURNING bucket",
    );
    const cleared = result.rows.map((row) => row.bucket);
    return {
      cleared: cleared.length,
      visitors: cleared.filter((bucket) => bucket.startsWith("visitor:"))
        .length,
      networks: cleared.filter((bucket) => bucket.startsWith("network:"))
        .length,
    };
  });
}
