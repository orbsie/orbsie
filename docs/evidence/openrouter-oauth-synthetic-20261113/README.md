# Synthetic OpenRouter OAuth gates — 2026-11-13

Scope: browser fixtures only. `/api/**` is intercepted, the OpenRouter
authorization redirect and token exchange are fulfilled locally, and no live
provider, account or model request is made. This does **not** prove a real
unmodified PKCE return, which still needs the owner's browser (plan step B03).

Server: production build (`npm run build`, then `npm start`) at
`http://127.0.0.1:3048`, served from the repository worktree.

| File | Script | Result |
| --- | --- | --- |
| `ui.txt` | `scripts/verify-openrouter-oauth-ui.mjs` | passed: orphan/unrelated callbacks ignored, 1 exchange, prompt restored, URL cleaned, no persisted key |
| `draft.json` | `scripts/verify-openrouter-oauth-draft.mjs` | passed: successful and cancelled callbacks both preserve the saved world, selection, prompt and revision; no key persisted |
| `races.json` | `scripts/verify-openrouter-oauth-races.mjs` | passed: scrubbed storage recovered, one exchange under Strict Mode, pending navigation aborted and recovered |

Harness change in this run: the draft and races fixtures waited on UI copy with
Playwright's 5 s default, which this machine exceeds while hydrating the
production bundle; both now use the 30 s timeout the UI fixture already used.
No application behavior was changed to make these pass.
