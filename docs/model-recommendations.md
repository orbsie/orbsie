# Orbsie model recommendations

Reviewed 2026-09-07 against `prompt.md`, `src/lib/server/generation.ts`, official vendor documentation, and unauthenticated live provider catalogs. This is a documented shortlist, not an Orbsie benchmark. No model inference calls were made for this research. Catalog fetch timestamps (UTC): openrouter 2026-09-07T23:13:49+00:00; gateway 2026-09-07T23:13:49+00:00.

## Recommended implementation map

Expose three modes; put every other compatible catalog model under **Advanced**. Default new connections to **Balanced**, preserve explicit saved choices, and never silently substitute another model when a selected recommendation is unavailable.

| Mode | OpenRouter ID | Vercel Gateway ID | Input / output USD per 1M tokens | Illustrative turn* |
| --- | --- | --- | --- | --- |
| Quality | `openai/gpt-6-astra` | `openai/gpt-6-astra` | $10 / $50 | $0.60 |
| Balanced | `openai/gpt-5.6-sol` | `openai/gpt-5.6-sol` | $2 / $10 | $0.12 |
| Budget | `openai/gpt-5.6-luna` | `openai/gpt-5.6-luna` | $0.20 / $1.20 | $0.014 |

Exact IDs and prices were present in both the [OpenRouter catalog](https://openrouter.ai/api/v1/models) and [Gateway catalog](https://ai-gateway.vercel.sh/v1/models). Prices above are their standard base rates, not fast, regional, batch, cache, or long-context rates. *Illustration assumes 10,000 uncached input tokens and 10,000 billed output tokens; it is arithmetic, not measured usage. Reasoning, retries, larger contexts, and repeated edits change the total. Refresh catalog pricing before displaying an estimate.

A material source discrepancy exists: the [official Sol model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol) lists $4/$20, while both routing catalogs return $2/$10. Use the selected provider's current quote and actual billed usage; do not promise the lower price indefinitely.

- **Quality / Astra:** Official OpenAI documentation positions it for the hardest reasoning and coding work. Its documented streaming, Chat Completions, structured outputs, and function calling match the adapter's direction. Use explicit **low** reasoning initially to support the owner's test constraint and responsive incremental creation. This is the premium candidate for coherent layouts and complex edits; superiority on Orbsie's geometry/gameplay contract remains unmeasured. [Astra documentation](https://developers.openai.com/api/docs/models/gpt-6-astra)
- **Balanced / Sol:** A flagship GPT-5.6 model with the same relevant documented API features and substantially lower catalog rates. This is the proposed everyday choice for initial worlds and revisions. Low reasoning is a reasonable initial configuration; any claimed quality/latency optimum requires evaluation. [Sol documentation](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- **Budget / Luna:** Officially intended for cost-sensitive, high-volume work, with streaming, structured outputs, and function calling. Its low output price matters for verbose entity reservations and refinements. Start with low reasoning; prefer bounded scenes and scoped changes until complex-scene adherence is measured. [Luna documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna)

## Alternatives considered

All IDs below also appeared in both routing catalogs. Keep them discoverable in Advanced, without adding another primary mode selector.

| Candidate | Catalog input / output per 1M | Why consider it |
| --- | --- | --- |
| `anthropic/claude-opus-5` | $5 / $25 | Quality challenger at half Astra's base rates; Anthropic positions it for complex coding. |
| `anthropic/claude-fable-5.1` | $10 / $50 | Quality challenger for demanding reasoning; same base rates as Astra. |
| `anthropic/claude-sonnet-5` | $2 / $10 | Direct Balanced challenger at the same catalog rates as Sol. |
| `google/gemini-3.8-flash` | $0.75 / $3.75 | Budget/Balanced challenger with documented software-engineering focus, function calling and structured outputs. More expensive than Luna per token. |

Vendor positioning comes from [Anthropic's current model comparison](https://platform.claude.com/docs/en/models/overview) and [Google's Gemini 3.8 Flash documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash). These are credible candidates, not evidence that one renders better 3D scenes. Terra was considered, but its $2/$12 routing rates currently provide no price advantage over Sol; no Orbsie evaluation establishes a compensating advantage. Generic coding or game-development leaderboard scores do not establish schema adherence, spatial coherence, playability, or cost per accepted revision here.

## Contract and verification implications

The inspected adapter generates newline-delimited JSON text: complete commands are parsed, Zod-validated, and semantically applied. It does **not** currently request `response_format`, structured tool arguments, or constrained decoding. Consequently, catalog structured-output support is useful future capability, not proof today's NDJSON is schema-guaranteed. Do not add a single-document JSON schema directly to a multi-record NDJSON stream. Preserve complete-record validation; adopting structured tools requires a corresponding adapter change. [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

All three recommendations document streaming and relevant API support upstream. OpenRouter lists `structured_outputs`, `tools`, and reasoning controls for each. For these three IDs, Gateway returns `type: language`, `modalities.output: [text]`, `supported_parameters` including `max_tokens`, `tools`, `tool_choice`, `reasoning`, and `include_reasoning`, plus `reasoning_options` containing effort `low`. OpenRouter supplies `architecture.output_modalities: [text]` and `supported_parameters` including `max_tokens`, `reasoning`, `reasoning_effort`, `response_format`, `structured_outputs`, `tools`, and `tool_choice`. Gateway does not independently enumerate structured-output support in these rows. Gateway provides the compatible Chat Completions transport; verify exact adapter request parameters and routed-model behavior, rather than assuming identical provider capability metadata. [Gateway Chat Completions](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions)

Refresh membership/capabilities when selecting models. Catalog presence does not prove a particular account has credits, routing access, or successful NDJSON generation. Keep non-text, batch-only, and incompatible models out of selectable generation options; Advanced should surface incompatibility clearly.

Under the owner's current constraint, live tests must resolve exactly `openai/gpt-6-astra` and explicitly request low reasoning, failing if unavailable. Do not benchmark the alternatives without a changed instruction. Future authorized comparisons should measure valid completion rate, unrelated-object preservation, spatial/playability checks, first valid reservation latency, and total billed cost per accepted revision using identical prompts and scene checkpoints. No latency, visual-quality winner, or account-level availability claim is established by this note.
