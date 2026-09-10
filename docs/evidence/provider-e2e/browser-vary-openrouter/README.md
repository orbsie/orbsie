# OpenRouter Luna live seeded-variation acceptance

Run configuration matches `browser-deformation-openrouter/README.md`: production build on `http://localhost:3058` with `BETTER_AUTH_URL=http://localhost:3058`, server-owned `ORBSIE_GENERATION_MAX_TOKENS=512`, harness flags `ORBSIE_LIVE_E2E=1 ORBSIE_KEY_SCOPE=local-only ORBSIE_OUTPUT_CAP_TOKENS=512 ORBSIE_SERVICE_TIER=default ORBSIE_REQUIRE_BROWSER_MODEL=1 ORBSIE_REQUIRE_GEOMETRY_EDIT=1 --provider openrouter`, exact model `openai/gpt-5.6-luna`, key from `.env.openrouter.local` without logging.

Two real Luna requests at regular/default processing:

1. Creation: "Create an original browser-manifold model from scratch: a lumpy boulder using the vary node with seed 7 and amplitude 0.35 on a simple cylinder." First reservation 5,930 ms; one generated entity with trusted `browser-manifold` provenance, zero catalog or procedural entities.
2. Targeted geometry edit: "Make only the selected boulder more lumpy by increasing its vary amplitude to 0.45. Keep the seed at 7." Passed with the selected ID preserved, a new recipe revision, and a changed trusted GLB hash.

Export and standalone playback passed. The exported `project.json` confirms the live model authored `cylinder → vary(seed 7, amplitude 0.45)`, so the edit changed only the amplitude while the seed stayed fixed. No fallback provider and no catalog substitution.

This closes live-provider acceptance for the advertised `vary` node. The same session also attempted the OpenRouter input-game acceptance twice (see `browser-input-game-openrouter/`); both attempts failed under the authorized 512-output-token cap — one stream truncated mid-record (SyntaxError) and one upstream 429 — so that gate remains open pending an owner-authorized cap increase or a longer authorized budget.
