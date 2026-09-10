# OpenRouter input-game live attempts — blocked at the authorized cap

Two real OpenRouter Luna attempts of the harness input-game scenario (`ORBSIE_REQUIRE_INPUT_GAME=1`, exact model `openai/gpt-5.6-luna`, authorized `local-only` key, explicit 512-output-token cap, standard processing) both failed before a committed game:

1. HTTP 200 stream reached operation 4 and ended with a mid-record SyntaxError (`INVALID_SCENE_JSON`), consistent with the response truncating before the full two-entity, three-rule game fit the 512-token cap.
2. HTTP 200 stream reported an upstream 429 (`PROVIDER_STREAM_ERROR`) before the first reservation.

No fallback model, cap increase, or funding change was attempted: the 512-token cap is the owner's standing authorization for this key. The input-game gate for OpenRouter remains open pending an explicitly authorized larger output budget; the equivalent ChatGPT input-game acceptance already passed under its own policy.
