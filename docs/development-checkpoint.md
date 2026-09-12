# Development checkpoint

Updated 2026-09-12; verified against HEAD `7ee6f97` and current worktree.
Keep this compact; historical evidence lives in `docs/scope-audit.md` and
`docs/evidence/`. Never include credentials.

## Objective and execution

Implement all of `prompt.md`, with E2E OpenRouter, Vercel AI Gateway and
browser-only ChatGPT subscription workflows. Full acceptance is incomplete.
Astra low/regular owns architecture, acceptance, finished-diff review and
integration. One Luna xhigh/regular worker, no nested agents, concise context.
Use completion notifications; do not spin status-only polls. Batch targeted
checks; full E2E and live inference only at meaningful milestones. Fast off.

Stop agents/tests below 20% remaining Codex quota. Fresh direct App Server `account/rateLimits/read` on 2026-09-12 returned
Codex primary usedPercent=8 (92% remaining), weekly window10080 minutes. The
old temporary helper is absent; a bounded stdio initialize/read/terminate
request succeeded without inference. Goal token counts are not quota.
Live tests use Luna only, low/default, maximum 4096 output tokens/call, no
automatic retries. Gateway standing limit is five calls/test; OpenRouter two
calls/run. A three-call OpenRouter recovery test remains pending approval.
End users retain supported model choices. GitHub operations use computer use.

## Active bounded task

Worker `/root/republish_acceptance_harness` completed the offline continuation.
Implementation e0dff7c: 20 focused tests, typecheck, syntax/diff checks and root
production build passed. Root then ran the real browser: zero generation,
exact edited reload, seeded-history undo, baseline reload/ZIP/standalone passed.
Evidence: `docs/evidence/provider-e2e/gateway-flagship-offline-continuation/`.
Original live history, settled visual quality and gameplay remain unverified.
The saved-gameplay worker completed and root integrated265f026. Corrected
saved revision40 traversal passed desktop keyboard and390x844 CDP touch:
portal contact at score0/no win, then score7/win/reset; zero inference/external
or mutating requests. Evidence `gateway-seven-gameplay-portal-bound/` and
`gateway-seven-gameplay-touch/`. Root reviewed actual portal bounds and mobile
winning screenshot. No worker task currently active. Next meaningful step:
independent publication of this exact edited revision and signed-out gameplay,
without new inference; preserve separate physical-mobile/platform/size gaps.
Publication milestone now running in exec session20868. Evidence updates at
`docs/evidence/publication-gateway-seven/report.json`. One signup, seven
uploads, one cloud save and one publication submitted; no inference/retries.
Deployment dpl_2RCTPEukaT9wZKVK8Yek35h7oqmL, Vercel project
prj_e0cxArDZnCwVUGjVVkibsP8ViFQ9; last observed INITIALIZING. Re-poll same
session/handle; never resubmit due timeout. Temporary test password exists at
/tmp/orbsie-gateway-publication-password; do not print; remove after completion
or retain privately only if authenticated recovery is needed. Run signed-out
public gameplay after publication/assets pass; saved-ZIP evidence is separate.
Local server3068 session41341 uses build e0dff7c; revalidate before use.

Live resume harness is committed as `9251381`; partial live evidence `12ce90a`;
audit reconciliation `7ee6f97`. Evidence directory:
`docs/evidence/provider-e2e/gateway-flagship-checkpoint-resume/`.
One Gateway request returned HTTP200 and produced revision40 from revision33:
platform-2 speed 1.2 → 0.6, crystals6/7 added, unrelated entities preserved.
All seven GLBs were captured. Saved rules increment crystals and require
crystals >= 7 at portal collision. This is structural evidence, not runtime
win-gating proof. The real Play HUD showed only `0 Score`; the `/7` selector
failed before reload, undo, export or standalone checks.

This milestone has used four calls across the original stopped runs and the
one-call resume. Do not repeat inference to bypass the HUD check. Offline
continuation must block inference, omit credentials and report seeded history
honestly; it cannot prove the original live undo history survived.
Baseline revision33 and reconstructed five-model evidence are under
`provider-e2e/gateway-flagship-story-catalog/gateway/` in `docs/evidence/`.
Use separate original-model and edited-model directories. Prior giant pink
mushroom is physically shorter than its original tree; size acceptance is open.

## Next acceptance contract (after current worker completes)

Reuse `scripts/verify-winning-traversal.mjs` for actual goal7 gameplay with
saved Gateway artifacts and zero inference. Source review found its contract
helper hardcodes five collectibles and crystals == 5, while the Gateway game
uses seven and >= 7. Add an explicit expected count/comparison contract with
regressions preserving the existing five-crystal case. Reject contradictory
win paths. The driver already traverses contract IDs but visits the portal
only last: add an early portal collision check proving no win, then collect
all seven, return, win and reset. Do not substitute structural rules for these
browser observations. Obtain the exact edited goal7 ZIP separately; the current
worker's undo/export check intentionally exports restored goal5. Retain source
hashes, failure evidence, input cleanup and zero-generation traffic checks.
Previous offline worker completed and was reviewed; this contract is now delegated.

## Deployment and established evidence

Latest recorded production source is `a5b2769` at https://orbsie.com;
`docs/evidence/replacement-sizing-release/report.json` records smoke checks.
Sizing prompt effectiveness is not established by deployment smoke.
The last local acceptance server was port3068, built source9098500; revalidate
process/build before reuse. Temporary Gateway key file was deleted. Do not
print keys or assume a Vercel env pull contains a usable value.

Current evidence reconciliation is at the top of `docs/scope-audit.md`.
Bounded OpenRouter and Gateway input-game create/edit/reload/export/play tests
passed. Gateway reload/explicit continuation/cloud recovery and independent
publication have separate evidence. Production free strawberry create/edit
passed two calls (trial2→1→0), then its mixed assets were published separately.
Public OpenRouter flagship crystal/portal/reset passed desktop and CDP touch;
sequential moving platforms passed desktop with sampled carry observations.
Touch platform sequence remains failed/unverified. These do not establish
physical-device acceptance or the full live story across every provider.

## Owner-dependent gates and remaining scope

- Regular Chrome page2 at orbsie.com last showed empty Orbsie sign-in fields.
  Owner sign-in is needed for browser ChatGPT subscription validation. Historical
  local-companion tests do not satisfy the no-installation browser requirement.
- Android Chrome first-run terms acceptance without a Google account awaits
  specific approval. Emulator installation is authorized; revalidate the AVD
  before use. Target is recent midrange Android; real iOS/Android checks remain.
- OpenRouter three-call recovery permission remains pending. No answer is implied
  by automatic goal continuation.
- Full flagship gameplay/revisions/undo/publication, browser ChatGPT
  consent/discovery/inference/recovery, physical mobile workflows, representative
  GPU performance/long sessions, failed-publication continuity, and complete
  requirement-by-requirement audit remain open.
- Product modeling/rendering is browser-only; native Blender experiments do not
  satisfy or replace that requirement. Preserve asset licenses/provenance.
