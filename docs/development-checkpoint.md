# Development checkpoint

Sep 23 next independent handoff: `docs/stream-resilience-acceptance-task.md`
pins the unchecked stream-resilience requirement to actual provider/route/client
failure boundaries. The existing clean-EOF toast implies connection loss without
evidence; synthetic fixtures do not yet prove interrupted-run save/undo recovery
or the cause of frequent production failures. Implement after browser review
integration with one Luna worker, then gather live provider evidence when access
and Gateway credits permit. No stream-resilience completion claim yet.
`docs/authoring-live-review-acceptance-task.md` defines the subsequent live gate:
the older provider harness alone does not prove review calls, and the five-call
Gateway cap requires separate create/edit tests when each may use three calls.

Sep 22 integration seam: `2b601cd` exposes `authoringReview` from server
configuration and preserves hosted opt-in; `ee97d7a` adds the API model's
admitted image-input header. Browser review request/response contracts are
`02d689b` and `bdf82a3`; shared structural feedback is `bf46488`. Private
ChatGPT review transport `e468f32` is accepted after root review: real
backend→handler→managed-runtime HTTP fixture proves accept, stale epoch and
abort/late reply; root 52 focused tests, typecheck, host bundle build and
format pass. Hosted web orchestration `d8b1504` is now accepted: credential
lease/status preflight precedes ledger admission, private results are bounded
and replayed independently, and seal/save/clear plus an exact-token failure
fence precede the public result. Root 56 focused tests, whole-tree typecheck,
format/diff checks, host bundle and production Next build passed. The real
durable→private HTTP→managed handler fixture includes accept, binding/epoch
tamper and held-work abort with mocked RPC/vault/admission. No live calls.

Sep 22 root browser handoff: `4c0c513` adds
`assertAppliedAuthoringReviewBinding` for the browser to recompute the authored
scene digest after correction; its focused test and format check pass. Browser
task `docs/authoring-browser-review-task.md` now requires this guard, re-derives
correction asset policy from the reviewed project, and pins the review opt-in
at submission. It also requires a fresh cloud journal segment for corrections:
the initial `commit_revision` closes the first journal. Next single Luna task
is the browser review loop in that document. Feature remains off and undeployed;
do not claim browser/live-provider E2E until the loop is reviewed and integrated.

Updated 2026-09-22. Full goal remains **all prompt.md, E2E validated with
OpenRouter, Vercel AI Gateway and ChatGPT**. Not complete. Previous detailed
acceptance history: checkpoint-history/2026-09-13-before-durable-release.md and
checkpoint-history/2026-09-13-before-client-diagnostics-release.md.

## Execution

Astra low/default owns contracts, every diff review, integration and acceptance.
One Luna xhigh/default worker, no nested agents, Fast off. Hosted initial authority
handoff accepted after root review of final source, actual private HTTP wire
mutations, safe writer errors and non-cooperative late completion. Worker affected
five-suite61passed, HTTP/backend36passed; final private HTTP22passed and final
whole-tree typecheck passed. Root private-host bundle build and node syntax check
passed. Evidence authoring-hosted-authority-20260914. Private completion records
are negotiated before inference, consumed only after clean private EOF and stripped
from public output. Cancel fences completion; post-scene credential seal failure
stays separate. No live calls/deployment or complete browser review-loop claim.
Reviewer executor accepted after three focused handoffs and root final prompt
correction. Worker23targeted tests/typecheck passed; root final6targeted tests passed
(17 omitted by name filter), whole-tree typecheck and diff check passed. Actual
QuickJS expression evaluation and browser-style operation/provenance binding match
the server correction result. Evidence scene-review-execution-20260914. Both API
providers and hosted generator adapter return validated correction batches; exact
selection, configured format, API output cap, clean completion, image scope,
semantic all-or-none application and cancellation tested. Hosted generator is mocked;
not actual private-hop/browser/live E2E. No public review endpoint enabled/deployed.
Next is public review admission + managed hosted review operation + browser loop
under docs/agentic-review-loop-task.md, including its recorded review-ledger late
COMMIT cancellation gaps and diagnostics. Do not repeat finished investigation.

USAGE RESUMED: authoritative quota 31%used/69%remaining on 2026-09-22.
The owner's below20% stop rule remains active. Goal returned to active after
prior blocked audit. Review-phase ledger fence accepted locally: signal-aware
bounded admission/completion, retained exact private token through COMMIT
acknowledgement, independent cancellation cleanup and stale-token isolation.
Worker and root confirmed 21/21 ledger tests on real PostgreSQL15 and whole-tree
typecheck. No model calls. Root committed public/hosted review handoff contracts
54173bb and 18181a2. Public review coordinator/route for free, OpenRouter and
Gateway is accepted locally: shared signed identity/fingerprint, exact scene
binding admission, catalog/image preflight, one-call executor, failure cleanup,
typed review diagnostics and fixed low reasoning for recommended API models.
Root final 47 focused tests passed on real PostgreSQL, with typecheck and format
checks. It remains feature-flagged off and is not browser E2E. Next single Luna
task is the managed hosted private review transport in
docs/authoring-hosted-review-task.md; browser task follows in
docs/authoring-browser-review-task.md. Root committed the earlier
review-route/browser contract ef8e773. Initial/editor
review still not wired or deployed; current E2E objective remains incomplete.
Gateway credit read 2026-09-22 HTTP200 still -0.0033684 with zero model calls;
evidence docs/evidence/gateway-credit-check-20260922. Owner asked asynchronously
for funded test key/credits, no key requested in chat. CUA browser inventory on
2026-09-22 exposed no browsers/apps; owner signed-in Chrome is not yet selectable
in this session. Preserve owner request to use existing signed-in browser and
computer use for GitHub. These external blockers do not stop local integration.
Sep 23 read-only credit recheck remains HTTP200 -0.0033684, zero model calls
(`docs/evidence/gateway-credit-check-20260923/report.json`); current CUA
inventory still has no browser or app surface. Do not run paid Gateway
inference until credit is positive.


Initial API task finished. Root
accepted final API initial issuance/completion/failure wiring after three focused
review fixes. Retained initial token fences abort during COMMIT acknowledgement;
review admission atomically replaces it. Pool acquisition and local DB lock/query
waits are bounded, late acquired clients released. Free opt-in charges one prompt
and reserves three global units atomically; linked API has no email/free-charge
gate. Existing one-call path preserved. ORBSIE_AUTHORING_REVIEW=1 plus request
opt-in required; production not enabled, no public review endpoint/browser loop.
Root seven integration checks passed (no skips), including actual PG durable
commit held before acknowledgement -> cancellation -> failed -> review denied,
production route/parser malformed output and scrubbed writer rejection. Worker
54route/ledger compatibility checks,6PG ledger checks, final6pool acquisition checks
and typecheck/format passed. Evidence authoring-initial-integration-20260914.
No live calls, production migration/deployment or browser E2E in this handoff.
After hosted authority: reviewer execution and browser integration under
docs/agentic-review-loop-task.md. Full goal intact. Root separate accepted-source
production build2d02761 passed in/tmp/orbsie-authoring-initial-build-20260914.
Desktop/phone synthetic diagnostics regression passed, root viewed screenshots;
raw parser toast wording remains a recorded recovery UX gap. Evidence
authoring-initial-build-20260914. Build5290/fixture66708 exit0; server15549 stopped130.
This excludes active worker WIP; no deployment, live calls or physical-device claim.
Synthetic PG15 container orbsie-authoring-route-20260914 stopped and auto-removed
after acceptance; only synthetic test data. Initial integration commit3a97e3f.
New clean-context spawn failed host thread limit; reuse existing worker.
Ledger5cedb2e accepted after root fixes/review and actual PostgreSQL5/5 plus legacy
trial2/2 tests (zero skips). Worker unit/reset/trial14passed/1DBskip and typecheck
passed. Evidence authoring-ledger-postgres-20260913. Internal storage only; no
production migration/deployment or public review wiring yet. Temporary PostgreSQL
container stopped after acceptance; auto-removes, synthetic data only.
Shared typed scene-review result interface39a5bce: six targeted tests and typecheck
pass. Not wired to models/browser. Lifecycle/procedural-binding source review
9f8e7dd and next task6eddec8. Logging and SEO remain deployed and accepted.
Root owns release evidence, checkpoint, deployment and integration review.
Private completion-record schemaaf2213e is now wired through the authenticated
host transport in43113e8; schema13focused tests preceded the integration evidence
above. Initial/hosted contracts9d819f6 are accepted locally. Production enablement
waits for the complete bounded review loop.
Binding accepted after root regressions: production server/browser procedural
digests match, trailing NDJSON commit->command->commit fails without completion,
and pending-hook cancellation fails once and consumes late results. Shared
abort-aware lifecycle controller; ordinary Manifold recipes retained, source hashes
and stale provenance checked, failure-only hooks cannot turn failed or cancelled state into completion.
Worker broad targeted pass54tests before final two fixes; final focused30tests,
typecheck/format/diffcheck passed. Root reviewed all final changes and independent
production-path probes. Evidence scene-binding-review-20260914; rejected baseline
scene-binding-review-baseline-20260913 retained. No browser/live-provider E2E claim.
Important next integration constraint: callback AbortSignal alone cannot cancel a
DB transaction. Carry cancellation through lock/commit and inspect settled ledger
state; failure cleanup needs independent bounded headroom. Contract appended to
docs/agentic-review-loop-task.md. Do not enable public multi-call yet.
Root added flagshipJourneyAcceptance to every provider report/CLI:12focused
contract tests and2follow-on tests pass; two historical partial reports correctly
remain incomplete. Evidence flagship-journey-gate-20260913. Actual seven/undo/
standalone/publication traversal producers remain required. Whole-tree
typecheck passed with the first binding handoff; its behavioral review failed.

Quota last31%used/69%remaining: stop workers/live calls below20%. Read
/home/marcos/.cache/orbsie/read-codex-quota.py; stop workers/livecalls below20%.
Goal token accounting is not subscription quota. Live model tests Luna only;
end-user model choice unrestricted. API4096 output/call, Gatewaymax5/test,
flagship3calls, no blind retries. Hosted180s/512KiB are runtime/output bounds.
Never echo credentials. Use completion notifications, avoid status-only turns.

Browser availability rechecked Sep14: CUA getState still reports
CUA_REPL_ENABLED_SURFACES required. Registered Chrome DevTools list_pages works,
but existing ChatGPT page3 snapshot shows Log in/Sign up and OpenRouter page2 is
on sign-in. No new login flow, cookie access or raw CDP; owner signed-in profile
still unavailable. Do not treat the reachable signed-out profile as owner E2E.

## Production and accepted release

Production https://orbsie.com ->
https://orbsie-m7loroa8a-grappeggias-projects.vercel.app, source **4a9d2d6**.
Isolated checkout /tmp/orbsie-durable-release-20260913 at4a9d2d6. Local and Vercel
builds passed; deploy69452 terminal0, alias confirmed. Public/server build IDs
set4a9d2d6. Live crawler checks passed, including an existing shared world with
its own canonical URL and noindex metadata. Built desktop/phone diagnostic
regression passed. Evidence seo-live-20260913, seo-production-build-20260913 and
seo-main-flow-regression-20260913. Localserver90973 stopped. Zero model calls.
Prior logging b518e68 actual runtime log correlation and download/startup fixtures
remain accepted; startup480782d evidence in chatgpt-durable-deployment-20260913.
Release generated next-env/player runtime/source dirty; preserve before advancing.
Previous ecaacaf generated outputs stashed safely. Old checkout
/tmp/orbsie-chatgpt-release-4eb9ce8 and stashes preserved.

CLI /home/marcos/.local/bin/vercel, scope grappeggias-projects, projectorbsie;
project metadata copied into release .vercel/project.json. Credentials configured.
Protected production env at /home/marcos/.cache/orbsie/durable-login-production/
production.env0600 (parent0700). Do not print or copy into browser/test reports.
Vault base and additive intent production schema already migrated/verified.

Durable foundations and integration now deployed: encrypted owner-bound cache,
exclusive lease/epoch fencing, isolated authfile import/seal, owner-lock admitted
initialization, initial-login intent distinct from legacy migration, atomic revoke
and owner-host snapshot, status/models/generate reconstruction, rotated-cache save,
independent bounded cancel/finalize cleanup. Actual pinnedCodex0.153.4 empty-runtime
privateHTTP tests passed; real PostgreSQL races/abort/rollback passed separately.
Root corrected authority/deadline/release-before-stop gaps; detailed evidence in
archive. Actual provider refresh/restart/renewal still unproven.

Startup480782d: versioned provider+tier only in localStorage, guarded config/session/
status/catalog restoration, exact remembered tier, inline Retry/Reconnect, manual
change wins, explicit Disconnect clears, no free submission while restoring.
24focused tests/typecheck passed. Root corrected literal JSONnull BetterAuth
missing-cookie handling (confirmed library and actual production response).
Root browser fixture requires exactly1 synthetic Budget/Luna-low request AND final
assistant reply; reload/disconnect/config+session+status retry/malformed session/
delayed config/manual switch pass. Dev evidence chatgpt-startup-restore-20260913;
production-build evidence chatgpt-startup-production-build-20260913, commit81ef1bd.
Earlier run5 falsely claimed prompt success with0requests; rejected, not acceptance.
Earlier apparent session hang was StrictMode fixture failure; outages now recover
explicitly instead of depending on number of dev-mode startup requests.

Quiet activityecaacaf: intermediate messages coalesced at2seconds, first/terminal
immediate, stale timers cleared, geometry/input unthrottled;11focused tests.
Built desktop1440x1000/phone390x844 flat-message fixture passed, root viewed phone;
evidence quiet-chat-browser-20260913. Direct Quality/Balanced/Budget dropdown and
flat chat already deployed. Capture/creativeprompt/capability/image transport and
40minute bounded privatehost lifetime included; actual image/quality/provider proof
remains separate. No full inspect/correct loop yet.

## Remaining implementation and acceptance (preserve full prompt scope)

1. Logging/export/replay implemented and deployed (see below). Actual recurring
   interruption diagnosis and provider recovery acceptance remain. Clean EOF
   without commit alone does not establish network failure. Optional further
   private-host/control-route lifecycle logs remain a following extension.
   Contract resilience-activity-seo-task.md.
2. Actual agentic inspect/correct/finalverify loop: agentic-review-loop-task.md.
   Atomic anonymous/auth run ledger, reserve3callunits, max2reviews, same provider/
   model/effort, revision-bound image/typedverdict, oneundo/runcontroller, honest
   structural-only feedback if images unsupported. No hidden fourth call/retry.
3. Real owner ChatGPT create/edit/recovery/>10min renewal/reload/export/publish;
   actual image ingestion; OpenRouter OAuth callback distinct from APIkey success.
4. Gateway last ae3a478 Luna4096 returned seed then INVALID_SCENE_JSON op2,
   issues[]/finishReason:null. generation-framing-debug-task.md requires bounded
   private response capture/replay and sanitized regression; no blind retry.
5. Fresh3call flagship EACHprovider: playable duringgeneration, bounce5winreset,
   mushroomedit, slowplatform+2=>7winreset, Undo5winreset, reload/export and fresh
   signedout publication winrestart. provider-live-gameplay-task.md. Old immutable
   artifacts use old runtime; do not mutate them to manufacture acceptance.
6. SEO accepted on deployed4a9d2d6: homepage-only sitemap, crawler metadata and
   server-rendered text; shared worlds have own canonical and noindex. Future
   opt-in world discovery requires an explicit consent contract.
7. Unbounded world/navigation, both renderers/mobile/save/publication: contract
   unbounded-world-task.md. Current radial8.4 clamp/camera constraints unresolved.
8. Code-free browser-only ChatGPT OAuth remains feasibility requirement. Official
   docs still show localhost callback; external tokens require host-owned auth.
   No proven Orbsie HTTPS client/subscription entitlement yet. Device-code flow
   is interim, not completion. ai-connection-priority.md. No cookie copying.
9. Licensed asset collection/mixed-new-only/performance and browser-only modeling;
   10KenneyCC0/procedural evidence partial. No user Blender installation/connection.
10. Recent midrange physical Android+iOS Safari fullflows/perf, all freebudget/
    cancellation/isolation/UX checks, every remaining prompt.md item, GitHubpush.

## Access and resources

Owner requires existing signed-in Chrome. CUA rechecked after ledger acceptance: CUA_REPL_ENABLED_SURFACES
required. DevTools reachable profile signed out of ChatGPT/OpenRouter; not owner
browser. No more login tabs, rawCDP or cookie copying. Do not repeat unchanged
access checks. Browser access alone does not block available implementation.
GitHub operations via computer use; push pending.

Android emulator API35/Chrome124/2cores3GiB/SwiftShader preflight and saved Gateway
world replay passed (7score/win/reset/loss/restart), root viewed6screenshots;
android-player-replay-20260913. Not new generation/currentpublication/physicalperf.
Emulator removed/stopped; ADB physical devices absent on lastcheck. Terms consent
for specific USJuly30,2026 Google terms granted, noaccount/reportingoff. Shared
3040/3096 servers left untouched. Synthetic Postgres container stopped/removed.

OpenRouter .env.openrouter.local0600; Gateway private
/home/marcos/.cache/orbsie/provider-tests/gateway.env0600. No secret in reports.
Root local servers10522 terminal0 and98456 terminal130 intentionally stopped.
Production browser synthetic fixture47567 passed/terminal0: exactly1 synthetic
Budget request+reply and all recovery cases. Evidence chatgpt-startup-live-fixture-
20260913; root viewed phone screenshot. No provider calls. No root processes remain.

Gateway funding recheck: GET /v1/credits returned200 with balance-0.0033684 again
on2026-09-14T07:57Z (local Sep14); no model calls or billing changes. New evidence
gateway-credit-check-20260914; previous Sep13 evidence retained. Existing owner
funding question remains pending. Do not retry inference until positive credits or
owner funding confirmation. Evidence gateway-credit-check-20260913.

Gateway diagnostic update: one instrumented request using isolated deployed480782d
returned HTTP402 positive-credit-balance required (includingBYOK), no sceneoutput,
no retry. Owner async question pending to replenish account. This blocks Gateway
live acceptance only, not other implementation. Evidence gateway-framing-capture-
20260913; original runner_failed report preserved with corrected provider_rejected
classification in acceptance.json. Original malformed-output failure not reproduced.
Private exact257byte response at /home/marcos/.cache/orbsie/provider-tests/
framing-20260913/response.sse0600; parent0700. Tool9976cc9 adds bounded exactSSE
capture and nonblocking limit cancellation;10focused tests pass. No root processes.

## Accepted reproducible diagnostics

Server dba95bc: fresh request UUID and validated client-run header, JSON-line
phase/terminal counters/timings/build metadata, provider/schema/EOF/deadline/cancel
classification, credential cleanup independent of scene success. Rolling private
transport keeps body unchanged, optional headers compatible with old480782d host.
Worker85targeted tests+root8privateHTTP integration tests pass; actual Vercel logs
verified for both routes. Never expose global server history or arbitrary errors.

Client b518e68: 20entries/64KiB max, strict projection/no prompts/output/credentials/
URLs/unverified model IDs, stage/revision/typecounts/quality/renderer/finish info,
partial in-progress snapshots, authoritative clear epoch and terminal guards.
Download in recovery and all connection states; reload persistence and reset.
Storage denial tolerated. Direct NEXT_PUBLIC_ORBSIE_BUILD_ID compiled/verified.
Replay CLI executes production observer/protocol and client store fixtures.
Final worker22tests/3files+typecheck, replay2suites, build-ID helper8tests pass.
Root built and live-site browser fixtures pass desktop1440/phone390 EOF/parser,
IDs/build ID/privacy/reload/reset, no overflow/pageerrors. Startup regression
requires1synthetic Budget/Luna request+reply and recovery checks. Zero live model
calls; not physical-device/provider acceptance. See docs/generation-logging.md.
Evidence client-diagnostics-production-build-20260913, client-diagnostics-startup-
regression-20260913 and client-diagnostics-live-fixture-20260913.
