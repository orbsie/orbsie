# OpenRouter garden live attempts — routed upstream, model-output failures

Two real OpenRouter Luna attempts of the garden second-scene scenario under the OpenAI-first upstream routing (exact model `openai/gpt-5.6-luna`, authorized `local-only` key, 4096-token cap with `ORBSIE_OPENROUTER_RAISED_CAP=1`, standard processing), after the owner disabled account-level ZDR and the OpenAI upstream became admitted:

1. HTTP 200 stream completed, but the model authored an invalid geometry recipe: the browser kernel rejected `node flower contains touching or overlapping solids` (fail-closed, last good world preserved). No diagnostics, no rate limiting.
2. HTTP 200 stream truncated mid-record at operation 10 (`INVALID_SCENE_JSON` SyntaxError).

No fallback model was attempted. The garden live gate remains open; the routing and the full relay/validation/bake/export path are proven through the OpenAI upstream in `browser-routed-openai-openrouter/`. The remaining risk is model recipe quality for multipart flowers, not infrastructure.
