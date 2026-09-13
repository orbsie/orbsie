# Agentic review integration contract

Follow capability and internal image-transport tasks. Implement in two bounded
worker handoffs: server-owned run accounting/review admission, then review execution
and browser lifecycle. Do not enable a public review path until accounting works.
Root reviews both; no nested workers. User-facing outcome remains the entire loop.

## Result and lifecycle interface

Use a separate typed review result, not prose parsed from commit_revision.message:
version1, projectId, reviewedRevision, scope(visual+structural or structural-only),
verdict(accept or revise), bounded concise user-facing summary, up to8 concrete
issues with relevant entity IDs, and up to16 canonical scene commands for correction.
Accept requires no corrections; revise requires a concrete defect. Validate all
commands with existing capability/asset-policy/scene-operation checks against the
reviewed snapshot before applying. Do not weaken schemas or treat image text as
higher-priority instructions. A screenshot does not establish gameplay completion.
Keep scene-review metadata out of published game behavior and credentials.

Maximum3 model calls per user request: initial generation, review that may propose
corrections, final review. If the first review accepts, finish after2. Apply the
first review's valid targeted corrections, await their actual render and verify.
The final review is verdict-only: if defects remain, preserve working state and
show an honest partial result with explicit continuation. Never silently make a
fourth call or apply unverified final corrections and declare success. No transport
retries. Retain selected provider/model/effort throughout; never substitute models.

Supply original instruction, current scene, selected entity, bounded transformed
bounds/support/game-reference/worker-error observations and revision-bound canvas.
Use existing typed feedback where appropriate, but distinguish structural evidence,
model visual judgment and observed gameplay results. Missing image capability means
structural-only review with clear limitation; normal generation stays available.
Failed capture/image request preserves objects and shows review could not finish.
Do not call a label, schema check, fixture or catalog entry visual inspection.

## Handoff 1: atomic server run accounting

Current api/generate calls claimTrial once per HTTP request. Extend that transaction
to create an expiring opaque authoring-run record with identity, project, original
request fingerprint, provider/model, initial revision, remaining review slots and
phase. Do not store provider keys/images. Initial issuance and trial charge must
commit together. Preserve visitor/network prompt counts (one user request) and
shared daily inference ceiling: conservatively reserve up to3 global call units
for the bounded run; unused slots may remain spent, never create refund/retry loops.
Document the conservative accounting explicitly. Existing non-review requests keep
their existing behavior. Signed/opaque bearer run data must also bind to server
identity; possession of a client flag/model capability is insufficient authority.

Review admission atomically consumes at most two slots with monotonic phase and
expected revision. Reject expired, replayed, concurrent duplicate, cross-identity,
cross-project/model/prompt and backwards-revision requests. Tie accepted revision
to initial generation completion and subsequent approved correction operations;
initial failure/cancel cannot issue fresh slots. Keep existing sorted bucket lock
order. Additive migration only; test rollback and real database contention before
production acceptance. Hosted subscription/API-linked calls also retain bounded
request phases, while free requests require durable shared-key accounting.

## Handoff 2: reviewer execution and browser integration

Reuse internal validated text/image transport with a separate bounded review output
schema. Avoid copying large provider adapters; factor shared mechanics with targeted
regressions where needed. Support current API output-format capabilities and hosted
transport without raw JSON repair or hidden model changes. Return parsed review
metadata separately from scene commands; no generic approval phrase as verdict.

Refactor store.run's single fetch/consume block into bounded phases under the same
AbortController, runId, project and writer ownership. Keep original pre-request
undo baseline; internal reviews must not create extra user prompts/undo actions.
Preserve intermediate saved good revisions and durable generation journal semantics.
Current code saves each completed operation: do not defer all persistence until
review or replace the world on failure. Reject delayed/stale captures and replies
before any mutation, after every await. Stop/new request/reset/draft switch abort
the whole loop. Keep game input/physics/unrelated objects running during review.

Extend activity with truthful reviewing/correcting/verified/partial events and
short actual action/result summaries, never private reasoning. Announce only latest
change accessibly; show linked-provider usage implication before new multi-call
behavior runs. Completion wording must reflect final scope/verdict. No model data
or credential UI in images. Do not block provider login behind Orbsie email login.

## Acceptance before live milestone

Deterministic fixtures: visible bad result -> actual capture -> model corrections
-> changed render -> final acceptance; accept/no changes; final defects -> partial;
unsupported image -> honest structural scope; capture failure; cancel at each phase;
stale project/revision; provider error; undo original request; free exhaustion and
concurrent/replayed admissions. Cover both renderers, phone viewport and gameplay
continuity. Then bounded Luna live milestone per provider with exact saved images,
commands/verdicts, frame impact and token/latency evidence. Retain all failures.
Full flagship/physical mobile/publication gates remain required separately.

### Hosted private HTTP wiring

Root source check: scripts/chatgpt-host-server.ts currently wires its private
/generate handler directly to createChatGPTSceneStream(input,generator,signal).
The scene request schema and parser are not a generic reviewer transport. The
review execution task must add an explicitly authorized private review operation
through host handler/manager/service as well as the public review admission path;
merely adding reviewImage to createChatGPTGeneration cannot reach the hosted user
workflow. Preserve private host token validation, request ceilings, abort forwarding
and renewal/session identity. Test this whole private hop with mocked RPC before
live acceptance; do not call an internal function test hosted E2E.
