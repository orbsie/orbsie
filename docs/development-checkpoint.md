# Development checkpoint

Keep this handoff compact (about 60 lines or fewer) and update it in place. It
is a resume point, not a transcript: omit secrets, credentials, raw prompts,
large logs, and copied diffs.

- Current objective: Implement the full Orbsie plan with validated OpenRouter,
  Vercel AI Gateway and browser ChatGPT journeys.
- Current source: `f88bcc9` is deployed to `https://orbsie.com`; `39710bd` records
  the release smoke. Verify `HEAD` on resume.
- Active task: Provider evidence reconciliation is complete for Astra review.
- Files changed: `docs/scope-audit.md` and this checkpoint only.
- Recovery evidence: stale-load browser/release checks passed; 35 targeted
  recovery tests, type checking, production build and host-package verification
  passed. Journal/checkpoint replay and completed-run recovery are implemented;
  this is not provider-stream resumption.
- Live OpenRouter evidence: Luna `openai/gpt-5.6-luna`, low/default,
  local-only key; deformation/vary passed at 512 tokens, flagship/garden/
  procedural passed at owner-authorized 4096 raised cap. Input-game attempts
  failed recipe validation at 4096; no fallback or new cap is inferred.
- Publication evidence: `2632a40` records live account/cloud/per-Orb deployment
  and signed-out playback of a deterministic protocol world; it made no model call.
- External gaps: Gateway BYOK key/cap absent; browser ChatGPT consent and live
  subscription inference absent. Root also revalidated empty CUA surfaces and
  absent `AI_GATEWAY_TEST_KEY`/`AI_GATEWAY_API_KEY` without inspecting secrets.
- Next action: obtain owner-authorized Gateway BYOK credentials and cap, then run
  one bounded Luna browser create/edit/recovery/export/standalone acceptance.
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
