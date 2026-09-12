# Strict scene wire format implementation contract

Status: codec implemented and reviewed in `0705a17`; generation integration
in progress, with no strict-mode live acceptance yet. Eight focused tests and
typechecking pass. The projected browser command schema is about29KB, with
125 object schemas and313 properties (before the commands envelope).

The canonical scene Zod schema and semantic validation remain authoritative.
Gateway's non-strict JSON Schema tests accepted the request but produced invalid
commands. A provider-only strict projection must preserve omission, explicit
null, discriminants, tuple constraints, and subsequent local validation.

Luna's offline audit measured the browser command schema at 23,992 bytes,
64 object schemas, 221 property occurrences, and object depth5 before its
envelope. Expanding all optional presence combinations was estimated at
114.5KB; that approach is rejected for avoidable input growth.

The chosen codec represents each optional property as either `{present:false}`
or `{present:true,value:...}`. It requires every wire property and closes every
wire object. Decoding removes absent properties and unwraps present values.
Explicit null remains available only where the canonical schema allows it.
No malformed JSON repair or relaxed canonical validation is permitted.

Projection removes schema/default annotations and replaces oneOf only when
disjoint constant discriminators prove equivalence to anyOf. The schema has
31 prefixItems occurrences: homogeneous fixed tuples become fixed-length
items arrays; heterogeneous tuples require closed item0/item1/... objects in
the wire representation, restored to arrays by the decoder. Unsupported
constructs must fail explicitly rather than silently lose constraints.

Validate wire data before decoding, then pass every decoded command through
the existing canonical parser, asset policy, semantic checks, and incremental
scene application. Final commit still waits for valid envelope completion and
a successful provider terminal status. Measure final schema size/depth and
verify real provider acceptance before activating strict format in production.

References reviewed by the investigating worker:
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/structured-outputs
