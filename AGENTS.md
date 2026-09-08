# Development model and delegation policy

- Astra low owns architecture, task contracts, review of every finished diff, integration, and final verification. Review code and evidence without duplicating the worker's investigation unless a specific gap requires it.
- Luna xhigh implements bounded tasks. Use `.codex/agents/luna-worker.toml` through `luna_worker`, or explicit `gpt-5.6-luna` / `xhigh` spawn overrides.
- Allow at most one worker at a time, including nested delegation. Workers must not spawn additional agents. Give concise, self-contained task context and file ownership; use `fork_turns="none"` rather than copying the full conversation.
- Batch validation: targeted tests per change; full E2E and live model calls at meaningful integration or release milestones. Repeat checks only after relevant changes, failures, or unresolved concerns.
- Use regular/standard processing (`service_tier = "default"`) for lead and workers; keep Fast mode off.
- Follow the development execution and quality plan in `prompt.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
