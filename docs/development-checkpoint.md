# Development checkpoint

Updated 2026-09-13. Full goal remains **all prompt.md, E2E validated with
OpenRouter, Vercel AI Gateway and ChatGPT**. Not complete. Previous detailed
acceptance history: checkpoint-history/2026-09-13-before-durable-release.md and
checkpoint-history/2026-09-13-before-client-diagnostics-release.md.

## Execution

Astra low/default owns contracts, every diff review, integration and acceptance.
One Luna xhigh/default worker, no nested agents, Fast off. Current worker
/root/host_session_renewal is implementing canonical scene binding/procedural
provenance and internal adapter completion/failure hooks. Task contract:
docs/authoring-scene-binding-task.md. Public review routes/browser loop are not
being enabled by this handoff. No nested agents or live calls.
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
Binding first handoff rejected after root review despite35tests/typecheck passing:
procedural client includes evaluated recipe absent in server shadow; trailing
NDJSON commit->command->commit authorizes completion; cancel-during-hook may finish
late. Root production-path probe reproduced all three (zero calls); cancellation used
the retained rejected-handoff bundle to avoid worker WIP. Evidence
scene-binding-review-baseline-20260913. Worker fix pass must add actual server/client
operation equality, strict termination and shared abort-aware lifecycle controller.
Do not accept/deploy this WIP until the specific regression matrix passes review.
Root added flagshipJourneyAcceptance to every provider report/CLI:12focused
contract tests and2follow-on tests pass; two historical partial reports correctly
remain incomplete. Evidence flagship-journey-gate-20260913. Actual seven/undo/
standalone/publication traversal producers remain required. Whole-tree
typecheck passed with the first binding handoff; its behavioral review failed.

Quota last77%used/23%remaining. Read
/home/marcos/.cache/orbsie/read-codex-quota.py; stop workers/livecalls below20%.
Goal token accounting is not subscription quota. Live model tests Luna only;
end-user model choice unrestricted. API4096 output/call, Gatewaymax5/test,
flagship3calls, no blind retries. Hosted180s/512KiB are runtime/output bounds.
Never echo credentials. Use completion notifications, avoid status-only turns.

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

Gateway funding recheck: GET /v1/credits returned200 with balance-0.0033684 on
2026-09-14T06:46Z (local Sep13); no model calls or billing changes. Existing owner
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
