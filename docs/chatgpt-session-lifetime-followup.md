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
