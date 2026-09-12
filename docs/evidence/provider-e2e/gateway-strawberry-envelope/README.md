# Gateway strawberry envelope acceptance

- Application source: `ff6ea23` (operator-supplied harness provenance).
- Build: production build with `ORBSIE_GENERATION_MAX_TOKENS=4096`.
- Provider/model: Vercel AI Gateway / `openai/gpt-5.6-luna`, low/default.
- Prompt: `a tree with blue strawberries`.
- Upstream format: `json-schema`, selected by the exact server-only override
  `gateway:openai/gpt-5.6-luna -> json-schema`. This is an operator
  compatibility assertion, not catalog evidence.
- Browser modeling was required; key scope was local-only.
- Provider traffic: 1 creation request, HTTP 200; no edit request or retry.
- Result: creation stopped before save with sanitized
  `INVALID_SCENE_UPDATE`, operation 4, path
  `geometry.job.recipe.nodes[2].id`. The Gateway allocation was not retried.

The JSON report and PNGs are sanitized and contain no key, cookie, prompt
payload, or provider response body.
