# Gateway Luna input-game evidence

This was one bounded live Gateway run against the local production build at
`http://127.0.0.1:3018`, using the exact catalog model
`openai/gpt-5.6-luna`, low reasoning, default service tier, and a 4096 output
token cap. The catalog preflight resolved the exact model before generation.

The run made **one actual provider generation request**: creation returned
HTTP 200, then the editor rejected operation 5 as `INVALID_SCENE_JSON`. The
creation therefore stopped before commit, and the edit phase made **zero**
provider requests. There was no retry, fallback, account, cloud, publication,
or deployment activity.

Evidence:

- `gateway.json` — sanitized report with model, cap, status, request count,
  and the bounded diagnostic.
- `connection-model.png` — exact model selection.
- `intermediate-seed.png` — partial creation state.
- `failure.png` — visible failure state.

No project ZIP was produced because creation did not commit. The local server
was stopped after the failure, and the private mode-0600 Gateway environment
file was deleted. Credentials, cookies, and raw provider payloads are not
included.
