# Development checkpoint

Updated2026-09-13. Full active goal remains incomplete: all prompt.md with real
OpenRouter, Vercel AI Gateway and hosted ChatGPT E2E. Detailed history retained in
checkpoint-history/2026-09-13-before-durable-login-vault.md and earlier archives.

## Execution / active work

Astra low/default architecture, contracts, every diff review and integration;
one Luna xhigh/default worker, no nested agents, Fast off. Reuse
/root/host_session_renewal. Vault foundations accepted: encrypted store/lease fencing, additive schema, six
unit tests and real PostgreSQL contention/rollback/expiry tests passed. Private runtime/controller stages are accepted; next worker stage is server vault
orchestration and public route integration, followed by main-page restoration. No public persistence
enablement yet. Contract docs/chatgpt-durable-connection-task.md. Next integrate
app-owned managed auth cache/private host lifecycle and truthful browser restoration.

Quota latest36%remaining. Check /home/marcos/.cache/orbsie/read-codex-quota.py;
stop workers/live calls below20%. Goal token count is not subscription quota.
Live tests Luna only; end users unrestricted. Owner approved neededcalls; API4096
output/call, Gatewaymax5/test, flagship3calls, no blind retries. Hosted180s/512KiB
are runtime/response bounds, not token/cost caps. Never echo credentials.

## Production / accepted changes

Production https://orbsie.com -> https://orbsie-4pv1ft4yr-grappeggias-projects.vercel.app
Release25aa1ae in /tmp/orbsie-chatgpt-release-4eb9ce8. CLI auth configured, scope
grappeggias-projects. Release generated files may be dirty; preserve before edits.
Prior generated changes stashed safely. No active deploy/build process.

Maina01ad40: direct anchored Quality/Balanced/Budget dropdown for API+ChatGPT,
provider-specific IDs, inline retry/stale guards, flat chronological assistant
activity, follow-latest scroll with resize/user opt-out. Root reviewed code/images.
25focused tests+typecheck pass. Selectorfixture6 actual1440x1000/390x844 passes;
activityfixture9 timing/order/phonevisibility/cancel passes. Earlier failed/mislabeled
fixtures retained. Root actual catalog parser: OpenRouter368/Gateway299 accepted,
all3tiers; ~alias regression fixed. Production UI fixture run2 passes dropdown,
draft preservation, one live announcement and final reply after flat activity;
root inspected phone image. Evidence inline-chat-production-fixture-20260913-run2.
HTTPS-to-HTTP streaming fixture unsupported by Playwright redirect, retained as
harness failure; local incremental stream evidence remains separate. No modelcalls.

Main69a3237: fixed private host ten-minute shutdown despite sandbox renewal; now
bounded40min cap matching registry. Two focused tests+typecheck pass; fakeclock
crosses10min/reaches40min, separate real local HTTP stream completes with pending
expiry. Deployed. Not proof of owner's exact interruption cause: production logs
showed one HTTP200 with no runtime completion diagnostic. Evidence
chatgpt-interruption-log-check-20260913. No live renewed-provider proof yet.

Capturea9975fd and creativepromptbfb82d7 deployed. Actual WebGL/software desktop
replacement capture +390x844 ->237x512 PNG pass; capture is project/revision/resource
bound,128KiB encoded cap. Creative prompt intent/art/game/capability guidance;
56tests+typecheck, root removal-semantics fix verified. Quality improvement unproven.

NOT YET DEPLOYED: capability94e3932 and image transporta9afe4a. Preserve explicit
vision true/false/unknown; API multipart/hosted image input, bounded PNG identity,
exact process guards, unchanged text-only byte limits.77tests+typecheck pass; actual
hosted PNG ingestion remains unproven. Build:chatgpt-host passed on main.

## Durable login requirements / rejected draft

User reports token lost on restart and mid-session EOF. Model preference alone
cannot restore authentication. Current isolated temporary auth directory and
expired-host destruction lose managed auth. Initial global resume:true/persistent
sandbox draft was rejected and removed: no complete restore/revocation lifecycle.
Need owner-bound encrypted remembered cache, refreshed-token persistence, lease/
epoch fencing, explicit Disconnect revocation and new-host verified restore.
No client credentials/localStorage tokens, copied developer CODEX_HOME or cookies.
No email gate or false-ready based solely on preference. Keep host execution bounded.

## Queued agentic integration

Owner requested ALL Astra recommendations, not only prompt changes. After latest
connection/UI work: docs/agentic-review-loop-task.md Handoff1 atomic run allowances,
then Handoff2 actual render/inspect/correct/finalverify with truthful activity.
Separate allowance ledger: existing generation_runs requires owned saved orb and
cannot authorize anonymous free prompts. One free prompt per bounded user request,
reserve3globalcallunits, max2reviews, server-owned identity/revision/phase admission.
Separate typed review schema/private hosted HTTP operation; preserve gameplay,
last-good revisions, original undo baseline, cancellation and stale guards.
Unsupported image => honest structural-only scope. Then controlled Luna quality
evaluation, full provider/gameplay milestone. No actual self-review implemented yet.

## Browser / mobile / credentials

Owner insists reuse signed-in Chrome, no more login tabs. CUA last unavailable
CUA_REPL_ENABLED_SURFACES; official Chrome runtime browserlist[]; no changedaccess
observed. DevTools profile signedout, not owner's browser. No rawCDP/cookie copying.
GitHub through computeruse; push still open. ADB devices empty on latest check;
prior emulator/device/IME evidence retained, no physical Android/iOS proof.
Worker instructed stop old devserver localhost3013 PID1669045/session13398;
revalidate handle before relying on cleanup. Root fixture processes terminal.
OpenRouter key .env.openrouter.local0600; Gateway private
/home/marcos/.cache/orbsie/provider-tests/gateway.env0600; never echo.

## Remaining full-goal acceptance gates

- Durable ChatGPT restart/restore + actual create/edit/recovery/>10min renewal,
  reload/export/publish in owner's signed-in browser; OpenRouter OAuth callback
  distinct from API-key success.
- Gateway latest ae3a478 one Luna4096/default call: HTTP200 seed then
  INVALID_SCENE_JSON op2 issues[] finishReason:null. Cause unproven; noedit/retry.
  docs/generation-framing-debug-task.md requires one bounded private response
  capture/replay and sanitized regression before further acceptance calls.
- Fresh3callflagship EACHprovider: playduringgeneration, platform/bounce5winreset,
  mushroomedit, slowplatform+2,7winreset, originalUndo5winreset, reload/export,
  fresh current-artifact signedoutpublication winrestart. Routefixb9a36bd partial
  traversal accepted; fullgate docs/provider-live-gameplay-task.md remains.
  Historical immutablepublication usesoldruntime; do not mutate to forcepass.
- Actual recent midrange Android +iOSSafari fullflows/performance; viewportfixtures
  are not physical device certification. Mobile acceleration/fallback/fullgameplay.
- Licensed collection admission/mixed-new-only generation/performance; prior10Kenney
  CC0/procedural evidence doesn't complete hosted/perf gates. Browser-only modeling,
  no user Blender install/connection. Preserve licenses.
- Fullprompt freebudget/exhaustion/cancel/recovery/isolation/UX, actual modelreview
  loop +controlledqualityeval, providerE2E, publication and GitHubpush.

## Accepted durable foundations (not deployed)

Vault5df8c95: AES-GCM/HKDF owner/version binding,64KiB bounded opaque cache,
30day retention,10min exclusive fenced leases and fresh DB/session authorization.
6unit tests+realPostgres independent pool contention/expiry-during-lockwait/forced
insert rollback passed. Root reviewed. Test container removed. Production additive
schema applied transactionally and verified: evidence chatgpt-vault-production-
migration-20260913. Protected fresh env /home/marcos/.cache/orbsie/durable-login-
production/production.env0600 (parent0700); never echo. No real cache copied yet.

Runtimebcfc786: isolated auth.json import, explicit file storage config,64KiB
no-follow/nonblocking reads,1second snapshot bounds, SIGKILL independent of reads,
post-close retained copied snapshot and late-read invalidation.19tests+typecheck.
Root actual pinned Codex0.153.4 empty-runtime initialization/account-read/cleanup
passed without login/modelcalls: chatgpt-runtime-config-20260913.

Private controller/transport ACCEPTED after final corrections: one operation slot,
ID/epoch/deadline, single-use failed admissions,64attempt lifetime cap, deferred
startup/termination fencing, private capability-only initialize/status/models/
generate/seal/clear and verified-login seal. Sticky managed mode closes legacy
admission; serialized legacy transition, post-close cache, failedclose poison,
separate generation/control cancellation.48focused tests,typecheck,format/diffcheck,
build:chatgpt-host passed. Root reviewed real HTTP tests (only runtime mocked).
Root actual pinned0.153.4+NodeHTTP empty-operation init/status/seal/clear/legacy409
passed: chatgpt-private-pinned-http-20260913. No login/inference. Test67719 terminal.
Earlier43test draft rejected; corrective findings/evidence retained in history.

## Next durable integration

Contract docs/chatgpt-durable-connection-task.md. Reusable sandbox HTTP service with
operation-scoped managed processes; lease covers process until confirmed seal.
Server restore on status/models/generate, verify account before Ready, persist
updated cache on success/error/cancel with independent bounded cleanup budget and
route headroom. Initial login seal->remember needs atomic attempt/revocation fence:
late initial remember must not resurrect Disconnect (save fencing alone insufficient).
Disconnect revokes before remote cleanup, across relevant owner hosts; preserve
valid preferences on transport errors. No raw cache public payloads/logs/modeldata.

UI currently resets to OpenRouter on mount and only modal checks ChatGPT status.
Need nonsecret provider+tier preference and verified startup restore on `/`, guarded
against manual provider/account changes. No email gate or anonymous rebootstrap on
transient failure. Automatic restart-to-prompt browser fixture +real owner acceptance
still required. Full review loop/provider/mobile goal remains intact above.

## Current access and resource state

Browser latest rechecked: CUA requires CUA_REPL_ENABLED_SURFACES; DevTools reachable
but existing ChatGPTpage3 explicitly signedout and OpenRouterpage2 sign-in. No new
login tabs/cookie copying/rawCDP. Evidence browser-access-check-20260913-durable.
Owner-signed-in browser remains unavailable; don't repeat unchanged checks.

Android emulator current preflight and actual saved-game replay passed: Right score7,
Up win/final7, PlayAgain reset0, Left loss0, restart overlaygone. Root viewed six
screenshots; current player runtime+unchanged saved Gateway project, hashes retained
in android-player-replay-20260913. No new generation/publication/flagship/physical
performance claim. AVDorbsie_api35_phone/API35/Chrome124,2cores/3GiB/SwiftShader;
Chrome first-run used existing owner approval matching US July30,2026 terms, no
account, optionalreportingoff/notificationsdeclined. Olderbrowser only.
Emulator76916 and localserver46673 both terminal exit0; reverse3187 removed.
No root test processes remain. Shared3040/3096 servers left untouched by worker.

History for vault/runtime/private review: checkpoint-history/2026-09-13-before-
private-host-acceptance.md. Do not repeat accepted investigations/tests absent gap.

## Active server orchestration handoff

Luna host_session_renewal is implementing durable service/public routes and initial
login intent fencing; not accepted or deployed. Root isolated PostgreSQL container
orbsie-durable-race-db-20260913 is running, loopback32770, DBorbsie_test/postgres,
synthetic trust auth/tmpfs256MiB/1CPU. Worker has URL; remove after reviewed tests.
Root early review found absent-intent SELECT FOR UPDATE does not serialize two
owner sessions: stale begin upsert can overwrite concurrent Disconnect. Worker
notified to serialize existing owner/intent admission, use fresh post-lock clocks,
and prove first-intent races. Final diff and evidence review still required.
Quota latest65%used/35%remaining; stop all workers/livecalls below20%remaining.
Durable and self-review task docs now preserve intent and managed-review contracts.

Latest root integration check: 2026-09-13 19:38 local command output,
`npx vitest run tests/chatgpt-durable-service.test.ts tests/chatgpt-route.test.ts
tests/chatgpt-generate-route.test.ts` passed3files/32tests in1.78s, session25416
terminal0. Worker notified; source still changing, so this is interim evidence,
not final acceptance. Real intent DB races/private lifecycle integration pending.
New owner resilience/activity2s/SEO/logging requirements committed in prompt.md
and docs/resilience-activity-seo-task.md (0675470,4590fd8). New unbounded navigation
and code-free login requirements preserved; root source audit in
unbounded-world-task.md and official OAuth feasibility gap in
ai-connection-priority.md. No replacement browser OAuth availability claimed.

Server worker final handoff was NOT accepted: reported5suites/48tests,2realPGtests,
typecheck/format/diffcheck pass. Root found new Start->begin/bind intent then status
calls migration-only admitLegacy (rejects existing intent), so normal new login
cannot remember credentials. Also Disconnect revokes vault but only current-session
host destroyed; other owner host can continue refresh. Missing-vault legacy
status/models fallback not gated by tombstone. Same worker restarted for bounded
corrections +real route/service/private-controller integration, rotated-cache
restore success/error/cancel, forced separate-session DB race orders. No deploy.

Release preparation: isolated detached checkout
/tmp/orbsie-durable-release-20260913 at8526b5d, npm ci --ignore-scripts
--prefer-offline --no-audit --no-fund completed239packages/7s (session61622 exit0).
No build, environment copy, migration or deployment there yet. Advance only to
reviewed integration commit; existing production/release checkout unchanged.
