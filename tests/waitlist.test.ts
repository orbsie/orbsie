import { afterEach, expect, it, vi } from "vitest";
import {
  normalizeWaitlistEmail,
  waitlistIpHash,
  joinWaitlist,
  deliverWaitlistConfirmation,
  sendWaitlistConfirmation,
  type WaitlistRepository,
} from "../src/lib/server/waitlist";
import { waitlistEmail } from "../src/lib/server/waitlist-email";
import { POST } from "../src/app/api/waitlist/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function repository() {
  const signup = {
    id: "test-signup",
    email: "person@example.test",
    confirmation_sent_at: null as Date | null,
  };
  let claimed = false;
  const repo: WaitlistRepository = {
    allow: vi.fn(async () => true),
    join: vi.fn(async () => signup),
    claim: vi.fn(async (_id, payload) => {
      if (claimed) return null;
      claimed = true;
      return { id: signup.id, confirmation_payload: payload };
    }),
    defer: vi.fn(async () => {}),
    sent: vi.fn(async () => {
      signup.confirmation_sent_at = new Date();
    }),
  };
  return { signup, repo };
}
function configured() {
  vi.stubEnv("RESEND_API_KEY", "synthetic-key");
  vi.stubEnv("WAITLIST_EMAIL_FROM", "Orbsie <updates@example.test>");
}
it("normalizes whitespace and case without rewriting plus-address aliases", () => {
  expect(normalizeWaitlistEmail("  Person+Plus@Example.COM ")).toBe(
    "person+plus@example.com",
  );
  for (const value of [
    null,
    "invalid",
    "person@example.com\r\nBcc:other@example.com",
    "a".repeat(255),
  ])
    expect(() => normalizeWaitlistEmail(value)).toThrow("valid email");
});
it("hashes platform IPs with a secret and ignores forwarding claims outside Vercel", () => {
  vi.stubEnv("WAITLIST_RATE_LIMIT_SECRET", "test-hash-secret");
  vi.stubEnv("VERCEL", "1");
  const request = (ip: string) =>
    new Request("https://orbsie.com", {
      headers: { "x-vercel-forwarded-for": ip },
    });
  const hash = waitlistIpHash(request("192.0.2.1"));
  expect(hash).toMatch(/^[a-f0-9]{64}$/);
  expect(hash).not.toContain("192.0.2.1");
  expect(waitlistIpHash(request("192.0.2.1"))).toBe(hash);
  expect(waitlistIpHash(request("192.0.2.2"))).not.toBe(hash);
  vi.stubEnv("VERCEL", "");
  expect(waitlistIpHash(request("192.0.2.1"))).toBe(
    waitlistIpHash(request("192.0.2.2")),
  );
});
it("persists signups with pending delivery when email is unconfigured", async () => {
  vi.stubEnv("RESEND_API_KEY", "");
  const { repo } = repository();
  expect(await joinWaitlist("person@example.test", "hash", repo)).toEqual({
    joined: true,
    confirmation: "pending",
  });
  expect(repo.join).toHaveBeenCalledWith("person@example.test");
  expect(repo.claim).not.toHaveBeenCalled();
});
it("rejects rate-limited attempts before creating a signup or sending", async () => {
  const { repo } = repository();
  repo.allow = async () => false;
  await expect(
    joinWaitlist("person@example.test", "hash", repo),
  ).rejects.toMatchObject({ status: 429 });
  expect(repo.join).not.toHaveBeenCalled();
});
it("one concurrent claim sends once and existing confirmed signups never send again", async () => {
  configured();
  const { repo, signup } = repository();
  const send = vi.fn(async () => "provider-id");
  const results = await Promise.all([
    deliverWaitlistConfirmation(signup, repo, send),
    deliverWaitlistConfirmation(signup, repo, send),
  ]);
  expect(results.sort()).toEqual(["pending", "sent"]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(await deliverWaitlistConfirmation(signup, repo, send)).toBe("sent");
  expect(send).toHaveBeenCalledTimes(1);
});
it("provider failures stay pending; retry eligibility remains controlled by durable claim", async () => {
  configured();
  const { repo, signup } = repository();
  const send = vi.fn(async () => {
    throw Error("secret provider output");
  });
  expect(await deliverWaitlistConfirmation(signup, repo, send)).toBe("pending");
  expect(repo.sent).not.toHaveBeenCalled();
  expect(await deliverWaitlistConfirmation(signup, repo, send)).toBe("pending");
  expect(send).toHaveBeenCalledTimes(1);
});
it("database acknowledgement failure does not claim confirmation was sent", async () => {
  configured();
  const { repo, signup } = repository();
  repo.sent = async () => {
    throw Error("database down");
  };
  expect(
    await deliverWaitlistConfirmation(signup, repo, async () => "provider-id"),
  ).toBe("pending");
});
it("Resend receives immutable HTML/plain text and a recipient-independent idempotency key", async () => {
  const payload = waitlistEmail(
    "Orbsie <updates@example.test>",
    "person@example.test",
  );
  const fetcher = vi.fn(async () => Response.json({ id: "accepted-id" }));
  vi.stubGlobal("fetch", fetcher);
  expect(
    await sendWaitlistConfirmation(
      { id: "signup-uuid", confirmation_payload: payload },
      "synthetic-key",
    ),
  ).toBe("accepted-id");
  const [url, options] = fetcher.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("https://api.resend.com/emails");
  expect(new Headers(options.headers).get("Idempotency-Key")).toBe(
    "orbsie-plus-confirmation/signup-uuid",
  );
  expect(JSON.parse(options.body as string)).toEqual(payload);
  expect(payload.html).toContain('role="presentation"');
  expect(payload.html).not.toContain("person@example.test");
  expect(payload.text).toContain("https://orbsie.com");
});
it("route rejects foreign origins and oversized/invalid bodies without revealing internals", async () => {
  vi.stubEnv("BETTER_AUTH_URL", "https://orbsie.test");
  const request = (body: string, origin = "https://orbsie.test") =>
    new Request("https://orbsie.test/api/waitlist", {
      method: "POST",
      headers: { origin },
      body,
    });
  expect((await POST(request("{}", "https://elsewhere.test"))).status).toBe(
    403,
  );
  expect((await POST(request("x".repeat(2049)))).status).toBe(413);
  const invalid = await POST(request('{"email":"not-an-email"}'));
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toEqual({
    error: "Enter a valid email address.",
  });
});

it("honors provider Retry-After by durably postponing the next attempt", async () => {
  configured();
  const { repo, signup } = repository();
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response("limited", {
        status: 429,
        headers: { "Retry-After": "3600" },
      }),
  );
  expect(await deliverWaitlistConfirmation(signup, repo)).toBe("pending");
  expect(repo.defer).toHaveBeenCalledWith(signup.id, 3600);
  expect(repo.sent).not.toHaveBeenCalled();
});
