# Gateway generation failure: bounded diagnostic task

Current evidence: `docs/evidence/provider-e2e/gateway-input-local-origin-20260913/`.
Release ae3a478, Gateway `openai/gpt-5.6-luna`, low/default, one generation call
with 4096 output tokens. A seed reached the browser; operation 2 then reported
INVALID_SCENE_JSON, no schema issues and no observed terminal reason. No edit
or subsequent provider retry occurred. This does not establish the rejected
content or whether the cause is model formatting or stream decoding.

## Source contract

- `src/lib/server/generation.ts`: NDJSON content is split on newlines before
  JSON.parse in emit; structured output goes through SceneCommandEnvelopeDecoder.
- `src/lib/server/generation-output-format.ts`: Gateway defaults to NDJSON.
- `tests/generation-diagnostics.test.ts`: malformed command after reservations
  already preserves the preceding commands and reports the attempted operation.
- `tests/generation.test.ts`: escaped newlines and split SSE byte chunks covered.
- Existing sanitized diagnostics intentionally omit parser text. Preserve that
  product boundary; never return raw provider content or credentials to the UI.

## Implementation and evidence

One Luna worker, no nested agents. First build an isolated diagnostic/replay tool
using the existing generator and a wrapped fetch. Preserve the exact request
format, model, effort, token bound and application validation. Capture only the
bounded response stream needed to replay the parser; do not log authorization
headers, keys, credential files or full request context. Store diagnostic raw
content in a private file outside the repository, with an explicit maximum byte
count, timeout and one-call ceiling. Prove the tool and limits with fixture data
before its one instrumented live call. A fixture or failing stream must never
trigger another provider request automatically.

Use that captured stream to determine the earliest failure and create a minimal,
sanitary deterministic regression. Preserve early valid reservations, stable
entities and the last committed revision. A fix must accept valid intended output
without silently repairing ambiguous malformed geometry, accepting arbitrary
code/URLs, dropping required commands or suppressing an invalid final commit.
If the provider output itself violates the contract, compare supported request
format/prompt options from actual evidence; do not weaken schema validation or
claim a parser defect solely from the generic diagnostic.

Root reviews the finished diff and reproduction before any further live
create/edit acceptance. Keep the failed original attempt, diagnostic capture,
regression, and subsequent live acceptance distinct. Only sanitized minimal
fixtures and summaries enter git. Existing API call authorization applies, but
this task's diagnostic is limited to one Luna call at 4096/default with no retry.
