# Authoring scene binding and completion handoff

Prerequisite: accepted internal authoring ledger, with real PostgreSQL evidence.
This handoff supplies authoritative scene completion to that ledger; the following
handoff wires public review admission/execution and the browser review loop. No
claim of a working agentic loop until those paths pass their integration gates.

## Source evidence

- `generation.ts` applies commands through `applyModelOperation`; NDJSON currently
  emits commit immediately and only structured output defers it. A trailing provider
  failure must not authorize a review even if a commit was emitted earlier.
- `chatgpt-scene-stream.ts` stages its commit until generator completion; private
  orchestration must transport completion authority without trusting client JSON.
- `protocol.ts:applyModelOperation` replaces browser-procedural geometry with an
  undefined server shadow geometry. The browser store instead evaluates QuickJS,
  records `authoring.source/sourceHash`, and stores a browser-manifold recipe/model.
- `set_material` updates geometry tint; provenance retained for an unresolved
  procedural server shadow must reflect that update too. Replacing/removing an
  entity must drop its old procedural provenance.
- Project messages and generated model metadata are presentation/history/cache
  data; authored transforms, environment, game program, entity/group IDs, policies,
  stage and geometry authoring source are part of the scene binding.

## Bounded implementation responsibility

Own a shared canonical authoring projection/digest module and its focused tests,
then adapter internal completion/failure callbacks with targeted stream regressions.
Keep adapter input JSON and public responses compatible until public loop admission
is integrated separately. Root reviews shared interfaces and actual callback wiring.
Do not duplicate the entire provider adapters or add another scene interpreter.

Define a domain-versioned canonical serialization with deterministic object-key
ordering, validated finite/safe numbers, and explicit omission rules. Preserve array
order where scene/game/recipe semantics may depend on it. Hash the projection using
SHA-256 (not a client-provided digest accepted as authority). Normalize missing
optional groups consistently. Do not strip authored fields to make a test agree.

Retain a server-owned per-entity procedural provenance map alongside the existing
shadow. Populate it only from validated model commands; never accept that map from
public JSON. For a procedural command retain canonical source, collision, detail
and tint. Normalize an evaluated browser job's canonical authoring source to the
same representation; its recipe/model cache is not the editable source of truth.
Keep ordinary browser-manifold recipes in the binding. Ensure stale provenance
cannot override a later replacement, removed entity or mutated authored property.
Initial saved procedural entities must use the same canonical source representation.
Source hashes must be checked or recomputed, never treated as trusted input labels.

Expose internal lifecycle callbacks receiving the final validated shadow plus
trusted provenance (or its computed digest), not an observed line count or client
revision. Completion is awaited once only after successful provider termination;
any failure/cancellation invokes a terminal failure callback. Test callback rejection
and no unhandled rejection, no completion after a failure, and no second completion.
Do not treat a failed credential seal as proof that the scene failed, or vice versa;
scene authority and hosted credential cleanup are separate lifecycles.

## Required evidence

- Real production operation application followed by matching server/client digest
  for browser-manifold and browser-procedural results, including a later material edit.
- Changed source, transform, behavior/game rule, policy, unrelated entity, revision
  or project changes the binding. Reordered object keys and model cache metadata do
  not. Generated provenance is removed on replacement/deletion.
- No browser evaluation or Blender connection is required to compute the binding;
  geometry rendering continues locally in the browser.
- Both adapters: valid final commit completes once; missing commit, trailing command,
  provider error after commit, transport failure, cancel and callback-write failure
  do not expose successful completion authority. Use production stream parsing.
- Targeted tests/typecheck only; no live model calls in this handoff. Next integration
  must consume these callbacks through actual route/private hosted lifecycle paths,
  not just call an internal helper in a test and label it E2E.
