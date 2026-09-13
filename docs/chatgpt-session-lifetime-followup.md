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
