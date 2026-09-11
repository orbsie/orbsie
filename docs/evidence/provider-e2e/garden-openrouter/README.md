# OpenRouter garden live attempt — blocked at the provider throttle

A real OpenRouter Luna attempt of the garden (second scene type) scenario (`ORBSIE_CREATION_PROMPT` requesting a garden whose flowers open when clicked, exact model `openai/gpt-5.6-luna`, authorized `local-only` key, 4096-token cap, standard processing) failed before the first reservation: the upstream returned HTTP 429. Two invocations hit the same throttle, consistent with the intermittent 429s observed in this session (the flagship run immediately before also encountered a mid-stream 429 on its first attempt and only completed after spacing).

No fallback model was attempted. The garden live gate remains open for a later session; the island flagship journey itself passed in `flagship-openrouter/`, which already exercises the mixed catalog/procedural/generated scene family.
