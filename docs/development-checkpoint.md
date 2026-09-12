# Development checkpoint

Keep this handoff compact (about 60 lines or fewer) and update it in place. It
is a resume point, not a transcript: omit secrets, credentials, raw prompts,
large logs, and copied diffs.

- Current objective: Implement the full Orbsie plan with validated OpenRouter,
  Vercel AI Gateway and browser ChatGPT journeys.
- Fresh owner approval: one Luna create/edit test EACH for OpenRouter and
  Gateway, maximum two calls/provider, 4096 output tokens/call, no retries.
  OpenRouter run used one HTTP200 call, then tree-shape overlap rejection before
  save; no edit/retry. Evidence: `input-game-feedback-approved`. Gateway also
  used one HTTP200 Luna call then tree overlap rejection, no edit/retry; evidence
  `gateway-input-game-approved`. Private temporary Gateway key file deleted.
  Owner also approved Chrome consent work;
  CUA still reports no browsers. Do not treat consent as already completed.
- Current source: `905b682` is deployed to `https://orbsie.com`; production smoke
  passed in `docs/evidence/compound-policy-release`. Verify `HEAD` on resume.
- Deployed kernel-tested compound union example (`38370aa`) and owner-scoped
  publication identity with republish harness (`6df72ec`). Build/typecheck and
  hosted-package verification passed; live acceptance of these changes is open.
- Input-game acceptance correction committed as `2c8db05`.
- Experience reconciliation reviewed: parcel frame, desktop composer focus and
  narrow play-during-stream paths already have deterministic browser evidence.
- Shared transition reviewed: direct mount, reversal, resize/interruption and
  CSS centering corrected. 19 tests/typecheck passed; final nine-scenario parcel
  run retained in `docs/evidence/coordinated-descent`.
- Provider report attribution reviewed: harness repository SHA/dirty status,
  timestamp and optional operator-supplied app SHA; no remote verification claim.
  Four focused tests/typecheck passed.
- Modeling failure feedback reviewed: typed project-scoped diagnostics and
  optional 32KiB recipe reach explicit follow-up requests across provider paths.
  Last-good geometry preserved; no automatic inference. 67 focused tests and
  typecheck passed. Feedback is transient and does not survive reload.
- Production build and ChatGPT host-package verification passed for `33148de`.
- Browser feedback acceptance passed: four fixture requests with real Manifold
  worker, last-good preservation, exact rejection feedback, corrected bake and
  cleared feedback on the next request. Evidence: `modeling-feedback-browser`.
- Feedback integration deployed; remote build/typecheck and read-only production
  smoke passed. No live inference.
- Gameplay audit: prior fixture/published evidence already proves physical
  crystal/portal win-reset and platform behavior. The saved live OpenRouter
  flagship has `project.game`, which the legacy traversal verifier rejects.
- Saved flagship traversal accepted in `5d0867f`: unchanged OpenRouter ZIP,
  desktop keyboard and touch five-crystal portal win/reset; legacy fixture
  desktop check passed. Separate probes verify carrying on all three platforms:
  1/3 in `flagship-platforms`, 2 in `flagship-platform2-corrected`. The initial
  platform-2 failure came from premature verifier release; corrected detector,
  retained-sample regression, and one focused browser run passed. These are
  isolated saved-snapshot probes, not a continuous three-platform route.
  No model calls or product changes. No active worker remains.
- Owner authorized one OpenRouter Luna input-game create/edit run: maximum two
  calls, 4096 output tokens each, using the existing local key (2026-09-11).
- Run attempted: one HTTP 200 generation, seed at 3830ms, then touching/overlapping
  solids rejection at `tree-shape`. No edit or retry. Evidence retained under
  `docs/evidence/provider-e2e/input-game-authorized-sep11`; local processes stopped.
- Owner supplied Gateway test key; added as sensitive `AI_GATEWAY_TEST_KEY` to
  Vercel production for `grappeggias-projects/orbsie`; env listing verified it.
  No key retained in repository. Available to subsequent deployments; no redeploy
  or inference performed for this configuration action. Gateway spending cap
  and browser ChatGPT consent remain outstanding.
- Harness evidence: canonical project validation accepts baked browser geometry;
  actual IndexedDB GLB digests are checked. Luna reports typecheck, 26 targeted
  tests, syntax and safety-gate checks passed. No new live inference was run.
- Recovery evidence: stale-load browser/release checks passed; 35 targeted
  recovery tests, type checking, production build and host-package verification
  passed. Journal/checkpoint replay and completed-run recovery are implemented;
  this is not provider-stream resumption.
- Live OpenRouter evidence: Luna `openai/gpt-5.6-luna`, low/default,
  local-only key; deformation/vary passed at 512 tokens, flagship/garden/
  procedural passed at owner-authorized 4096 raised cap. Input-game attempts
  hit one recipe failure and two overly narrow harness rejections at 4096;
  the harness is now corrected, but live gameplay acceptance remains unproven.
- Publication evidence: `2632a40` records live account/cloud/per-Orb deployment
  and signed-out playback of a deterministic protocol world; it made no model call.
- External gaps: Gateway key is stored in Vercel production, but local test
  configuration and spending cap remain outstanding. Browser ChatGPT consent
  and live hosted subscription inference remain unverified.
- Next action: close remaining live provider acceptance prerequisites and
  full flagship platform-traversal evidence. The prior failed
  OpenRouter create/edit authorization does not authorize a new creation retry.
- Do not equate synthetic fixtures, free-prompt/server-funded Gateway evidence,
  deterministic publication or production smoke with provider E2E acceptance.

Coordination follows the repository policy:

- Astra low/regular is the lead, reviewer, integrator, and final verifier.
- At most one Luna xhigh/regular worker runs at once. Use `fork_turns="none"`
  and task-specific context; workers do not spawn agents.
- Keep small work in one cohesive task instead of separate investigation,
  review, or documentation workers. Completion notifications drive follow-up.
- Avoid status-only polling and automatic continuation chatter. If explicit
  waiting is necessary, each blocking call is at most 60 seconds, with no new
  turn solely to recheck unchanged state.
- Batch fixes and targeted validation. Repeat green checks only after a
  relevant change, failure, or new risk; reserve full E2E/live model checks
  for meaningful integration or release milestones.

The repo settings use regular processing (`service_tier = "default"`) and
Fast mode off. Live model-backed tests are authorized for Luna only, while
end users retain every model supported by their connected provider. Repo
configuration cannot disable host automatic goal continuation, change
subscription accounting, or guarantee 2x savings; those are external settings
and billing behavior.
