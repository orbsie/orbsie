# Generation output formats

The `/api/generate` route keeps newline-delimited JSON (NDJSON) as its default
wire format. It selects a structured format only after the server checks the
exact provider model catalog entry used for the request:

- OpenRouter models advertising `response_format` use `json-object`.
- OpenRouter models without that parameter but advertising `structured_outputs`
  use `json-schema`.
- Unknown or unsupported catalog evidence, and all Gateway models without an
  operator assertion, stay on NDJSON.

Structured responses are still validated incrementally against Orbsie's local
command schema. A provider catalog flag is request-shape evidence; it is not a
guarantee that every provider route will produce valid scene commands. The
operator-only `json-schema-strict` override uses a strict wire schema with
presence wrappers for optional fields and `itemN` objects for heterogeneous
tuples; the server decodes that wire form back to canonical commands before
validation and application. It is intentionally not auto-selected.

Operators may make a bounded compatibility assertion with the server-only
`ORBSIE_GENERATION_FORMAT_OVERRIDES` environment variable:

```json
{ "gateway:openai/gpt-5.6-luna": "json-schema-strict" }
```

Keys must be exact `openrouter:model` or `gateway:model` entries, and values
must be `ndjson`, `json-object`, `json-schema`, or `json-schema-strict`. The
strict Gateway example above is an operator assertion and is not yet live
verified. The route rejects malformed,
oversized, or overlong override maps before free-trial admission or provider
inference. Overrides are operator assertions that require live validation;
they are not catalog evidence and are never accepted from the browser.
