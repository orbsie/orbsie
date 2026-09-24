# Browser authoring review handoff

Sep 24 amendment: the opt-in review budget is now at most four model calls
including creation: two correction-bearing `review` calls followed, if needed,
by one verdict-only `final-review` call. Existing in-flight two-slot runs skip
directly from their first correction to the final verdict. Each correction
pass requires a saved finding, a fresh cloud journal segment, fresh renderer
evidence, and an exact revision/digest check. The live OpenRouter test budget
remains capped separately at three calls; validate this four-call path with
deterministic fixtures until a new live budget is approved.

This task follows accepted public API and hosted review routes. Read
`docs/authoring-review-integration-task.md` and preserve the current
`src/lib/store.ts` generation journal, single AbortController/client run ID,
writer ownership, undo baseline and per-operation save path.

`/api/config` now exposes `authoringReview` only when the server switch and
durable session storage are configured, and `generationRequest` forwards the
hosted opt-in. Show a plain-language budget cue (up to four model calls per
request, including the first generation) before enabling it. Keep the feature
off when the server flag is off. Send the opt-in to both initial routes. Capture
the initial response's opaque `X-Orbsie-Authoring-Run-Id` privately; do not
persist it into a project, shared world, diagnostic export or game runtime.
The API initial route also returns `X-Orbsie-Review-Image-Supported: 1|0`,
derived from its admitted catalog model. Treat absence or any value other than
`1` as structural-only. Obtain the equivalent admitted capability for hosted
ChatGPT; a UI preference or browser guess is not authority for image input.
The UI submits through `src/components/orbsie.tsx` near `selectedConnection`
and calls `store.run`; carry the server config opt-in across that boundary
explicitly rather than reading a mutable global after the request starts.

After a clean initial commit and persisted revision, keep `building` and the
same controller active while awaiting renderer readiness. Use the selected
model's server-admitted image capability to decide whether to capture the
canvas; derive bounded renderer facts with
`sceneReviewObservationsFromCapture` and omit the image on structural-only
requests. Raw renderer errors and the PNG must not enter structural feedback.
If capture fails, leave the committed world playable and report review
incomplete. Check active
controller, writer, journal, project ID and exact revision after every await.

Send the original prompt/selected ID, original provider/model/effort/flags,
current project, bounded feedback and optional `captureSceneReview` image to
the provider-specific review route through `authoringReviewRequest` in
`src/lib/authoring-review-connection.ts`. The builder validates both opaque
run IDs, keeps the original client correlation, and removes stale API secrets
from hosted/free requests. Parse each JSON reply through
`parseAuthoringReviewResponse` in `src/lib/authoring-review-response.ts`
before applying commands; it checks the expected phase, project, revision,
scope, canonical correction commit and call count. On accept, finish after the
accepting review. On a first or second revise, apply only the returned validated
commands using the existing
`apply` function so geometry workers, game rules, cloud journal, save and
formation effects remain in sync. The server derives review asset policy from
the reviewed project; the browser's current `apply` closes over policy from
the initial project. Reconcile these at the review boundary before applying
corrections, then verify revision and canonical scene digest against the
server's resulting binding. After the first correction, capture the changed
rendered revision and send a second correction-bearing review when the ledger
reports two calls remaining; otherwise send the final verdict-only review.
After a second correction, capture the changed revision again before the final
verdict. A final `revise` is partial; no further correction is automatic.

Use `assertAppliedAuthoringReviewBinding` from
`src/lib/authoring-review-binding.ts` for the browser-side digest comparison;
it hashes the same authored projection and validates persisted procedural
source provenance. Do not compare serialized whole-project JSON or a digest
supplied by the response itself. Re-derive the correction
asset policy from the exact reviewed project before each correction;
the initial stream's policy was derived before that project existed.

Keep one history entry and one user-facing run for all phases. A stop, new
request, reset, draft switch, stale reply, geometry failure, journal conflict,
save failure or dropped connection must preserve the last committed scene and
cannot start an unapproved phase. Show truthful review/correction/verified or
partial assistant messages in the parent chat, through the existing two-second
activity coalescer. Do not display private chain of thought or claim visual
inspection when no image was sent. Mark completion only after the final
admitted phase and save succeed; keep gameplay input/physics running throughout.

Cloud generation journals mark each `commit_revision` as `complete`
(`src/lib/server/generation-runs.ts`), so review corrections cannot append to
that same durable journal. If signed in, begin a fresh journal segment from
the exact committed reviewed project before applying the server-approved
correction batch. Give each correction its own cloud run ID and sequence while retaining one
user-facing run, controller, history entry and authoring ledger run. Verify
the cloud baseline/save acknowledgement before applying corrections, and test
recovery across all segments; never append to a completed journal.

Fixture acceptance must include actual canvas capture, targeted correction,
changed rendered revision, final verdict; first accept; final partial;
structural-only; capture failure; abort at each phase; stale project and
revision; wrong binding/identity; free budget; replay; original Undo; cloud
journal; software/WebGL renderer; desktop and phone viewport. Then perform
bounded Luna live tests only at the integration milestone.

Build the rendered fixture from the existing `scripts/verify-scene-review-capture.mjs`
and `scripts/verify-visible-authoring.mjs` patterns: they already exercise
WebGL/software canvas capture, delayed worker geometry, IndexedDB, and the
real editor with synthetic provider streams. The review fixture should
intercept both initial and review routes, assert exact run/revision/image
scope at each request, and inspect the final playable canvas and saved world.
Keep live provider calls out of that deterministic fixture.
