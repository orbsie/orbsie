# Development checkpoint

Updated 2026-09-12 against HEAD `7c0eec7`; full goal remains incomplete.
Historical reports and rejected evidence are retained in `docs/evidence/` and
`docs/scope-audit.md`. This file records current state, not conversation history.

## Execution policy

Implement all of `prompt.md`, including real OpenRouter, Vercel AI Gateway and
browser-only ChatGPT subscription workflows. Astra reviews/integrates; one
Luna xhigh/default bounded worker, no nested delegation, concise context.
Fast off. Targeted checks per change; full/live checks only at milestones.
Stop agents/tests below20% remaining Codex usage. Fresh App Server quota read
2026-09-12: primary usedPercent12, 88% remaining, weekly10080-minute window.
Goal token totals are not quota. Live tests Luna only, low/default,4096 output
maximum per call, no automatic retries; Gateway up to5 calls/test, OpenRouter
2/run. Proposed OpenRouter3-call recovery remains pending. End users retain
supported model choice. GitHub actions use computer use. Never print secrets.

## Active bounded task

Luna `/root/gateway_platform_contact` completed the verifier correction; root
reviewed source binding and ran one local acceptance. Eight targeted tests
passed. Formation local matrix and Player local center now share gameplay
coordinates; malformed matrices fail closed and authored-Y false landings
are rejected. Provider metadata correctly identifies Gateway.

`gateway-seven-platforms-runtime-contact/` still fails platform1 landing:
effective position[-1,1.2,5] from saved bounce-1 set_position rule yields
contactY1.7025, above observed apex1.50 and ideal ground-jump apex1.62.
Zero inference/external/mutating requests/page errors. This is a generated
playability defect for this ground jump, not proof all routes are impossible.
Luna `/root/moving_bounce_authoring` completed the bounded follow-up; root
reviewed the diff. Existing bounce behavior + start move_path works: actual
GameSession/runtimeEntityMatrix/stepGameplay integration proves downward
contact gives velocityY7.08 without jump input, path continues and unrelated
tree is preserved.20 focused tests/typecheck/format/diff checks passed.
Generation guidance now teaches composition and ground-jump reach margin;
set_position repositions the entity and cancels its path, not a player launch.
No schema/runtime behavior changed. Browser worker stopped after four local
fixture attempts; no worker/process remains active. New verify-moving-bounce
script and moving-bounce-browser* evidence preserve failures. Current raw
report fails desktop ascent, before export/touch. Root reviewed code and
recorded independent arithmetic in root-trace-review.json: samples24→26
fall to1.0175,27 stays there,28→29 rise, all after recorded jump release.
This is partial retained evidence, not a fresh passing rerun. Current script
fixes catalog-vs-visible contact height, scans later candidates and closes
contexts before video save; synthetic fall/flat cases reject. Syntax passes.
Root corrected run in moving-bounce-browser-corrected passed desktop rebound,
continued path, UI reload/ZIP, then failed immediate touch platform readiness.
Luna added bounded player+matched-platform readiness; root reviewed and ran
once in moving-bounce-browser-ready. Desktop/export passed, touch59 samples
show ascent after release but proof fails. Root reviewed input/trajectory.
Luna corrected duplicate-frame ascent handling offline; root reviewed final
diff and ran one new fixture browser milestone. moving-bounce-browser-frame-aware
PASSED editor create/reload, desktop bounce/path, exact ZIP export, standalone
390x844 CDP touch bounce/path. Root reviewed actual direction reversal, no
post-release jump events and touch screenshot. Zero provider/model/external
requests/page errors. No worker or owned test process remains active. This
closes one fixture composition path, not three-platform route/live provider
story/physical mobile. Next meaningful step: deploy/test current authoring
guidance in an authorized fresh provider milestone, preserving all failures.
Production build at7c0eec7 passed. Old idle server81664 stopped; new server3068
session18186 serves this build with local env and output cap4096. No model
calls started. Existing .env.openrouter.local contains nonempty test key,
model and cap variables; values were not printed. Main env files and current
environment contain no Gateway test key. OpenRouter remains local-only,
2calls/run4096 maximum, Luna low/default/no retries;3-call request pending. Do not
rebuild .next while server in use. Live provider effectiveness remains open.
Earlier failure `gateway-seven-platforms-sequential/` remains retained.
Acceptance distinction: existing verify-flagship-platforms asserts landing
then560ms carried support. That is appropriate for moving nonbounce platforms,
not automatic bounce. A bounce browser contract must instead show descending
contact followed by upward launch with no jump input, continued platform path,
and sequential reachable contact. Do not weaken carry checks to call a bounce
pass; keep separate evidence scopes. Root sent this criterion to the worker.

Publication terminal-state regression a49c84e passed26 targeted tests; live
failed-deployment continuity remains unverified.

## Latest live OpenRouter milestone

`provider-e2e/openrouter-moving-bounce-guidance/` passed exactly2 Luna low/default
calls at4096 cap, local app7c0eec7, existing local-only key. Original flagship
creation + selected color edit, reload, ZIP and standalone load passed.
Saved13 objects include3 bounce entities and3 move_path actions; confirms
structural guidance adoption, not actual3-platform route/giant edit/full story.
No worker/test process active. Full goal still incomplete.

## Current Gateway flagship evidence

Four live Luna calls across stopped runs/resume produced saved revision40;
not a fresh uninterrupted story. Baseline revision33 in
`provider-e2e/gateway-flagship-story-catalog/gateway/`; hash-identical rebuilt
baseline GLBs are explicitly reconstructed. Revision40 plus seven captured
GLBs in `provider-e2e/gateway-flagship-checkpoint-resume/` (`12ce90a`).
Middle platform speed1.2→0.6, two crystals added, other entities preserved.
Giant mushroom physical size failed: replacement shorter than original tree.
Sizing guidance deployed `a5b2769`; live effectiveness unverified.

Offline continuation (`e0dff7c`, evidence `146332f`) proved exact edited reload,
undo with seeded history, restored reload/export/standalone, zero inference.
Does not establish original live undo history. Separate revision40 goal7 ZIP:
`provider-e2e/gateway-flagship-seven-export/gateway/world-goal-7.zip`, SHA256
4460108481bbd9b7b3153afff9a948b41c51a69499b0b5035fc6d5accd02ecfd.
`world.zip` alongside is restored revision41 goal5; do not confuse them.

Verifier `265f026` uniquely binds actual portal bounds and requires two early
contact samples: desktop/CDP390x844 touch score0/no win, then7/win/reset passed
(`gateway-seven-gameplay-portal-bound/`, `gateway-seven-gameplay-touch/`).
Earlier `gateway-seven-gameplay/` used wrong planet bounds: partial only.

Published test clone and signed-out desktop/CDP-touch gameplay passed b004e99:
`publication-gateway-seven/`, exact assets/licenses, zero inference/retries.
https://orb-187a1afe648f20a2fde3-bw4hvlfhr-grappeggias-projects.vercel.app
Deployment dpl_2RCTPEukaT9wZKVK8Yek35h7oqmL; temporary password deleted.
This does not prove platform sequence, original-project revision continuity,
physical mobile or complete provider story. No publication job remains live.

## Runtime and other accepted milestones

Latest production source a5b2769 at orbsie.com; smoke evidence in
`replacement-sizing-release/`. Current local server3068/session18186 uses build7c0eec7; revalidate before reuse. Temporary Gateway key file deleted;
do not assume Vercel env pull contains a usable key.
OpenRouter/Gateway input-game create/edit/reload/export/play passed separately.
Gateway explicit continuation/cloud recovery/publication have separate reports.
Public OpenRouter flagship crystal/portal/reset passed keyboard and CDP touch;
platform1→2→3 passed desktop sampled landing/carry, touch sequence still failed.
Free strawberry production trial2→1→0 create/edit and independent mixed asset
publication passed. These are bounded evidence, not complete provider E2E.

## Owner-dependent and remaining gates

- CUA fresh inventory2026-09-12: apps[],browsers[]. Fresh DevTools page1 was opened to Orbsie sign-in; fields empty. Owner sign-in/browser access needed for ChatGPT
  consent/discovery/inference/recovery. Local companion does not satisfy scope.
- Android Chrome first-run terms without Google account need specific approval.
  Emulator installation authorized. Revalidate AVD; physical recent midrange
  Android model/OS and iOS device availability unanswered.
- OpenRouter3-call recovery approval pending; continuation is not approval.
- Complete flagship creation/play-during-stream/targeted revisions/undo and
  publication across providers, giant sizing, mobile editor and platform routes,
  actual-device iOS/Android, representative GPU timing/memory/long sessions,
  failed-publication continuity and full requirement audit remain open.
- Modeling/rendering must use local browser resources with no Blender setup
  surfaced. Preserve catalog/generated asset provenance and licenses.
