# Live authoring-review acceptance

Run this only after the browser review loop, its deterministic rendered fixture,
and the production build pass root review. Keep `ORBSIE_AUTHORING_REVIEW` off in
production until the end-to-end evidence below is accepted. Live model calls
must use Luna. This is separate from the older one-call provider harness:
`scripts/provider-browser-e2e.mjs` currently counts initial generation requests
but does not establish that the admitted review and final-review routes executed.

For local production-build tests, use an isolated migrated PostgreSQL database,
set `ORBSIE_AUTHORING_REVIEW=1` and `ORBSIE_GENERATION_MAX_TOKENS=4096`, and
explicitly set `VERCEL=0`. The downloaded `.env.production.local` contains
`VERCEL=1`; leaving that value active on localhost makes anonymous admission
expect Vercel's trusted forwarded-IP header and fail with HTTP 503 before
inference. `scripts/verify-live-authoring-review.mjs` is a focused OpenRouter
CREATE/review harness. Its two-call guard intentionally blocks final review
after a revise verdict; a bounded-incomplete result is evidence of iteration,
not full acceptance.

For each provider, use a fresh owner-authorized session and explicit create/edit
prompts. Observe the real initial, review and, on revise, final-review requests;
count model calls across all routes for the user turn. Assert the exact same
provider/model/effort and authoring run, independent request IDs, correct phase
order, no replay, at most one correction batch and three total calls per turn.
Capture the browser-visible original scene, revised scene when applicable,
activity messages, playable input during review, one Undo baseline, saved cloud
or local revision, reload, export and independent signed-out published playback.
Require an actual revision-bound screenshot for an image-capable admitted model;
require an explicit structural-only label when the admitted model lacks images.
Verify server and client sanitized terminal diagnostics without prompt, image,
token, credential or raw model text.

Preserve the owner-approved API limit of 4,096 output tokens per call and the
Gateway limit of five calls **per test**. A create plus edit with maximum review
loops can take six calls, so run them as separately bounded tests or stop before
the cap; do not silently truncate a review and claim success. No blind retries.
The last observed negative Gateway balance blocks paid inference until the
account state changes. Check browser-control availability at execution time:
the current computer-use inventory exposes no Chrome surfaces. A browser
profile being signed in elsewhere does not prove Orbsie's hosted connection
or a real model turn. Existing API keys remain local and never enter reports.

After live review acceptance, run the full three-turn flagship gameplay journey
per provider as specified in `prompt.md` and the existing flagship harness. A
green create/edit review test alone does not satisfy gameplay, publication,
mobile or browser-only subscription OAuth requirements.
