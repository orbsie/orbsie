# OpenRouter Luna live deformation acceptance

Run configuration: production build on `http://localhost:3058` with `BETTER_AUTH_URL=http://localhost:3058` (the deployed `.env.production.local` origin must be overridden for loopback acceptance or `checkOrigin` rejects the browser) and the server-owned `ORBSIE_GENERATION_MAX_TOKENS=512` so `/api/config` exposes the authorized cap. Harness flags: `ORBSIE_LIVE_E2E=1 ORBSIE_KEY_SCOPE=local-only ORBSIE_OUTPUT_CAP_TOKENS=512 ORBSIE_SERVICE_TIER=default ORBSIE_REQUIRE_BROWSER_MODEL=1 ORBSIE_REQUIRE_GEOMETRY_EDIT=1 --provider openrouter`, exact model `openai/gpt-5.6-luna`, explicit output cap 512 tokens, key loaded from `.env.openrouter.local` without logging.

Two real Luna requests at regular/default processing:

1. Creation: "Create an original browser-manifold model from scratch: a twisted pillar with a visibly flared top, using a twist node and a taper node in its recipe." First reservation 12,964 ms; one generated entity with trusted `browser-manifold` provenance, zero catalog or procedural entities, seed observed.
2. Targeted geometry edit: "Widen only the top taper of the selected pillar without changing the twist or the bottom scale." Passed with the selected ID preserved, a new recipe revision, and a changed trusted GLB hash.

Export (`world.zip`) and standalone playback passed. The exported `project.json` confirms the model authored the advertised deformation nodes: `box → taper → twist` with output node `twist` at recipe revision 2. No fallback provider, no catalog substitution, and no key material in any artifact.

An earlier invocation in this directory was blocked before inference because the server's deployed origin configuration rejected the loopback browser origin (HTTP 403 from `checkOrigin`); that state is documented here and its screenshot was removed. This closes the live-provider acceptance for the advertised twist/taper nodes; seeded `vary`, broader flagship journeys, Gateway BYOK, hosted ChatGPT consent and publication remain open.
