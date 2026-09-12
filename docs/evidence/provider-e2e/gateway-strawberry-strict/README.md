# Gateway strict-schema acceptance

This is one authorized live-browser run against a local production server.

- Provider/model: Vercel AI Gateway, `openai/gpt-5.6-luna`
- Prompt: `a tree with blue strawberries`
- Output format: operator override `json-schema-strict`
- Server cap/reasoning: 4096 output tokens, low/default reasoning
- Key scope: local-only; no credential or raw provider payload is stored here
- Generation requests: exactly 2, creation and selected-entity material edit; both HTTP 200
- Result: creation, edit, local recovery, export, and signed-out standalone playback passed
- Publication/cloud recovery/free trial: not requested

The production build was started from source ref `5403f61` with
`ORBSIE_GENERATION_MAX_TOKENS=4096`. The harness report records the shared
checkout as `59f3171c070003394ccc56a440fda5c5662c8c3e` and marks the supplied
application source ref unverified; the shared checkout advanced while this
run was in progress. The report's provenance is authoritative for that
distinction.

Evidence is in `gateway/`; `gateway.json` is the sanitized run report. The
temporary Gateway key was deleted and the local server was stopped after the
run.

Lead review: screenshots show successful selected-fruit recoloring and preserved
scene. Overall composition remains small/sparse; this does not close the full
visual-quality requirement. JSON/text/ZIP evidence key-pattern scan was clean,
and the temporary test credential was confirmed absent. Source provenance is
operator supplied, not independently attested by the running application.
