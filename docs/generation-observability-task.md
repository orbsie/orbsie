# Bounded generation observability implementation

Owner request: significantly improve logs so future failures can be reproduced.
Implement after the current startup-restoration handoff, with one Luna worker.
This extends `resilience-activity-seo-task.md`; it does not replace remaining scope.

## Contract

Use a small shared, versioned, allowlisted event schema. Generate a fresh server
request UUID and return it in `X-Orbsie-Request-Id`, including failed responses.
Client run UUID is a separate correlation field, validated before use, never an
authorization token. Propagate correlation into hosted operations without changing
their capability, lease, epoch or cancellation authority. Do not use owner IDs,
session IDs, project IDs, sandbox URLs or arbitrary request headers as log context.

Record bounded durations and aggregate byte/command counts at request admission,
provider start, first byte, first valid command, commit and termination. Distinguish
server stream completion from client application/commit success. Each layer emits
one terminal summary, correlated by request ID; one layer cannot claim another
layer completed. HTTP 200 and receiving headers are not completion evidence.
Record enumerated abort source, timeout, clean EOF without commit, parser/schema
failure, provider finish reason, and managed credential cleanup result separately.
A completed scene with failed credential persistence must remain distinguishable.

Use monotonic duration measurement; timestamps are for cross-system lookup only.
Use fixed phase/reason/provider values and bounded numeric fields. Model metadata
must originate from an admitted catalog entry; omit unsafe/unverified values.
Release identifier must be a validated build identifier, not arbitrary env text.
Never serialize Error objects/messages, request bodies, prompt/model text, URLs,
headers, account details, auth cache, geometry, screenshot data or entire projects.
Logging failure must not break generation or delay cancellation/finalization.
Avoid stream clones/tees with unbounded queues; observe the existing read path and
preserve backpressure, byte-for-byte output, abort and reader-release semantics.

Keep the latest bounded diagnostics locally (for example 20 runs / 64 KiB total),
without persisting credentials or world contents. Offer an explicit Download
diagnostics action near generation recovery/settings, with no automatic upload.
Include schema/build, correlation, provider/tier, timings, outcome, renderer mode,
coarse browser capability data and a short manual reproduction checklist. State
that content-free logs locate failures but cannot reconstruct a private scene.
Do not collect detailed device fingerprints. Clear diagnostics on local-data reset.

## Ownership and integration seams

Worker: shared diagnostics helper, generation adapters/public routes,
`chatgpt-durable-service.ts`/private transport where necessary for correlation,
`store.ts`, a small export control in `orbsie.tsx`, focused tests and replay script.
Root reviews every diff and owns milestone build/browser/deployment acceptance.
Read relevant local Next route docs first. Preserve concurrent safe edits; no
nested workers. Do not rewrite the logging infrastructure or silently retry models.

Existing `generation-diagnostics.ts` already sanitizes schema paths and provider
failure reasons. Reuse its projections; do not forward arbitrary `diagnostic`
objects received from a stream into logs. Existing test-only
`scripts/lib/generation-diagnostic-observer.mjs` only observes `/api/generate`;
extend it to hosted generation or replace its use with the bounded export seam.

## Acceptance

- Deterministic streamed fixtures: valid commit, UTF-8/JSON byte splits, clean EOF
  after valid edits, invalid final commit, provider error, thrown read, deadline,
  user cancellation, stale run, and credential-finalization failure.
- Both public provider routes return stable request correlation; hosted private
  records join correctly without leaking private endpoint/operation authority.
- Exactly one terminal event per layer despite competing abort/error/finally;
  counts/timings survive error paths and no false successful scene outcome.
- Sentinel credentials, prompts, model output, malformed headers and arbitrary
  Error messages are absent from console output and exported JSON.
- Export is size bounded and schema validated, clears on reset, downloads through
  a user action, and remains usable after reload if local retention is implemented.
- Replay command accepts a checked-in synthetic fixture and reproduces each
  expected failure classification without credentials or live provider calls.
- Targeted route/store/helper tests and typecheck; root reviews actual browser
  download. No live calls needed for this stage. Production log visibility after
  deployment is a separate acceptance check, not established by mocked console.

## Subsequent client and connection handoff

Stage 1 is server-only. Stage 2 adds a browser-owned bounded history and explicit
download; never expose a process-global server ring to a requesting user. Share a
pure schema/projector with the browser, not a module importing node:crypto, Buffer
or server env. `store.ts` has the authoritative client cursor.runId and scene apply
loop; `generation-connection.ts` constructs requests. Add correlation in a header,
not into model context. Preserve response-body schemas and staged scene validation.

The existing recovery controls are `.toast-actions` in `orbsie.tsx`; use a small
Download diagnostics action there and in settings, without adding another dialog
or debug content to the normal chat. `resetLocalData` in `store.ts` must clear this
history alongside IndexedDB worlds. Keep original errors and cancellation behavior;
only classify allowlisted diagnostics for the export. Reasoning effort, service
tier and the user's Quality/Balanced/Budget selection are separate fields.

Also cover startup connection recovery: configuration/session/status/catalog
stage, timing and enumerated failure class, without user/session IDs or auth data.
Control-route/private-host lifecycle correlation is a following bounded extension
where not covered by generation observations. A user reporting lost login needs
useful evidence even when no generation request began. Synthetic fixture outcomes
must not be labeled live-provider success, and scene success must be measured
after the client applies the validated commit.
