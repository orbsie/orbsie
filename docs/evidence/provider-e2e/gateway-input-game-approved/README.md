# Authorized Gateway input-game acceptance

This directory records one owner-authorized fresh Vercel AI Gateway Luna run
against the local app at `http://127.0.0.1:3018` using source commit
`6df72ec`.

- Provider: Vercel AI Gateway
- Catalog-resolved model: `openai/gpt-5.6-luna` (selected from a bounded
  294-model Gateway catalog response; the Fast Luna variant was not selected)
- Reasoning: low
- Service tier: default
- Key scope: local-only
- Output cap: 4096 tokens
- Creation: new-only input-game prompt
- Retry budget: one creation call, then at most one edit call

The single creation request returned HTTP 200 and produced a seed, then failed
before saving because the browser modeling kernel rejected `tree` for touching
or overlapping solids. The edit call was not attempted, and no retry was made.
The local server and browser were stopped after the failure.

Evidence is the sanitized `gateway.json` report and its referenced PNGs:
`connection-model.png`, `intermediate-seed.png`, and `failure.png`. No
credentials, cookies, tokens, or raw provider payloads are stored here. The
private temporary Gateway env file was deleted after the run.
