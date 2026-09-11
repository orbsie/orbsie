# OpenRouter Luna live procedural authoring acceptance

Run configuration matches `browser-routed-openai-openrouter/README.md` (production build on `http://localhost:3058`, `BETTER_AUTH_URL=http://localhost:3058`, server-owned 4096-token cap, `ORBSIE_OPENROUTER_RAISED_CAP=1`, exact model `openai/gpt-5.6-luna`, `local-only` key without logging).

Harness gates: `ORBSIE_REQUIRE_PROCEDURAL=1` with `ORBSIE_REQUIRE_BROWSER_MODEL=1 ORBSIE_REQUIRE_NEW_ONLY=1 ORBSIE_REQUIRE_GEOMETRY_EDIT=1`, explicit new-only creation prompt ("brand new original model from scratch without any catalog asset") and an explicit source-revision edit prompt.

Two real Luna requests through the OpenAI-direct upstream:

1. Creation: 3 operations with one trusted `browser-manifold` entity whose job retained QuickJS source and a source hash (`browserProcedural: true`), zero catalog entities — the model authored browser-procedural source rather than reusing prepared assets. First reservation 4,927 ms.
2. Source-revision edit: passed with the same selected entity ID, a new recipe revision, changed source and hash, and a changed trusted GLB.

ZIP export and standalone playback passed; no fallback. One earlier attempt in this directory truncated at the procedural source line with a more verbose prompt and was documented; the compact source ask passed. This closes the live procedural-authoring gate for OpenRouter (the earlier observed 429/invalid-update state in `browser-procedural-openrouter-observed/` is superseded by this passing run).
