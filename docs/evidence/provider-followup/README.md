# Live follow-up context

`chatgpt-local.json` records a real `gpt-6-astra` low-reasoning request through the authenticated loopback ChatGPT adapter and scene reducer using source `d40f8c3`. The exact requested sky color appears only in an earlier user message. The current instruction asks to apply that earlier color while preserving everything else.

The final check passed: HTTP 200, validated `set_environment` and `commit_revision`, sky `#d9a7c7`, and unchanged entities, ground and water. Request duration was 6,819 ms. The harness stores no provider credentials or local capability token. Reproduce with:

```sh
ORBSIE_LIVE_E2E=1 node scripts/verify-live-chatgpt-followup.mjs
```

Two earlier harness attempts did not complete scene assertions. The second localized a reducer argument-order bug in the verification script; the corrected final attempt passed. Their reports are retained separately. The first report counted the HTTP dispatch as an inference attempt; the corrected harness counts actual client generation calls.

`openrouter.json` records the equivalent passing OpenRouter check through the actual local Next route, using `openai/gpt-5.6-luna` and a server-owned 512-token output cap. One request returned HTTP 200, applied the history-only sky color and preserved entities, ground and water in 2,770 ms. The temporary local server was stopped afterward. The supplied credential remained local and was not written to evidence.

After building the application, run the capped server in one terminal and the opt-in probe in another:

```sh
BETTER_AUTH_URL=http://127.0.0.1:3024 ORBSIE_GENERATION_MAX_TOKENS=512 node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3024
ORBSIE_LIVE_E2E=1 ORBSIE_OUTPUT_CAP_TOKENS=512 node scripts/verify-live-openrouter-followup.mjs
```

The output-cap environment flag on the probe is an assertion about the server setup, not a replacement for the server-owned limit. The probe always uses the fixed local URL and Luna model, reads `.env.openrouter.local`, and never retries generation automatically.

These are live adapter-to-model-to-scene checks, not browser E2E or interrupted-checkpoint recovery tests. Gateway has deterministic adapter coverage for the new context forwarding; its equivalent live follow-up check remains open under the existing credential/allowance constraints.
