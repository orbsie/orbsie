# Live authoring-review acceptance

Run this only after the browser review loop, its deterministic rendered fixture,
and the production build pass root review. Keep `ORBSIE_AUTHORING_REVIEW` off in
production until the end-to-end evidence below is accepted. Live model calls
must use Luna. This is separate from the older one-call provider harness:
`scripts/provider-browser-e2e.mjs` currently counts initial generation requests
but does not establish that the admitted review and final-review routes executed.

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
The negative Gateway balance currently blocks paid inference. The owner-signed-in
Chrome session is not yet exposed to computer use, so ChatGPT browser acceptance
cannot be inferred from a signed-out/new profile. Record these as blocked tests
until the resources exist. Existing API keys remain local and never enter reports.

After live review acceptance, run the full three-turn flagship gameplay journey
per provider as specified in `prompt.md` and the existing flagship harness. A
green create/edit review test alone does not satisfy gameplay, publication,
mobile or browser-only subscription OAuth requirements.
