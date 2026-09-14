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

Use a separate authoring-run allowance ledger: existing generation_runs requires
an owned saved orb and owner_id, so reusing it would block anonymous free prompts.
Bind anonymous runs to the existing signed visitor identity and authenticated runs
to their existing secure identity; never require email signup or a saved cloud orb.

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

### Accounting source review and acceptance details

Root verified current `trial.ts`: `claimTrial` locks visitor/network/global buckets
in sorted order and increments each by one. The new transaction must charge one
visitor/network prompt but reserve three global inference units, with a capacity
check for the full reservation. Do not simply increment every bucket by three.
Remaining-prompt presentation must account for the selected request mode's global
unit cost. Keep the legacy one-call transaction behavior when reviews are disabled.
`trialIdentity` uses the signed HttpOnly visitor cookie and trusted deployment IP;
do not add a client-selected identity header or email-login prerequisite.

The existing `generation_runs` table has an owned-orb foreign key. The new ledger
must remain independent of that table for anonymous runs. Its opaque run ID is
not sufficient authority: every phase checks the current secure identity, original
provider/model/effort/prompt fingerprint, project and expected phase/revision.
Do not store API keys, images or raw prompts in the allowance ledger.

Initial completion must be recorded by the server's validated output lifecycle,
not a client `completed: true` request. Reject review after incomplete/failed
initial output. A revision number alone must not authorize an arbitrary substituted
scene. Define and test the scene/operation binding before exposing review routes.
Both adapters already advance a server shadow via `applyModelOperation`.
Browser-procedural jobs are intentionally normalized differently in the browser;
bind their canonical authoring source/provenance without assuming the server
shadow is byte-identical to the renderer's cached mesh representation.

Use additive schema and explicit initial/review/final-review transition methods.
Test issuance rollback together with the trial charge, daily-unit exhaustion,
parallel identical admissions (only one wins), expiry, stale revision, identity
changes, and initial failure. Root will verify actual PostgreSQL contention before
deploying/enabling the new accounting. No public multi-call behavior in handoff 1.

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

### Durable hosted-operation integration

The accepted private host lifecycle now uses operation-scoped managed processes
(`chatgpt-managed-operation.ts`), with an owner credential lease held through
confirmed seal, rotated-cache save and clear. Add review to that same lifecycle;
do not revive the legacy session generator or hold a refresh-capable process after
releasing its lease. Each review phase is a distinct bounded model call under the
same authoring-run identity and original provider/model selection. It may reuse
the sandbox service, but must acquire current credential authority and verify its
operation binding. Cancellation and failed review must finalize credentials with
independent cleanup headroom exactly as initial generation does. Test the private
HTTP hop through the real handler/controller and server orchestration, including
Disconnect during review and stale replies after project or account changes.

### Lifecycle wiring source review (2026-09-13)

The storage-only handoff does not make a client review flag authoritative. Before
public admission, add an internal completion/failure callback to each adapter and
wire it through its actual route/private host lifecycle. Call completion only after
validated provider termination and the final committed server shadow; await the
ledger transition before advertising review availability. Failure, cancellation,
callback/database error, or an incomplete stream closes review authority. Keep
phase tokens private to server orchestration and never return them in diagnostics
or browser responses. Test commit followed by provider error, trailing commands,
EOF without commit, cancellation after last command, and completion-write failure.

Source evidence: generation.ts currently stages commit only for structured output;
NDJSON emits commit immediately, and its finally block sees lastCommandType even
after a later transport failure. That is not an adequate ledger completion signal.
chatgpt-scene-stream.ts already defers commit until generator completion but needs
the explicit authoritative callback and private-host forwarding. Do not infer
success from the observability wrapper, a client flag, or an emitted commit alone.

Use a canonical scene-binding projection shared by server and browser. Validate
ordinary authored fields and preserve entity IDs, game program, transforms,
materials, stage and asset policy. Exclude presentation caches, history timestamps,
and baked model bytes. For browser-manifold retain the canonical recipe; for a
browser-procedural result bind canonical source/provenance and normalize its
rendered recipe/cache representation deliberately. applyModelOperation currently
removes procedural geometry in the server shadow while store.ts records its
source/hash and evaluated recipe, so hashing those Project objects directly will
not agree. The adapter must retain trusted procedural provenance while validating
operations. Test a legitimate procedural result plus substituted source, altered
transform, changed game rule and unrelated-entity mutation. Browser-produced
geometry is rendering evidence, not independent server authority.

API-linked users currently do not need Orbsie email authentication. Derive their
run identity from a server-signed browser identity, optionally additionally binding
the connected credential with a domain-separated digest; never introduce an email
login gate or store the credential. Hosted runs bind the secure owner/session
identity. Preserve exact provider-admitted effort strings: the existing ChatGPT
preset resolver supports provider-returned efforts, not just low/medium/high.

### Shared result interface

`src/lib/scene-review.ts` defines the versioned result schema and phase/scope/
revision-bound parser. Six targeted tests cover acceptance, first corrections,
final partial verdict, stale/evidence mismatch, contradictions, bounds and issue
references. Commit commands are excluded from model corrections: orchestration
owns the final correction commit. This parser does not authorize review calls or
establish semantic validity; integration must run existing asset-policy and scene
operation checks before applying any correction. It is not yet wired to providers
or the browser and is not evidence of a working inspect/correct loop.

### Internal storage acceptance

Commit5cedb2e implements the internal ledger and shared trial transactions. Root
review corrected token comparison, bigint decoding, phase/verdict validation,
first-acceptance finalization and failed-rollback pool eviction. Actual isolated
PostgreSQL ledger5/5 and legacy trial2/2 checks passed without skips; worker focused
unit/reset/trial suites14passed/1DBskip and typecheck passed. Evidence:
`docs/evidence/authoring-ledger-postgres-20260913`.

This reserves three shared global inference units per free authoring request while
charging one visitor/network prompt; unused reserved units are not refunded.
Legacy requests retain one-call accounting. Internal storage is accepted, not
production-migrated or wired to public review admission. Next handoff is
`docs/authoring-scene-binding-task.md`, followed by route/private lifecycle and
browser reviewer integration. The complete agentic loop remains unfinished.

### Private completion boundary source check

Current managed host generation calls `createChatGPTSceneStream` inside the private
executor (`chatgpt-managed-operation.ts`), while the public route receives a stream
through `chatgpt-durable-service.ts`. In that service, upstream EOF is followed by
credential sealing before the returned stream closes; sealing failure can therefore
error the returned stream after a scene has committed. Keep those outcomes distinct.

The next public/private wiring task must make completion authority cross this real
boundary. Either use an explicitly versioned authenticated private completion record
that the manager consumes, or validate/replay the authenticated host command stream
with the shared authoring accumulator on the web server. Do not serialize callback
functions, forward internal phase tokens to browser JSON, or rely on a callback that
exists only inside an isolated executor with no ledger integration. Avoid breaking
older private hosts by adding unsolicited strict-schema request-body fields. Exercise
the actual HTTP handler/controller, durable wrapper, seal failure and Disconnect.
