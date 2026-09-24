# OpenRouter live authoring review — September 23, 2026

This was a fresh local production-build browser run against an isolated
PostgreSQL database. The harness selected exact `openai/gpt-6-luna`, standard
processing, and a server/client ceiling of 4,096 output tokens per call. It
allowed two live calls and blocked the third before reaching the server. No
automatic retry was used.

Creation committed revision 18. The second call received a revision-bound
canvas image and structural observation, returned a `revise` verdict, and
proposed a correction. The browser applied that correction and saved revision
20; a reload recovered the same project and revision. The final review could
not run under the existing two-call cap, so the outcome is
**bounded-incomplete**, not visually verified or product acceptance.

The [sanitized report](report.json) includes request IDs, revision binding,
phase order, call counts, storage checks, and the blocked final request. Full
page screenshots remain in a private local evidence directory with restrictive
permissions; they are not committed because they can include connection UI.
The test did not exercise play, Undo, export, publication, or physical mobile.
