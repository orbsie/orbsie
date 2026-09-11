# Development checkpoint

Keep this handoff compact (about 60 lines or fewer) and update it in place. It
is a resume point, not a transcript: omit secrets, credentials, raw prompts,
large logs, and copied diffs.

- Current objective: Implement the full Orbsie plan with validated OpenRouter,
  Vercel AI Gateway and browser ChatGPT journeys.
- Current source: `1c09907` is deployed to `https://orbsie.com`; production smoke
  passed in `docs/evidence/coordinated-descent-release`. Verify `HEAD` on resume.
- Input-game acceptance correction committed as `2c8db05`.
- Experience reconciliation reviewed: parcel frame, desktop composer focus and
  narrow play-during-stream paths already have deterministic browser evidence.
- Shared transition reviewed: direct mount, reversal, resize/interruption and
  CSS centering corrected. 19 tests/typecheck passed; final nine-scenario parcel
  run retained in `docs/evidence/coordinated-descent`.
- Active Luna worker: `provider_evidence_identity`, adding harness/source
  attribution to provider reports without implying remote-source verification.
- Production/player build and host-package verification passed; deployment and
  production smoke passed. Next: close authorized live provider acceptance gates.
- Confirmed timing mismatch: store phase timer is 4.2s; renderer damping reaches
  its .995 camera handoff at about 5.58s. This does not prove content is blocked.
- Live-provider authorization request remains pending.
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
- External gaps: Gateway BYOK key/cap absent; browser ChatGPT consent and live
  subscription inference absent. Root also revalidated empty CUA surfaces and
  absent `AI_GATEWAY_TEST_KEY`/`AI_GATEWAY_API_KEY` without inspecting secrets.
  A names-only check of `.env.local`, `.env.production.local` and
  `.env.openrouter.local` also found no Gateway key or account-state assignment.
- Next action: run bounded input-game live acceptance within explicit call/cap
  authorization; Gateway BYOK and browser ChatGPT consent remain separate gates.
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
