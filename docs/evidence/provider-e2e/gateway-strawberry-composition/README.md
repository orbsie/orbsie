# Gateway strawberry composition acceptance

- Application source: `4884ad0` (operator-supplied harness provenance).
- Production build: passed with `ORBSIE_GENERATION_MAX_TOKENS=4096`.
- Provider/model: Vercel AI Gateway / `openai/gpt-5.6-luna`, low/default.
- Prompt: `a tree with blue strawberries`.
- Upstream format: `json-schema`, selected by the exact server-only override
  `gateway:openai/gpt-5.6-luna -> json-schema`.
- Browser modeling was required; key scope was local-only.
- Provider traffic: 1 creation request, HTTP 200; no edit request or retry.
- Result: creation stopped before save with sanitized
  `INVALID_SCENE_UPDATE` at operation 4. The bounded diagnostic preserved
  schema-only issue codes and paths; no provider payload, model node value,
  key, or cookie was recorded.

The JSON report and PNGs are sanitized evidence. The Gateway allocation was
not retried after the failed creation.
