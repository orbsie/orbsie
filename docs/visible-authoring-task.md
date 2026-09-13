# Visible authoring implementation contract

Owner reports ChatGPT sign-in/prompts work, but creation is silent and lacks model
self-review. Full outcome in prompt.md's final section is visible activity plus
actual render → inspect → targeted revise. This first bounded task implements
truthful activity; it must not claim the inspection loop is already present.

## Task 1: real activity in the conversation

Ownership: src/lib/store.ts, a small typed activity helper if useful,
src/components/orbsie.tsx, relevant shared styles and focused tests/browser fixture.
Do not edit provider-browser-e2e or the parked route driver WIP. Other work exists;
preserve it. No nested agents, live model calls or deployment.

Current source: store.run starts around619, initializes building near690, consumes
commands in apply near720, evaluates/builds browser geometry near740–800, then
marks success at a final commit near980. UI conversation is in orbsie.tsx around
1500. Use these real lifecycle points rather than timers producing fake stages.

- Show a compact activity block in the conversation during creation and edits,
  including first-request waiting, named entity construction, actual local
  geometry preparation, applied changes, completion, cancellation and failure.
- Use short plain-language action/result summaries. Never expose private model
  reasoning, raw JSON, backend/runtime names or credentials. Never label ordinary
  schema validation as visual inspection or pretend the model is self-correcting.
- Tie events to the active run/project and revision where applicable; late worker
  callbacks after stop, new prompt, draft switch or failure cannot update another
  run's visible state. Bound retained events and avoid per-frame React updates.
- Preserve useful completed activity for the current request without confusing it
  with a new request. No changes to prompt charging, provider selection, free-path
  accounting, generation semantics, undo or saved scene schema are needed here.
- Accessible polite announcement of the latest change; do not re-announce the full
  event list each time. Compact/reachable at mobile widths with Stop still usable.
- Validate with deterministic delayed fixture commands and delayed worker geometry:
  first waiting update appears before first entity, progress changes as actual
  operations complete, terminal error/cancel states truthful, stale results ignored,
  and no false visual-review claim. Inspect desktop and narrow-phone UI.

Return files, targeted checks/evidence, assumptions and unresolved risks. Root
reviews every diff before acceptance. This does not complete Task 2 below.

## Task 2: actual model inspection and revision (separate bounded contract next)

Renderer capture must represent the requested project/revision after relevant
worker assets are ready. Send structural feedback plus that rendered view to the
selected vision-capable model, accept targeted corrections through the existing
validated operation contract, and recheck within explicit loop/time/usage bounds.
Unsupported visual input must be described honestly. Stop, stale revision checks,
last-good-scene preservation and gameplay continuity apply to the entire loop.
Activity from Task 1 will display actual reviewing/correcting events from this
loop once implemented. No mock timer or status text can count as inspection.

### Root source findings and proposed review contract

The current hosted bridge constructs only text input in
src/lib/server/chatgpt-generation.ts (turn/start near524); chatgpt-scene-stream.ts
ends after one generation and a final commit. The browser store immediately marks
that commit successful. Adding a progress label cannot provide self-review.

The official [App Server input documentation](https://learn.chatgpt.com/docs/app-server#turns)
defines image input with a URL, alongside text. The locally generated pinned
0.153.4 TurnStartParams schema also includes ImageUserInput with required type/url.
Neither schema alone proves a data URL is accepted by the hosted runtime: verify
that exact transport with a bounded fixture/decoder probe before live acceptance.
Do not enable arbitrary remote URL fetching or a browser-local filesystem path.

world.tsx already renders a 320x180 publication thumbnail; it has no revision or
asset-readiness binding, and SoftwareWorld has no matching registration. A review
capture therefore needs a renderer-neutral bridge with projectId, revision,
rendered revision, ready/failed asset IDs, image dimensions and cancellation.
Capture only the game canvas, with bounded encoded bytes/pixels. Do not capture
page chrome, account UI or developer overlays. Verify both renderers and reject
stale, failed or absent captures; never substitute a previous world's picture.

Proposed bounded user-request lifecycle: initial generation → render/readiness →
review with image + structural state + original request → apply any validated
corrections → render/readiness → final review. A review can return acceptance or
concrete corrections; it must not merely produce a generic approval phrase.
Maximum three model calls total (initial plus two reviews), with no transport
retries. If the final review still requests changes, preserve a partial result
and offer an explicit continuation; don't claim success. Keep the same selected
model/effort unless the user changes it, and disclose unsupported visual review.
The client must not be the sole enforcer of server-owned free-call budgets:
claim a free prompt once for the bounded request, then authorize remaining review
calls with a server-issued, identity/run/revision-bound, expiring allowance and
atomic counters. Replays or manual review endpoint calls cannot create extra
free inference. Paid-provider review consumes the linked provider's usage and
must be explained in the UI. Scope this lifecycle as one user request for undo
and cancellation while preserving recoverable intermediate good revisions.

Implement and validate transport/capture and the loop as cohesive bounded steps
with one worker. The exact contract may be refined after runtime probes; do not
quietly remove visual review, free-path accounting or final-check acceptance to
make a smaller test pass. Live acceptance must show an observed visual defect,
model-proposed targeted correction, subsequent changed render and final verdict.


Capture readiness implementation notes: WebGL Formation already knows pendingAsset,
asset.error and progress.current.value (0.9s formation); source refs must match the
current recipe before reporting ready. SoftwareGeometryEntry includes ready,
sourceRecipe and sourceStage, intentionally retaining last-good geometry during
replacement. Do not treat that retained geometry as the new revision's render.
The generated loader's global hash readiness alone does not prove a particular
entity is displayed. Bind capture to the frame after relevant entity resources
commit, with parcel transition complete; otherwise the model may inspect the
planet or an old mesh. Keep readiness/capture in renderer refs, not per-frame
store updates, and invalidate registrations on renderer/project unmount.

### Vision capability plumbing for the transport step

Root check 2026-09-13: public OpenRouter Luna metadata advertises
architecture.input_modalities=[file,image,text]; Gateway advertises
modalities.input=[text,image,pdf]. Current model-capabilities.ts parses output
modalities only and has no image-input capability. Add an explicit catalog-backed
image-input capability without changing ordinary text-generation availability.

Pinned App Server0.153.4 generated ModelListResponse schema includes inputModalities
(text/image); validateChatGPTModels currently strips it. Preserve bounded known
modality metadata through server/client catalogs in the transport step. Missing
metadata must remain unknown rather than silently claiming visual support. Keep
end-user model choices unchanged. Tests need explicit image support, explicit
text-only, absent/invalid metadata, and user-facing limited-review behavior.
These catalog checks are not successful image-inference acceptance.

## Creative quality follow-up (Astra investigation, 2026-09-13)

Read-only source investigation completed; no quality improvement is claimed yet.
After capture integration, implement a bounded shared-prompt refactor before the
controlled live review milestone. Preserve adapter-specific serialization and all
existing stable-ID, catalog/new-only, geometry and supported-gameplay constraints.

Order semantic sections explicitly: user intent/preservation, artistic intent,
playable experience, staged authoring, capabilities/output. Guide recognizable
silhouettes, deliberate proportions, coherent palettes, focal hierarchy, visible
requested details and believable contact/support without imposing a fixed style.
For games, prioritize a clear player action, reachable objective, visible feedback
and completion/reset where appropriate; build the essential route before scenery.
Retain concrete jump/bounce/path guidance. Label recommended complexity separately
from schema limits (currently prompt16 custom parts versus schema32).

The existing prompt in generation.ts is largely correctness/serialization policy;
modeling-policy.ts combines capability limits and a substantial tree-like example.
Example anchoring is a hypothesis to test, not an established cause of blandness.
Both adapters currently send complete scene recipes; defer snapshot compression
until dependency preservation and actual token savings can be measured. Avoid a
separate planning call or simply increasing output caps.

Capture/review must include actual transformed bounds and relevant game/geometry
observations, not just image approval: prior giant-mushroom evidence shows a larger
scale value still produced a physically shorter object. A screenshot cannot prove
playability. Review returns concrete entity-scoped defects/corrections or acceptance.

Controlled baseline-versus-change evaluation uses Luna only and unchanged call
caps/settings. Cases: blue-strawberry tree, asymmetric original sculpture, mixed
catalog garden, explicit new-only edit, giant replacement preserving unrelated IDs,
collect/bounce/moving-platform route, and input/timer score/reset game. Record every
attempt. Separate parse/kernel success, blinded visual recognizability/composition/
requested-detail ratings, observed gameplay completion, preservation, first-object
latency, total latency and token/cost measurements. Current Gateway malformed JSON
cause remains unresolved; do not infer it from a different older missing-brace case.
