# Development checkpoint

Updated 2026-09-13. Full goal: implement all `prompt.md`, with real E2E workflows
for OpenRouter, Vercel AI Gateway and ChatGPT. **Incomplete.** Requirements remain
in `prompt.md`; do not substitute focused milestones for full acceptance.
Previous detailed evidence/history: [archive](checkpoint-history/2026-09-13-after-software-fallback.md).

## Execution policy

Astra reviews architecture/integration; one Luna xhigh/default worker at a time,
no nested agents, concise context, Fast off. Targeted checks; full/live runs only
at meaningful milestones. Latest actual quota read: 34% weekly used, 66% remaining;
stop workers/tests below20% remaining. Goal token totals are not quota.
Live tests use Luna only; users retain unrestricted supported model choice.
Owner approved needed ChatGPT calls; existing harness two-call milestone has
180s/512KiB per call, no enforceable token cap. OpenRouter4096 output tokens/call,
2-call milestones; Gateway up to5/test. No automatic blind retries.
Use owner Chrome via computer use; GitHub via computer use. No copied browser
cookies, local Codex credentials, or user Blender installation. Preserve licenses.

## Current task: diagnose first real hosted ChatGPT generation failure

Worker `/root/chatgpt_failure_diagnostics` implements bounded safe diagnostics in
chatgpt-runtime/generation/scene-stream plus narrowly required schema/tests.
Also fixes exact protocol mismatch root proved against hosted Codex0.153.4:
`turn/completed` has `{threadId, turn:{id,...}}`, not top-level `turnId`.
Current generator incorrectly rejects official completion events. Preserve
cross-thread/turn validation. Diagnostics must only expose closed stage/reason
codes, bounded numeric RPC code and already-sanitized validation metadata, never
raw provider text, credentials, IDs, paths or generated content. No live calls,
deploy or nested agents by worker. Root reviewed the server/protocol diff and
requested fixes for client acceptance of CHATGPT_GENERATION_ERROR, serialization
of mutated RPC metadata, and unmatched pre-ack terminal classification. Final
review accepted those fixes. Six focused suites (78 tests), typecheck, Prettier
and diff checks passed. No additional live calls. Next: isolated release build
and deployment, then fresh owner Chrome ChatGPT create/edit acceptance.

Real owner Chrome authorization/catalog succeeded again, Luna low applied.
One live create requested mushroom platforms, moving middle platform, crystals,
portal win/reset and blue-strawberry tree. POST /api/chatgpt/generate returned200
at2026-09-13T03:46:24Z, but UI generic generation failure; objects panel empty.
No edit or retry. Actual failure cause remains unproven: current code erases
RPC/callback/terminal causes. Evidence `chatgpt-owner-live-20260913/create-failure.json`
and `completion-schema.json`. Do not attribute that run solely to the protocol
bug until stronger evidence. Next: review/test fix, isolated deploy, fresh consent
if required by host expiry/artifact change, then deliberate live create/edit.

## Production and workspace

Production sourceb880edd (ChatGPT fix4eb9ce8) deployed to
https://orbsie-5jeulbfbi-grappeggias-projects.vercel.app, aliased https://orbsie.com.
Build/typecheck passed. Graphics fallback source1b8698d, advice52ee047,
standalone bundle0ff35ca. Owner Chrome now renders Canvas2D and enables Create
with prompt; no fatal dialog. Evidence `software-owner-local/production.json`.
43 shared gameplay/input/readiness unit tests passed. Editor+standalone variable,
click/color, visibility, position/path, score/reset acceptance passed:
`game-actions-software-acceptance-final/report.json`. Zero unexpected errors or
external standalone requests. Fallback/retry/race suite also passed. These are
focused checks, not full mobile/flagship/performance certification.

Main retains paused unreviewed texture WIP: World Formation, asset hook/texture,
formation particles/core and catalog comparison scripts/tests. Do not deploy main
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
  export/license acceptance. Decoder3d6a839 accepted; texture WIP not accepted.
- Full prompt.md requirement audit, provider recovery/free exhaustion, GitHub push.

Prior provider evidence remains in archive: OpenRouter3658d7e create/pink edit/
reload/export/contact passed with visual-quality gap; Gateway input-game39b8c90
and3-call cloud recovery passed; free blue-strawberry2→1→0 passed. Do not repeat
those isolated checks as a substitute for missing full same-world milestones.
