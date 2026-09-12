# Gateway strawberry command example

This is a bounded post-change browser acceptance attempt against the local production build from operator-supplied source `43dc427`. The build used `ORBSIE_GENERATION_MAX_TOKENS=4096`; the app ran at `http://127.0.0.1:3018` with `BETTER_AUTH_URL` set to that origin.

Configuration was exact Luna only: provider `gateway`, model `openai/gpt-5.6-luna`, reasoning `low`, service tier `default`, output cap `4096`, browser modeling required, and no new-only constraint. The creation prompt was exactly `a tree with blue strawberries`; the harness used its default material edit prompt, but the edit phase was not reached. The Gateway credential was loaded from the private env file supplied for this run and was deleted after shutdown; no credential, cookie, request body, or provider payload is retained here.

The first attempted run stopped before Chromium because the local server wrapper exited; that sanitized zero-call artifact is preserved as `preflight-server-lifecycle-failure.json`. The corrected run made one Gateway generation request, observed the seed after 5067 ms, received the invalid scene update path, saved zero operations, and stopped before edit. The sanitized result is `gateway.json`. No reload, export, standalone playback, or screenshots exist because creation failed before those phases. No retry or second Gateway request was made.

The harness reported checkout SHA `43dc42752cdb00647455d810c9aad086027f5d0b`, dirty because the shared worktree contains generated/root-owned changes; the harness application source gate was `43dc427` with operator-supplied provenance. The run ended with no server listening on port 3018.

Command shape (credential value omitted):

```text
ORBSIE_LIVE_E2E=1 ORBSIE_TEST_URL=http://127.0.0.1:3018
ORBSIE_APP_SOURCE_COMMIT=43dc427 ORBSIE_EXPECTED_MODEL=openai/gpt-5.6-luna
ORBSIE_KEY_SCOPE=local-only ORBSIE_OUTPUT_CAP_TOKENS=4096
ORBSIE_REQUIRE_BROWSER_MODEL=1 ORBSIE_CREATION_PROMPT='a tree with blue strawberries'
ORBSIE_EVIDENCE_DIR=docs/evidence/provider-e2e/gateway-strawberry-command-example
node --env-file=<private Gateway env> scripts/provider-browser-e2e.mjs --provider gateway
```
