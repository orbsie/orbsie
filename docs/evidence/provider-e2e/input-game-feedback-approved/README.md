# Authorized OpenRouter input-game acceptance

This directory records one owner-authorized fresh OpenRouter Luna run against
the local app at `http://127.0.0.1:3018` using source commit `6df72ec`.

- Provider: OpenRouter
- Model: `openai/gpt-5.6-luna`
- Reasoning: low
- Service tier: default
- Key scope: local-only
- Output cap: 4096 tokens
- Creation: new-only input-game prompt
- Retry budget: one creation call, then at most one edit call

The single creation request returned HTTP 200 and produced a seed, then failed
before saving because the browser modeling kernel rejected `tree-shape` for
touching or overlapping solids. The edit call was not attempted, and no retry
was made. The local server and browser were stopped after the failure.

Evidence is the sanitized `openrouter.json` report and its referenced PNGs:
`connection-model.png`, `intermediate-seed.png`, and `failure.png`. No
credentials, cookies, tokens, or raw provider payloads are stored here.
