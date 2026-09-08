import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { database, HttpError } from "./auth";
import { waitlistEmail, type ConfirmationEmail } from "./waitlist-email";

export function normalizeWaitlistEmail(value: unknown): string {
  const parsed = z.string().trim().max(254).email().safeParse(value);
  if (!parsed.success) throw new HttpError(400, "Enter a valid email address.");
  return parsed.data.toLowerCase();
}
export function waitlistIpHash(request: Request): string {
  const secret =
    process.env.WAITLIST_RATE_LIMIT_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!secret)
    throw new HttpError(
      503,
      "The waitlist is temporarily unavailable. Please try again later.",
    );
  // Vercel supplies this header. Never trust a caller-supplied forwarding header
  // on a different host; those installations share the conservative unknown bucket.
  const forwarded =
    process.env.VERCEL === "1"
      ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
      : undefined;
  const ip = forwarded && isIP(forwarded) ? forwarded : "unknown";
  return createHmac("sha256", secret).update(`waitlist:${ip}`).digest("hex");
}
type Signup = { id: string; email: string; confirmation_sent_at: Date | null };
type Delivery = { id: string; confirmation_payload: ConfirmationEmail };
export interface WaitlistRepository {
  allow(ipHash: string): Promise<boolean>;
  join(email: string): Promise<Signup>;
  claim(id: string, payload: ConfirmationEmail): Promise<Delivery | null>;
  sent(id: string, providerId: string): Promise<void>;
  defer(id: string, seconds: number): Promise<void>;
}
export const waitlistRepository: WaitlistRepository = {
  async allow(ipHash) {
    const db = database();
    await db.query(
      "DELETE FROM orbsie_waitlist_limits WHERE window_start < now() - interval '1 day'",
    );
    const result = await db.query(
      `INSERT INTO orbsie_waitlist_limits(ip_hash,window_start,requests)
       VALUES($1,date_trunc('hour',now()),1)
       ON CONFLICT(ip_hash,window_start) DO UPDATE
       SET requests=orbsie_waitlist_limits.requests+1
       WHERE orbsie_waitlist_limits.requests < 5 RETURNING requests`,
      [ipHash],
    );
    return result.rows.length > 0;
  },
  async join(email) {
    // A no-op upsert returns the same identity even for concurrent signups.
    const result = await database().query(
      `INSERT INTO orbsie_waitlist(id,email) VALUES($1,$2)
       ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email
       RETURNING id,email,confirmation_sent_at`,
      [randomUUID(), email],
    );
    return result.rows[0];
  },
  async claim(id, payload) {
    // This atomic lease commits BEFORE contacting Resend. Five attempts maximum,
    // fifteen minutes apart; no automatic send outside its 24h deduplication TTL.
    const result = await database().query(
      `UPDATE orbsie_waitlist SET attempts=attempts+1,
       first_attempt_at=COALESCE(first_attempt_at,now()),
       confirmation_payload=COALESCE(confirmation_payload,$2::jsonb),
       next_attempt_at=now()+interval '15 minutes'
       WHERE id=$1 AND confirmation_sent_at IS NULL AND attempts < 5
       AND next_attempt_at <= now()
       AND (first_attempt_at IS NULL OR first_attempt_at > now()-interval '23 hours')
       RETURNING id,confirmation_payload`,
      [id, JSON.stringify(payload)],
    );
    return result.rows[0] ?? null;
  },
  async defer(id, seconds) {
    await database().query(
      "UPDATE orbsie_waitlist SET next_attempt_at=GREATEST(next_attempt_at,now()+$2*interval '1 second') WHERE id=$1",
      [id, seconds],
    );
  },
  async sent(id, providerId) {
    await database().query(
      `UPDATE orbsie_waitlist SET confirmation_sent_at=now(),provider_message_id=$2
       WHERE id=$1 AND confirmation_sent_at IS NULL`,
      [id, providerId],
    );
  },
};
export async function sendWaitlistConfirmation(
  delivery: Delivery,
  key: string,
) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `orbsie-plus-confirmation/${delivery.id}`,
    },
    body: JSON.stringify(delivery.confirmation_payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const retry = response.headers.get("Retry-After");
    const seconds = retry
      ? /^\d+$/.test(retry)
        ? Number(retry)
        : (Date.parse(retry) - Date.now()) / 1000
      : 0;
    await response.body?.cancel();
    return Number.isFinite(seconds) && seconds > 0
      ? { retryAfterSeconds: Math.ceil(seconds) }
      : null;
  }
  const data = await response.json();
  return typeof data.id === "string" && data.id.length > 0 ? data.id : null;
}
export async function deliverWaitlistConfirmation(
  signup: Signup,
  repository: WaitlistRepository = waitlistRepository,
  send = sendWaitlistConfirmation,
): Promise<"sent" | "pending"> {
  if (signup.confirmation_sent_at) return "sent";
  const key = process.env.RESEND_API_KEY;
  const from = process.env.WAITLIST_EMAIL_FROM;
  if (!key || !from) return "pending";
  try {
    const delivery = await repository.claim(
      signup.id,
      waitlistEmail(from, signup.email),
    );
    if (!delivery) return "pending";
    const providerId = await send(delivery, key);
    if (!providerId) return "pending";
    if (typeof providerId !== "string") {
      await repository.defer(signup.id, providerId.retryAfterSeconds);
      return "pending";
    }
    await repository.sent(signup.id, providerId);
    return "sent";
  } catch {
    // Signup and retry state are already durable. Never surface provider output,
    // recipient addresses or secrets; a later attempt uses the same payload/key.
    return "pending";
  }
}
export async function joinWaitlist(
  email: string,
  ipHash: string,
  repository: WaitlistRepository = waitlistRepository,
) {
  if (!(await repository.allow(ipHash)))
    throw new HttpError(429, "Too many attempts. Please try again in an hour.");
  const signup = await repository.join(email);
  const confirmation = await deliverWaitlistConfirmation(signup, repository);
  return { joined: true as const, confirmation };
}
