# Connection notice messaging acceptance

Run `node scripts/verify-connection-notices.mjs` against the production build (`ORBSIE_TEST_URL` optional). Fixture transport; no inference.

Three deterministic checks driven through the real editor:

1. **Exhausted free prompts**: `/api/trial` returns `remaining: 0`; typing a prompt and pressing Create opens the account modal with the reason rendered as the first content note — "You've used today's free prompts. Sign in or connect a provider to keep creating — your draft stays safe on this device." — followed by the drafts and the sign-in form. The typed prompt ("A farm full of pigs") remains in the composer behind the modal.
2. **Prompt preservation**: the composer keeps the exact prompt text with the modal open (and the component clears the notice whenever the modal closes).
3. **Offline**: with `navigator.onLine` false and the trial endpoint unreachable, no modal opens — a toast explains "You're offline. Your draft is saved on this device — try again when you reconnect." and the prompt stays in the composer.

`src/lib/connection-messages.ts` holds the typed message catalog (signed-out vs signed-in variants; generation error code mapping), covered by unit tests in `tests/connection-messages.test.ts`. Draft hygiene companion changes live in `src/lib/store.ts`: new drafts are titled from the user's prompt (first 40 characters) and the generation failure/stop paths skip saving a fully empty world (no entities, no messages) instead of accumulating duplicate "A pocketful of sunshine" drafts.

Production verification: after deploying this source to `orbsie.com`, a fresh browser typed "A farm full of pigs" and pressed Create — the account modal opened with the exhausted-free notice, and the composer preserved the prompt (`production-exhausted.png`). The network trial bucket was genuinely exhausted that day, so the notice reflects the real product state.
