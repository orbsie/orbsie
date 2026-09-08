# Public provider capability verification

Run `node scripts/verify-provider-capabilities.mjs` to fetch each official public catalog once and exercise the actual catalog mapper. No credentials or inference endpoints are used. The report records exact Astra IDs, raw/compatible counts, and capability declarations.

Both catalogs confirm text output and tools for `openai/gpt-6-astra`. OpenRouter streaming support is recorded from its published provider contract. Gateway streaming and unadvertised structured output remain unknown, rather than fabricated support or rejection. The regression suite checks that missing Gateway structured parameters remain unknown.

This verifies catalog discovery and mapping only. It does not replace the required real OpenRouter/Gateway/ChatGPT creation, revision, persistence and playback E2E runs. OpenRouter's existing credential restriction and Gateway funding constraints still apply.
