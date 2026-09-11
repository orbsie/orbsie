# OpenRouter input-game live attempts — model recipe quality, routed upstream

Three real OpenRouter Luna attempts of the harness input-game scenario under the OpenAI-first upstream routing (exact model `openai/gpt-5.6-luna`, authorized `local-only` key, 4096-token cap with `ORBSIE_OPENROUTER_RAISED_CAP=1`, standard processing), superseding the earlier 512-cap truncation boundary:

1. The model authored a browser-manifold tree recipe whose compose inputs touched — the kernel rejected `node tree contains touching or overlapping solids` (fail-closed, world preserved).
2. The model created an entity with a protocol geometry kind instead of the gate's required procedural/custom-only geometry ("Created project contains a non-procedural/non-custom entity").
3. Same as 2.

All three streamed fully over HTTP 200 with zero provider errors — infrastructure is healthy; the failures are recipe-quality variance for the strict "original geometry + three input rules" combination. No further retries were made after three consecutive attempts. The gate remains open; the equivalent ChatGPT input-game acceptance already passed under its own policy, and the deterministic runtime/gameplay coverage is proven in the editor fixtures.
