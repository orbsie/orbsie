# Development checkpoint

Updated 2026-09-13. Full goal remains **all prompt.md, E2E validated with
OpenRouter, Vercel AI Gateway and ChatGPT**. Not complete. Previous detailed
acceptance history: checkpoint-history/2026-09-13-before-durable-release.md.

## Execution

Astra low/default owns contracts, every diff review, integration and acceptance.
One Luna xhigh/default worker, no nested agents, Fast off. Current worker
/root/host_session_renewal is implementing **client diagnostic history/export**.
New clean-context spawn failed host thread limit; reuse existing worker.
Contract docs/generation-observability-task.md. Server stage dba95bc accepted and
deployed. Worker owns browser helper/store/export UI/startup diagnostics/replay
fixtures and targeted checks. Root owns scripts/verify-generation-diagnostics.mjs,
release checkout, evidence, checkpoint and deployment. No live logging-stage calls.

Quota last73%used/27%remaining. Read
/home/marcos/.cache/orbsie/read-codex-quota.py; stop workers/livecalls below20%.
Goal token accounting is not subscription quota. Live model tests Luna only;
end-user model choice unrestricted. API4096 output/call, Gatewaymax5/test,
flagship3calls, no blind retries. Hosted180s/512KiB are runtime/output bounds.
Never echo credentials. Use completion notifications, avoid status-only turns.

## Production and accepted release

Production https://orbsie.com ->
https://orbsie-7y9kfo9yy-grappeggias-projects.vercel.app, source **dba95bc**.
Isolated checkout /tmp/orbsie-durable-release-20260913 atdba95bc. Local build and
Vercel remote build passed. Deploy33697 terminal0, alias confirmed. Both generation
routes rejected400/401 with correlated UUIDs and exactly1terminal/builddba95bc
verified in actual Vercel logs; generation-observability-deployment-20260913.
No real-provider generation in this release. Prior startup480782d HTTP/browser
synthetic acceptance remains recorded in chatgpt-durable-deployment-20260913.
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

1. Server logging current, then client safe diagnostic export/replay and actual
   interruption diagnosis. HTTP200 does not mean commit; clean EOF without
   commit_revision alone does not prove network failure. Never log raw content,
   credentials or arbitrary errors; exactlyone terminal/layer. Contracts
   generation-observability-task.md, resilience-activity-seo-task.md.
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
6. SEO/crawler metadata/routes/public HTML; source baseline642a3cc. No discovery
   consent field in schema: homepage sitemap first, no automatic world enumeration.
   Public world share metadata accurate; no private account/API/callback indexing.
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

Owner requires existing signed-in Chrome. Last CUA: CUA_REPL_ENABLED_SURFACES
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

Gateway diagnostic update: one instrumented request using isolated deployed480782d
returned HTTP402 positive-credit-balance required (includingBYOK), no sceneoutput,
no retry. Owner async question pending to replenish account. This blocks Gateway
live acceptance only, not other implementation. Evidence gateway-framing-capture-
20260913; original runner_failed report preserved with corrected provider_rejected
classification in acceptance.json. Original malformed-output failure not reproduced.
Private exact257byte response at /home/marcos/.cache/orbsie/provider-tests/
framing-20260913/response.sse0600; parent0700. Tool9976cc9 adds bounded exactSSE
capture and nonblocking limit cancellation;10focused tests pass. No root processes.

Server observability first handoff78tests/7files+typecheck passed, but root review
REJECTED it pending corrections. Critical: hosted scene finally aborted local signal
before outcome check, falsely logging every success as cancellation. Also schema
errors misclassified as transport, freequota429 logged500, observer64KiB bound can
mislabel valid geometry, missing observer/cancel/UTF8/error regressions, JSON-line
sink needed. Worker correcting same bounded stage; no deploy/acceptance yet.
Root actual480782d private handler proof: extra observability JSONfield=>400,
unchangedbody+optionalcorrelationheader=>200/one syntheticcall. Existing sandbox
reuse means body change would break rolling deployment. Worker moving correlation
to headers via manager/backend, preserving body/capability/epoch; evidence
observability-protocol-compat-20260913. Root quota72%used/28%remaining.

Stage1 server observability corrected and root-reviewed: actual hosted read failure
now transport-error independently of saved credentials; success before cleanup
abort, parser/quota classifications, bounded observer UTF8/final/large records,
JSON-line sink and rolling-compatible private headers accepted. Worker85tests in
7suites+typecheck/format pass; root8 actual private-HTTP integration tests pass.
No live model calls or deployment for this stage yet. Client export/history and
startup diagnostics remain next bounded task. Runbook docs/generation-logging.md.

Server logging dba95bc deployed to orbsie-7y9kfo9yy-grappeggias-projects.vercel.app,
aliased orbsie.com; local+remote build pass. Explicit ORBSIE_BUILD_ID=dba95bc.
Both public generate routes tested with rejected requests (400/401), zero model
calls: UUID correlation, correct HTTP/failure code, build ID and exactly1terminal
verified in actual Vercel request-detail logs. CLI59.11.7 historical logs shows
only first log per request; direct scoped request-logs rows reveal both events.
Evidence generation-observability-deployment-20260913. Stage2 client diagnostics
assigned to same sole Luna worker, no nested/live calls. Root deploy33697 done.

Stage2 first handoff22tests/typecheck rejected on root review pending privacy and
reliability corrections: arbitrary bounded model/timestamp/startupID strings,
getItem denial can throw, start timestamp recorded at end, no build/type counts/
initial revision, misleading parser/limit/429 classification, startup stage timing,
and missing replay/negative store coverage. Same Luna correcting. Root owns
scripts/verify-generation-diagnostics.mjs, preliminary desktop+phone download,
reload/reset fixture under .vercel/diagnostics-preliminary. Local dev5285 on3013
started for synthetic fixture50399; no model calls. A separate modal-anchor probe
briefly loaded local home before setContent and issued read-only config/trial
requests; no generation. Preliminary50399/47285 fail: settings download absent
after reload without provider, placement gap sent to Luna. Root viewed screenshot;
5285 stopped intentionally (130). Prototype tests are not acceptance evidence.

Stage2 corrective handoff36tests/typecheck +9 parallel-classifier replay cases
reviewed. Root actual dev browser download fixture87775 PASSED desktop1440 and
phone390: cleanEOF/parser classifications, IDs, private sentinels absent, reload
retention, disconnected settings access, reset clears, no overflow/pageerrors.
Root viewed phone recovery/settings; requested readable 2-row phone toast.
Further corrections pending: replay must execute real production store (current
script duplicates classifier), storage-remove denial must not reload cleared
history, bound crypto UUID receiver, wire actual public buildID, plain semantic
applyOperation errors classification, prevent late snapshot/header writes after
terminal/reset. Same Luna worker. Dev46589 stopped130; report/screenshots remain
.vercel/diagnostics-corrected (not final production acceptance). Quota26%remaining.
