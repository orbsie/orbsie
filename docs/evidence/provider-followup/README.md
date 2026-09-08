# Live follow-up context

`chatgpt-local.json` records a real `gpt-6-astra` low-reasoning request through the authenticated loopback ChatGPT adapter and scene reducer using source `d40f8c3`. The exact requested sky color appears only in an earlier user message. The current instruction asks to apply that earlier color while preserving everything else.

The final check passed: HTTP 200, validated `set_environment` and `commit_revision`, sky `#d9a7c7`, and unchanged entities, ground and water. Request duration was 6,819 ms. The harness stores no provider credentials or local capability token. Reproduce with:

```sh
ORBSIE_LIVE_E2E=1 node scripts/verify-live-chatgpt-followup.mjs
```

Two earlier harness attempts did not complete scene assertions. The second localized a reducer argument-order bug in the verification script; the corrected final attempt passed. Their reports are retained separately. The first report counted the HTTP dispatch as an inference attempt; the corrected harness counts actual client generation calls.

This is live adapter-to-model-to-scene evidence, not a browser E2E or an interrupted-checkpoint recovery test. OpenRouter and Gateway have deterministic adapter coverage for the new context forwarding; equivalent live follow-up checks remain open.
