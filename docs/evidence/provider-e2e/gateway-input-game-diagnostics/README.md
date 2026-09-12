# Gateway Luna diagnostics acceptance

This directory records one owner-authorized live Vercel AI Gateway run against
the local production build at `http://127.0.0.1:3018`. The tested application
build was source commit `7e74569`; the exact catalog model was
`openai/gpt-5.6-luna` with low reasoning, default service tier, and a 4096
output-token cap.

The catalog preflight resolved the exact model before generation. Creation made
one provider request and returned HTTP 200, producing two new browser-manifold
entities and the required three-rule input game. The material edit made the
second provider request and returned HTTP 200 while preserving the selected
entity, geometry, game, and unrelated scene state. Total provider requests:
**2**. No retry, fallback, account, publication, or deployment activity took
place. The sanitized report recorded no generation diagnostics or blocked
external requests.

The invocation used the private mode-0600 Gateway environment file through
`node --env-file`; its contents were never printed and the file was deleted
after the run:

```sh
ORBSIE_LIVE_E2E=1 ORBSIE_TEST_URL=http://127.0.0.1:3018 \
ORBSIE_APP_SOURCE_COMMIT=7e74569 \
ORBSIE_EXPECTED_MODEL=openai/gpt-5.6-luna ORBSIE_KEY_SCOPE=local-only \
ORBSIE_OUTPUT_CAP_TOKENS=4096 ORBSIE_REQUIRE_INPUT_GAME=1 \
ORBSIE_REQUIRE_NEW_ONLY=1 \
ORBSIE_EVIDENCE_DIR=docs/evidence/provider-e2e/gateway-input-game-diagnostics \
node --env-file=/tmp/orbsie-gateway-diagnostics-pkvhaj7o/gateway.env \
scripts/provider-browser-e2e.mjs --provider gateway
```

Evidence consists of `gateway.json`, the model-selection, seed, edit, share,
and standalone-playback screenshots, plus `world.zip`. The local server and
browser were stopped after completion. Credentials, cookies, and raw provider
payloads are not included.
