# Development checkpoint

Updated 2026-09-12 after reviewed work based on HEAD `98d1c60`. The full `prompt.md` goal is incomplete.
Previous detailed handoff is preserved in
[checkpoint archive](checkpoint-history/2026-09-12-before-asset-import.md).
Use raw evidence and current source to verify claims; older exports remain immutable.

## Execution constraints

Astra reviews/integrates; at most one Luna xhigh/default worker, no nested agents,
concise task context, Fast off. Targeted checks; live/full E2E only at milestones.
Latest actual Codex App Server read: 30% weekly used, 70% remaining. Stop workers
and tests below 20% remaining. Goal token totals are not subscription quota.
Live model tests: Luna only, low/default, max4096 output tokens/call, no automatic
retries. OpenRouter2 calls/run (local file default512; explicit raised-cap flag
required); Gateway up to5/test. OpenRouter3-call recovery approval remains pending.
End users retain provider/model choice. GitHub actions use computer use. No secrets
in reports. Browser-only product modeling; no user Blender install or connection.

## Current task

LATEST USER CORRECTION: WebGL failure must select playable Canvas2D fallback, not block the game. Supersedes earlier no-software-fallback/WebGL-only gate and guidance-first task. /root/texture_rendering switched to this priority; texture WIP paused unreviewed. Existing graphics guidance partial edits also paused/integrated only as optional advisory. Root isolated clean release worktree /tmp/orbsie-graphics-release-7006a72; pre-guidance texture snapshot /tmp/orbsie-pre-graphics-guidance-d_mlrmvd. Do not deploy unreviewed texture work. prompt.md updated with shared actual gameplay/scene acceptance.

ChatGPT real owner browser connection succeeded2026-09-13 after fresh device authorization. Orbsie Signed in message, real catalog includes Luna, selected gpt-5.6-luna/low and applied connection. Evidence chatgpt-device-owner/connected.json. No inference yet: owner Chrome WebGL unavailable blocks Create. Do not bypass rendering gate or copy browser cookies. Prior rejection preserved, cause unproven; device-code security setting was already enabled.

WebGL correction committed0fe5d2e: separate Canvas readiness, submission state/ref gates, persistent accessible error and interrupted draft restoration. Typecheck and focused browser verifier passed; strengthened race evidence webgl-failure-1789265408500/report.json. Root saw actual owner Chrome local error feedback. Deployed source6300025 to orbsie-r0z3rja1o-grappeggias-projects.vercel.app, aliased orbsie.com. Build/typecheck passed. Actual owner Chrome production shows persistent graphics error and disabled Create; evidence webgl-owner-local/production.json. Gameplay remains blocked by that browser WebGL failure. Decoder3d6a839 and next texture integration contract70fa2de remain unchanged.

Decoder/transfer/cache stage reviewed and accepted: explicit material-index validation corrected; 17 focused tests and typecheck passed. Final actual-worker evidence: mushroom-basic-textured-worker-final/report.json (666 UV vertices, expected samplers, pixel-inclusive accounting). Renderer/export/catalog integration remains incomplete. No deployment or live calls.

NEXT PRIORITY: texture renderer/export integration active with /root/texture_rendering; ChatGPT consent/live acceptance still outstanding. Historical WebGL diagnosis below is resolved by0fe5d2e.
Owner Chrome on orbsie.com emits WebGL initialization errors, DOM has no message,
Create becomes enabled with a nonempty prompt (cleared without submitting).
World returns null when onError supplied; Orbsie callback1248 discards message.
Evidence owner-browser-texture-check/orbsie-fallback.json. Show persistent useful
error, prevent generation while renderer unavailable, preserve draft and account
connection access. No graphics settings automation or policy workaround.

Owner-browser check2026-09-13: extension Chrome auth remains accessible but
local textured fixture fails WebGL context creation (llvmpipe Mesa,
BindToCurrentSequence failed). Evidence owner-browser-texture-check/report.json.
chrome://gpu diagnostics blocked by browser URL policy; do not bypass via CDP
or alternate surfaces. Orbsie has a WebGL2 fallback; owner hardware/browser 3D
acceptance is unproven. Previous ChatGPT challenge no longer pending; UI is
Not connected, so old code must not be used. Fresh start requires owner readiness.

Hosted test-limit guard reviewed and integrated: exact
ORBSIE_CHATGPT_TEST_LIMITS=2-calls-180s-512kib required before private state
access/network. Any hosted ORBSIE_OUTPUT_CAP_TOKENS is rejected. Reports record
outputTokenCap:null and application time/byte bounds without a cost guarantee.
Owner approved the calls needed for live acceptance on 2026-09-13. Existing two-call milestones may run once consent/session prerequisites are met; per-call safeguards and quota stop remain. Do not infer completed ChatGPT consent from test approval. Hosted+recovery synthetic suites20/20 passed;
script syntax and diff checks passed. No live calls, no product deployment.
Worker finished; root reviewed all five changed files. Texture integration task
contract is docs/catalog-texture-integration-plan.md, not implemented.

Browser handoff 2026-09-13: use CUA extension Chrome profile Person 1 (browser1,
extension instance9a170aec-060d-42f6-9e37-e4a360ee76a6) for owner testing;
user explicitly chose this signed-in profile for future work. ChatGPT Pro session
verified via profile UI; Orbsie tab1618752688 and OpenAI tab1618752689.
Cloudflare loop did not recur: account selection and Continue reached device-code
entry. Authorization still incomplete. Extension fill/keyboard attempts left all
nine code fields empty; do not treat tool actions as successful submission.
The Codex CLI label is consistent with the actual isolated codex app-server runtime
(src/lib/server/chatgpt-runtime.ts) and documented account/login/start type
chatgptDeviceCode (https://learn.chatgpt.com/docs/app-server#3b-log-in-with-chatgpt-device-code-flow).
Earlier categorical mismatch warning was corrected; label alone does not prove an
unsupported integration. No inference calls. Next: complete device entry through
owner UI, verify Connected/catalog. Hosted harness outputCap is null;512KiB/180s
limits are not4096tokens. Resolve actual authorized/enforceable inference bounds
before live Luna acceptance; see hosted-chatgpt-acceptance.md reconciliation.

PRIORITY owner correction: no separate Orbsie email/password gate for provider
connection. Implemented BetterAuth anonymous-session bootstrap with existing
session reuse, cookie forwarding, origin/rate-limit preservation, sanitized user
response and no auto-deletion of guest owners. Additive user.isAnonymous boolean
DEFAULT false applied to .env.local DB. Real bootstrap/reuse/isolation/HTTPOnly/
403-origin checks passed; temporary test users removed. No provider calls.
Frontend ChatGPT button now opens settings and starts device authorization without
email/password. Bounded singleflight bootstrap, stale account guards and StrictMode
unmount cleanup included. Root reviewed diff;38 focused tests+tsc passed. Browser
check with real bootstrap/mocked ChatGPT passed start1/cancel1/email0/draft preserved.
Signedout OpenRouter OAuth destination(mocked) and Gateway entry also passed with
zero email requests. Evidence docs/evidence/provider-session-bootstrap. Existing
OpenAI device-code/link step remains; automatic external redirect not implemented.
Deployed28a1219 to orbsie.com via orbsie-onchbepae-grappeggias-projects.vercel.app.
Production build/tsc passed. Initial live bootstrap503 exposed different production
DB missing isAnonymous; additive migration then applied to production. OwnerChrome
bootstrap200, real ChatGPT/start200 and status200; actual device code displayed
without Orbsie password. Authorization link clicked. Owner authorization/inference
still pending; don't claim Connected. Production evidence provider-session-bootstrap/production.json. Local
Next dev3070 session75807. Do not tell owner fix is live before deploy verification.

Conforming bake review completed 2026-09-13: root reviewed converter/topology diff
and both front/rear comparisons. Pink speckles are absent in these views; measured
25620 vertices/8540 triangles, zero T-junctions/exact-zero/small-area triangles,
finite normals and no inverted winding. GLB923604 bytes; output SHA and exact
CC0 license verified. Repair stays opt-in and historical evidence is unchanged.
Default-color white spots retain visibly jagged fringes: NOT admitted to catalog.
Next asset quality work must address color fidelity, not repeat topology repair.
Worker /root/mushroom_color_fidelity completed. No source change retained.
22000 refinement-budget experiment GLB hashb1e47e23 recovered and verified;
root reviewed recovered front image: white spot outlines worse, rejected.
Experimental topology counts lack a retained report and are explicitly
worker-reported/unverified. Baseline fidelity-* artifacts duplicate conforming
baseline; only experiment-22000 artifacts demonstrate the attempted variant.
Do not rerun vertex-budget tuning. Next architecture decision: bounded embedded
texture support across decoder/worker transfer/material/export, or a different
permissive asset with acceptable vertex-color appearance. Textured prototype completed and root-reviewed: filter-corrected GLB271396bytes,
666vertices/222triangles, embedded512PNG, exactCC0, base0/height1. Hash3bb6e9fc
verified. Front/rear show softly filtered spots without old fringes; uniform
pink visible. Initial nearest-filter export and blank-pink fixture preserved;
corrected evidence mushroom-basic-textured-filter-corrected{,-preview}.
Typecheck and20hosted/recovery tests passed after correcting texture image types
and earlier helper optional-parameter typings. No catalog/runtime integration yet.
Next implement decoder/transfer/cache contract from catalog-texture-integration-plan.md,
then editor/export integration before asset admission.
Active worker /root/mushroom_color_fidelity owns decoder/worker/queue/cache and
asset tests for optional typed RGBA atlas descriptor. It may add runtime helper
and corresponding build-player source allowlist entry. No World/hook/catalog
changes or player bundle regeneration in this stage. Root must review real-worker
PNG decode, resource rejection, transfer/cache budget accounting and typecheck.
Renderer integration remains separate; do not enable textured asset IDs yet.

## Asset handoff (paused)

The bounded offline Three.js FBX/TGA import probe passed and root reviewed source
and report. scripts/probe-mushroom-import.mjs imports one762-vertex/254-triangle
mesh with762 UV vertices, finite bounds, and exact texture-map identity. TGA is
4096-square, decoded to RGBA with flipY=true, repeat wrapping and sRGB. Input
hashes match inspection. Evidence: mushroom-candidate-import/report.json. No
model/network/browser calls or catalog changes. No worker currently active.
Texture-baked prototype is now generated by scripts/convert-mushroom-candidate.mjs.
Root reviewed and corrected texture texel-center/wrapping sampling and transformed
normals. Synthetic texel-center/repeat-seam checks and corrected conversion passed.
Output: docs/evidence/mushroom-candidate-conversion/prototype.glb,440200 bytes,
12192 vertices/4064 triangles, one-meter height/base0, no texture/image/URI. Exact
license copied and source/output hashes recorded in report.json. GLTFLoader and
transformed bounds checks passed. Appearance remains unverified; no catalog change.
Local original/baked/pink front/rear previews now rendered; root reviewed images
and fixture. Evidence mushroom-candidate-preview. First incorrect multiplicative
pink comparator preserved under first-run; corrected comparator replaces COLOR_0
and clones geometry, with assertions. No page errors/external requests. Silhouette
matches source; gills/spots softened. Flat mature cap is not approved as the default
giant mushroom. No catalog admission. Basic variant has now been extracted, converted and rendered using those tools.
Evidence mushroom-basic-{inspection,conversion,preview}; GLB384900 bytes,
10656 vertices/3552 triangles, base0/height1m. Root sees rounded cap and distinct
stem in pink, but jagged baked white spots are a visible quality defect. Not
admitted. Opt-in adaptive bake now implemented and rendered in mushroom-basic-adaptive-
{conversion,preview}:29997 vertices/9999 triangles,~1.08MB, sampled color error
0.467→0.121; vertex budget saturated, threshold0.04 not achieved. Root reviewed
images: spot outlines improved but dark cap speckles persist even under uniform
pink. NOT approved. Next diagnose this concrete rendering defect; no blanket
quality claim or repeated provider calls. Topology diagnosis (mushroom-topology-diagnosis) now compares source/uniform/
adaptive geometry after unit-height normalization. Root corrected an initial
mislabeling of small triangles as zero-area; first-run.json retained. Corrected
adaptive has0 exact-zero triangles,32 positive areas<=1e-6m2,2689 T-junctions;
uniform has0/0/0. Both finite normals/no inverted winding. This establishes a
nonconforming topology difference, not rendered causality. Next bounded correction
should ensure neighboring refined triangles share split edge vertices, then run
numeric topology and the same pink visual comparison before any admission.
Preview fixture TypeScript errors were corrected; repository tsc now passes.
Converter/verifier accept environment-selected inputs/output dirs; historical
Big evidence is unchanged. Prior full conversion attempt was stopped
at its time bound without artifacts; do not repeat a broad investigation.

Candidate source: Asset Quest Low Poly Mushroom Kit, bundled CC0 license verified.
Inspection: docs/evidence/mushroom-candidate-inspection/{README.md,report.json,License.txt}.
Archive and selected FBX/TGA: /tmp/orbsie-mushroom-candidate.nIL3N8/.
Selected mesh has254 triangles, UVs and external4096-square diffuse TGA. Actual
silhouette/texture fidelity remain unrendered. Current catalog loader drops UVs
and preserves material/COLOR_0 only; world asset tint replaces all vertex colors.
Before admission: self-contained bounded GLB derivative, exact provenance/license,
base/scale/normal validation, source-versus-derivative visual review, new catalog
ID, actual decoder/export checks. Existing Kenney mushroom bytes/ID stay intact.

## Recent completed work

- `8046783`: player build includes every manifest source license, rejecting unsafe
  paths. Root reviewed diff. Syntax/build/exact license inclusion passed; generated
  player artifacts unchanged for current single-source catalog.
- `7f06602`: candidate inspection/license/hash evidence committed; no asset shipped.
- `3658d7e`: OpenRouter support-contact run, two Luna4096 calls, create/selected
  mushroom edit/reload/export/standalone passed. Evidence provider-e2e/openrouter-support-contact.
  Source bounds plus scale12/Y.6 give base0 against support0. Root reviewed saved
  snapshots and screenshot. Giant size/recognizable mushroom quality still open.
- `216386c`: shared provider catalog guidance recomputes support contact after
  geometry/scale changes; production deployed. Prior clipping evidence retained.
- `2db0ada`: live canceled replacement publication preserves old revision/URL,
  exact snapshot and fresh signed-out browser load. Evidence publication-terminal-corrected.
  Two publish POSTs, one guarded cancel, no model calls. CANCELED verified; ERROR
  only offline. This does not prove full gameplay/mobile acceptance.
- `4a60a13` / `6639c7d`: bounded input latency telemetry integrated with World.
  Two-sample synthetic browser check passes; not representative mobile performance.

## Environment and owner gates

Production: https://orbsie.com, app source216386c.
Last local build2e04040 on127.0.0.1:3068, server handle1205; verify handle before use.
Latest Chrome page1 snapshot still shows Orbsie sign-in dialog, ChatGPT queued
for after sign-in. Owner must authenticate/consent; don't repeatedly ask unchanged
question or disturb draft. Real ChatGPT consent/catalog/inference remains unverified.
Vercel credential file: /home/marcos/.local/share/com.vercel.cli/auth.json (0600).
Main project prj_oRks1By5wPlChGkGgHG0Kz4xYn17; team_AuL6qTSH2R8yEQT4Q12a0jXR.
Never target main project in controlled deployment-failure tests.
OpenRouter local key/config: ignored .env.openrouter.local. Never print values.
No current local Gateway plaintext test key; don't infer from sensitive env pull.
Physical Android/iOS devices unavailable; owner specified recent midrange Android.
Emulator evidence is not physical-device acceptance.

## Remaining full-scope acceptance

1. Real browser ChatGPT subscription sign-in/consent/catalog/inference/create/edit,
   recovery, export and publication. OpenRouter real OAuth consent also unverified.
2. Complete flagship story per provider: play during creation, three moving bounce
   platforms, collectibles/portal win/reset, giant pink target edit, slow middle
   platform plus two crystals, original live undo, refresh and same-world publish.
   Current Gateway saved revision37 route has partial platform evidence, not full
   portal/reset/mobile proof. Older/different worlds cannot close that scope.
3. Real midrange Android and iOS Safari editor/public workflows, keyboard/orientation,
   background/recovery, long sessions; representative frame/input/memory timings.
4. Remaining provider recovery/free-failure/exhaustion acceptance, catalog versus
   procedural responsiveness benchmark, asset quality review and full scope audit.
5. GitHub push through computer use remains unverified.

Do not mark the goal complete from bounded fixture passes. See prompt.md,
docs/scope-audit.md and archived checkpoint for detailed evidence locations and
failed attempts. Preserve failures; do not weaken acceptance to fit them.
