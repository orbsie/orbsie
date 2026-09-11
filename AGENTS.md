# Development model and bounded execution policy

- Astra low/regular owns architecture, task contracts, shared interfaces, acceptance criteria, review of every finished diff, integration, and final verification. Review code and evidence without repeating the worker's investigation unless a concrete evidence gap requires it.
- Luna xhigh/regular implements one cohesive, bounded task at a time through `.codex/agents/luna-worker.toml` and `luna_worker`. Keep small work in that task; do not create separate investigation, review, or documentation workers for it. Allow at most one worker, including nested delegation, and never let a worker spawn agents.
- Before delegation, inspect the relevant source and send only task-specific context: intended behavior, file ownership, constraints, and acceptance evidence. Launch with `fork_turns="none"`; do not copy the full conversation. The worker reports changed files, targeted checks and results, assumptions, and unresolved risks in a concise final.
- Use completion notifications to drive coordination. Astra does useful independent work while the worker runs and does not spin status-only polls or automatic continuation chatter. If explicit tool waiting is necessary, use at most 60 seconds per blocking call and do not start a new turn just to recheck unchanged state.
- Batch fixes and run targeted validation for each change. Reserve full E2E and live model calls for meaningful integration or release milestones; do not repeat green checks unless a relevant change, failure, or new risk justifies them.
- Resume from `docs/development-checkpoint.md` and verify its source against the worktree. Update that compact checkpoint at task handoff; do not copy the conversation into it.
- Use regular/standard processing (`service_tier = "default"`) for Astra and Luna, with Fast mode off. Live model-backed tests may call Luna only; preserve credential-specific output/spending limits. This test restriction does not limit end users' supported provider/model choices.
- Follow the development execution and quality plan in `prompt.md`. Repository policy cannot disable host-level automatic goal continuation, change subscription accounting, or guarantee a 2x saving; those are external settings and billing behavior.

## Local Blender access

- For asset construction, write a bounded typed modeling job and run `node scripts/run-blender-job.mjs JOB.json NEW_OUTPUT_DIRECTORY`. See `docs/agent-blender-runtime.md` for the schema example and runtime prerequisites.
- Reuse this isolated executor; do not run arbitrary generated Python in a normal Blender session. The command returns `model.glb` and metadata without making model calls.
- Installed-runtime success does not complete the separate portable Blender release requirements in `prompt.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
