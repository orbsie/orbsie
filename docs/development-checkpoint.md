# Development checkpoint

Updated2026-09-13. Full active goal remains incomplete: all prompt.md with real
OpenRouter, Vercel AI Gateway and hosted ChatGPT E2E. Detailed history retained in
checkpoint-history/2026-09-13-before-durable-login-vault.md and earlier archives.

## Execution / active work

Astra low/default architecture, contracts, every diff review and integration;
one Luna xhigh/default worker, no nested agents, Fast off. Reuse
/root/host_session_renewal. Worker currently implements durable credential-vault
FOUNDATIONS only: new encrypted store/lease fencing, additive schema/migration,
crypto/lifecycle tests and opt-in PostgreSQL contention test. No public persistence
enablement yet. Contract docs/chatgpt-durable-connection-task.md. Next integrate
app-owned managed auth cache/private host lifecycle and truthful browser restoration.

Quota latest40%remaining. Check /home/marcos/.cache/orbsie/read-codex-quota.py;
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

## Isolated DB test setup

Docker cached postgres:15-alpine available. Prior real trial concurrency baseline
cd0e42b passed12claims/3admitted9exhausted using independentpool; container removed.
Use new loopback-only tmpfs container, synthetic users/sessions, apply additive
schema; run opted-in vault contention test. No production migration untilreview.

Active vault review: metadata read must not expose unleased cache; protect session
check vs logout and refresh DB clock after locks; test was found using mocked
functions despite real SQLsetup and is being corrected. Isolated root DB ready:
containerorbsie-vault-db-20260913, loopback127.0.0.1:32769/orbsie_vault_test,
postgres trust (synthetic only). Root must run opted-in test then stop/remove it.
