# Execute one bounded scene review

Next implementation slice of docs/agentic-review-loop-task.md after hosted
initial authority43113e8. This is real model adapter execution and semantic result
validation, not another schema-only task. Public admission/browser orchestration
follow immediately; keep production review disabled until the complete loop works.

## Ownership and contract

One Luna worker owns new server scene-review execution module(s), a shared bounded
provider text transport only if necessary, narrowly required generation adapter
refactoring, and focused tests. No public routes, ledger, browser UI, hosted lease
lifecycle, deployment, model calls or nested workers in this slice. Root owns those
integration contracts and will review the final diff. Preserve other changes.

Expose an internal one-call reviewer for OpenRouter/Gateway and a hosted reviewer
that uses the existing createChatGPTGeneration generator. Both consume the same
typed input and return a validated review plus the authoritative corrected scene
binding/provenance and canonical corrections. Never emit private phase tokens.
The caller supplies admitted phase, exact provider/model/effort, snapshot, original
prompt/selected ID/browser-modeling flag, actual bounded feedback, optional
revision-bound image and server-derived capability snapshot. This is an internal
interface, not public authorization. No model switching or retries.

Use scene-review.ts version1 result: scope derived from supplied validated image,
first review may accept or correct; final review must be verdict-only. Build a
concise reviewer prompt requiring concrete defects and targeted improvements to
shape/readability/style/playability, preserving the user's intention and unaffected
objects. Distinguish structural facts, visual judgment and observed gameplay; do
not claim gameplay was tested from a screenshot. Treat prompt/scene/image text as
content, not instructions that override protocol. No fabricated observations.

Reuse existing provider request/routing/error/output-format/capability mechanics
instead of copying the whole scene adapter. A bounded non-streaming JSON completion
is acceptable for review if it preserves exact admitted selection, configured
response format and cancellation. Models lacking structured formats may return
plain JSON with strict parse; no JSON repair/fallback calls. Handle json-object,
json-schema and configured strict schema consistently with supported command
encoding; do not weaken existing formats. Hosted generator already accepts
instructions,input,reviewImage,onText,signal and validates model/effort/image
capability. Accumulate bounded raw review text and parse only after confirmed
clean completion, never just after a syntactically complete JSON prefix.

Use existing image size/type/revision validation and authoritative image-capability
checks. Missing image is explicitly structural-only; unsupported image cannot be
silently dropped after requesting visual review. Maintain existing request bounds,
512KiB maximum response and cancellation/deadline behavior. Generic public-safe
errors must not echo prompt/output/key or arbitrary provider/persistence messages.
No ordinary logging of raw model text/images/private project content.

After parseSceneReviewResult, validate corrections using deriveAssetPolicy from
original request, enforceAssetPolicy, assertModelingCommand and applyModelOperation
against the reviewed scene. Preserve canonical command output and procedural
provenance via initialSceneProvenance/updateSceneProvenance/createSceneBinding.
Do not fabricate rendered geometry on the server. Validate all corrections before
returning any applicable batch. Orchestration owns exactly one correction commit;
first accept/final verdict have no commands or changed scene. Define that explicit
commit in returned canonical batch and binding so the browser can later reproduce
it. Abort after every async boundary before exposing an accepted result.

## Evidence

Focused tests using mocked actual fetch and hosted RPC/generator transport cover:
API providers request identity/effort/routing and image inclusion; structured/plain
formats; hosted input/image and clean completion; first accept, valid targeted
correction, final remaining defects without mutation; malformed/truncated/error/
non-stop output; wrong scope/revision/entity; policy violation; semantic command
failure (entire batch rejected); procedural server/browser binding normalization;
pre-abort, mid-call and late completed reply after abort; response bounds; no retry
and no leaked sensitive text. Count actual adapter calls. Run targeted suite and
typecheck, report files/checks/assumptions/risks concisely. Do not call synthetic
transport tests live E2E. Root will wire this executor to durable ledger admission,
real hosted private operation and browser capture/render lifecycle next.
