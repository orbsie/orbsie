# Development checkpoint

Keep this handoff compact (about 60 lines or fewer) and update it in place. It
is a resume point, not a transcript: omit secrets, credentials, raw prompts,
large logs, and copied diffs.

- Current objective: Implement the full Orbsie plan with validated OpenRouter,
  Vercel AI Gateway and ChatGPT journeys.
- Current source: main at ee4464c when task started; verify pending changes on resume.
- Active task: Luna fix_stale_project_load reproduces and fixes asynchronous
  history loading that can overwrite a newer selected world.
- Files in scope: src/lib/store.ts and focused recovery tests; Astra owns this checkpoint.
- Evidence completed: Review of e204bde/ee4464c; 41 targeted recovery/store tests
  passed but did not cover out-of-order load completion. Worktree was clean.
- Next action: Review the worker's reproduction, stale-load guards and targeted
  evidence when its completion notification arrives. Do not poll unchanged status.
- Blockers: Live provider acceptance is incomplete. Revalidate authorized account
  access and test credentials without exposing their values before a live milestone.

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
