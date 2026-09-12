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
