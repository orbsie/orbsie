# Live OpenRouter browser-modeling acceptance

Passed against the production build from cfe0009, served on loopback port 3048 with matching BETTER_AUTH_URL and ORBSIE_GENERATION_MAX_TOKENS=512. The existing local-only credential was loaded from an ignored env file and was not sent to hosted Orbsie. Exact model: openai/gpt-5.6-luna, low reasoning, default processing; no fallback.

Two real generation requests returned HTTP 200. Creation reserved one entity and produced a browser-manifold sphere recipe plus a commit (3 operations), with no catalog/procedural substitution. First observed reservation was 5,499 ms in this run, not a latency benchmark. The second request recolored that same entity pink while preserving geometry. Local reload, export and independent player checks passed. Astra inspected the standalone screenshot and confirmed the pink generated sphere is visible. The harness scanned retained output for the supplied credential.

This proves the small browser-model create/material-edit/reload/export loop through OpenRouter. It does not prove a topology-changing live edit, full gameplay rules, publication, cloud recovery, actual OAuth authorization, Gateway or ChatGPT. Google Fonts requests were blocked by the test harness and reported separately; generation was not intercepted. The publication status is not-requested, not a deployment failure.
