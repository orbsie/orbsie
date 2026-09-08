# Model ordering and price estimates

Advanced models use **estimated 3D suitability**, based on a dated external preference ranking. This is not an Orbsie benchmark, geometry-accuracy test, or guarantee of better results for a particular prompt. Models without ranking evidence appear alphabetically after ranked models; **unranked does not mean lower quality**.

## Ranking evidence

The September 7, 2026 snapshot in `src/lib/model-rankings.ts` extracts positive integer ranks from `benchmarks.design_arena` entries where `arena` is `models` and `category` is `3d`. Source: the [public OpenRouter catalog](https://openrouter.ai/api/v1/models). The [catalog documentation](https://openrouter.ai/docs/guides/overview/models#benchmarks-object) describes these as third-party Design Arena preference rankings among OpenRouter-listed models. They measure a different setting from Orbsie's structured scene commands, progressive formation, or working gameplay.

The first three observed entries were Kimi K3, Claude Fable 5.1, and Claude Opus 5. This order follows that evidence rather than model price, provider, release date, or an invented composite score. General intelligence and coding scores are not mixed into the 3D ranking. Tied ranks sort by display name, then exact model ID.

Both providers use the same checked-in snapshot so a shared model's rank is consistent. Gateway namespaces `zai/` and `spacexai/` map to `z-ai/` and `x-ai/` for lookup only. Submitted model IDs remain exactly as returned by the selected provider. Undocumented variants do not inherit a base model's rank. Refresh the snapshot by repeating the extraction above from the public catalog and reviewing its date, category and IDs.

The current user-selected presets are Quality: GPT-6 Astra, Balanced: GPT-5.6 Luna, and Budget: GLM-5.3-Flash. OpenRouter's Budget ID is `z-ai/glm-5.3-flash`; Gateway's is `zai/glm-5.3-flash`. Both use `openai/gpt-5.6-luna` for Balanced and `openai/gpt-6-astra` for Quality. `modelModesForProvider` resolves these exact catalog IDs; the free three-creation mode remains separately configured to Luna and does not follow Budget. Astra and Luna lack Design Arena `3d` entries in this ranking snapshot and are therefore unranked in Advanced. [OpenAI describes Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) as its most capable model for complex reasoning and coding, but that is not a comparative 3D benchmark. A preset and an external preference rank answer different questions.

## Prices and compatibility

The API fetches each provider's catalog, cached for one hour, and multiplies its base per-token rates by one million. OpenRouter uses `pricing.prompt`, `pricing.input_cache_read`, and `pricing.completion`; [Gateway documents](https://vercel.com/docs/ai-gateway/models-and-providers) `pricing.input`, `pricing.input_cache_read`, and `pricing.output`. These exact cache keys were also confirmed in the live responses.

The UI must label amounts **Estimated USD / 1M tokens**. Missing, negative, malformed, or nonfinite rates become `null` and display as unavailable, never zero. An explicitly supplied zero remains zero. These estimates do not promise a cache hit or include cache-write fees, context-tier overrides, routing differences, service tiers, taxes, or additional request/tool charges. We use the selected provider's live rates, which may differ from direct-provider documentation.

The existing language/tool compatibility filter remains. Async `:batch` variants are excluded: the [official Batch API](https://openrouter.ai/docs/batch-quickstart) submits requests for later retrieval rather than providing this app's immediate streaming interaction. No inference-based certification of every catalog entry is claimed.

## Validation

Six deterministic tests cover conversion, unavailable versus free rates, ordering, namespace aliases without ID rewriting, malformed/unsupported rows, preset stability, batch exclusion, and route provenance. Typecheck passed. Public catalog reads produced 293 selectable OpenRouter models (100 ranked) and 249 Gateway models (70 ranked), with the same top three and all three preset IDs available. Evidence: `docs/evidence/model-catalog-estimates.json`. No credentials were read and no inference requests were made.

## Preset update verification

The preset IDs above were independently checked against fresh unauthenticated reads of both official catalogs on September 7, 2026 (Pacific). All three IDs survive the app's compatibility filter. Current catalog estimates for GLM-5.3-Flash differ by provider: OpenRouter input/cache-read/output are $0.075/$0.015/$0.25 per million tokens; Gateway reports $0.15/$0.03/$0.50. These remain provider estimates, not guaranteed charges. See `docs/evidence/preset-catalog.json` for timestamps, source URLs, exact IDs and all preset rates. No inference or credential access was needed.

## Generation capability contract

The remote adapter consumes streamed text containing complete NDJSON commands and validates each command locally before applying it. Native tool calling and provider-enforced JSON schema are optional capabilities, not requirements of this transport. OpenRouter documents streaming for all models at https://openrouter.ai/docs/api_reference/streaming; this does not establish that every model follows the scene protocol reliably.

Generation now checks the exact chosen model against the provider's public catalog before spending a free prompt or starting inference. Catalog lookup is cached for one hour, sends no user credential, and fails clearly when unavailable. Missing or known-incompatible models are rejected without silently selecting a different ID. Provider metadata declarations distinguish unknown capabilities from confirmed support; catalog compatibility alone is not live E2E evidence.

Local verification of this change: 18 generation-route tests and 12 catalog/preflight tests passed, along with type checking. Coverage includes exact model lookup, unavailable catalogs, explicit non-language rejection, unknown metadata, and preserving free quota when preflight fails. This change has not yet been deployed or verified through live provider inference. Gateway streaming remains explicitly unknown where its catalog does not establish support; the relay still detects provider errors and validates complete records at runtime.
