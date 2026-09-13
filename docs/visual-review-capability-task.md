# Bounded visual-review capability task

Queue after renderer capture Task2a; one Luna worker, no nested delegation.
This is a prerequisite to image transport, not acceptance of model visual review.
Root inspected the current interfaces on 2026-09-13.

## Ownership and changes

- src/lib/model-capabilities.ts: add optional imageInput Capability, matching the
  existing supported true/false/unknown and source contract. OpenRouter reads
  architecture.input_modalities; Gateway reads modalities.input. A bounded valid
  nonempty string array explicitly containing image means true; a valid nonempty
  array without image means false. Missing, empty or malformed metadata is unknown.
  Do not use model names, output modalities, or generic vision tags as proof of
  image input. Existing text-generation filtering must remain independent.
- src/lib/server/chatgpt-models.ts: retain optional bounded inputModalities through
  validateChatGPTModels and listChatGPTModels. Preserve known text/image values;
  absent or malformed optional metadata yields unknown without breaking an otherwise
  usable text model. Do not invent schema defaults when the runtime omitted them.
- src/components/chatgpt-connection.tsx: ChatGPTModelOption and parseChatGPTModels
  must preserve the same safe metadata. This is a separate stripping boundary.
  The API route src/app/api/chatgpt/[action]/route.ts validates host metadata again;
  verify retention across both validations and the final browser parser.
- Relevant focused tests: tests/model-catalog.test.ts, tests/chatgpt-models.test.ts,
  tests/chatgpt-connection.test.ts, plus existing presets/output-format regressions.
  Keep code ownership limited to capability normalization and catalog propagation.

Prefer one small shared pure modality normalizer if needed to prevent divergent
server/browser semantics; do not import server runtime modules into client code.
Bound metadata (at most16 entries, each at most32 characters) and avoid publishing
unrelated catalog fields. A malformed optional field must not poison normal model
selection. Preserve provider/model identifiers, reasoning efforts, and presets.

## Acceptance

Cover image+text, text-only, absent, empty, non-array, mixed invalid entries,
oversized input, duplicate known modalities and unrelated extra metadata. Verify
catalog -> route validation -> browser parsing retains capability; models without
image support stay available for ordinary generation. No new network/model calls.
No UI may announce that visual review occurred merely because capability is true.

## Follow-on transport boundary (not implementation in this task)

The renderer result binds projectId/revision and image dimensions/bytes. Transport
must validate these together with the current run and original requested model.
Validate encoded request bytes, not only decoded image size: base64 expansion plus
scene text must fit current route512KiB, hosted text256KiB/instructions64KiB bounds.
Do not silently raise limits or accept arbitrary remote URLs. Runtime image ingest
needs its own bounded decoder/transport evidence; catalog support alone is not proof.
The server must independently resolve review capability and enforce free-call
allowances; a client capability flag is never authorization for extra inference.
