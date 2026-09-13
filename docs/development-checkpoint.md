# Development checkpoint

Updated 2026-09-13. Full goal remains **incomplete**: implement all of `prompt.md`
with real E2E OpenRouter, Vercel AI Gateway and hosted ChatGPT. Prior detailed
history/evidence: [archive](checkpoint-history/2026-09-13-before-chatgpt-presets.md).

## Execution

Astra architecture/review/integration; one Luna xhigh/default worker, no nested
agents, concise context, Fast off. Reuse `/root/host_session_renewal`.
Latest measured Codex quota:51% used/49% remaining. Stop worker/live tests below20%
remaining; helper `/home/marcos/.cache/orbsie/read-codex-quota.py`. Goal tokens are
not subscription quota. Targeted checks; no repeated green/live runs without cause.
Live tests Luna only, users unrestricted. Owner approved needed calls. API tests
4096 output tokens/call; Gateway ceiling5/test, flagship3calls. Hosted bounds
180s/512KiB per request, not a provider token/cost cap. No blind model retries.
GitHub via computer use; no copied browser/Codex credentials. Browser-only product,
no Blender installation/connection. Preserve licenses and safe unrelated work.

## Current priorities and worker

1. Owner's hosted ChatGPT gingerbread failure: fix deployed83710c4, real generation
   after fresh connection still unverified. Pinned App Server0.153.4 rejects legacy
   `readonly.access` before thread validation. New `readOnly/networkAccess:false`
   policy reaches validation. Empty-home/no-inference probe plus42targeted tests
   and typecheck pass. Evidence `chatgpt-gingerbread-failure-20260913/`.
   Original production request HTTP200, journal cancelled within951ms, zero
   commands/entities. Root's later host diagnostics made **zero inference calls**:
   catalog502 then non-JSON sandbox response, not proof Luna was unavailable.
2. Current Luna task: ChatGPT default choices exactly Quality/Balanced/Budget;
   arbitrary catalog model/reasoning only inside collapsed Advanced. Validate
   actual returned IDs/efforts, prefer Balanced initially, never send GLM to
   ChatGPT. Root found initial selection-effect bug (Quality→Budget overwritten
   by Balanced), duplicate pressed states on single-effort catalogs, and empty
   Advanced selection without placeholder. Worker correcting before acceptance.
   Owned WIP: chatgpt-connection.tsx, chatgpt-model-presets.ts, focused tests.
3. Then route timing correction, seven-crystal/original-undo traversal, complete
   flagship report gate, and fresh signed-out publication gameplay. Contract in
   `docs/provider-live-gameplay-task.md`. No route WIP was created before pause.

## Production and local processes

Production source83710c4:
https://orbsie-59aw2ca0h-grappeggias-projects.vercel.app, alias https://orbsie.com.
Local build99187/deploy61897 completed successfully; configHTTP200. Changing host
artifact requires a fresh ChatGPT connection. Current preset WIP is not deployed.
Release checkout `/tmp/orbsie-chatgpt-release-4eb9ce8` detached83710c4; known
build-generated next-env.d.ts dirty. Existing Vercel CLI auth, scope
`grappeggias-projects`; do not print credentials.
Local servers last confirmed3040(start2303),3091(dev720360/720361); revalidate.

## Accepted recent product evidence

- Play focusbf654aa and restart/replay80db2e2 deployed. Both editor renderers prove
  real Restart→Space. Standalone forcedsoftware proves Restart→Space and real
  Wcollision→win→Play again→focus/reset.72targeted tests/typecheck pass. Separate
  replay-postreset jump and standaloneWebGL were not exercised. Failed fixtures
  retained; foreground/closing editor improved sampling, emulator causality unproven.
- Graphics accessibilityf506f85 deployed: transient canvas fallback neutral and
  hidden; genuine failure remains accessible. Desktop healthy/forced-both-failure
  aria checks,38tests/typecheck, Android local and production tree checks pass.
  Evidence graphics-accessibility-run1, android-graphics-accessibility-20260913,
  focus-accessibility-release-f506f85 (four deployed artifact hashes matched).
- Software camera/composer/mobile layoutddafb15 deployed. Shared transitions,
  reachable coarse-pointer UI1280x900/390x844/844x390. Run18coarse UI-only pass;
  run12 routeC miss retained. Early sheet focus transient remains documented.
- Fresh creation drivera553f02: WebGLrun9/software run10 actual stream movement,
  three moving-platform contacts/bounce, five collectibles/portal win/UIreset.
  Root adjudicated only the deliberately injected WebGL error in software report.
 95focused tests; no live-provider/full-story/mobile gameplay claim.

## Browser and Android

Owner answered: signed in to ChatGPT/OpenRouter; Google Android setup terms
approved; original graphics error was main `/`. No unanswered setup permission.
CUA still fails `CUA_REPL_ENABLED_SURFACES is required`. Provided Chrome connector
works but refreshed ChatGPT/OpenRouter tabs remain signed out: profile mismatch.
Alternate Playwright MCP fails headed launch (missing DISPLAY); not owner profile.
Do not retry unchanged browser adapters or copy cookies/raw CDP to bypass them.
Connector screenshot saving denied earlier; inline viewing allowed.

Android AVDorbsie_api35_phone/API35/Chrome124, emulator5580 session62423;
host CPU affinity30,31,2virtualcores/3072MiB/SwiftShader. Previous unbounded-emulator
load1169% CPU corrected. Chrome setup: no account, reporting switch verifiedfalse,
notifications declined. Owner-approved terms accepted. adb reverse3091 active.
Main planet/composer, portrait keyboard reachability, landscape draft persistence,
Connections touch/scroll and ChatGPT device-sign-in link navigation pass. Test
sign-in cancelled afterward; no inference. Evidence android-main-smoke-20260913.
Emulator/desktop emulation is not physical-device or complete gameplay acceptance.

## Provider prerequisites and remaining gates

OpenRouter key `.env.openrouter.local`; raised-cap flag required for4096.
Gateway key `/home/marcos/.cache/orbsie/provider-tests/gateway.env`, mode0600,
directory0700; validity not live-tested. Do not repeat Vercel sensitive-env
retrieval/decryption attempts. Hosted owner browser access still unresolved.

Remaining full-goal gates include actual ChatGPT create/edit/recovery/>10min
renewal/reload/export/publish; OpenRouter OAuth consent/callback; fresh same-world
three-call flagship all providers with playing during generation, platforms/bounce,
5win/reset, mushroom edit, slow platform+2,7win/reset, original undo5win/reset,
refresh/export and current-artifact signed-out publication win/restart. API-key
success does not prove subscription/OAuth. Structural checks cannot count as
complete gameplay. Publication verifierac7268f checks identity/current artifacts;
historical immutable published world has old runtime and is not current acceptance.

Also pending: physical midrange Android/iOS Safari complete flows and performance;
licensed catalog admission/mix/new-only live matrix and measurements; full prompt
budget/cancellation/recovery/isolation/UX audit; GitHub push. Prior29test procedural
isolation audit,118test hosted renewal coverage and atlas/offline fixture evidence
are retained in archive, with their explicit live/performance limitations.
