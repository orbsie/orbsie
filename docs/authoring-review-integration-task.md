# Review admission and browser loop integration

Current accepted source through 7e26f9c provides initial API/hosted authority,
private completion transport, a two-slot ledger, browser capture, and a one-call
review executor. This contract drives the next implementation work under
`docs/agentic-review-loop-task.md`. Do not enable `ORBSIE_AUTHORING_REVIEW` in
production until all phases and provider paths are integrated and validated.

## Public API review route

Use a dedicated bounded POST route for `free`, OpenRouter, and Gateway. A separate
hosted route may share its server-only admission coordinator. Public input carries
opaque initial run ID, phase (`review` or `final-review`), original prompt/selected
ID, current project snapshot, original provider/model/effort/browser-modeling flags,
connection key only for linked API, optional validated revision-bound image, and
bounded structural observations. No client-supplied identity, digest, phase token,
completion flag, model capability, or image-support assertion has authority.
Refactor initial request fingerprint and identity derivation into one shared
server-only helper so initial and review phases cannot normalize differently.
Use the signed trial cookie for free, secure owner/session for hosted, and the
existing signed visitor/session identity for linked API without an Orbsie email
login gate. Recompute `createSceneBinding` from the submitted scene, compare exact
revision/digest in atomic `admitAuthoringReview`, then issue one model call. Resolve
the same catalog model, exact effort and output format server-side. Free uses
`FREE_MODEL` and the configured free Gateway key, with no second visitor/network
charge; the initial transaction already reserved three global inference units.

The server returns typed review result, canonical validated correction batch with
one server-owned commit when revising, resulting binding revision/digest, scope,
and remaining call count. It never returns a phase token, private completion record,
provider credential or raw model text. Require image support before admission when
an image is supplied; if unsupported, respond safely with zero model calls rather
than silently dropping the image. A structural-only request omits the image and
must be labeled honestly. First accept terminates after two total calls. First
revise yields an approved correction and leaves exactly one final-review slot.
Final review cannot return/apply corrections; remaining defects are a partial
result. No retries or fourth call. Failure/cancel after admission invokes bounded,
independent exact-token failure cleanup and consumes late completion promises.
A stalled database COMMIT acknowledgement must not grant review after cancel.

Use `X-Orbsie-Client-Run-Id` to correlate all phases, a distinct request ID per
HTTP call, and allowlisted phase/call-index/scope/outcome fields in structured logs
and local diagnostics. Never log prompt, scene, image, key, model text or tokens.
Follow the installed Next route-handler guide. Exercise actual route + admission
+ executor with mocked provider transport and real PostgreSQL for identity/replay/
cancel/late-COMMIT cases. No live calls in focused development tests.

## Hosted private review route

Use owner/session authentication and the managed operation's current private HTTP
transport. Add an authenticated, typed `/private/operation/review` with exact
operation/epoch binding and a capability preflight before inference, like hosted
initial scene completion. Reuse the managed runtime/credential lease, seal/save/
clear path and independent cleanup headroom. Execute the accepted review executor
inside that host through `createChatGPTGeneration`; return bounded parsed review
metadata and canonical corrections, never raw auth/runtime state. Web server still
owns ledger phase admission/completion using the authenticated private result and
current owner/session. Preserve model/effort exactly. Actual private HTTP handler
and managed-controller tests with mocked RPC must cover success, stale binding,
Disconnect, cancel, late reply, old-host unsupported capability, seal failure after
accepted review, and zero retry. A mocked `hostedGenerator` unit is insufficient.

## Browser loop

`store.run` currently uses one fetch/consume block around line 1149 and never
requests review. Keep its existing AbortController, client run ID, writer lock,
original undo baseline, journal and per-operation persistence. Request initial
`authoringReview:true` only when the feature is enabled and the account/call budget
has been explained in the UI. Store the returned opaque run ID for this user run;
never put it in diagnostics, shared published data or the game runtime. After clean
initial EOF and current persisted revision, await renderer readiness and capture
`captureSceneReview({projectId,revision,signal})` when the admitted model supports
images. Otherwise request structural-only review and explain that limit. On failed
capture, preserve good objects and report that review did not finish.

Send first review with the original request, actual current project, selected ID,
image/structural feedback and exact provider choice. Recheck active controller,
writer, project ID and revision after every await before mutation. If accepted,
finish after the second call. If revising, apply only the server-validated canonical
batch through existing `apply` so browser geometry workers, physics, cloud journal,
local save and formation presentation remain active. Verify returned revision and
canonical digest against the rendered/persisted result. Await a fresh capture at
that revision, then request the verdict-only final phase. A failed geometry worker,
stale reply, stop/new request/reset/draft switch, network drop or save error retains
last good completed scene and cannot silently spend or apply an extra call.
Preserve the original undo entry; internal phases are one user request. Keep normal
game movement/physics running. Add truthful review/correction/verified/partial
assistant messages in the parent chat, coalesced at no more than one nonterminal
update every two seconds. No private chain of thought or invented inspection.

Fixture acceptance: bad visible result -> actual canvas capture -> targeted model
corrections -> changed rendered revision -> final verdict; first accept; final
partial; structural-only; capture failure; abort in every phase; stale project;
wrong identity/scene binding; free budget; replay; original undo; renderer and
phone viewports; live gameplay throughout. Then bounded Luna live acceptance for
OpenRouter, funded Gateway and owner-signed-in ChatGPT, followed by full flagship,
publication and physical mobile gates from `prompt.md`.
