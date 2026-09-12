# OpenRouter strawberry command example

This is a bounded post-change browser acceptance attempt against the local production build from operator-supplied source `43dc427`. The build used `ORBSIE_GENERATION_MAX_TOKENS=4096`; the app ran at `http://127.0.0.1:3018` with `BETTER_AUTH_URL` set to that origin.

Configuration was exact Luna only: provider `openrouter`, model `openai/gpt-5.6-luna`, reasoning `low`, service tier `default`, output cap `4096`, raised-cap gate enabled, browser modeling required, and no new-only constraint. The creation prompt was exactly `a tree with blue strawberries`; the harness used its default material edit prompt, but the edit phase was not reached. The existing local-only OpenRouter env file was loaded without recording its contents.

The run made one OpenRouter generation request, observed the seed after 4806 ms, received the invalid scene update path, saved zero operations, and stopped before edit. The sanitized result is `openrouter.json`. No reload, export, standalone playback, or screenshots exist because creation failed before those phases. No retry or second OpenRouter request was made.

The harness reported checkout SHA `da6f388570ff6cd86c09865abec96499e1cef25f`, dirty because the shared worktree contains generated/root-owned changes; the harness application source gate remained `43dc427` with operator-supplied provenance. The run ended with no server listening on port 3018.

Command shape (credential value omitted):

```text
ORBSIE_LIVE_E2E=1 ORBSIE_TEST_URL=http://127.0.0.1:3018
ORBSIE_APP_SOURCE_COMMIT=43dc427 ORBSIE_EXPECTED_MODEL=openai/gpt-5.6-luna
ORBSIE_KEY_SCOPE=local-only ORBSIE_OUTPUT_CAP_TOKENS=4096
ORBSIE_OPENROUTER_RAISED_CAP=1 ORBSIE_REQUIRE_BROWSER_MODEL=1
ORBSIE_CREATION_PROMPT='a tree with blue strawberries'
ORBSIE_EVIDENCE_DIR=docs/evidence/provider-e2e/openrouter-strawberry-command-example
node --env-file=.env.openrouter.local scripts/provider-browser-e2e.mjs --provider openrouter
```
