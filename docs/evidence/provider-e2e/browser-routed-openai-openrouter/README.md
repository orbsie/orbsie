# OpenRouter Luna routed through OpenAI — live acceptance

Run configuration: production build on `http://localhost:3058` with `BETTER_AUTH_URL=http://localhost:3058` and the server-owned `ORBSIE_GENERATION_MAX_TOKENS=512`; harness flags `ORBSIE_LIVE_E2E=1 ORBSIE_KEY_SCOPE=local-only ORBSIE_OUTPUT_CAP_TOKENS=512 ORBSIE_SERVICE_TIER=default ORBSIE_REQUIRE_BROWSER_MODEL=1 ORBSIE_REQUIRE_GEOMETRY_EDIT=1 --provider openrouter`, exact model `openai/gpt-5.6-luna`, key from `.env.openrouter.local` without logging.

This run verifies the owner-directed upstream routing (`order: ["OpenAI", "Amazon Bedrock", "Azure"], allow_fallbacks: false`, committed in `9d2c8f9`) after the owner disabled account-level Zero Data Retention enforcement. OpenRouter confirmed that setting was the sole reason OpenAI-direct and Bedrock endpoints were excluded ("ZDR violation (account settings)"), and a direct probe now reports `provider: "OpenAI"`.

Two real Luna requests at regular/default processing:

1. Creation: "Create an original browser-manifold model from scratch: a simple vase using a revolve node." First reservation 4,120 ms; one generated entity with trusted `browser-manifold` provenance, zero catalog or procedural entities.
2. Targeted geometry edit: "Make only the selected vase wider without changing its height." Passed with the selected ID preserved, a new recipe revision and a changed trusted GLB hash.

Export and standalone playback passed; no fallback provider. Two prior attempts in this directory used the harness default island prompt and truncated at the 512-token cap (mid-record SyntaxError at operation 6 on both, documented here rather than retried further); the single-object prompt fits the cap. This establishes that the full generation path — routing, relay, validation, bake, export — works through the OpenAI-direct upstream; Bedrock fallback remains structured-in but was not exercised because Azure/OpenAI capacity was never exhausted in the same request.
