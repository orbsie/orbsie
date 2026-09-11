# OpenRouter Luna live garden acceptance (second scene type)

Run configuration matches `browser-routed-openai-openrouter/README.md`: production build on `http://localhost:3058` with `BETTER_AUTH_URL=http://localhost:3058`, server-owned `ORBSIE_GENERATION_MAX_TOKENS=4096`, harness flags `ORBSIE_LIVE_E2E=1 ORBSIE_OPENROUTER_RAISED_CAP=1 ORBSIE_KEY_SCOPE=local-only ORBSIE_OUTPUT_CAP_TOKENS=4096 ORBSIE_SERVICE_TIER=default --provider openrouter`, exact model `openai/gpt-5.6-luna`, key from `.env.openrouter.local` without logging. The raised cap continues the owner's 2026-09-10 authorization for the live second-scene/flagship journey class.

Two real Luna requests through the OpenAI-direct upstream at regular/default processing:

1. Creation: "Make a small peaceful garden scene whose flowers open when clicked, with a stone path and a bench." 18 committed operations with 8 entities (2 catalog models, 6 procedural), first reservation 3,983 ms — a distinct second scene family created by a real provider.
2. Scoped material edit: passed with the selected ID preserved and unrelated state unchanged.

ZIP export and standalone playback passed; no fallback provider, zero diagnostics.

Two earlier attempts in this directory failed on model output quality (an invalid touching-solids flower recipe, then a mid-record truncation) and were documented; this passing run resolves them. This closes the live second-scene non-hardcoding gate for OpenRouter: the same provider authored both the island flagship (`flagship-openrouter/`) and a structurally different garden.
