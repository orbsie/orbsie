# OpenRouter input-game acceptance after compound-union policy

This is the single owner-authorized post-policy live Luna run against the local
application at `http://127.0.0.1:3018`. The harness recorded application source
`905b682` (operator-supplied) and its own clean checkout SHA `5c645fd`.

- Provider: OpenRouter
- Model: `openai/gpt-5.6-luna`
- Reasoning: low
- Service tier: default
- Key scope: local-only loopback credential
- Output cap: 4096 tokens
- Mode: new-only input-game creation, followed by one selected edit
- Provider requests: exactly 2 (`HTTP 200`, creation and edit); no retry or fallback

Creation committed 6 operations and 2 generated entities, with a seed observed
at 5158 ms. The input-game checks passed for the tree/mushroom scene, refined
geometry, exact rule count, right-input score +7, up-input win, left-input loss,
and absence of timer/collection scoring. The selected material edit preserved
its entity ID and the input rules. Local recovery, ZIP export and standalone
playback passed; standalone playback had no page errors or blocked external
requests and verified win/loss/restart behavior.

Evidence is the sanitized `openrouter.json`, screenshots, and `world.zip` in
this directory. No account, cloud, publication, deployment, or other provider
was used. Credentials, cookies, raw provider payloads, and secrets are not
stored here.
