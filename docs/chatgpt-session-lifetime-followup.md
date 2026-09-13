# Hosted ChatGPT session lifetime follow-up

Source inspection after real device authorization succeeded (e853a94):

- src/lib/server/chatgpt-host-registry.ts sets HOST_LIFETIME_MS to 10 minutes.
- src/lib/server/chatgpt-sandbox-backend.ts caps sandbox timeout at 600,000 ms,
  creates it nonpersistent, reads with resume:false, and rejects expired hosts.
- No renewal path is present in the inspected backend/service.

This limits ordinary connected editing sessions and can expire a runtime while
waiting for unrelated UI fixes. It is not proof of the earlier OpenAI code
rejection cause. Real consent/catalog evidence remains valid; do not assume that
same runtime is still usable later.

After playable Canvas2D fallback: define bounded session renewal/idle expiry
against actual sandbox capabilities, keep owner/session isolation and revocation,
avoid extending credentials or retaining them silently beyond product policy.
Test active-session continuity, idle expiry, refresh and clean reconnect. Reuse
existing consent only while the actual host reports connected. Do not copy
browser cookies or local Codex credentials to bypass reconnect.

2026-09-13 verification: installed @vercel/sandbox3.2.2 declares
Sandbox.extendTimeout(duration,{signal}); the pinned application currently does
not call it. Official current duration/persistence guidance also documents this
capability: https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence .
Runtime extension and credential persistence are separate decisions. Keep
persistent:false and resume:false unless a separately reviewed policy changes
that contract. Renewal must coordinate the registry expiry with the actual
running sandbox, preserve owner/session/attempt checks and logout cleanup, and
reserve enough time for an in-flight generation. Passive status polling must not
silently keep metered runtimes alive indefinitely. No renewal was implemented by
this investigation.

## Bounded implementation contract (not yet implemented)

Source review2026-09-13: `database()` returns a pg Pool, registry rows already
have `created_at`, and the installed SDK exposes the actual session `expiresAt`
in addition to `extendTimeout`. Use these existing interfaces; do not infer a
running session deadline from the default timeout alone.

- Keep initial/idle allowance10minutes, with a40minute absolute host lifetime
  measured from registry creation and capped by the owning auth-session expiry.
  This proposed product cap stays below the previously verified45minute Hobby
  limit. It does not promise unlimited subscription-session persistence.
- Renew only on an explicit valid generation request, after owner/session,
  input, project-feedback identity and artifact checks. Status/model polling,
  focus and refresh do not extend a metered host. Never create a replacement
  host or restart inference automatically in this path.
- Before dispatch, require enough verified runtime headroom for the bounded
  request plus transport cleanup. If the absolute/session cap leaves too little
  time, return the existing reconnect-required response before inference and
  preserve the draft. Account for renewal/acquisition time inside the route's
  total180second deadline; do not independently reset a175second fetch budget
  after spending30seconds on acquisition.
- Serialize renewal across server instances using an owner/session/attempt-scoped
  registry transaction and row lock. Read the same ready, unexpired host and
  owning session under that transaction. Bound lock wait and backend duration.
  Recheck expiry against current time after acquiring the lock; PostgreSQL
  transaction-start `now()` alone is insufficient after a wait.
- Read a running sandbox with `resume:false`, validate finite actual expiry,
  calculate only the positive delta needed to reach the chosen deadline, then
  extend and verify its resulting expiry. Commit registry expiry only after
  verified backend success, never beyond the actual sandbox or product/session
  deadline. Roll back on failure; a backend extension followed by failed DB
  commit may leave bounded extra runtime, but must not restore authorization.
- Logout/teardown and expired cleanup retain attempt identity and cannot revive
  a deleted/newer host. Stop/delete failures never justify credential copying,
  persistence, unbounded retries or bypassing session revocation.

Focused acceptance must cover no-op headroom, extension, passive reads, idle and
absolute expiry, insufficient generation headroom, wrong owner/attempt, expired
session, concurrent renewal, failed extension/DB commit and logout races. A later
live milestone must exercise a real connected host beyond its original10minute
expiry, verify the actual backend/registry deadlines and complete a generation.
Synthetic timers alone will not establish live session continuity.
