# Development checkpoint

Updated 2026-09-13. Goal: entirety of `prompt.md`, real E2E OpenRouter, Vercel AI
Gateway and ChatGPT. **Incomplete.** Prior detailed handoff/evidence is in
[archive](checkpoint-history/2026-09-13-before-publication-identity.md).

## Execution

Astra reviews architecture/diffs/integration; one Luna xhigh/default worker,
no nested agents, concise contexts, Fast off. Reuse `/root/host_session_renewal`:
fresh worker creation previously hit thread cap. Latest quota44% used/56% remaining;
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
remains unverified. Worker is ready for next bounded gameplay task from
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

Current source7cbd875 deployed to
https://orbsie-bl9a1qn22-grappeggias-projects.vercel.app (alias https://orbsie.com).
Local/Vercel builds pass. OpenAI logo visible/loaded in Connections heading/button;
390x844 touch emulation, compatibility renderer ready, no horizontal overflow.
Root inspected inline screenshot. Evidence provider-harness-release-20260913.
No physical mobile/live provider claim. Historic public test world still serves
old WebGL-only independent runtime: published-old-runtime-20260913 evidence.
Do not mutate old publications or treat main deploy as updating their runtime.

Isolated release checkout `/tmp/orbsie-chatgpt-release-4eb9ce8` at7cbd875; known
next-env.d.ts build-generated change retained. Vercel CLI existing local auth,
scope grappeggias-projects. Build/deploy completed; no live build handle pending.
Do not deploy unreviewed main WIP. No .openai/hosting.json. Frequent local commits.

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
Exec16021 historically running; revalidate before using. Google US terms effective
2026-07-30 awaiting specific owner approval; do not accept/bypass first-run.
Owner asked to approve terms/continue without account/disable reporting and provide
URL of graphics error; both answers pending. No physical device attached.

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

Gameplay WIP review criteria and outstanding corrections are recorded under
In-progress review in provider-live-gameplay-task.md. Await worker completion and
actual browser fixture evidence before accepting/deploying observation changes.
