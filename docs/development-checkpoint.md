# Development checkpoint

Updated 2026-09-13. Full goal: implement all `prompt.md`, with real E2E workflows
for OpenRouter, Vercel AI Gateway and ChatGPT. **Incomplete.** Requirements remain
in `prompt.md`; do not substitute focused milestones for full acceptance.
Previous detailed evidence/history: [archive](checkpoint-history/2026-09-13-after-software-fallback.md).

## Execution policy

Astra reviews architecture/integration; one Luna xhigh/default worker at a time,
no nested agents, concise context, Fast off. Targeted checks; full/live runs only
at meaningful milestones. Latest actual quota read 2026-09-13: 39% weekly used, 61% remaining;
stop workers/tests below20% remaining. Reusable local check:
`python3 /home/marcos/.cache/orbsie/read-codex-quota.py`. Goal token totals are not quota.
Live tests use Luna only; users retain unrestricted supported model choice.
Owner approved needed ChatGPT calls; existing harness two-call milestone has
180s/512KiB per call, no enforceable token cap. OpenRouter4096 output tokens/call,
2-call milestones; Gateway up to5/test. No automatic blind retries.
Use owner Chrome via computer use; GitHub via computer use. No copied browser
cookies, local Codex credentials, or user Blender installation. Preserve licenses.

## Current task: software atlas appearance

Previous turn made progress: reviewed and committed WebGL texture integration
and fresh fallback evidence inff61fbc. Owner graphics error remains unreproduced;
forced-WebGL-off editor/retry and standalone input checks pass. CUA remains
unavailable before browser access; no auth workaround is authorized.

One Luna worker `/root/software_texture` implements precomputed approximate
UV-sampled vertex colors in SoftwareEntity’s committed effect, shared sampler,
uniform tint overrides and last-good appearance. Owns focused source/tests/browser
fixture changes and player rebuild. No catalog admission, live calls or deployment.
Root owns review and documentation. Contract: `catalog-texture-integration-plan.md`.
Acceptance: actual worker with WebGL disabled, source/pink/restored editor views
and offline exported playback, targeted sampler tests and typecheck.

WebGL texture stage ff61fbc includes immutable atlas ownership, uniform tint and
restore, last-good replacement and committed lifecycle cleanup. Typecheck, player
build,22 focused tests and actual-worker StrictMode verifier pass:
`catalog-texture-render-final-5/report.json`. Root reviewed settled editor views
in final-2 and exported player in final-4. Candidate remains fixture substitution.
Source archive retained in `/home/marcos/.cache/orbsie/source-archives/`; provenance
`mushroom-source-restored-20260913/report.json` matches original hashes.

ChatGPT completion/protected diagnostics fix4eb9ce8 and player buildb880edd are
reviewed and deployed. Six focused suites78 tests, typecheck and local/Vercel
production builds passed. Official nested turn/completed.turn.id now accepted;
conflicting IDs rejected, safe stage/reason/RPC metadata retained by client.
First real owner Chrome auth/catalog succeeded, Luna low applied, but one create
failed at2026-09-13T03:46:24Z with empty objects. No edit/retry. Cause of that
pre-fix failure remains unproven. Evidence `chatgpt-owner-live-20260913/`.
Next provider step is deliberate post-deploy owner Chrome create/edit, pending
browser surface restoration. No new model calls during texture work.

## Production and workspace

Production sourceb880edd (ChatGPT fix4eb9ce8) deployed to
https://orbsie-5jeulbfbi-grappeggias-projects.vercel.app, aliased https://orbsie.com.
Build/typecheck passed. Read-only deployed HTTP200 and exact player runtime/source
hashes passed: `chatgpt-completion-release-20260913/report.json`. No post-fix live
inference yet. Graphics fallback source1b8698d, advice52ee047,
standalone bundle0ff35ca. Owner Chrome now renders Canvas2D and enables Create
with prompt; no fatal dialog. Evidence `software-owner-local/production.json`.
43 shared gameplay/input/readiness unit tests passed. Editor+standalone variable,
click/color, visibility, position/path, score/reset acceptance passed:
`game-actions-software-acceptance-final/report.json`. Zero unexpected errors or
external standalone requests. Fallback/retry/race suite also passed. These are
focused checks, not full mobile/flagship/performance certification.

Main ff61fbc contains reviewed WebGL texture work and fallback evidence;
software atlas worker changes are not yet reviewed. Do not deploy main
worktree directly. Prior /tmp release worktree disappeared. New clean release worktree
`/tmp/orbsie-chatgpt-release-4eb9ce8` is atb880edd with dependencies and project
link. Local production build and Vercel production build passed. Servers3071/3072
were stopped; local3070 historically exists, verify before use. Deploy reviewed
commits through isolated worktree. Vercel CLI uses existing local auth; no keys in
chat/evidence. Root commits frequently and preserves failed unique-run evidence.

## Browser handoff

CUA extension Chrome browser1, Person1, instance9a170aec-060d-42f6-9e37-e4a360ee76a6.
Production tab1618752702; ChatGPT signed-in tab1618750689. Claim/mark handoff in
current turn as needed. Latest CUA call failed before browser access with
`CUA_REPL_ENABLED_SURFACES is required`; owner asked to re-enable the surface.
No post-deploy live calls or browser verification yet. Device auth tabs auto-close
on success; never reuse codes.
chrome://gpu diagnostics and direct /api/chatgpt/status tab navigation were blocked;
do not bypass via CDP/backend/cookie export. Normal Connections UI works.
Host initial lifetime is10min, nonpersistent, no renewal implemented. Vercel SDK
supports extendTimeout, verified locally and official docs; see
`docs/chatgpt-session-lifetime-followup.md`. No claim current host remains alive.

## Remaining major acceptance gaps

- ChatGPT real creation/edit/recovery/export/publish; active-session continuity.
- OpenRouter real OAuth consent; API-key evidence is not OAuth acceptance.
- Same persistent flagship game per provider: incremental creation while playing,
  three moving bouncy mushrooms, collection/portal win/reset, giant pink targeted
  edit, slower middle+two crystals, original live undo, refresh and publish.
- Physical midrange Android and iOS Safari, touch/orientation/background/long-run
  performance. Prior emulator or narrow desktop tests do not certify mobile.
- Finish texture/catalog/procedural mix integration, visual quality and offline
  export/license acceptance. Decoder3d6a839 and WebGL texture stage reviewed; software appearance/admission remain open.
- Full prompt.md requirement audit, provider recovery/free exhaustion, GitHub push.

Prior provider evidence remains in archive: OpenRouter3658d7e create/pink edit/
reload/export/contact passed with visual-quality gap; Gateway input-game39b8c90
and3-call cloud recovery passed; free blue-strawberry2→1→0 passed. Do not repeat
those isolated checks as a substitute for missing full same-world milestones.
