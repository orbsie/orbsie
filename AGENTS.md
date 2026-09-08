# Development model and delegation policy

- Default all development agents to GPT-6 Astra, low reasoning, regular/standard processing. Disable Fast mode.
- Strategically delegate independent, bounded work to GPT-5.6 Luna with xhigh reasoning and regular processing. Use `.codex/agents/luna-worker.toml` through the `luna_worker` role, or explicit model/effort overrides when the runtime uses spawn arguments.
- Astra owns task contracts, architecture, review of every delegated diff, integration, and final verification. Do not accept worker completion without checking its code and evidence.
- Follow the development execution and quality plan in `prompt.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
