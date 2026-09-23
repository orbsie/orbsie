# Expired ChatGPT device challenge recovery

Local implementation and synthetic acceptance completed on 2026-09-22. The
PostgreSQL regression confirmed the bound stale intent as the 409 cause and
proved fenced replacement; 57 focused tests, the synthetic browser fixture,
the full suite and production build passed. Evidence is in
`docs/evidence/chatgpt-expired-challenge-recovery-20260922/`. Live deployment,
consent and connected model discovery are still open. Computer use later
rejected the Orbsie Chrome tab under its browser URL policy, so do not treat
the synthetic code as a live verification code or bypass that browser block.

The owner approved connecting Orbsie to the signed-in ChatGPT account in regular
Chrome on 2026-09-22. The previously issued device challenge had disappeared
from Orbsie's UI. A fresh **Connect ChatGPT** attempt showed the generic
connection error. The production `/api/chatgpt/start` request returned HTTP
409 at 2026-09-23T04:31:56.883Z; no new code was issued and no consent or model
call occurred. Chrome control and the signed-in ChatGPT profile both work.

Root-cause hypothesis to verify before changing behavior: the old owner intent
still has `pending_attempt_id` after its challenge/host expired. The UI's
status path can show disconnected with no recoverable pending challenge, while
`beginChatGPTCredentialIntent` rejects any pending attempt as
`active-connection`. A genuine active connection and an in-progress login can
also return 409, so the status code alone does not prove this hypothesis.
Reproduce with the real vault/database and durable-service boundaries before
selecting a fix; do not expose account IDs, device codes, cookies or tokens.

Acceptance contract:

1. A genuinely live pending challenge remains single-owner and cannot be
   replaced by another tab or session. An active remembered connection also
   cannot be silently replaced.
2. An expired or irrecoverable challenge can be explicitly restarted in the
   same browser, without a separate Orbsie password or lost draft. Reconcile
   the host and owner intent under the epoch/attempt fence; a late callback
   from the former challenge cannot save credentials after a new Start or
   Disconnect.
3. The UI distinguishes a recoverable expired/pending conflict from a generic
   failure and offers a safe action that works from the actual disconnected
   state. Preserve the user's explicit Disconnect intent.
4. Add a focused regression at the database/service boundary and a browser
   fixture for expired challenge → restart → code display. Run targeted tests,
   typecheck and production build; retain the exact prior connection on any
   failed restart.
5. After root review and deployment, use the owner's approved Chrome flow to
   complete the one consent and verify connected model discovery. Live model
   calls remain Luna only. Direct redirect-based OAuth remains a separate
   feasibility requirement; device-code success does not close it.

Do not infer a database row's content from the 409 alone. Production logs are
sanitized and showed only path/status, so this task begins with a hypothesis,
not a confirmed cause.
