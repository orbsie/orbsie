# OpenRouter blue-strawberry tree review

One fresh local production acceptance run used `openai/gpt-6-luna`, default
service tier, a 4,096-token output cap, and the prompt `a tree with blue
strawberries`. The isolated PostgreSQL database was migrated, the app ran with
`VERCEL=0` and authoring review enabled, and `BETTER_AUTH_URL` exactly matched
the loopback `ORBSIE_TEST_URL`.

Before the browser run, the malformed-JSON origin preflight returned HTTP 400
with zero inference calls. The browser then made exactly three model calls and
no retries: create, review, and final review. All returned HTTP 200 and used
the expected provider/model, project, and authoring run, with distinct request
IDs. The first visual+structural review examined revision 11 and requested a
correction bound to revision 17. The final visual+structural review examined
revision 17 and returned `revise` with the same binding digest. The call cap
was reached, so the result is **bounded-incomplete**, not accepted.

Revision 17 survived reload. The API key was absent from browser storage after
connection and reload, and the browser external-request guard blocked zero
requests. Browser diagnostics recorded no console or page errors and one
request failure.

The private scene-only capture was inspected and removed. It shows a broad,
rounded green canopy and brown trunk; no blue strawberries or attached fruit
are discernible at play scale. The requested defining feature therefore
remains visually unverified and the quality outcome remains incomplete. The
report contains sanitized call metadata only, with no prompt, key, token, or
raw provider/model text. Runtime and screenshot artifacts were removed after
the run.

Codex account usage was not available in the current tool surfaces, so this
evidence makes no remaining-usage or quota claim.
