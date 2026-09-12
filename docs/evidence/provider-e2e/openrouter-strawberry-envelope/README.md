# OpenRouter strawberry envelope acceptance

- Application source: `ff6ea23` (operator-supplied harness provenance).
- Build: production build with `ORBSIE_GENERATION_MAX_TOKENS=4096`.
- Provider/model: OpenRouter / `openai/gpt-5.6-luna`, low/default.
- Prompt: `a tree with blue strawberries`.
- Upstream format: `json-object`, selected by the server from the exact
  OpenRouter preflight catalog entry advertising `response_format`; no
  operator override was used for this provider.
- Browser modeling was required; key scope was local-only.
- Provider traffic: exactly 2 HTTP 200 generation requests (creation and
  material edit), with no retry or fallback.
- Result: creation passed with 14 operations; selected material edit passed
  with the selected ID preserved. Local recovery, export, and standalone
  playback also passed.

The JSON report, PNGs, and ZIP are sanitized and contain no key, cookie,
prompt payload, or provider response body.

## Lead visual review

The edit screenshot confirms the selected strawberry changed to pink while
other blue fruit remains. The tree is small and visually sparse in the scene;
this run proves functional create/edit/recovery/export behavior, not the full
plan's high-quality modeling and composition target. Visual quality remains open.
