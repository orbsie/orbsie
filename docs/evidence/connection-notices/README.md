# Connection notice messaging acceptance

Run `node scripts/verify-connection-notices.mjs` against the production build (`ORBSIE_TEST_URL` optional). Fixture transport; no inference.

Five deterministic checks driven through the real editor:

1. **Exhausted free prompts**: `/api/trial` returns `remaining: 0`; typing a prompt and pressing Create opens the account modal with the reason rendered as the first content note — "You've used today's free prompts. Sign in or connect a provider to keep creating — your draft stays safe on this device." — followed by the drafts and the sign-in form. The typed prompt ("A farm full of pigs") remains in the composer behind the modal.
2. **Prompt preservation**: the composer keeps the exact prompt text with the modal open (and the component clears the notice whenever the modal closes).
3. **Offline**: with `navigator.onLine` false and the trial endpoint unreachable, no modal opens — a toast explains "You're offline. Your draft is saved on this device — try again when you reconnect." and the prompt stays in the composer.
4. **Admin reset control**: with `/api/config` reporting `isAdmin: true` and a mocked signed-in session, the exhausted path lands on the connection modal, which renders "Reset free-prompt limits for visitors active in the last 5 minutes" (the control exists in both signed-in surfaces — settings and account). Clicking it calls `POST /api/trial/reset-recent` and the confirmation note reads "Cleared 2 visitor limit rows. Visitors active in the last 5 minutes can claim free prompts again."
5. **No admin control without the flag**: the same flow with `isAdmin: false` renders no reset control anywhere.

The endpoint itself is fail-closed: `POST /api/trial/reset-recent` requires a signed-in session whose email is listed in `ORBSIE_ADMIN_EMAILS`; unconfigured lists 404 everyone, including plausible admin addresses. The underlying `resetRecentTrialUsage` deletes only `visitor:%`/`network:%` rows last claimed within the fixed 5-minute window (`DELETE ... updated_at >= now() - interval '5 minutes' RETURNING bucket`) and never matches `global:%`, so the site-wide daily pool cannot grow — the reset only redistributes it. Unit tests: `tests/trial-reset.test.ts` (delete semantics, rollback, empty window) and `tests/trial-reset-route.test.ts` (401 for anonymous, 404 for non-admin and unconfigured allowlist, counts for admin, database failure mapping). Activation on production requires `ORBSIE_ADMIN_EMAILS` in the deployed env; until then every caller receives 404.

`src/lib/connection-messages.ts` holds the typed message catalog (signed-out vs signed-in variants; generation error code mapping), covered by unit tests in `tests/connection-messages.test.ts`. Draft hygiene companion changes live in `src/lib/store.ts`: new drafts are titled from the user's prompt (first 40 characters) and the generation failure/stop paths skip saving a fully empty world (no entities, no messages) instead of accumulating duplicate "A pocketful of sunshine" drafts.

Production verification: after deploying this source to `orbsie.com`, a fresh browser typed "A farm full of pigs" and pressed Create — the account modal opened with the exhausted-free notice, and the composer preserved the prompt (`production-exhausted.png`). The network trial bucket was genuinely exhausted that day, so the notice reflects the real product state.
