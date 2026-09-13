# Development checkpoint

Updated 2026-09-13. Full goal remains incomplete: all of prompt.md with real E2E
OpenRouter, Vercel AI Gateway and hosted ChatGPT. Detailed retained evidence and
history: checkpoint-history/2026-09-13-before-creative-prompt.md (and its archive).

## Execution and current task

Astra low/default architecture/review/integration; one Luna xhigh/default worker,
no nested agents, concise context, Fast off. Reuse /root/host_session_renewal.
Worker confirmed running creative-prompt-task.md after capture handoff; root owns
review, not duplicate investigation. Owner explicitly requested implementing ALL
Astra recommendations. Sequence: shared creative/game prompt -> image capability
propagation -> bounded image transport/process policy -> render/inspect/correct/
verify loop and server-owned free allowances -> controlled Luna quality evaluation.
Contracts: docs/creative-prompt-task.md, docs/visual-review-capability-task.md,
docs/visible-authoring-task.md. Do not claim prompt-quality improvement before eval.

Quota last55%used/45%remaining; check /home/marcos/.cache/orbsie/read-codex-quota.py.
Stop worker/live tests below20%remaining. Goal token count is not quota. Live tests
Luna only; end users unrestricted. Owner approved needed calls; API output4096/call,
Gateway max5/test, flagship3calls. Hosted180s/512KiB bounds are not token/cost caps.
No blind retries. GitHub via computer use; no copied cookies/Codex credentials.
Browser-only product, no Blender installation/connection surfaced. Preserve licenses
and safe unrelated edits. Frequent coherent commits; targeted checks, full/live
E2E at meaningful milestones.

## Accepted implementation, not deployed yet

Capture a9975fd: project/revision-bound game canvas, committed resource/frame
readiness in both renderers, stale/cancel/failure/timeout rejection,128KiB encoded
PNG cap with five aspect-preserving downsizes. Root reviewed diff,10focused tests,
typecheck and actual replacement images. Desktop fixture run7 proves delayed asset
replacement with unrelated pebble ready; prior failed runs retained. No modelcalls.
Root portrait acceptance8906ad7: actual390x844 browser canvas ->237x512 capture in
both renderers, correct identity/revision/aspect,27946/83022bytes. Evidence
scene-review-portrait-root-20260913 includes executable fixture and images. This is
viewport capture acceptance, not physical-phone/full-gameplay certification.
Player artifacts rebuilt after capture; root devserver3091/session48628 stopped.

## Production

Current production c84ecbd: https://orbsie.com alias for
https://orbsie-byn8nwc6r-grappeggias-projects.vercel.app. Includes ChatGPT presets,
sandbox policy gingerbread fix, graphics/focus/replay/accessibility fixes and real
activity UI. Capture/new prompt/review loop not deployed. Activity is truthful
waiting/building/preparing/applied/completed/cancelled/failed, bounded18events,
accessible latest/history and stale-run guards;16tests+desktop/390px fixture pass.
It is not model reasoning or visual inspection.
Release checkout /tmp/orbsie-chatgpt-release-4eb9ce8 detachedc84ecbd; known generated
next-env.d.ts dirty. Existing Vercel CLI auth/scope grappeggias-projects. Do not
print credentials. Other old local process handles must be revalidated before use.

## Integration findings for upcoming loop

Hosted turn currently text-only. image metadata stripped at host validator, API
revalidation and browser parseChatGPTModels. API model-capabilities parses output
but not image input. Preserve true/false/unknown; ordinary model choice unchanged.
Pinned AppServer0.153.4 schema supports image/url but actual image ingestion is
unverified. Offline policy evidence visual-review-policy-20260913 proves current
process guard accepts exactly one text item and rejects images before RPC. Extend
narrowly with bounded local PNG and aggregate bytes; no arbitrary URL/path access.
Three-call proposal: initial -> review/correction -> final verification, same model,
no automatic transport retries. Unsupported vision gets honest limited review.
Current free route charges every request; extend trial transaction to issue atomic
run-bound allowances and preserve shared daily spending ceiling. Never trust client
review flags or silently consume three free prompts for one user request.

## Browser / live provider state

Owner says existing ChatGPT login/prompts work. Controlled hosted E2E still unproven.
Reuse existing signed-in Chrome; do not create more login tabs. CUA unavailable
(CUA_REPL_ENABLED_SURFACES required); official Chrome runtime browser list[] at last
check. Recheck only on changed access. DevTools is a different signed-out profile.
No raw CDP/cookie copying. Android API35 emulator approved/setup with optional
reporting off; historical main/IME/connections checks pass, no physical-device proof.

Gateway latest ae3a478 input-game call: HTTP200 seed then INVALID_SCENE_JSON op2,
issues[],finishReason:null; one Luna4096/default call, no edit/retry. Cause unproven.
Evidence provider-e2e/gateway-input-local-origin-20260913. Next diagnostic contract
docs/generation-framing-debug-task.md: bounded private capture/replay, minimal offline
regression before further call. Keys remain local protected files; never echo.
Public catalogs list Luna; readiness alone is not successful inference acceptance.

## Full-goal gates still open

- Complete actual ChatGPT create/edit/recovery/>10min renewal/reload/export/publish;
  OpenRouter OAuth consent/callback separate from API-key success.
- Fresh three-call flagship per provider, playing during generation, platforms/bounce,
 5win/reset, mushroom edit, slow platform+2,7win/reset, original Undo5win/reset,
 refresh/export and fresh current-artifact signed-out publication win/restart.
 Route fixes b9a36bd root16tests+4assertions/software traversal pass; landscape fixture
 expectation mismatch remains. Seven/original-undo/full gate contract in
 docs/provider-live-gameplay-task.md. Historical publication is immutable oldruntime.
- Physical recent midrange Android and iOS Safari full flows/performance; browser
 viewport proof does not replace them. Device model/OS/attachment still unavailable.
- Licensed asset admission, mixed/new-only live matrix/performance; prior10KenneyCC0
 and procedural fixture evidence retained, not complete hosted acceptance.
- Full prompt budget/cancellation/recovery/isolation/UX audit, GitHub push, actual
 visible model inspection/correction and controlled quality evaluation. No completion
 claim until requirement-by-requirement evidence covers all of prompt.md.
