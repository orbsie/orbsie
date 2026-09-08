# OpenRouter-authored gameplay

One actual OpenRouter `openai/gpt-5.6-luna` request through the local Next generation route authored three rules on a deterministic starter scene. The server used `ORBSIE_GENERATION_MAX_TOKENS=512`; no model fallback was requested. The starter scene and trial/config UI responses were fixtures. The authoring response, protocol application, editor gameplay and export were real.

The editor passed right-input scoring (7 points), held-input deduplication, win, loss and restart checks. The exported project preserved its original entities and the new three-rule program, with the engine/session source included. The initial standalone assertion sent input before WebGL scene initialization and failed. Replaying the same saved ZIP after waiting for scene initialization passed score, win, loss and restart checks with no browser errors or external requests. Both screenshots were visually inspected.

`live-attempt.json` records the observed first run and ZIP hash. `standalone-replay.json` records the independent no-inference replay. The replay does not represent another model call. An earlier local-origin configuration error returned 403 before inference; the test server was restarted with the correct loopback `BETTER_AUTH_URL` before the actual generation run.

This proves one live rules-edit workflow on a fixture scene. It does not prove live scene creation, cloud recovery, publication, all gameplay action types, or Gateway/ChatGPT coverage.

Repeat with the capped loopback server and `ORBSIE_LIVE_E2E=1 ORBSIE_OUTPUT_CAP_TOKENS=512 node scripts/verify-live-openrouter-game.mjs`. The cap is server-owned; the client flag alone does not enforce it. `node scripts/verify-openrouter-game-replay.mjs` replays the saved ZIP without credentials or inference.
