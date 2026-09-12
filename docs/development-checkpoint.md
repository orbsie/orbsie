# Development checkpoint

- Owner capacity rule: stop all subagents and running tests if a reliable Codex usage-limit signal shows less than 20% of the Codex allowance remaining, or the owner reports that threshold. Read quota through local Codex App Server account/rateLimits/read (helper: /tmp/orbsie-read-codex-quota.py); use 100 minus usedPercent for the codex bucket. Last observed 72% weekly remaining. An unbounded goal token budget is not quota evidence.

Keep this handoff compact and update it in place. Never include secrets.

- Objective: implement all of `prompt.md` with E2E OpenRouter, Vercel AI Gateway
  and browser ChatGPT journeys. The full goal is incomplete.
- Policy: Astra low reviews/integrates; one Luna xhigh worker, regular/default,
  no nested agents, Fast off. Only Luna for live tests; user model choices remain
  unrestricted among supported models. Batch validation at meaningful milestones.
- Standing owner approval: up to five Gateway calls/test; OpenRouter remains
  two calls/run. Both use Luna only and 4096 output tokens/call,
  no automatic retries, for bounded OpenRouter/Gateway acceptance milestones.
  Do not treat this as unlimited inference. Sign-in must use computer use.
  Latest explicit next-milestone approval is narrower: one fresh create/edit test
  per OpenRouter/Gateway, maximum two calls each, 4096 output tokens/call, no retries.
- Production is source `7e74569` at https://orbsie.com, with smoke evidence
  in `docs/evidence/recovery-diagnostics-release`. Local HEAD must be checked on resume.
- Latest accepted feature: `60f91c7`, explicit Try again / Use last working actions.
  Original prompt/selection survive retry; latest valid increments survive failure;
  unfinished reservations are removed; stale recovery clears on revision changes.
  Eleven targeted tests, typecheck, production build, seven-request fixture browser
  regression passed. Evidence: `docs/evidence/generation-failure-recovery/`.
  Recovery and diagnostic changes are deployed; read-only production smoke passed.
- Priority bug: exact owner prompt `a tree with blue strawberries` failed on
  production free path (browser request confirmed). Gateway BYOK reproduction
  `57fee42` used one Luna low/default call,4096; HTTP200, seed5948ms, operation4
  INVALID_SCENE_JSON with finishReason null. No edit/retry; private key deleted.
  Sole worker `/root/republish_acceptance_harness` investigates parser/framing
  offline and diagnostic gaps; no more live calls assigned yet.
- Provider-logo request: official assets committed `fe5b647` in public/providers;
  connection-button UI hookup still queued after the generation failure.
- Mobile layout accepted in `db12ed8` and `042c486`: settled atomic checks cover
  portrait plus 844x390/667x375 landscape composer states, toolbar/HUD, recovery,
  touch controls and composer. Root visually reviewed. Two fixture requests,
  zero live calls. Physical-device and capture-loss limitations remain open.
  Earlier production build passed; latest mobile changes are not deployed.
- Input fixes committed `43c7482`: pointer identities, keyboard aliases, cancellation,
  lifecycle clearing, focused-button Space release. Real CDP multitouch/capture,
  ordinary release, touchCancel and synthetic-blur checks passed in editor/player.
  `input-touch-lifecycle/report.json` stays partial: direct releasePointerCapture
  did not emit a loss event even after movement; actual Android/iOS tests remain.
  Earlier mocked capture report is retained separately, not accepted as real touch.
  First real-touch failure was a success-toast overlap, corrected in db12ed8.
- Owner authorized Android emulator installation. Isolated AVD `orbsie_api35_phone`
  is booted as `emulator-5580` (root process session4786), Android35 Google Play
  x86_64, Pixel6 profile, KVM, SwiftShader,3GiB/2cores. Use SDK adb at
  `/home/marcos/android-sdk/platform-tools/adb` (system adb was unreliable).
  Chrome is installed; welcome flow awaits owner approval of Google Terms effective
  July30,2026. Root opened the terms link only; no consent/account created.
  Do not bypass onboarding or accept terms without the pending explicit approval.
- Owner mobile target: a recent midrange Android phone (not a flagship); exact
  physical model/OS not yet supplied. Emulator results remain separate evidence.
- Mobile is an explicit release gate (`63f7332`): full workflows and actual-device
  iOS Safari/Android Chrome validation. Emulation alone cannot establish completion.
- Diagnostics accepted in `a698cbf`; alias resolution/integration in `7e74569`.
  Forty-four generation tests, typecheck and local/remote production builds pass.
- Gateway input-game passed (`39b8c90`): two HTTP200 Luna low/default calls, cap4096,
  create/edit, reload recovery, export and standalone win/loss/restart. Evidence:
  `provider-e2e/gateway-input-game-diagnostics`, local built source7e74569. Key deletion
  verified; server/browser stopped. No account/cloud/publication in this run.
- OpenRouter post-union input-game passed (`694c904`): exactly two HTTP200 calls,
  creation/edit, recovery, export, standalone win/loss/restart. Evidence directory
  `provider-e2e/input-game-union-policy`; app source905b682 is operator-supplied.
- Gateway key also exists as sensitive Vercel production `AI_GATEWAY_TEST_KEY`.
  Never print it or commit local env files. Existing CLI deploy auth works.
- ChatGPT browser subscription consent/discovery/inference remains unverified.
  Chrome DevTools snapshot/click tools now work. Root opened Orbsie sign-in in
  page2; owner must enter credentials there, then root can continue connection.
  CUA itself still exposes no browser. Do not export browser cookies/profiles.
  Historical local-companion evidence does not satisfy browser-only acceptance.
- Republish evidence `republishing-browser-live/resume-report.json` proves same
  Vercel project, distinct deployments, served revision2, signed-out readiness,
  exact revision1/2 snapshots. Pending-window availability was not observed.
- Saved flagship evidence proves keyboard/touch crystal/portal win/reset and
  separate carry probes for all three platforms (`flagship-program-traversal`,
  `flagship-platforms`, `flagship-platform2-corrected`), not one continuous route.
- Modeling feedback, durable journals/checkpoints, share metadata and browser-only
  modeling are implemented. See current reconciliation in `docs/scope-audit.md`;
  conflicting historical rows are obsolete. Native Blender packaging is superseded.
- Memory-cap regression accepted `71c50c8`: valid recipe after4MiB allocation passes,
  above8MiB rejects as execution (not timeout); all13 procedural tests pass.
- Other open gates: hosted ChatGPT, complete provider-publication journeys,
  representative GPU/mobile performance and timing, and full requirement audit.
- Avoid status-only turn churn. Await the existing worker without spawning another;
  review its diff/evidence before acceptance, commit coherent progress, then move on.

## Current strawberry failure follow-up

- Reviewed acceptance source `43dc427`: Gateway failed JSON at operation 4;
  OpenRouter failed JSON at operation 3. One call each, edits skipped, no retries.
  Evidence and refreshed player source committed in `d4485c2`. Prompt example
  alone did not solve the failure; production fix remains open.
- One Luna worker is implementing an offline incremental `{"commands":[...]}`
  decoder. Each complete command must retain the existing schema and application
  validation. No malformed JSON repair, partial command emission, or scene reset.
  Integration must withhold final commit until the entire envelope is valid.
- Provider-format selection is still under investigation: current OpenRouter Luna
  catalog advertises `response_format` and `structured_outputs`; Gateway Luna
  catalog omits both. Do not infer support for every model. OpenRouter documents
  JSON object mode; Gateway documents JSON Schema mode. Verify the actual
  supported format before wiring production requests. Preserve arbitrary supported
  user model choices and choose compatibility transport before inference; no
  automatic paid retry on format rejection.
- Next: review decoder, implement capability-aware transport and integration tests,
  then a bounded live create/edit milestone. Do not repeat live prompt-only tests.
- Codex allowance last observed 71% remaining; stop agents/tests below 20%.

### Decoder review accepted

`e6c7cf5` adds the bounded incremental command-envelope decoder. Luna reports
20 focused tests plus typechecking passing; Astra reviewed the implementation
and requested immediate incomplete-command limits, chunk-consistent Unicode
accounting, and fail-closed callback handling before acceptance.

Next bounded task implements optional internal JSON object / JSON Schema
transports through the existing generation validation pipeline. Defaults and
route capability selection remain unchanged until reviewed and live-verified.
The schema transport uses non-strict schema guidance, not an unsupported claim
of full strict-schema compatibility. Final commit must wait for complete valid
envelope syntax and a non-truncated provider result. No live calls in this task.

### Streaming transport review accepted

`122e9a4` integrates optional JSON object / non-strict JSON Schema output with
the existing validation pipeline. All 39 focused generation/diagnostics/envelope
tests and typechecking passed. Final commit is withheld until complete valid
syntax and provider finish `stop`; truncation, refusal, missing finish and
commands after commit cannot commit. Existing NDJSON remains the default.

The next worker task selects formats from precise catalog parameters and adds
an exact provider/model operator override for controlled Gateway acceptance.
Unknown capabilities retain NDJSON. Override validation must happen before
free-prompt consumption. No production deployment or additional live calls yet.

### Capability selection accepted; bounded acceptance running

`ff6ea23` enables OpenRouter format selection from separate response-format
capabilities and bounded exact-model server overrides. All 44 targeted selector,
route, anonymous/free, catalog and preflight tests plus typechecking passed.

One Luna worker is running the first post-transport live milestone from that
source: one production build, Gateway JSON Schema via exact Luna override and
OpenRouter JSON object via catalog, exact strawberry prompt then material edit
only if creation succeeds. Maximum two calls per provider, 4096 output tokens,
Luna low/default, no retries or fallback. Test key is temporary/local-only.
This is not yet a successful acceptance or a production deployment.

### First envelope live milestone completed

From `ff6ea23`, OpenRouter passed two-call strawberry creation/material edit,
recovery, ZIP export and standalone playback. Gateway stopped after one create
call with INVALID_SCENE_UPDATE at geometry.job.recipe.nodes[2].id (custom);
the sanitized path alone cannot distinguish duplicate IDs from unreachable
nodes. No edit/retry. Temporary Gateway key deleted and server stopped.
Root scanned JSON/text/ZIP evidence for key patterns (none) and viewed the edit
screenshot: functional success, but tiny/sparse tree does not close visual QA.
Gateway semantic validation, visual quality and the broader acceptance matrix
remain open. No production deploy in this milestone.

### Recipe diagnostics and composition improvements

`caf36e0` adds allowlisted duplicate/unreachable-node diagnostic reasons, with
36 focused tests and typechecking passing. Validation remains strict.
`4884ad0` supplies conservative catalog bounds and exact scale/origin metadata,
plus parent-aware attachment guidance. 37 focused tests and typechecking pass.
JSON Schema prompts no longer duplicate the full command schema.

A Gateway-only acceptance milestone is running from 4884ad0: exact strawberry
prompt, material edit only after success, max two Luna low/default calls at
4096 output tokens, no retries. OpenRouter is not repeated in this milestone.
Regular Chrome was rechecked: Orbsie is signed out; its sign-in dialog is open
and the owner has been asked to sign in before browser ChatGPT acceptance.

### Gateway composition milestone: still failing

Source4884ad0 production build passed; one Gateway JSON Schema create call
failed at operation4. First diagnostic path is recipe.nodes[0].kind (invalid
union), followed by alternative-union schema errors. No edit or retry. This
is a new semantic failure, not evidence of duplicate/unreachable node IDs.
Non-strict provider schema guidance is insufficient for reliable commands.
Next worker investigates strict-schema compatibility offline; no further live
prompt-only retry. Codex allowance last checked:70% remaining.

### Recovery architecture follow-up

Root inspected store.ts: server error records currently throw only record.error;
the bounded diagnostic is discarded, unlike browser modelingFeedback. After
strict-schema compatibility work, add validated project-scoped generation
feedback to explicit retry/continuation requests so a model can correct its
previous schema error. No automatic paid retry. Clear stale feedback on success,
project/revision changes, and recovery dismissal; never forward raw payloads or
provider messages. This is pending work, not implemented acceptance.

### Strict wire integration accepted

`0705a17` implements the roughly29KB optional-presence/tuple codec;8 focused
tests and typechecking pass. `5403f61` adds the operator-only strict format,
wire decode before canonical validation, and strict Gateway route tests.
36 focused integration/codec/selector/route tests and typechecking pass.

A Gateway-only strict acceptance run is now assigned from5403f61: one build,
exact strawberry prompt, material edit only after successful creation, max2
Luna low/default calls of4096 output tokens, no retries or fallback. No default
Gateway transport or production environment has changed yet.

### Strict Gateway acceptance passed

Source5403f61 passed two bounded Luna requests for strawberry creation and
selected material edit, plus recovery/export/standalone playback. No fallback
or diagnostics. Strict mode was exact-override configured. Evidence directory
`gateway-strawberry-strict`; source is operator-supplied-unverified. Root viewed
edit screenshot and scanned text/JSON/ZIP for key patterns (none); temp key
deleted, local server stopped. Visual quality remains small/sparse and open.
Next release validation precedes deployment with the accepted exact Gateway
Luna strict override. Live free-trial, cloud/publication and ChatGPT gates are
not proven by this BYOK result.

## Current production release

Source0c2381c is deployed at https://orbsie.com as deployment
BKUuZkkhGMpAfs1e3UR5xRFQ68Kg. Production exact Gateway Luna override is
json-schema-strict. This includes provider logos, mobile landscape/input fixes,
validated JSON transports and catalog-aware composition guidance.
Release validation:987 tests passed across127 files;7 tests in2 files skipped;
typecheck passed. Production build and GET/HEAD smoke passed, with matching
runtime/five worker hashes, canvas/prompt presence, no page errors and all
provider SVGs served200. Evidence:docs/evidence/strict-generation-release.

OpenRouter JSON-object and Gateway strict local production BYOK create/edit,
recovery/export/standalone passed. Production live free-trial, cloud/publication
provider matrix, browser ChatGPT consent/inference, physical mobile and full
visual/performance targets remain unproven. User sign-in and emulator terms
answers remain pending. No physical/emulated Android currently attached.

### Android setup revalidated

The existing isolated orbsie_api35_phone AVD was restarted and Android15 boot
completion observed. It is at Chrome first-run consent; no terms accepted or
prompt submitted. Bundled Chrome is124.0.6367.219, so current-browser coverage
requires an updated environment in addition to physical-device acceptance.
Report:docs/evidence/android-emulator-ready/report.json. Revalidate the live
emulator handle before use; this setup report is not gameplay certification.

### Reviewed recovery changes after the production release

`5387592` adds bounded explicit-retry feedback across OpenRouter/Gateway and
hosted ChatGPT, including EOF error records and shared allowlists.86 targeted
tests and typechecking pass. No automatic model calls or paid retries added.
`c01a1fe` holds ChatGPT commits until successful generation completion and
rejects any later command;11 hosted-stream tests and typechecking pass.

Both changes are local, not part of production source0c2381c. The single Luna
worker is extending/running the existing actual-button browser fixture for
retry feedback with all generation intercepted, after one local production
build. Preserve the separate browser-only ChatGPT consent/inference gate.

### Retry feedback browser fixture accepted

Production build fromc01a1fe passed. The actual editor/button fixture passed
with7 intercepted generation requests and0 live calls/page errors. Both
selected/unselected retries forwarded safe project-scoped feedback; new prompts
after dismissal/restore did not. Last-good increments, unrelated entities,
selection and no-automatic-retry assertions held. Initial fixture probe failure
is retained: its selected new-only reservation triggered the client guard before
the intended server error. The final fixture omits that incompatible reservation
for selected edits; it does not weaken the application guard.
Evidence:docs/evidence/generation-retry-feedback-browser. Root reviewed harness
diff, report and bundled-source consistency. These recovery changes are still
local; production remains source0c2381c until the next deployment.

### Retry feedback production release verified

Production now serves source `ec48831`, deployment
`dpl_FiPeTt1ytHJbCZhAoYtjU6etg381`, aliased to https://orbsie.com.
Vercel inspect confirmed Ready; the existing GET/HEAD release smoke passed
with matching player and five geometry worker hashes, visible canvas/prompt,
no page errors, no external requests and no mutation requests. Evidence:
`docs/evidence/retry-feedback-release/report.json`. This verifies deployment
and loading, not live free-trial or ChatGPT generation acceptance.

Codex quota was rechecked: 32% used / 68% remaining. A read-only audit found
existing hosted ChatGPT runtimes lack bundle provenance checks and can retain
old code for their remaining ten-minute lifetime; one Luna worker is adding
stale-runtime detection with focused tests. Owner sign-in and Android Chrome
terms consent remain pending.

### Remaining recovery harness coverage gap

Read-only inspection of `scripts/provider-browser-e2e.mjs` found the
`interruptedRecovery` configuration still explicitly rejects providers other
than `chatgpt-local` (around lines 430–433). Modern hosted ChatGPT has separate
configuration handling that must be inspected before changing this guard.
Do not treat the historical companion recovery result as current browser
provider acceptance. Next bounded harness task should support and prove the
app journal/replay and stop/reload semantics for current provider transports,
using intercepted fixtures first and only the authorized bounded Luna calls
at the combined cloud/publication milestone. No additional live calls were
made during this inspection.

### Hosted runtime provenance review and migration

The bounded server patch passed 50 targeted tests and typechecking. Root
review found stale status would enter an error UI with only a refresh button,
preventing the instructed disconnect/reconnect; Luna is correcting that path
and the analogous model-list response before acceptance. No deployment yet.

Root ran `node --env-file=.env.local scripts/verify-chatgpt-host-registry.mjs`:
real PostgreSQL temporary-table/rollback verification passed ownership, claim
serialization, encrypted capability and artifact digest roundtrip, expiry and
stale release checks. Applied only the additive `artifact_digest text` column
with `ADD COLUMN IF NOT EXISTS` to development and production via their existing
local env files; information_schema verified the text column in each. No
credentials were printed and no model calls made. This migration is compatible
with the currently deployed code, which ignores the nullable column.

### Runtime provenance code review accepted; browser action check pending

Root reviewed the stale-code guard, nullable digest migration, exact provisioned
artifact hashing, explicit cleanup, shared safe error code/message and generation
error routing. The UI now exposes Reconnect ChatGPT for stale status/models/start
responses and performs logout before starting a fresh device flow on user click.
60 targeted tests and typechecking passed. These tests cover server guards and
response parsing; they do not prove the actual reconnect button. One Luna worker
is extending the intercepted browser fixture to check request ordering, no
automatic reconnect, and no start following failed logout. No live model calls.

### Stale reconnect browser validation accepted

Local production build from `fd1caea` and all 12 intercepted hosted ChatGPT UI
scenarios passed. Actual reconnect buttons prove no automatic logout/start,
logout before start, and no start after failed logout; status and models stale
responses both reach the action. Root reviewed the harness and report. Evidence:
`docs/evidence/chatgpt-stale-reconnect`. Local server stopped, zero external
requests or live model calls. Ready for deployment; live consent remains open.

### Hosted runtime provenance release verified

Production source `44c7fa1` deployed successfully as
`dpl_6UB9SXyPaKwmSRXRKMybikaeJzXN`, aliased to https://orbsie.com.
Production build/typecheck and GET/HEAD release smoke passed with matching
player/worker hashes, visible canvas/prompt and no browser errors or external
requests. Evidence: `docs/evidence/chatgpt-runtime-release/report.json`.
The databases were migrated before deployment. Real owner ChatGPT consent and
inference remain unverified; this release adds safe stale-runtime handling.

### Current provider recovery harness implemented

Root reviewed provider-aware Stop/reload recovery for OpenRouter, Gateway and
hosted ChatGPT. Reload restores API selection with the in-memory key or hosted
selection with account cookies; only historical chatgpt-local uses the companion.
Normal preflight sets budget2. Interrupted mode requires explicit
`ORBSIE_INTERRUPTED_GENERATION_BUDGET=3`; API/hosted guards reject invalid or
exhausted budgets before dispatch. The historical wrapper cannot infer budget3.
21 focused tests, typechecking and syntax checks passed; no live calls or builds.
This is harness readiness, not proof of live recovery. Gateway's earlier owner
allowance is up to5 calls/test; OpenRouter's most recent explicit milestone
authorization is2 calls, so a3-call OpenRouter recovery run needs approval.
Owner ChatGPT login/consent and Android Chrome terms remain pending.

### Gateway live reload recovery passed

Source `c586d74`: one bounded3-call Luna low/default run at4096 output tokens
per call passed actual reload interruption, durable checkpoint recovery,
explicit continuation, selected edit, input-game playback, ZIP/standalone and
fresh cookie-only cloud reopen. No retries/budget violations/fallback.
Evidence: `docs/evidence/provider-e2e/gateway-reload-recovery`. Root reviewed
report/image and scanned text/ZIP for key patterns; private key deleted.
Initial missing-cloud-state preflight made0 calls; corrected run was the sole
provider attempt. Publication/free trial/full visual quality remain unproven.
OpenRouter3-call approval and owner ChatGPT sign-in remain pending.

### Existing Gateway publication setup failures retained

The reviewed publication wrapper stopped before cloud lookup/publication: first
HTTP403 due to a mismatched local Better Auth origin, then HTTP401/User not found
after the local launch explicitly set BETTER_AUTH_URL to its loopback origin.
Both attempts made0 generation calls and0 publication requests; no deployment
handle exists. Reports are retained under gateway-reload-recovery-publication.
One Luna worker is comparing the successful recovery run's account/DB setup
with the publication setup read-only before any further login attempt.

### Gateway-authored recovery game published and verified

Project4a5d7783-c7fd-44e0-bf19-864bab9f9b08 revision9 published once as
dpl_8SXrutydgMwHjWxZxqSnsb2Z6WDf in prj_2sG67u1U0jO8mDEWT2lMWMkm64zi.
Exact publishable cloud and served snapshots matched the accepted Gateway ZIP.
Signed-out score/win/loss/restart passed with0 cookies/external requests/page
errors/model calls. Evidence: gateway-reload-recovery-publication. Root reviewed
report/image and checked credential cleanup. Codex allowance now66% remaining.
URL: https://orb-c8952b5b6fd77ac951a4-ant5977ut-grappeggias-projects.vercel.app

This connects the bounded Gateway create/reload recovery/edit/cloud/export
journey to actual publication and signed-out gameplay. Other provider stories,
mobile/physical performance and full flagship quality remain incomplete.

### Standalone touch controls and truthful help fixed

Root reviewed touch-layout state shared by controls/help, coarse-pointer and
maxTouchPoints detection, click/tap wording and legacy bloom gating. Five focused
tests/typechecking passed. Rebuilt standalone runtime passed actual CDP touch
score/win/loss/restart in390x844 and844x390 with visible nonoverlapping footer
and controls, zero external/inference requests or page errors. Evidence:
`docs/evidence/player-touch-layout`. Root reviewed harness/report/landscape
screenshot. Initial fixture root404 is retained. Physical devices/safe-area and
real mobile performance remain separate acceptance gates. Not yet deployed;
existing immutable published game still uses the prior player bundle.

### Standalone touch fix platform release verified

Source b13b0b4 deployed as dpl_7WoACnTsvcZai4G2h2Z8cBnqEdA4 to orbsie.com.
Production build/typecheck and GET/HEAD smoke passed; root additionally verified
exact player CSS hash because touch visibility depends on the stylesheet.
Evidence: docs/evidence/player-touch-release. Future exports/publications use
the new bundle; existing immutable deployments retain their bundled version.
One Luna read-only audit is checking standalone safe areas and touch interruption
against shared input handling; no extra live model calls.

### Standalone safe-area changes accepted

Export/publication HTML now includes viewport-fit=cover; header, score, footer
and touch controls use browser safe-area inset variables. Root reviewed CSS,
metadata, fixture assertions and landscape screenshot. Four CDP touch scenarios
passed (portrait/landscape, each zero and synthetic asymmetric notch/home
insets), including score/win/loss/restart,0 external/model calls/page errors.
Synthetic injection is explicitly not physical-device certification.

A publication recovery regression initially failed because its fixture hashed
pre-change HTML. Baseline test passed; updating only that fixture to the new
HTML restored22/22 publication+HTML tests. No route logic change was needed.
Typecheck/diff checks passed and player CSS rebuilt. Codex65% remains.

### Safe-area platform release verified

Source a2ffe54 deployed as dpl_FGqCJb3J8xarCcKLcRg6Z3pShE61 to orbsie.com.
Production build/typecheck and release smoke passed; exact safe-area player CSS
hash verified separately. Evidence: docs/evidence/player-safe-area-release.
Existing immutable game deployments still retain their old runtime until a
reviewed republish; no model calls were made for this release.

### Gateway revision 10 republish verified

The existing Gateway recovery world was saved with CAS from revision 9 to 10
and published once to deployment dpl_BrHgxz6AhGdqVYbVBEdsbthhLqSS. The first
harness comparison incorrectly retained private messages in its expected public
snapshot; that failure is preserved. The corrected read-only resume verified
the existing deployment without repeating authentication, writes or model calls.

Public JS/CSS hashes match the current player, viewport-fit=cover is present,
and the exact revision-10 publishable snapshot matches. Signed-out desktop,
portrait touch and landscape touch passed scoring, win, loss and restart with
zero cookies, external requests, generation requests or page errors. Evidence:
`docs/evidence/provider-e2e/gateway-reload-recovery-republish-resume/report.json`.
Root reviewed the diff and assertions. Physical mobile and flagship quality
remain unproven. Codex quota check reports 64% remaining.

### Mixed-asset publication payload coverage

A focused publication regression now submits a catalog tree plus procedural
crystal through the real publication route with mocked database/Vercel transport.
It checks both geometry kinds in project.json and exact packaged GLB, license
and used-assets provenance against local catalog originals. Existing mixed ZIP
and browser evidence was already present; this closes the payload test gap,
not live mixed-asset publication acceptance. Root reviewed the finished diff.
Worker validation: 25 publication/asset-bundle tests passed, typecheck and diff
checks passed. No live provider calls, deployment or authentication was used.

### Publication continuity harness evidence made durable

The live acceptance harness now records pending-window observation immediately
after its previous-release browser/snapshot check, before later polling can fail.
Terminal or wrong-served-revision responses record an unobserved window. A
failed replacement POST triggers one bounded signed-out old-release check and
then rethrows, with no retry. Root reviewed both changes and the regression
proving evidence survives subsequent polling failure. Twenty harness tests,
typecheck, syntax/format and diff checks passed. No live deployment was run;
previous-release availability during a live pending window remains unverified.

### Live pending publication continuity passed

At harness source 17797d6, one production test account and Orb completed two
publication POSTs without retries or model calls. Revision 1 remained browser
ready with its original snapshot after revision 2 submission; a subsequent
status still reported BUILDING with servedRevision 1. Revision 2 then became
READY with the changed snapshot in the same Vercel project. Both signed-out
browser checks had a ready canvas and zero page errors. Evidence:
`docs/evidence/publication-continuity-live/report.json`. Root reviewed the
ordered observations. Temporary credentials were deleted after success. This
proves bounded pending-release continuity, not gameplay or failed-live-deploy
continuity, which remain separate requirements.

### Free-trial failure observations added

Provider browser acceptance now captures free-response remaining quota and
refreshes trial status after failure. It compares saved scene checkpoints while
excluding message-only changes, reports advancing scenes as partial-unverified
with structural-only scope, and preserves the original error. Root reviewed
these limitations and restricted trial refresh to free-provider failures. Ten
focused tests, typecheck, syntax/format and diff checks passed. No live calls
were used for this harness change; production free inference is still pending.

### Production free strawberry create/edit passed

Harness 731462f against orbsie.com completed the exact prompt “a tree with blue
strawberries” and selected material edit with two HTTP200 Luna calls capped at
4096 output tokens each. Trial remaining moved 2→1→0; no retries or quota bypass.
Creation produced 11 operations, one catalog entity and four generated entities;
local reload, ZIP export and standalone readiness passed without external
requests or page errors. Evidence: docs/evidence/provider-e2e/free-strawberry-current.
Root reviewed report and edit screenshot and scanned JSON/ZIP text for credential
patterns. App source a2ffe54 is operator supplied, not independently attested by
this harness. This closes this bounded free creation/edit journey, not failure
preservation, input-game objectives, full visual quality or mobile acceptance.
The rendering remains visually sparse; do not claim flagship quality.

### Strawberry visual diagnosis

Read-only comparison of the saved ZIP and screenshots found one 114-triangle
Kenney catalog tree and four authored low-poly revolve berries without calyx
geometry. Standalone rendering shows the saved pink tint on trunk and canopy;
the earlier editor capture likely caught a transition. No material/loader/scale
fix is justified by this evidence. Sparse authored detail remains a visual
quality limitation. A bounded harness follow-up will inspect completion signals
so edit screenshots capture settled presentation, without new model calls.

### Live mixed free-world publication passed

Harness c900d94 published an explicit clone of the free strawberry export
(source revision13 → new cloud revision1) using one signup, one deduplicated
generated GLB upload, one save and one publish POST, without retries or model
calls. Deployment dpl_28MfnFdZZ2mCvvmfRg9yGdozLMgw served the exact cloned
snapshot and byte-identical catalog tree, license, used-assets provenance,
generated GLB and generated manifest. Signed-out browser readiness/canvas passed
with zero cookies, external/API requests and page errors. Root reviewed report
and exact file hashes. Evidence: docs/evidence/publication-free-strawberry.
Worker deleted its private password file. This closes this mixed-asset packaging
and public-loading journey, not full objectives/gameplay or physical mobile.

### OpenRouter flagship independent publication passed

Saved flagship ZIP revision30 was cloned to cloud revision1 and deployed once
as dpl_HFJEvnuPJeyPjkvyjGTzTPQAQvHx. Five unique generated GLBs, three catalog
GLBs, license/provenance files and exact public snapshot passed verification.
One signup/save/publication, no inference or retries. Signed-out readiness
passed. Evidence: docs/evidence/publication-flagship-openrouter.
Public traversal stopped before Chromium because the harness rejects project.game
in published mode while supporting it for ZIP mode. Original failure retained;
a bounded harness fix is in progress. Public gameplay is not yet proven.

### Published flagship crystal/portal traversal passed

Harness5965d6a tested the existing flagship deployment without new writes.
Desktop keyboard and390x844 CDP touch each collected all five crystals, jumped,
won at the portal and reset to score0. Both remained signed out; zero inference,
external/mutating requests, page errors or overflow were reported. Root reviewed
the ordered scoring/position checkpoints and contract. Evidence:
`docs/evidence/publication-flagship-openrouter/traversal-current`. This proves
public crystal/portal traversal, not traversal across all three moving platforms,
physical-device/mobile lifecycle or play during generation. Original preflight
harness failure remains preserved.

### Three independent platform carry checks passed

`docs/evidence/flagship-platforms-current` verifies keyboard landing and carry
on each of the three moving platforms in the immutable OpenRouter flagship ZIP.
Each check has21 consecutive on-top samples with matching player/platform
displacement, no inference/external/mutating requests or errors. Root reviewed
provenance and clarified that the verifier reloads between platforms. This is
three independent interactions on ZIP runtime3d2fa966, not continuous crossing
of all three or verification of the newer public runtime. Those remain open.

### Sequential local platform route observed

Optional FLAGSHIP_SEQUENTIAL=1 uses a single page and real keyboard input for
platforms1→2→3, with descending-contact/carry proof at each landing. The bounded
saved-ZIP run passed with no observed ground contact in sampled telemetry and
zero external/inference/mutating requests. Root corrected the absolute contact
claim to sampled observations, and required failed-stage retention/key cleanup.
Syntax, existing helper test and diff checks passed; no redundant browser rerun.
Evidence README records the post-run label correction and older runtime limit.
Public/current-runtime and touch crossing remain unverified.

### Public sequential platform attempt failed

One read-only attempt with harness58da795 passed exact flagship snapshot
comparison but failed to land on platform2 after platform1 carry. Platform3
was not attempted;17 sampled ground contacts were recorded. Public runtime
825e0fea differs from ZIP runtime3d2fa966. This difference does not isolate
product vs driver cause. Zero inference/external/mutating/API requests or page
errors. Evidence: docs/evidence/publication-flagship-openrouter/platforms-sequential.
Read-only trajectory/contact diagnosis is next; no retry or game modification.
