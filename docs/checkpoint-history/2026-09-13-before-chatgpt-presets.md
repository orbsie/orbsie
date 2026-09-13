# Development checkpoint

Updated 2026-09-13. Goal: entirety of `prompt.md`, real E2E OpenRouter, Vercel AI
Gateway and ChatGPT. **Incomplete.** Prior detailed handoff/evidence is in
[archive](checkpoint-history/2026-09-13-before-publication-identity.md).

## Execution

Astra reviews architecture/diffs/integration; one Luna xhigh/default worker,
no nested agents, concise contexts, Fast off. Reuse `/root/host_session_renewal`:
fresh worker creation previously hit thread cap. Latest quota49% used/51% remaining;
stop workers/live tests below20% remaining. Read actual quota with
`python3 /home/marcos/.cache/orbsie/read-codex-quota.py`; goal tokens are not quota.
Targeted tests; no repeated green/live runs without new evidence need.

Live tests Luna only; users retain model choice. Owner approved needed calls.
API-key tests4096 output tokens/call; Gateway up to5/test. Fresh flagship3calls.
Hosted application bounds180s/512KiB per call, no provider token/cost guarantee:
2-calls-180s-512kib regular contract; 3-calls-180s-512kib flagship/interrupted recovery.
No blind retries. GitHub via computer use, no copied browser/Codex credentials.
User product runs in browser, no Blender installation/connection. Preserve licenses.

## Current task

Publication verifier implemented and root-reviewed:44 targeted flagship tests,
typecheck/diffcheck pass. Original project/content, target-vs-ZIP-vs-deployment
runtime/worker hashes, bounded anonymous fetches, exact wrapper/iframe origins.
Root actual production player fetch matches reviewed7cbd875 local build for all
four files; evidence publication-verifier-local-20260913. Fresh publication itself
remains unverified. Worker is executing the bounded gameplay task from
`docs/provider-live-gameplay-task.md`; no live calls/auth/deploy in this task.

Provider harness7cbd875 accepted: three providers/fresh3call story, exact prompts,
original undo, refresh/export/cloud/publication follow-on. Behavioral helper
rejects wrong project IDs/revisions.55 tests across provider-browser-e2e-flagship,
hosted-chatgpt-acceptance, provider-browser-e2e-recovery pass; typecheck passes.
Structural coverage is not actual collect/bounce/portal-win/reset traversal.
Publication previously observed revision/canvas only; verifier now closes the identity
and current runtime/worker byte checking gap, pending a real publication run. Saved ZIP traversal scripts
prove separate worlds; do not label them full fresh-provider acceptance.

## Production and release

Current source 83710c4 deployed to
https://orbsie-59aw2ca0h-grappeggias-projects.vercel.app (alias https://orbsie.com).
Local and Vercel production builds pass. All4 current player/runtime worker bytes
match isolated release build. Provided Chrome390x844 touch smoke: software ready,
no fatal graphics dialog or horizontal overflow; root viewed inline screenshot.
Evidence fallback-release-ddafb15/report.json. No inference or physical-device
claim. Historical publications retain their old independent runtime.

Isolated checkout /tmp/orbsie-chatgpt-release-4eb9ce8 now detached ddafb15;
known build-generated next-env.d.ts change retained. Build14774/deploy15400 both
completed; no active release process. Vercel scope grappeggias-projects. Main
worker WIP is not deployed. Browser page5 is fresh release smoke context;
OpenRouter/ChatGPT owner-login tabs preserved.

## Accepted implementation; remaining live evidence

- Hosted completion4eb9ce8 handles official nested turn/completed.turn.id, identity
  checks and safe diagnostics.78 tests/build pass. Pre-fix owner create failed;
  post-fix real create/edit not yet exercised (chatgpt-owner-live-20260913).
- Hosted renewal0a2fbf6: owner/session/attempt lock,10min idle/40min absolute capped
  by auth, actual non-resuming runtime extension, late-client cleanup,180s abort.
  118 focused tests/mock concurrency and build pass; real >10min continuity and
  actual Postgres contention remain unverified. chatgpt-renewal-local/release evidence.
- WebGL atlasff61fbc and software atlas2a1a38f accepted. Software reduced-detail
  vertex colors, actual-worker/offline export checks, exact model/license retention.
  software-texture-fallback-final-20260913 and catalog-texture-render-final-5.
  Candidate still fixture-only; no catalog admission/performance claim.
- Canvas2D fallback runs shared gameplay/input/physics;43 shared tests and focused
  editor/standalone action checks pass (game-actions-software-acceptance-final).
  Full fresh-world traversal and physical mobile performance remain open.

## Browser and Android

CUA owner surface still fails CUA_REPL_ENABLED_SURFACES is required. Do not bypass
with raw CDP/cookie copying. Provided chrome_devtools connector works, but its
profile is signed out of ChatGPT. Page2 now OpenRouter /sign-in after actual Connect with OpenRouter navigation;
3chatgpt.com signed out,4historical published world. Revalidate inventory.
OAuth entry/PKCE callback origin observed, consent/exchange not completed.
Evidence openrouter-oauth-entry-20260913; owner asked to sign in through the
existing OpenRouter and ChatGPT tabs, without sending credentials in chat.
No owner login/new inference performed. Connector screenshot file save to repo
was denied; inline viewing is permitted. Do not route around filesystem policy.

Android read-only AVD orbsie_api35_phone, emulator-5580, API35, Chrome124.
Exec16021 historically running; revalidate before using. Owner approved Google Android setup terms on2026-09-13, continuing without an account and with reporting disabled. Original graphics error was the main / page. Terms approval is no longer pending. No physical device attached.

## Full-goal gaps

Real ChatGPT creation/edit/export/publication and >10min renewal; actual OpenRouter
OAuth (API-key tests are separate); fresh same-project flagship gameplay across
all providers, including playing during generation and original undo; current
artifact signed-out publication; midrange physical Android and iOS Safari touch,
orientation/background/long-run performance; licensed catalog admission/mix/new-only
matrix and measurements; full prompt audit/free exhaustion/provider recovery and
GitHub push. Scope remains prompt.md, not merely these implementation milestones.

Procedural isolation audit:29 targeted evaluator/integrity/queue tests passed on
current source; exact hashes in procedural-isolation-audit-20260913/report.json.
Real QuickJS tests plus mocked queues; prior actual-browser worker evidence linked.
No blanket security/mobile claim and no model calls. Current single Luna task is
the fresh-world gameplay driver; publication verification is committedac7268f.

Gameplay driver committed a553f02. Root reviewed source and run9 WebGL full
creation gameplay plus run10 software full gameplay. Run10 original report failed
only on deliberately injected WebGL initialization error; separate adjudication in
fresh-flagship-gameplay-review/report.json preserves original report and hashes.
Both cover actual movement while stream open, all3 moving-platform contacts,
bounce, five collections, portal win and UI reset. Typecheck and6focused suites
(95tests) pass; latest helper suite15pass. No live-provider/full-story/mobile claim.

Software transition/layout fix ddafb15 accepted and deployed. Shared controller
now drives Canvas2D camera/composer; portrait title and advisory overlaps fixed.
Root reviewed run18-coarse UI-only pass at1280x900,390x844,844x390: actual coarse
pointer/taps, sheet open/close, landing/reopen, no document overflow, reachable
controls. Source typecheck, playerbuild and3focused suites13tests pass. Prior
run11 fullsoftware gameplay passed before layout assertion; run12 Ccontact failure
is retained as route timing fragility, not erased by layout pass. Normal-motion
sheet must settle before fixture fill; early-focus transient is documented inrun17.
No complete physical-mobile or live-provider acceptance claim.

Current single Luna task: explicit Play transfers focus to named gameplay target,
so Space jumps without extra canvasclick; preserve button activation, typing
isolation, Tab navigation, and touch. Root handles release evidence only. No model
calls/deploy byworker. Seven-crystal/undo and signed-out traversal remain queued.

Provider prerequisites: OpenRouter key is in .env.openrouter.local. Gateway test
credential previously supplied by the owner is now stored mode0600 at
/home/marcos/.cache/orbsie/provider-tests/gateway.env (directory0700).
Vercel metadata confirms production variable type=sensitive; supported retrieval
returns no value, so no further decryption attempts. Production variable unchanged.
Local Gateway credential validity not yet tested; no model calls during setup.
Next fresh API-provider test remains Luna only,3calls,4096 output tokens/call,
no automatic retries. Owner's broader Gateway ceiling remains5calls/test.

Play focus fix accepted: root reviewed finished diff and both gameplay-focus-*-run1 reports. Click Play and real Tab→Enter Play focus the named region; fresh positive vertical velocity plus raised Y proves Space jump. Composer isolation and Tab return pass. Worker reports typecheck,6focused suites60tests,syntax/format pass. Editor-only change; no player rebuild/live calls. Next bounded task is restart/replay focus in editor and standalone, then queued route timing recovery (contract23463f3), then actual seven-crystal/undo traversal. Production remains ddafb15 until next release.

2026-09-13 resource correction: root identified emulator pid381254/AVD orbsie_api35_phone/port5580 consuming1169% CPU while Android setup was pending. adb emu kill returned OK; emulator deliberately stopped, not an unexpected missing session. Restart only for Android work after setup approval. Restart-focus standalone run2 showed >7s observation gap; contention removed but causal link unproven. Current worker continues diagnosis. Root docs commits7c6847f/92423e8 add complete flagship evidence gate and correct Luna/browser-only test guidance.

Owner answered all three pending questions: signed in, Android terms approved, graphicsfailure on main/. Available connector ChatGPT still displays Log in and OpenRouter tab remains sign-in; treat as browser-profile access mismatch, not unanswered user question. Main production / snapshot currently shows working software compatibility mode and composer, no fatal Graphics unavailable dialog. Owner CUA initialization remains unavailable. Restart worker checkpoint: all test processes terminal; local servers3040/3091 remain. Resume one diagnostic-informed standalone attempt then editor checks; repeated stall requires scheduling diagnosis, not blind retries.

Android setup completed under owner approval: Chrome no account, usage-reporting switch verified false, notifications declined. Emulator session62423 active, adb5580, hostCPU affinity30,31,2virtualcores/3072MiB/SwiftShader. Main production / visibly renders planet/composer with no fatal graphicsdialog; root viewed screenshot, evidence android-main-smoke-20260913. No modelcalls/generated-game/physical-device/performance claim.

Restart/replay commit80db2e2 root-reviewed: editor WebGL/software restart→Space pass; standalone forcedsoftware Restart→Space and Wcollision→win→Play again→focus/reset pass. Worker typecheck,6suites72tests,syntax/format/playerbuild pass. Source manifest mismatch found: only postbuild Prettier button formatting, runtime behavior unchanged; next worker rebuild after final formatting. Replay-specific postresetjump and standaloneWebGL not separately exercised. Preserve failedruns1–5; foreground/closing editor improved sampling, emulator causality unproven. Current worker fixes misleading unavailable text exposed in Android accessibility tree despite healthy WebGL planet. Production stillddafb15.

Graphics accessibility fix root accepted: neutral aria-hidden canvasfallback, realfailure accessible. Desktop actualaria healthy/forcedbothfailure pass (graphics-accessibility-run1); Android local healthy pass b161d03. Worker typecheck,5suites38tests/playerbuild pass; source manifest matches world/main/playerCSS. Existing unrelated testformatwarning retained. Root preparing release of focus+accessibility changes; current quota50%used/50%remaining. Next Luna task route timing from provider-live-gameplay-task.md, then sevenundo/fullreportgate.

Releasef506f85 complete: localbuild20760 and Verceldeploy84568 exit0/aliasorbsie.com. Fourplayerartifacts matchisolatedbuild; providedChrome390x844 software ready/nofataldialog/nooverflow; Androidproduction namedGameplayarea and nofalseGraphicsfailuretext. Evidence focus-accessibility-release-f506f85. Checkout /tmp/orbsie-chatgpt-release-4eb9ce8 nowf506f85, knownnext-env.d.tsdirty. Currentworker route timing correction; no livecalls.

Owner priorities changed: hostedChatGPT Build a gingerbread house fails immediately afterlogin; investigate/fix first. Production HTTP200, journalcancelled within951ms/sequence0/entities0, hostreadyrenewed. Read-onlyevidence chatgpt-gingerbread-failure-20260913; no livecalls. CurrentLuna traces runtime/stream path, rootlogs/DB. Awaiting selectedmodel/effort answer; existingownerbrowser mismatch blocksreadingclientdiagnostic. Next queued userchange: ChatGPT default exactlyQuality/Balanced/Budget; rawmodel/effort onlyAdvanced, catalog-validatedpresets. Route timing then sevenundo remainqueued; noWIP onthese.

Gingerbread rootcauseconfirmed by pinned0.153.4 empty-home/no-inference RPCprobe: oldreadonly.access rejected beforethreadvalidation, newreadOnly/networkAccessfalse accepted tothreadvalidation. Root reviewedpolicy+42targetedtests/typecheck evidence; deploying hostartifactfix. Rootproductionhostdiagnostic had0modelcalls: catalog502 then nonJSONsandboxresponse, not genuineLunaabsence. Hostartifactchange requires freshChatGPTconnection; livecreationnotyetproven. Currentworker next3presetChatGPT UI.

Gingerbread policyfix83710c4 deployed(aliasorbsie.com), build99187/deploy61897 exit0, configHTTP200. Evidence chatgpt-gingerbread-failure-20260913/release.json. FreshChatGPTconnectionrequiredforupdatedhostartifact; livecreate/editnotyetverified. Currentworker3presetUI; routetimingqueued.
