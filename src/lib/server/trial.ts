import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
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
    cookie: `${COOKIE}=${id}.${digest(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
    buckets: [
      { key: `visitor:${digest(id)}`, limit: TRIAL_LIMIT },
      { key: `network:${day}:${digest(rawIP)}`, limit: TRIAL_LIMIT },
      { key: `global:${day}`, limit: dailyLimit },
    ],
  };
}
export type TrialIdentity = ReturnType<typeof trialIdentity>;
export class TrialExhausted extends HttpError {
  constructor() {
    super(
      429,
      "Your free prompts are used. Connect a provider or join the Orbsie Plus waitlist.",
    );
  }
}
export async function trialRemaining(identity: TrialIdentity) {
  const result = await database().query<{ bucket: string; used: number }>(
    "SELECT bucket, used FROM orbsie_trial_usage WHERE bucket = ANY($1::text[])",
    [identity.buckets.map((b) => b.key)],
  );
  const counts = new Map(result.rows.map((row) => [row.bucket, row.used]));
  return Math.max(
    0,
    Math.min(
      ...identity.buckets.map((b) => b.limit - (counts.get(b.key) ?? 0)),
    ),
  );
}
export async function claimTrial(identity: TrialIdentity) {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
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
      if (result.rows[0].used >= bucket.limit) throw new TrialExhausted();
    }
    const updated = await client.query<{ bucket: string; used: number }>(
      "UPDATE orbsie_trial_usage SET used=used+1, updated_at=now() WHERE bucket = ANY($1::text[]) RETURNING bucket, used",
      [buckets.map((b) => b.key)],
    );
    await client.query("COMMIT");
    const counts = new Map(updated.rows.map((row) => [row.bucket, row.used]));
    return Math.max(
      0,
      Math.min(...buckets.map((b) => b.limit - counts.get(b.key)!)),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
/** Clear visitor/network usage rows last claimed within the fixed 5-minute window. */
export async function resetRecentTrialUsage() {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ bucket: string }>(
      "DELETE FROM orbsie_trial_usage WHERE (bucket LIKE 'visitor:%' OR bucket LIKE 'network:%') AND updated_at >= now() - interval '5 minutes' RETURNING bucket",
    );
    await client.query("COMMIT");
    const cleared = result.rows.map((row) => row.bucket);
    return {
      cleared: cleared.length,
      visitors: cleared.filter((bucket) => bucket.startsWith("visitor:"))
        .length,
      networks: cleared.filter((bucket) => bucket.startsWith("network:"))
        .length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
