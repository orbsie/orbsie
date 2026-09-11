# Development checkpoint

Keep this handoff compact (about 60 lines or fewer) and update it in place. It
is a resume point, not a transcript: omit secrets, credentials, raw prompts,
large logs, and copied diffs.

- Current objective: Implement the full Orbsie plan with validated OpenRouter,
  Vercel AI Gateway and ChatGPT journeys.
- Current source: Working tree on main; verify HEAD and pending changes on resume.
- Active task: Usage-saving execution policy, implemented by Luna and reviewed by Astra.
- Files in scope: AGENTS.md, prompt.md execution policy, Luna role, this checkpoint.
- Evidence completed: TOML parsing, whitespace and policy consistency checks passed.
- Next action: Reconcile the existing app/storage recovery changes before resuming
  a single bounded product task; do not assume those changes are reviewed.
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
