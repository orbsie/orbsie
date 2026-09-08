import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { database } from "../src/lib/server/auth";
import { joinWaitlist } from "../src/lib/server/waitlist";
it.runIf(process.env.RUN_WAITLIST_DATABASE_TEST === "1")(
  "persists one pending signup across concurrent submissions without email delivery",
  async () => {
    const id = randomUUID();
    const email = `orbsie-test-${id}@example.invalid`;
    const hash = `test-${id}`;
    vi.stubEnv("RESEND_API_KEY", "");
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    try {
      const results = await Promise.all([
        joinWaitlist(email, hash),
        joinWaitlist(email, hash),
      ]);
      expect(results).toEqual([
        { joined: true, confirmation: "pending" },
        { joined: true, confirmation: "pending" },
      ]);
      const rows = await database().query(
        "SELECT email, attempts, confirmation_sent_at FROM orbsie_waitlist WHERE email=$1",
        [email],
      );
      expect(rows.rows).toEqual([
        { email, attempts: 0, confirmation_sent_at: null },
      ]);
      expect(transport).not.toHaveBeenCalled();
    } finally {
      await database().query("DELETE FROM orbsie_waitlist WHERE email=$1", [
        email,
      ]);
      await database().query(
        "DELETE FROM orbsie_waitlist_limits WHERE ip_hash=$1",
        [hash],
      );
      await database().end();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  },
  30000,
);
