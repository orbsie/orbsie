# Development checkpoint

Sep 27 one post-diagnostics Gateway mushroom run used two Luna requests, both
HTTP 200, with no retries or fallback. Creation passed and the edited project
was saved at revision 9; the harness then stopped at its pink-material check,
with no protocol diagnostic. The check missed the pink custom cap-part color;
the saved geometry has no global tint, so its teal entity fallback color does
not override that explicit part color. The initial editor capture's cyan/blue
flecked canopy was taken after save, but whether its formation animation had
settled is unknown. A zero-generation local replay reopened revision 9, waited
10 seconds, then captured editor and Play views with zero generation requests,
external requests, or page errors. The pink cap fits both views, but the editor
angle hides most of the stem and the complete joined form is unclear in Play;
the pale details do not read as visible spots. Renderer transforms put the
stem top at world Y=2.42 m and cap underside at Y=2.97 m, leaving a 0.55 m gap,
so they do not contact. Visual acceptance remains unmet. The authoring prompt
now gives the unit-cylinder/lathe contact formulas and retains intentional
floating forms. Mushroom-replacement harness checks now honor global tint over
part colors and admit ready labeled custom multipart geometry with computed
part bounds using the renderer's exact Three.js matrix/Euler transform; a
multi-axis rotated nonuniform-scale fixture checks each resulting dimension.
They report structural/backend status separately from pending manual visual
quality. Focused generation and harness tests plus typecheck pass. The shared
authoring prompt grew by 57 ASCII bytes in every capability and output-format
branch. No model call or deployment occurred. Sanitized report:
`docs/evidence/provider-e2e/mushroom-contact-post-diagnostics-20260927/report.json`.

Sep 27 precommit generation activity now uses preview wording for new objects,
geometry, entity edits, world rules, and atmosphere; the committed final-update
wording is unchanged. A focused stream test holds a selected-object edit open,
checks the preview trace, then closes without commit and verifies scene rollback.
Authoring activity tests pass (13) and TypeScript typecheck passes. No model call
or deployment occurred.

Sep 27 zero-model review of the rejected mushroom edit found the retained
sanitized run record contains only `INVALID_SCENE_PROTOCOL`, operation 3, zero
schema issues, and a null finish reason; it does not preserve enough information
to distinguish event or command parsing, policy enforcement, turn completion,
or command application. The exact cause remains unknown. Generation diagnostics
now include an allowlisted protocol subreason for those failure stages without
exposing error text. The
focused parser/stream suite passes (67 tests) and TypeScript typecheck passes.
This improves future diagnosis only; it does not repair or visually validate
the prior model response.

Sep 27 fresh Gateway mushroom-replacement attempt ran after the local cap was
corrected to 4096. Exactly two generation requests returned HTTP 200 with no
retry, fallback, budget violation, or blocked external request. Tiny-island
creation passed; the selected-object edit was rejected as
`INVALID_SCENE_PROTOCOL` (operation 3), so recovery/export/player never ran.
Inspected seed and failure screenshots show the original tree and an explicit
unapplied-change error. Only the pre-edit island/tree snapshot exists; no
mushroom contact geometry or player framing could be assessed. This is not
visual acceptance evidence. Sanitized result:
`docs/evidence/provider-e2e/mushroom-contact-prompt-20260927-cap4096/report.json`.

Sep 27 mushroom-replacement Gateway run stopped at harness preflight: the app's
`/api/config` reported `generationMaxTokens: 10000`, while this test requires an
exact 4096-token cap. No provider request was sent; creation/edit and visual
inspection did not start, so this run provides no visual acceptance evidence.
That earlier attempt predates the runtime cap correction. Sanitized result:
`docs/evidence/provider-e2e/mushroom-contact-prompt-20260927/report.json`.

Sep 27 shared generation prompt now states that custom-part coordinates compose
through part, entity, and parent transforms, gives a small lathe-profile contact
example, and directs intended attachments to transformed support contact and
camera-visible surfaces. Floating gaps and embedded forms remain valid when
intended. The shared prompt grows by 393 ASCII characters/bytes in every
capability and output-format combination. Prompt-branch and hosted-adapter
coverage passes (40 tests) with TypeScript typecheck. No live model evaluation
ran, and this prompt contract change does not establish visual acceptance.

Sep 27 cloud-save fix release: clean source `c9c7369` deployed as Vercel
`dpl_y9Srao3nYCRBicCQt4DkBKnTHTcr` (READY) and aliased to
`https://orbsie.com`. Owner Chrome main page rendered with compatibility
graphics; public config still has accounts/publishing and hosted ChatGPT flags,
free trial is enabled with one prompt remaining for this test egress, robots
returned 200, and the previously published flagship project remains 200. No
model call or production account write occurred during this release smoke.
The signed-in save fixture passed on the local production build connected to
the same synthetic account/database, not on the deployed alias. Evidence:
`docs/evidence/cloud-save-reload-browser-20260927/deployment.json`.

Sep 27 integration of the cloud-save reload fix: a rebuilt loopback production
app and synthetic signed-in browser context passed local revision 42 reopening
after reload, cloud revision 35 verification, ordinary UI Save HTTP 200, exact
scene/transcript preservation, then a competing cloud update blocked before a
second PUT while the local draft remained unchanged. Zero generation requests
and browser page errors. `npm run build` passed. The first fixture attempt
stopped before Save on an outdated account-button name; the corrected fixture
passed on one fresh synthetic project. The script and sanitized evidence are
`scripts/verify-cloud-save-reload.mjs` and
`docs/evidence/cloud-save-reload-browser-20260927/report.json`. This is a
synthetic-account integration check, not a fresh owner-session provider journey.

Sep 27 cloud-save reload recovery: Save now fetches the owned cloud row just
before writing, verifies its canonical snapshot token, and accepts a prior
base only when an account/project-scoped acknowledgement or the active local
past history proves ancestry. It merges local/cloud transcripts only when one
is a prefix of the other, persists any merged messages locally before one
server-CAS PUT, and retains the local draft with an open-cloud/export path when
proof is missing or the histories diverge. Server conflict checks are
unchanged. Focused helper and project-route coverage passes (15 tests), as does
TypeScript typecheck. At this implementation checkpoint no live model or
browser journey had run; the synthetic signed-in fixture above now covers
reload/reopen/Save and a competing update. Legacy drafts without a receipt can
continue only when active past history proves the cloud revision; redo or
unordered history cannot establish ancestry.

Sep 27 one fresh Gateway BYOK browser journey passed the standard tiny-island
create, selected-object material edit, local recovery, export, and standalone
readiness checks against the loopback production build at
`http://127.0.0.1:3055`. Exactly two `openai/gpt-6-luna` generation requests
returned HTTP 200 with low reasoning, default tier, a 4,096-token ceiling,
and no fallback, retries, budget violations, or blocked external requests.
Standalone playback had zero page errors. The route-guard probe returned its
expected HTTP 400 and is not counted as a model call. The initial launcher
preflight stopped locally before credential read; the corrected harness ran
once. Publication, cloud recovery, and account writes were not requested, so
this result does not address the separate cloud-baseline reload/save 409 gap
documented in `docs/cloud-save-reload-contract.md`. Codex quota was 97%
remaining before the run. Raw evidence remains in the mode-0700 local cache;
the sanitized summary is
`docs/evidence/provider-e2e/gateway-standard-create-edit-20260927/report.json`.

Sep 27 one fresh anonymous production free-mode browser run on
`https://orbsie.com` passed the standard tiny-island create, selected-object
material edit, local recovery, export and standalone readiness checks at
revision 9. It used exactly two `openai/gpt-6-luna` requests (both HTTP 200),
low reasoning, default tier and a 4,096-token ceiling per request, with no
fallback or generation-budget violation. Trial response headers recorded the
allowance moving 3→2→1; no separate final `/api/trial` refresh was performed.
Standalone playback had zero page errors and blocked external requests. No
publication or flagship gameplay traversal was requested; the harness's
flagship journey field remains incomplete outside this run's scope. Codex quota
was 97% remaining before the run. Raw evidence remains in the mode-0700 local
cache; sanitized summary:
`docs/evidence/provider-e2e/free-trial-production-luna-create-edit-20260927/report.json`.

Later Sep 27 funding check: the same private Vercel AI Gateway test key's
read-only `/v1/credits` response now has a positive balance. Production
`https://orbsie.com/api/trial` reports `enabled:true,remaining:3,limit:3` for
a fresh visitor. This removes the prior unfunded-provider availability gate;
it does not yet prove a free-mode generation or complete Gateway create/edit
run. The owner authorized bounded live Gateway tests after funding, using
Luna only and no automatic retries.

Sep 27 the retained OpenRouter flagship revision-42 cloud continuation passed
after one direct CAS-assisted recovery save from the verified revision-35
ancestor. The first browser stopped before UI save/publish because its account
list still held the startup revision-35 row; no publish request was sent. A
separate zero-direct-CAS resume reloaded once, verified the same project and
revision-42 retained snapshot with all five cloud messages, opened that cloud
row in Orbsie, then completed the normal UI cloud save (HTTP 200, revision
42), real Vercel deployment (READY), and signed-out published iframe gameplay.
Five crystals, all three moving/bouncy platform contacts, portal win at score
5, and UI restart to score 0 passed; generation, editor/provider, and external
request counts were zero. The continuation used the retained artifact and
made no new model call; it is separate from the original live authoring browser
session. Its initial incomplete report and successful resume summary are
`docs/evidence/provider-e2e/openrouter-flagship-cas-assisted-publication-20260927/report.json`
and
`docs/evidence/provider-e2e/openrouter-flagship-cas-assisted-zero-write-resume-20260927/report.json`.

Sep 27 fresh OpenRouter flagship live milestone: one corrected preflight and
then exactly three `openai/gpt-6-luna` requests (HTTP 200, low reasoning,
default tier, 4,096 output-token cap, no fallback) created the five-crystal
island, revised a selected tree to a pink mushroom, changed the objective to
seven crystals, and restored five crystals through the UI Undo on the same
project. Browser gameplay passed at creation revision 30, seven-crystal
revision 41, and undo revision 42: movement, all collectibles, three moving
platform and bounce contacts, portal win, and reset. The original journey
stopped at export comparison because two in-memory `assetPolicy: undefined`
fields were omitted by correct JSON export. The harness comparison now uses
the JSON wire shape (`b86b847`, 54 focused tests and typecheck passed). A
zero-model-call replay of the retained revision-42 ZIP then passed standalone
gameplay, five collections, win/reset, no page errors, and no external
requests (`c0e3924`). This replay is separate from the live browser session;
the later cloud-publication continuation validated the retained ZIP and
current player bytes but stopped at cloud save HTTP 409: a read-only account
check found the same project at revision 35 with different snapshot content,
while the retained ZIP is revision 42.
Deployment and signed-out published gameplay were not reached, and the replay
was not retried. Its incomplete sanitized report is
`docs/evidence/provider-e2e/openrouter-flagship-offline-publication-replay-20260927/report.json`.
The earlier committed sanitized summaries are in
`docs/evidence/provider-e2e/openrouter-flagship-continuous-publication-20260927-retry-after-preflight/`;
raw artifacts and account state are mode-0600 files under a mode-0700 local
cache, not in Git. Visual review finds the scene recognizable and playable but
still simple; visual delight needs a separate pass.

Sep 27 read-only external gate check: the private Gateway test key's `/v1/credits`
request returned HTTP 200 with a negative balance; no Gateway inference was
attempted. The production `/api/trial` endpoint still reports
`enabled:false,remaining:0,limit:3`, so free prompts remain unavailable.
Computer use can now inspect the owner's existing Chrome profile: one Orbsie
tab has an OpenRouter-connected completed castle draft, while a separate
`Connect ChatGPT` attempt reached OpenAI's `Sign in to Codex with ChatGPT`
consent page. The owner approved that specific Continue action, but before it
was clicked the tab advanced to a separate Codex CLI device-code challenge.
No code or grant was submitted, and Orbsie still showed ChatGPT disconnected.
The current official
App Server guide still documents a localhost managed browser callback rather
than an Orbsie HTTPS subscription OAuth callback; see
`docs/ai-connection-priority.md`. `adb devices -l` lists no physical Android
device. These checks made zero model calls and did not change account grants.

Sep 27 the fresh publication harness now traverses the validated signed-out
player inside its exact iframe: desktop keyboard focus/input stays in that
frame, gameplay observations must match the current project/revision and five
crystal set, and reports retain win/restart or bounded failure evidence. A
browser-backed replay of the retained revision-42 export passed movement, all
three bounce contacts, five collections, portal win, and UI restart from a
cross-origin iframe served on a second loopback port, with zero external or
editor/provider requests. Ordinary publication still reports deployment READY
without running flagship gameplay. A failed or missing flagship traversal
retains failure evidence, blocks the configured run, and records deployment
READY separately. Missing and stale gameplay bindings are rejected. Focused
tests and typecheck pass; no live provider call or publish was run, so a fresh
provider-created publication journey remains unverified.

Sep 27 corrected mobile-emulated OpenRouter journey passed on the loopback
production build. The fresh `openai/gpt-6-luna` create and selected-object edit
used exactly two HTTP 200 model calls with low reasoning, default tier, and a
4,096 output-token cap per call; there was no retry or fallback. Local recovery,
export, standalone playback, editor reachability, and a real Chromium touch
gesture moving the player 0.64 world units passed at 390×844/DPR 2 with no
horizontal overflow. The initial preflight stopped at HTTP 403 before any
model call because `BETTER_AUTH_URL` did not match the loopback origin; matching
the origin resolved it. The live screenshot lost the touch controls after a
redundant CDP touch-emulation override was detached. A separate zero-model-call
offline replay of the retained export after removing that override confirmed
all five controls stayed visible and in bounds through touch release and
screenshot capture; Right moved the player 1.3116 units, and the screenshot was
visually reviewed. The live and offline results do not establish physical
Android performance, a scored/winning game, cloud publication, or a Gateway or
ChatGPT provider run. Evidence:
`docs/evidence/provider-e2e/openrouter-mobile-create-edit-corrected-20260927/`
and
`docs/evidence/provider-e2e/openrouter-mobile-standalone-offline-recheck-20260927/`.
Harness and focused regression commits: `63ed7e9`, `b272e1a`; live evidence:
`be45390`. Focused tests passed 8/8 after the harness correction.

Sep 27 signed-out Android Chrome acceptance for the published OpenRouter
revision-9 island is now passed for the applicable touch gameplay interaction
(`29fbe7a`). The earlier one-finger camera-drag assertion was invalid for a
published player: `World` intentionally reserves canvas navigation for editing
and exposes separate play controls. The revised harness held Forward for one
second in the Android 15 initialized non-Play AVD clone; before/after gameplay
captures visibly shifted the island and tree, with 67,191 changed pixels
(4.25%). It served the exact revision-9 project and two catalog GLBs; cookies,
provider/generation/editor/external requests, page errors and console errors
were zero. The run used SwiftShader with automatic Canvas2D compatibility
graphics, not physical-device or hardware-WebGL evidence. This small island
has no authored score/win objective, so it does not replace the separate
flagship gameplay acceptance. Evidence:
`docs/evidence/android-openrouter-publication/revision-9-clean-avd-20260927/touch-controls-gameplay-20260927/`.

Sep 27 read-only follow-up in the owner's existing Chrome tab after the earlier
OpenRouter OAuth exchange: Orbsie displayed `OpenRouter · Balanced`, `AI key
added`, `Generation complete. Changes are applied`, and five ready castle,
princess, tree, pine, and garden entities for the retained `princess in a
castle` prompt. A production `/api/generate` observability record at
2026-09-27T17:17:12Z shows an HTTP 200 OpenRouter
`openai/gpt-6-luna` first byte on the deployment then serving Orbsie. The
browser scene was visually recognizable in compatibility graphics. This is
strong evidence that the OAuth-connected browser subsequently generated an
Orb, but the log alone does not attest to the key's issuance source, final
commit, or output-token request cap. It also does not verify a fresh
unmodified OAuth redirect after the callback fix. No new inference ran in this
follow-up; the owner tab was left connected.

Sep 27 free-mode production diagnosis: `AI_GATEWAY_API_KEY_FREE` is configured,
but `https://orbsie.com/api/trial` reports `enabled:false`. Added transition-only,
secret-safe credits-probe diagnostics (`4911d63`); the first production probe
returned HTTP 2xx with a JSON `balance` **string**, which the old numeric-only
parser rejected. Added bounded response-shape diagnostics (`ff9f957`) and a
strict decimal-string balance parser (`9162040`). Each change passed focused
tests and typecheck; the Vercel deployments built and reached READY. The final
production deployment `dpl_DVwpF91bAKLGryVtCtGTGgB8N58W` is aliased to
`https://orbsie.com`; its read-only trial probe logs `nonpositive_balance` and
still returns `enabled:false`. No free or paid model inference ran. Free prompts
require a positive Gateway balance or another authorized funded provider key;
no credit purchase or credential replacement was made. `/v1/credits` remains
undocumented in the inspected official Vercel AI Gateway docs, so this check
must continue to be treated as an availability signal, not proof that a
positive balance guarantees a generation request will succeed.

Sep 27 the OpenRouter markerless callback fix, cancellation draft recovery,
orphan-query cleanup, and blocked-storage message are deployed on production
`https://orbsie.com` as Vercel deployment `dpl_DDSc8qGDaLtC8sLHeZdfQfcTgGKn`
(READY). The local production build passed. Three synthetic Chromium suites
against the promoted production alias passed: OAuth success restored the prompt
and exchanged exactly once, success/cancellation preserved a saved world and
selection with zero cancellation exchanges, and blocked-storage/reload races
scrubbed callbacks without extra exchanges. These suites intercepted OpenRouter
and made zero live provider/model calls. The owner's prior real OAuth consent
returned a markerless code; manually adding the missing marker allowed the
single live code exchange, showed “OpenRouter connected,” selected Balanced
Luna, and restored `princess in a castle`. That live flow preceded this release;
a fresh unmodified live OAuth redirect and OAuth-key inference remain unverified.
The production free trial endpoint still reports `enabled:false`.

Sep 27 OpenRouter OAuth accepts OpenRouter's observed markerless root return
when the same tab still has its pending PKCE transaction. Callback origin,
path, state, and single code-or-error response are validated; the transaction
is consumed once, callback parameters are stripped before exchange, and a
state-matched prompt draft is restored for both success and cancellation.
Markerful callbacks remain supported. Bare `?state=` or `?code=` navigation is
ignored, while a full markerless callback without a pending transaction is
scrubbed without opening a provider error. If pending-transaction storage is
blocked for a markerless callback, the URL is scrubbed and the storage message
appears without exchange. Focused OAuth/draft tests (26), typecheck, and source
formatting pass. Synthetic Chromium success/cancellation checks pass for both
prompt-only and saved-world/selection recovery; bare, orphaned, and blocked-
storage query checks also pass. No provider/model calls were made. Deployed
browser verification remains for root integration.

Sep 27 retry of signed-out Android Chrome validation for OpenRouter project
`d33a530a-1cd8-4943-a7ae-28d11538ad87` revision 9 stopped before Android or
Chrome became available. The separate `droidlm_api35_play_midrange` emulator
exited with status 139 during normal startup after gfxstream initialization and
repeated libunwind bad-FDE diagnostics; ADB remained empty. No workaround or
retry was attempted. Cookie and consent state could not be checked, and no
public page was loaded. This is an emulator startup block, not a publication
result. Evidence: `docs/evidence/android-openrouter-clean-publication-20260927/`.

Sep 27 signed-out Android Chrome validation for OpenRouter project
`d33a530a-1cd8-4943-a7ae-28d11538ad87` revision 9 stopped before navigation.
The existing Android Chrome profile had one cookie for `orbsie.com` and none
for the pinned Vercel origin; Playwright could not create an isolated browser
context, and the Chrome incognito path surfaced a sync-consent screen. The
profile was left intact. No public page, asset, or provider/auth endpoint was
requested; rendered assets, screenshot, and touch response remain unverified
on Android. This is an environment block, not a failed publication result.
Evidence: `docs/evidence/android-openrouter-continuous-publication-20260927/`.

Sep 27 one fresh local-only OpenRouter `openai/gpt-6-luna` creation and
selected-object material edit passed on the loopback production build with low
reasoning, default tier, 4,096 output tokens per call, and exactly two HTTP 200
generation requests (no retry/fallback). Cloud save/reopen, local recovery,
export, and standalone playback passed at revision 9 for project
`d33a530a-1cd8-4943-a7ae-28d11538ad87`. The authenticated production app
published that same cloud revision to the existing Vercel Orb project; the
deployment reached READY at
`https://orb-e1fab578a6fcded5a5e7-r7kfjhhxi-grappeggias-projects.vercel.app`.
Signed-out `https://orbsie.com/o/d33a530a-1cd8-4943-a7ae-28d11538ad87` returned
the exact revision-9 public snapshot and a ready playable canvas with zero
editor/provider requests or page errors. The OpenRouter key remained local.
The initial run guard refused before inference because the server defaulted to
10,000 tokens; restarting with the authorized 4,096 cap made no model call,
then the single bounded provider run passed. Sanitized evidence (report,
preflight, conversation-free project snapshot, publication report, and signed-
out screenshot; source ZIP omitted) is in
`docs/evidence/provider-e2e/openrouter-continuous-publication-20260927/`.

Sep27 one live `orbsie.com` publication of the pinned OpenRouter GPT-6 Luna
revision-42 export passed from a fresh test account. The harness cloned the
source to Orb `pub-free-75a021f2-969d-4a61-8e6a-dbc4a51eeb20`, saved and
published revision 1, verified its signed-out page/browser/snapshot plus exact
referenced catalog asset and license bytes, then changed only `crystal-1`'s
material and saved/published revision 2 to the same Vercel project
`prj_BC1Us91OLtO3hSxwxeeLIfFMKG1W`. The first release remained served while
revision 2 built; final deployment
`https://orb-6d7c4d2b7a0130aecdf4-en8sbxfen-grappeggias-projects.vercel.app`
was READY and the stable `/o/{id}` sharing page linked to it. A separate
signed-out published-player traversal passed on desktop keyboard and 390×844
emulated mobile touch: portal contact before collecting did not win, score
reached 5, portal win appeared, and restart reset score to 0. The browser made
zero inference, external, or mutating requests and recorded no page errors.
This proves publication and gameplay for the saved artifact, not a fresh
provider run through publication or physical-device play. Evidence:
`docs/evidence/publication-flagship-openrouter-gpt6-20260927/`.

Sep 27 the exported-artifact publication harness now accepts a missing
generated-model manifest only when the project references no generated models;
referenced generated models still require valid manifest provenance. The
optional revision-2 republish can target an explicit entity ID and color while
the existing `crystal-accept` / `#ff8f6b` default remains intact. Prepare-only
passed for the pinned OpenRouter GPT-6 Luna ZIP (SHA-256
`7630cb95236386713f84c5fc40559273e37fec18b204ea242c6c8ba8f595978a`, revision
42, 14 entities): no generated uploads, two planned cloud saves, and the
`crystal-1` material change from `#56eaff` to `#ff8f6b`. Focused publication
tests (34) and typecheck pass; no model calls were made.
That prepare-only checkpoint preceded the live publication pass above.

Sep27 Android flagship replay rerun supersedes the partial replay note below.
The exact pinned OpenRouter GPT-6 Luna `world.zip` (SHA-256
`7630cb95236386713f84c5fc40559273e37fec18b204ea242c6c8ba8f595978a`) passed
once on the Android 15/API 35 `droidlm_api35_midrange` emulator with Chrome
124.0.6367.219, forced Canvas2D, and the ZIP's archived runtime served
byte-for-byte unchanged. The touch replay recorded bounce contacts and movement
on all three platforms, collected all five crystals, and won through the portal
at score 5. Tapping “Play again” returned to playing at score 0; the harness
confirmed a fresh gameplay observation newer than the win observation and an
advanced reset lifecycle. Provider calls, external requests, request failures,
and page errors were zero. WebGL and physical-device behavior remain untested.
Evidence: `docs/evidence/android-openrouter-flagship-20260927/fresh-android-api35-touch-replay/`.

Sep27 production alias `https://orbsie.com` was updated to deployment
`DwtS2YspB6NrtzbstLzmQz1UctnA` (source `a1008eb`). A fresh read-only
`/api/trial` response is `{enabled:false,remaining:0,limit:3}`, consistent with
the free provider being unavailable. In the owner's restored Chrome session,
the failed draft `princess in a castle` remains in the prompt field, the old
connection dialog says the free provider could not complete the request, and
the refreshed entry point offers `Connect provider`. The pasted
`sudo python3 .../accelerate-4tb-peer.py --run` line is not an Orbsie error and
does not appear in this repository; the owner was asked for its exact screen
location. Chrome also has a signed-in ChatGPT Pro tab. Clicking Orbsie's
`Connect ChatGPT` reached OpenAI's account-selection and then `Sign in to Codex
with ChatGPT` consent for the owner's account; authorization is awaiting the
owner's specific confirmation, so subscription generation is not yet verified.

Sep27 free trial availability now checks `GET /v1/credits` with only the
configured `AI_GATEWAY_API_KEY_FREE` before `/api/trial` advertises prompts and
before `/api/generate` model preflight or quota admission. Only a successful
response with a finite positive numeric `balance` admits free use. The
server-side check times out at 2.5s and uses 10s per-process cache/single-flight
coalescing; unreadable, zero, negative, and network-failed results fail closed
with `FREE_PROVIDER_UNAVAILABLE`. The existing HTTP402 refund remains as a
race/insufficient-budget fallback. Focused synthetic checks (19 tests),
typecheck, and production build pass; no live model calls. The credits endpoint
and response shape are undocumented, and this balance may not reflect a
key-specific or model-specific budget, so a positive result cannot prevent all
upstream HTTP402 responses.

Sep 25 one fresh loopback OpenRouter flagship run on clean source `21f24cd7ead590579eedccad6dd8e19250c301c1` passed creation (revision 30), keyboard gameplay (five crystals, score 5, portal win, restart), a selected-tree-to-mushroom edit (revision 35; ID `tree-a` remained stable and its label became “Giant Pink Mushroom”), the seven-crystal goal edit (revision 41 and a 7/7 win), undo (revision 42, restoring 5/5), export, and standalone keyboard playback (5/5, score 5, win, restart to score 0). It used `openai/gpt-6-luna`, low reasoning/default tier, local-only credentials, 4,096 output-token cap, and exactly three generation requests (all HTTP 200); quota was 37% before the run, with no retry/fallback, cloud recovery, external requests, or publication. The top-level strict journey acceptance remains `incomplete` only for signed-out publication artifacts and published-win restart, which were not requested. Visual review remains pending. The saved label result supports same-entity identity editing, but this harness report does not preserve a raw command trace to prove the exact wire command. Sanitized report, scene-only screenshots, project snapshots, and export are in `docs/evidence/provider-e2e/openrouter-flagship-set-label-live-20260925/`.

Sep 25 the model command protocol now includes a strict `set_label` update for existing entities with a nonblank label bounded by the entity's 100-character limit. Applying it changes only the label, preserving the stable entity ID, geometry, transforms, behavior, asset policy, game references, and unrelated scene state; store scene updates and client command diagnostics include it. The authoring prompt reserves this command for identity changes and keeps labels unchanged for material- or shape-only edits. Focused protocol, strict-wire, prompt, and diagnostic tests and typecheck pass; no provider calls.

Sep 25 one fresh OpenRouter flagship run on `d600afc87bded70837b2e9a423ee3289382b82e2` passed loopback/model/cap preflights; quota was 37%. It used `openai/gpt-6-luna`, low reasoning/default tier, local-only key scope, 4,096 output cap, and a three-request maximum. Two HTTP 200 generation requests ran without observed retries or fallback: creation at revision 29 (29 commands), then a mushroom edit at revision 32. Creation gameplay passed the keyboard gates with three bounce-platform traversals, five collections, score 5, portal win, and restart to playing with score 0/reset 1. The edit stopped on supported-mushroom semantic evidence: the selected-target assertion passed, but target geometry changed from `tree` to `custom` without supported mushroom kind/label/catalog tag, despite a pink form in the scene crop. The run is failed/incomplete; no platform edit, undo, export, standalone, or publication phase was reached. Sanitized evidence: `docs/evidence/provider-e2e/openrouter-flagship-d600afc-live-20260925/`.

Sep 25 generation guidance now turns a requested portal completion objective into a ready entity with `behavior.type: portal` and an explicit reachable `set_game` collision rule whose win respects any requested collection-progress target. It clarifies that arch geometry or a portal label alone is decorative, while preserving open-ended and explicit no-win requests. This addresses the failed f11ef40 creation evidence; prompt test and typecheck pass, with no provider calls.

Sep 25, fresh OpenRouter flagship run on reviewed source `f11ef40188c5fc9cbd136b9a876a0d1771035c28` passed loopback origin/model/cap preflights using an isolated production build at `127.0.0.1:3051` with the remote database, accounts, and publishing disabled. Quota was 37% before the attempt. The exact `openai/gpt-6-luna` model ran low reasoning/default tier, local-only key scope, 4,096 output cap and three-request maximum; one generation request returned HTTP 200 and saved the creation at revision 28, with no retry/fallback. Keyboard movement was observed while the stream remained open. Story validation then stopped with `Story creation must contain one portal (0 !== 1)`: the saved scene has a ready arch entity named `portal`, but its behavior is `static`; the validator requires one ready entity with `behavior.type: portal` and therefore found zero. No platform traversal/contact, collections, score, portal win, reset, edit, undo, export, or standalone phase was reached. Cloud recovery and publication were disabled. Evidence is in `docs/evidence/provider-e2e/openrouter-flagship-f11ef40-live-20260925/`; the retained scene snapshot removes both conversation messages and normalizes the title, while the screenshot retains only the rendered scene plus the pre-key model-selection view. The original failure/intermediate screenshots containing chat text were omitted/cropped. This is a failed fresh acceptance attempt; no later-phase pass is claimed.

Sep 25 the story validator now accepts a bounce platform with exactly one valid, nondegenerate `move_path` writer activated either at `start` or by an unconditional timer firing within five seconds. It rejects conditional, unsupported, invalid or conflicting paths; timer/path bounds match the runtime limits. The slowdown-edit validator uses the same active-path definition, while keyboard contact, bounce, and movement gates remain unchanged. The exact sanitized rev28 scene (project `1d946bbc-8164-4ccd-9aec-0c8ee3545b8f`, SHA-256 `c2e7a482…cd005dd7`) was served byte-for-byte with two catalog assets verified and no scene mutation. One loopback Chromium keyboard replay using the checked-in player passed: all three bounce platforms satisfied authoritative bounce-contact and >=0.05 m movement gates, all five crystals were collected, the portal won at score 5, and restart returned to playing with score 0/reset 1. Provider/cloud calls, external requests, page/console errors, and request failures were zero. The original report omitted exact platform frame counts and maximum-displacement values; it now records only the gate-proven booleans and marks those exact metrics unavailable. The replay reporter now serializes those bounded metrics for future runs; no second traversal was made. This is a local replay of saved sanitized content, not provider acceptance. Focused timer/slowdown tests and typecheck pass. Evidence: `docs/evidence/provider-e2e/openrouter-flagship-revision28-timer-platform-replay-20260925/`.

Sep 25 one fresh OpenRouter flagship attempt on source `33b72896a27e4975c97d4f63b8867799bfaeb581` used `openai/gpt-6-luna`, low reasoning, default service tier, local-only key scope, 4,096 output cap, and a three-call maximum. Quota was 38% before the run. The isolated production build and loopback origin/model/cap preflights passed. Exactly one generation request returned HTTP 200 with no retry or fallback; cloud recovery and publication were disabled. Creation reached revision 28, then the harness acceptance validator stopped with `Story creation must contain three moving platforms (0 !== 3)`. The saved project has three ready platform geometry entities with bounce behavior, and three nondegenerate `move_path` actions in one condition-free repeating timer rule (`seconds: 4`); the validator counts bounce platforms as moving only with a condition-free `start` path, so it classified zero. This is a validator classification, not evidence the platforms are absent. No gameplay, edit, undo, export, standalone, or publication phase ran; contacts, pickups, score, win, and reset were not measured. The flagship journey remains incomplete, with no pass claimed. Sanitized report and scene evidence are in `docs/evidence/provider-e2e/openrouter-flagship-live-33b7289-20260925/`; its saved project has two conversation messages removed and the prompt-derived title normalized (original SHA-256 `5f17a3a0…1f993ab9`, sanitized SHA-256 `c2e7a482…cd005dd7`). The retained connection screenshot shows the selected model and empty key placeholder; the failure screenshot is cropped to the scene, and the prompt-bearing screenshots are omitted. No API key or raw provider text is retained.


Sep 25 the fresh gameplay driver now keeps the steering stop radius plus a
0.12 m observation buffer inside the platform footprint, and approaches from
low stable non-route ground until within 2.5 m of the safe landing aim before
jumping; 2.5 m leaves about 0.33 m against the ideal 2.83 m travel for the
observed 0.49 m rise (runtime movement/jump/gravity 4/6/15). The pinned
c245b8e report showed the recovery crossing 0.011 m beyond
platform one's front edge and the first jump starting 3.69 m from its center.
No physics, scene, contact criteria, or platform geometry changed.
All 29 focused gameplay tests and typecheck pass. One loopback-only Chromium
keyboard replay of the exact provider-origin revision29 project passed from
the checked-in player runtime: project ID `860b8fd5-d30b-4021-9c12-62b7ab2539f5`,
source and served project hash `d478be5d…747985`, no mutation, two verified
catalog assets, runtime hash `53d7cc3d…9479eb`. The driver observed contact,
bounce, and motion on all three platforms, collected all five crystals,
contacted the portal, won with score 5, then reset to playing with score 0
(reset counter 1). Provider/cloud calls, external requests, page/console errors,
and request failures were zero. This is a local replay of saved provider-origin
content, not a fresh provider acceptance run. Evidence:
`docs/evidence/provider-e2e/openrouter-flagship-live-c245b8e-driver-replay-20260925/`.

Sep 25 one fresh OpenRouter flagship attempt used exact `openai/gpt-6-luna`
with low reasoning/default tier, 4096 output cap, three-call budget, and a
local-only key. The isolated build and loopback origin/model/cap preflights
passed on source `b73564aa`; quota was 38% before the run. The harness made one
generation request (HTTP 200), with no retry, fallback, publication, or cloud
recovery. Creation reached revision 29, then failed fresh gameplay with
`Fresh gameplay could not recover reachable support moving-platform-1 before
retrying moving-platform-2.` Moving-platform-1 recorded one grounded and one
bounce contact frame; platforms 2 and 3 recorded none. No collectibles were
collected, score stayed 0, and there was no win, loss, or reset. Edit/undo/
export did not run. The read-only OpenRouter model catalog preflight found the
exact model; browser telemetry recorded zero blocked external requests.
Sanitized report, scene-only screenshot, and saved project (chat messages
removed) are in
`docs/evidence/provider-e2e/openrouter-flagship-live-nearside-20260925/`.

Sep 25 the fresh gameplay driver now steers toward the nearest point inside a
0.12 m inset of an unparented built-in platform footprint, recomputing from the
live platform position throughout approach and after jump release. Yaw-only
rotation is handled in local X/Z coordinates; nested, pitched, or unsupported
geometry keeps the existing center aim. Contact counters remain the only
landing evidence. Focused gameplay tests pass (27) and typecheck passes.

One loopback-only keyboard replay used the pinned revision29 scene with its
existing clone-only bounce-1 anchor/path lowering (source hash
`a7b89641…05903b47`, served document hash `ee19cde6…d7e4ed3`) and the checked-in
runtime (`53d7cc3d…9479eb`). The target preflights and both local assets passed.
The driver recorded one grounded and one bounce contact on bounce-1, then
failed on bounce-2: the descending crossing bracket was at player Z=-1.676 to
-1.830 while the platform center was Z=-3 (near footprint edge=-2.175); both
samples were outside and contact counters stayed zero. Bounce-3 and collection
were not reached; no pickups, score, win, or reset occurred. Provider, cloud,
and external requests, browser errors, and request failures were zero. This is
a modified-scene diagnostic, not provider acceptance; no setup failure occurred.
Report and screenshots:
`docs/evidence/provider-e2e/openrouter-flagship-revision29-nearside-landing-replay-20260925/`.

Sep 25 the fresh gameplay driver now prioritizes collectibles at or above the
last live platform anchor height, then sorts by full 3D distance with original
order as the deterministic tie-break. This preserves high pickups while bounce
height is available without relying on target IDs or horizontal world
direction. One loopback keyboard replay of the path-aware rev29 clone was
inconclusive for this ordering: bounce-1 and bounce-2 each recorded one
grounded and one bounce frame, but bounce-3 recorded none, so the driver never
entered collection; the attempted collectible order is empty. The report keeps
the generic `fresh-gameplay-traversal-incomplete` code, with platform counters
localizing the failure to bounce-3. Score remained 0, with no win or reset. No
provider/cloud/external requests or browser errors occurred. This is not
provider acceptance. Evidence and driver source hashes:
`docs/evidence/provider-e2e/openrouter-flagship-revision29-bounce1-anchor-path-collectible-priority-replay-20260925/`.

Sep 25 generation guidance now asks that a moving platform's entity position
match the first world-space `move_path` point, with both updated together when
changing its start. It also asks collect rules to pair objective-variable
increments with positive `add_score` when HUD collection progress or score is
intended; an explicit no-scoring request takes precedence. The pinned revision29
source had bounce-1's anchor and all three path Y values at 0.7; its clone-only
anchor+path diagnostic observed contacts on all three platforms, collected four
crystals, but left score at 0 because collect rules only incremented `crystals`.
No runtime semantics or validators changed. Evidence:
`docs/evidence/provider-e2e/openrouter-flagship-revision29-bounce1-anchor-path-diagnostic-20260925/`.

Sep 25 one loopback-only Chromium keyboard replay of the pinned revision29
scene used `--clearance-path-diagnostic`, a clone-only mutation that changed
`bounce-1.position[1]` and all three Y values in its sole `move_path` from 0.7
to 0.4. The provider-origin source hash remains
`a7b89641…05903b47`; the served clone hash is
`ee19cde6…d7e4ed3`, and the report lists each changed JSON path. Runtime
telemetry observed bounce-1 at Y=0.4. All three platforms recorded one
grounded and one bounce contact frame; the route collected four of five
crystals, score remained 0, and there was no portal win or reset. The bounded
traversal therefore failed; this diagnostic does not establish provider
acceptance. Provider, cloud, and external requests, page/console errors, and
request failures were zero. Report and screenshots:
`docs/evidence/provider-e2e/openrouter-flagship-revision29-bounce1-anchor-path-diagnostic-20260925/`.

Sep 25 one loopback-only bounce-one clearance diagnostic (`--revision29
--clearance-diagnostic`) used the pinned revision29 project
(`a7b89641…05903b47`) and an in-memory clone changing only
`bounce-1.position[1]` from 0.7 to 0.4. The source hash stayed unchanged; the
served `/project.json` hash was `c495bfac…7b036ad`. Chromium loaded revision29
in WebGL and recorded 0.64 m of keyboard movement, but no bounce-one contact
across three attempts; score stayed 0, with no win or reset. The highest player
center was 1.480 m. The unchanged `move_path` starts at `[0,0.7,0]` and all its
Y points are 0.7; runtime telemetry likewise observed the platform at Y=0.7.
Thus the path overrode the anchor-only diagnostic, which did not test the
lowered support plane; route versus driver uncertainty remains. Provider,
cloud, and external requests, page errors, console errors, and request failures
were zero. Report and screenshots:
`docs/evidence/provider-e2e/openrouter-flagship-revision29-bounce1-clearance-diagnostic-20260925/`.
The path-overrides-anchor interpretation was added from captured telemetry and
the saved move_path after the run; the browser was not rerun.

Sep 25 bounded platform-clearance advisory: the server derives one direct
ground-jump estimate to the nearest ready, root-level, unrotated built-in
traversal platform (`bounce` or `move`), excluding static ground/island
support. It compares authored base positions and estimates vertical clearance
only; horizontal motion, steering, and actual contact are not modeled. It
reuses the gameplay contact surface and physics constants; missing or
unsupported transforms and vertical platform motion return a skipped,
inconclusive result. The saved revision29 scene selects `bounce-1`, with an
ideal apex of 1.62 m, landing center 1.64 m, and signed clearance -0.02 m.
This is only a vertical advisory: it neither rejects nor mutates a scene, and
review instructions require checking alternate supports and routes. The same
bounded observation is included in API and hosted review inputs, and generation
guidance asks for a 0.2 m direct-jump margin. For the default ground-center
Y=0.42 and scaleY=1, the safe landing-center limit is 1.42 m and the platform
anchor limit is y<=0.48 m. The player source snapshot and runtime bundle were
regenerated with `scripts/build-player.mjs`; a second run produced identical
hashes with esbuild 0.28.2 (`runtime.js` 53d7cc3d…, `source.json`
863e3ae4…). The previous source snapshot contained a different
`src/lib/gameplay.ts`; the broad runtime diff is reproducible minifier
identifier renumbering after that source change, not toolchain drift.
Simulation thresholds remain unchanged. Five focused suites pass (90 tests)
and typecheck passes. No provider/model call ran.

Sep 25 OpenRouter GPT-6 Luna flagship live attempt on clean source
`13921945204565298c9385ed748776a15c8f8144`: origin, exact-model, and 4,096
cap preflights passed; reasoning was low, tier default, key scope local-only,
generation budget three, and cloud/publication disabled. Exactly one generation
request returned HTTP 200 and completed normally. Creation passed at revision
29 with 13 ready entities (five collectibles, three bounce platforms, one
portal, four static objects), eight game rules, and three movement paths. The
immediate creation-gameplay gate then failed on bounce-three after 62
observations: score, contacts, and collections remained zero; no win or reset
occurred. No edit, undo, export, standalone, cloud, or publication phase ran;
there was no retry or fallback. The sanitized report, project, and screenshots
are in `docs/evidence/provider-e2e/openrouter-flagship-gpt6-luna-live-20260925-recheck/`.
The saved project has chat messages stripped while keeping its scene, game,
entities, and revision; its SHA-256 is
`a7b8964167a6df97e1154124be5eb4f02a5ce8669ed6a0d048a8ae7405903b47`.

The saved project's player spawn is `[0,0,5]`. Bounce-platform centers/scales
are bounce-one `[0,0.7,0]` / `[1.5,1,1.5]`, bounce-two `[0,1.5,-3]` /
`[1.5,1,1.5]`, and bounce-three `[0,2.3,-6]` / `[1.5,1,1.5]`; their paths
keep Y/Z fixed and use X waypoints `[0,1,0]`, `[0,-1,0]`, and `[0,1,0]`.
`storyPlatforms()` sorts by X then Z ascending,
so this equal-X layout made the harness try bounce-three first, then bounce-two,
then bounce-one, despite the spawn being nearest bounce-one. Telemetry records
three bounce-three attempts, all with zero grounded/bounce contacts; their apex
Y values were 1.428, 1.428, and 1.476 while the platform center was Y=2.3.
From the spawn Z=5, the platforms are respectively 5 m, 8 m, and 11 m away on
the horizontal Z axis.
The surface-crossing pair is null, so no exact crossing position is claimed.
That run exposed a driver target-order mismatch; bounce-one/two traversal and a
full create/edit journey were untested. It did not establish a physics cause.

Sep 25 offline route-order repair: `storyPlatforms()` now walks from the saved
game spawn to the nearest remaining platform, then repeats from each selected
platform; exact distance ties use stable entity IDs. It has no world-axis
assumption. A focused regression over the saved revision29 project, an edited
and undo snapshot, and a rotated scene with reversed platform IDs confirms the
same middle-platform identity (`bounce-2` in the original scene). Syntax,
focused test, typecheck, and diff checks pass.

One loopback-only keyboard replay used that exact revision29 project
(`a7b89641…05903b47`) and the checked-in player runtime (`d70d5d1f…df967619`);
the production validator selected bounce-1, bounce-2, bounce-3. The local
project/runtime/asset preflights passed; browser readiness matched project and
revision, with no external requests, page errors, console errors, request
failures, provider calls, or cloud calls. Traversal still failed on bounce-1
after three jump attempts and 62 observations, with no platform/bounce contact,
collection, score, win, or reset. The third apex was `(0.709, 1.476, 0.007)`;
the moving platform was `(0.485, 0.700, 0)`. The player was inside the estimated
X/Z footprint, but its center stayed 0.164 m below the estimated platform-top
center height (1.640 m); contact counters remained zero and no surface crossing
was recorded. This supports a vertical-clearance shortfall in this bounded
traversal, not proof that every approach is unreachable. Bounce-2/3 and all
objectives remain untested. The initial local asset-count preflight failure
(revision29 has two references, not the revision31 fixture's three) is kept
separately from gameplay in `pre-browser-setup-failure.json`. Report,
diagnostic, and screenshots:
`docs/evidence/provider-e2e/openrouter-flagship-revision29-route-replay-20260925/`.
The source physics constants provide a tighter bound: `src/lib/gameplay.ts`
sets ground center 0.42, jump speed 6, gravity 15, and player half-height 0.42.
The ideal rise is 1.20 m, so the ideal center apex is 1.62 m; the procedural
platform top rule puts bounce-1's landing center at 0.7 + 0.52 + 0.42 = 1.64 m.
That makes a direct ground jump 0.02 m short even at the ideal apex. This is a
source-grounded reachability inference, not contact evidence; the actual replay
apex was 1.476 m with contact counters still zero.

Sep 25 stream-budget prevention: generation prompts now explicitly reserve the
final model-authored command for `commit_revision` and prioritize a minimal
complete scene over optional decoration when output space is tight. Server
semantics remain unchanged: clean EOF after a normal `stop` without the model's
commit still fails as `clean-eof-without-commit`; no commit is synthesized and
no retry is started. Focused tests assert both the prompt instruction and the
structured clean-stop failure. This is prospective prevention only; no live
model call ran, and it does not establish that the earlier provider stream
would have followed the instruction. See the sanitized one-call failure at
`docs/evidence/provider-e2e/openrouter-flagship-gpt6-luna-live-20260925/`.

Sep 25 fresh OpenRouter GPT-6 Luna flagship attempt on source commit
`cb0e3d44ea9f40038b4820bac5d6031f7138f36d`: the isolated loopback server,
matching-origin probe, 4,096-token cap, and exact `openai/gpt-6-luna` catalog
preflight passed. The standard-tier harness was bounded to three calls but
stopped on its first creation request: HTTP 200 returned
`INVALID_SCENE_PROTOCOL` (operation 30, finish reason `stop`), the seed was
observed, and zero operations were committed. The UI reported that the model
stopped before finishing the scene update. No retry or fallback occurred, and
gameplay, edits, undo, export, standalone playback, cloud recovery, and
publication did not run. No project artifact was created. Sanitized report and
three credential-free screenshots:
`docs/evidence/provider-e2e/openrouter-flagship-gpt6-luna-live-20260925/`.
The initial Turbopack symlink-root startup failure happened before preflights
and consumed no provider/model call; it is separately recorded as
`setup-failure.json`, not gameplay evidence.

Sep 25 portal-arrival replay: the fresh gameplay driver now treats portal
proximity as a settle point and continues steering toward its center until the
existing authoritative predicate sees portal contact, a win, and every expected
score ID; the 240-step bound and collectible behavior are unchanged. A focused
predicate test rejects near/no-contact and accepts contact with the full score;
syntax, that test, and typecheck pass. One loopback standalone replay of the
same saved revision 31 and checked-in runtime passed: it recorded portal contact,
all five crystals (score 5), `won`, then Restart returned to `playing` at score 0
with reset 1. Provider/cloud/external requests, page errors, console errors, and
request failures were zero. Evidence and screenshots:
`docs/evidence/provider-e2e/openrouter-flagship-portal-arrival-20260925/`.

Sep 25 looped-path replay: `move_path` with `loop:true` now spends the same
duration across each listed segment plus a virtual last-to-first segment when
the path is open; explicitly closed and non-looping paths keep their prior
timing. Focused game-program/runtime integration tests (19) and typecheck pass,
and the checked-in player bundle/source were rebuilt. One exact loopback replay
of saved project revision 31 (project SHA `b6bfb722…1e09`) used player runtime
SHA `d70d5d1f…7619`, with zero provider/cloud/external requests or page, console,
and request errors. Authoritative platform and bounce counters each incremented
on bounce-one, bounce-two, and bounce-three. At bounce-three contact (8,131 ms),
player center was `(-0.533, 2.100, -3.561)` and platform center
`(-0.580, 1.550, -3.600)`; counters changed 0→1. The estimated crossing-pair
field was null because the contact sample landed exactly at the estimated top
plane. All five crystals were collected (score 5); the run remained `playing`,
with no portal win or reset, so the traversal report remains failed and makes
no full-game pass claim. Evidence and screenshots:
`docs/evidence/provider-e2e/openrouter-flagship-loop-closure-20260925/`.

Sep 25 surface-crossing replay: one bounded keyboard traversal of saved project
revision 31 now recorded a compact pair bracketing bounce-three's estimated
top plane (y=2.10). At 8,222 ms the player was `(0.661, 2.206, -3.576)` and
the platform `(-0.592, 1.550, -3.600)`; at 8,266 ms the player was
`(0.507, 1.982, -3.621)` and the platform `(-0.580, 1.550, -3.600)`. Both
frames were outside the estimated X footprint (half-width 0.6325) but inside
its Z footprint; platform and bounce contact counters stayed 0 across the
pair. This brackets the crossing but does not claim an exact interpolated
contact position or authoritative collision; the run remains failed with only
crystal-five collected. No external/provider/cloud requests or page/console/
request errors occurred. Sanitized pair and screenshots:
`docs/evidence/provider-e2e/openrouter-flagship-surface-crossing-20260925/`.

Sep 25 expanded-sample replay: fresh loopback traversal of the same saved
revision-31 OpenRouter project, with per-attempt jump telemetry now retaining
the first four plus latest eight frames (12 maximum). WebGL loaded and all
local runtime/project/model requests returned 200; provider/cloud/external
requests and page/console/request errors were zero. Bounce-three still had no
contact or bounce. Its apex was `(0.591, 3.110, -2.640)` at 8,170 ms. The first
retained descending sample was at 9,491 ms: player `(-0.366, 1.485, -3.615)`,
platform `(-0.370, 1.550, -3.600)`. The estimated player-center landing plane is
y=2.10, so this frame was already 0.615 below it; the exact crossing position
falls in the gap between retained frames. Score remained 1 (crystal-five), with
no portal win or reset; the report stays failed and does not establish whether
the route or driver caused the miss. Evidence:
`docs/evidence/provider-e2e/openrouter-flagship-current-runtime-samples-20260925/`.

Sep 25 exact saved OpenRouter creation replay: pinned revision 31
(`b6bfb722…1e09`) against checked-in player runtime (`runtime.js`
`4767933f…1179`) in a loopback-only static page. The first setup response
incorrectly served `/` as a download; that failure and blank screenshot are
preserved separately and are not gameplay evidence. After `/` and `/runtime.js`
content-type preflights passed, one real keyboard traversal loaded the exact
project in WebGL with no external/provider/cloud requests, page errors, or
missing assets. The player moved 0.64 m, collected crystal-five (score 1), and
recorded contact/bounce on bounce-one and bounce-two. Bounce-three moved 0.98 m
but recorded no grounded/bounce frames or contact; no portal win or reset was
observed. The run remains failed and leaves authored-route versus driver
uncertainty unresolved. Sanitized telemetry and screenshots:
`docs/evidence/provider-e2e/openrouter-flagship-current-runtime-replay-20260925/`.

Sep 25 fresh OpenRouter GPT-6 Luna flagship browser attempt: source commit
`47ea2e68e3da565504838eb6526df8ded915d6fc` was served from an isolated
loopback Next dev server at `127.0.0.1:3057` with the 4,096-token cap and
publishing/accounts disabled. The exact-model, origin and cap preflights passed.
One provider request completed with HTTP 200 and committed the island creation
(31 operations); no retry or fallback occurred. Fresh gameplay registered
movement during generation, but the bounded run could not contact moving
platform `bounce-three`. It stopped before the mushroom and seven-crystal edits,
undo, export or standalone playback. Publication/cloud were not requested. The
optimized build compiled but stopped at existing TypeScript errors in
`tests/android-adb-reverse.test.ts`; the live attempt used the current-source
dev server. Sanitized mode-0600 evidence is in
`docs/evidence/provider-e2e/openrouter-flagship-current-20260925/`.

Sep 25 failure-reporting repair: fresh creation, goal-7 and undo traversal
exceptions now mark both the gameplay phase and flagship story failed, retaining
bounded allowlisted evidence bound to the attempted project revision, including
the last three sanitized platform-jump attempts. Initial capture kept at most
eight samples each; it now keeps the first four plus latest eight (12 maximum).
The top-level sanitized error remains intact. A deterministic focused test
covers failure status, revision binding, nested evidence bounds and omission of
provider text; the historical OpenRouter report above remains unchanged. No
model call ran.

Sep 25 OpenRouter Android publication check: the exact URL pinned by
`docs/evidence/provider-artifact-publication-openrouter-current-20260925/report.json`
passed one signed-out Android 15/API 35 midrange AVD Chrome touch run in
automatic renderer mode. WebGL2 was available and reported SwiftShader; the
active visible game view used its successful 2D context and `.software-world`
path, selected automatically without blocking WebGL. Right scored 7, Restart
reset, Forward won, and Left lost after Restart. Screenshots visibly show the
scene and both end states. The request log has zero generation/external
requests; provider calls, cookies, page errors, and console errors were zero.
No login, terms, or Chrome privacy choice was accepted. This is emulator
evidence, not physical-device certification. See
`docs/evidence/android-openrouter-publication/current-runtime-20260925/`.

Sep 25 OpenRouter-origin current-runtime publication: one live isolated
publication of the retained `openai/gpt-5.6-luna` input-game ZIP passed. The
production save/readback, two generated-model uploads, Vercel deployment,
public project/model/runtime hash checks, and signed-out desktop keyboard plus
portrait/landscape touch-emulated score, win, loss, and Restart checks passed
with zero provider, external, or page-error requests. Screenshots were visually
reviewed; this simple input-game fixture is functional evidence, not the
flagship visual-quality bar. The source ZIP is older provider-origin data, so
this does not prove fresh GPT-6 OpenRouter generation or physical Android play.
Evidence: `docs/evidence/provider-artifact-publication-openrouter-current-20260925/`.

Sep 25 provider artifact publication handoff: `verify-provider-artifact-publication.mjs`
now selects either the pinned Gateway or OpenRouter input-game ZIP through
`ORBSIE_PUBLICATION_SOURCE` (Gateway default). ZIP, project JSON, and canonical
project/model digests are pinned per source; source identity is carried through
reports and private credential metadata. The OpenRouter source preserves the
same two entities and three input rules, with only its schema-valid omitted
optional rotations and mushroom tint allowed. Offline preflights and five
focused checks pass for both presets, tampered ZIPs, wrong-source selection,
and the legacy Gateway API. The retained OpenRouter ZIP came from
`openai/gpt-5.6-luna`; it is provider-origin evidence, not a fresh GPT-6
create/edit or complete provider E2E. No live publication, account creation,
or model call was run; current-runtime publication remains for Astra.

Sep 25 standalone flagship gameplay handoff: the provider harness now binds
standalone traversal to the exported project's exact ID and undo revision and
records input, contacts/collections, portal win, runtime hash and UI reset in
`report.standaloneGameplay`. The deterministic current-runtime ZIP fixture keeps
the revision-41 project/assets from the older Gateway archive but replaces its
runtime and worker bundles with checked-in `public/player` assets; the source ZIP
is unchanged and is not treated as current. Real keyboard movement/jump reached
the page with zero external/editor/provider requests, but the bounded route could
not contact `platform-1`; the report remains failed/incomplete, with no claimed
collection, win or restart. Evidence:
`docs/evidence/provider-e2e/standalone-current-runtime-gameplay-fixture/`.
The fixture does not establish fresh live-provider publication gameplay.

Sep 25 Android published-player touch follow-up: the same immutable OpenRouter
Vercel URL loaded directly in Chrome 124 on the Android 15/API 35 midrange AVD.
The score and controls appeared, but the game canvas stayed visually blank
through a right hold and Jump tap; Score remained 0. Restart produced no visible
change, so its reset effect is unverified. No in-game compatibility switch was
visible. Combined touch, score increase and portal win/loss were not verified.
The emulator log reported its host OpenGL backend as SwiftShader/software after
a GPU warning; the published page's canvas context type was not established, so
the blank canvas is not attributed to an Orbsie renderer path.
The same URL showed a visible scene in the earlier ADB smoke, so this blank
capture is not a deterministic product failure. `b34dad2` was the checkout at
the earlier test, not verified provenance of the immutable published artifact.
This was not a fresh current-runtime publication. No login, consent, terms
acceptance or model call occurred. See
`docs/evidence/android-published-touch-20260925/`.

Sep 25 fresh Android distance diagnosis: a 120-entity readiness-only run passed
at 100 m, while two 120-entity runs at 5000 m lost the page before
`fixture.ready()`. Diagnostic 1-entity runs varied by boot: at 5000 m the page
reached `fixture.ready()` before closing during its first state sample; at 100 m
navigation aborted before DOMContentLoaded. ActivityManager and retained process
exit records identify Chrome sandbox child exits, including one marked
`ISOLATED NOT NEEDED`; none proves that a child exit caused the page closure or
that OOM occurred. The different failure stages across distances make a
distance-only root cause unproven. No travel cycle or frame/heap acceptance was
obtained, and normal 120/160 acceptance is unchanged. See
`docs/evidence/android-growing-world-runtime/diagnostic-distance-comparison-20260925.md`
and the linked per-run reports.
Gateway credits read-only GET still returned HTTP 200 and balance
`-0.00456495`; no paid Gateway inference ran. Computer use currently reports
zero browser surfaces, so signed-in ChatGPT acceptance remains unavailable.

Sep 25 Android browser recovery: Chrome 124 on the existing Android 15
midrange emulator loaded the signed-out published OpenRouter Orb after a second
URL intent; the first showed Chrome Enhanced ad privacy onboarding, with no
consent choice selected. ADB screenshots show the playable portrait screen,
right-control movement, Restart returning the player to start, and controls
visible in landscape. Score, win/loss, jump, simultaneous touch, renderer and
performance were not checked. Evidence:
`docs/evidence/android-adb-openrouter-public-20260925/`.

After the initial existing-AVD static-control run hit an occupied ADB reverse
port, `7bb8407` added bounded collision-only retries (3 focused tests passed;
Astra reviewed the diff). On the same existing emulator, the next static HTML
control run passed CDP, HTTP 200, DOMContentLoaded, screenshot and cleanup.
A subsequent 40-entity/100 m SoftwareWorld readiness diagnostic also passed
with zero WebGL context attempts. This changes the prior fresh-AVD failure
interpretation: the browser can load the fixture in a warmed session, but the
cause of the fresh-session child deaths remains unknown. Neither run establishes
120/160-entity traversal, frame-time or memory acceptance. Evidence:
`docs/evidence/android-growing-world-runtime/static-control-2026-09-25T06-01-57-966Z/`,
`docs/evidence/android-growing-world-runtime/static-control-2026-09-25T06-09-40-851Z/`,
`docs/evidence/android-growing-world-runtime/40-entity-distance-100-readiness-2026-09-25T06-11-08-575Z/`.

Sep 25 Android 16 alternate-emulator control attempt: the existing static
control harness was run once on `droidlm_api36_latest` (Android 16, Chrome 133,
emulator memory capped at 3 GiB). The owned AVD booted, but Chrome's DevTools
`/json/version` endpoint did not become ready within 30 seconds. CDP attachment,
page creation and navigation never occurred; filtered logcat had zero Chrome
failure lines, and Chrome main/sandbox processes remained present. The worker's
earlier control-failure template incorrectly claimed endpoint readiness; Astra
corrected that conditional for future runs and retained the original wording
in the report's `reviewCorrection` field. This alternate emulator also yields
no application or growing-world acceptance. Node syntax, Prettier, JSON and
diff checks passed; owned ADB mappings/emulator were removed. Evidence:
`docs/evidence/android-growing-world-runtime/static-control-2026-09-25T05-52-01-470Z/`.

Sep 25 Android static-control diagnostic: source/evidence `9ea2ac5` adds a
separate no-bundle, no-renderer static HTML mode to the same owned AVD/ADB/CDP
harness. One fresh Android 15/Chrome 124 run reached Chrome's `/json/version`
endpoint, but Playwright `connectOverCDP` timed out after the WebSocket
connected. No page object or navigation was created (zero control attempts).
Filtered logcat had zero Chrome failure lines and main/sandbox processes were
still listed; the cause of CDP attachment timeout is unknown. This run cannot
establish whether plain HTML navigation works, and does not prove an app
regression or explain earlier fixture child deaths. Astra reviewed the diff and
report; syntax/format/diff/JSON checks passed, no retry occurred, and owned
emulator/ADB resources were removed. Evidence:
`docs/evidence/android-growing-world-runtime/static-control-2026-09-25T05-43-30-085Z/`.

Sep 25 Android growing-world low-count diagnosis: `aa00c71` adds a
diagnostic-only 1..119 entity count to the Android SoftwareWorld harness;
normal 120/160 acceptance fixtures are unchanged. Fresh owned Android 15 /
Chrome 124 runs at 100 m both lost the page before scene readiness. The
one-entity run aborted navigation before DOMContentLoaded and its filtered
logcat showed two sandboxed Chrome child deaths. The 40-entity run loaded the
page and unchanged 4,395,147-byte bundle, then lost the page during readiness;
filtered logcat showed one sandboxed child death. Chrome's main process
remained. This weakens an entity-count-only explanation but does not identify
the crash cause or prove OOM. No travel, frame, heap or readiness acceptance
was obtained. Astra reviewed the diff and reports; syntax/format/diff and
report-consistency checks passed. Owned emulator/ADB mappings were removed;
`adb devices -l` is empty. Evidence:
`docs/evidence/android-growing-world-runtime/diagnostic-count-comparison-20260925.md`
and its two linked reports.

Sep 24 ChatGPT connection feasibility recheck: official OpenAI documentation
now describes Sign in with ChatGPT for participating partners, but the identity
flow shares only name/email/profile picture; additional access requires separate
permission. It does not document Orbsie partner registration or subscription
inference entitlement. Codex workload identity federation is beta for managed
ChatGPT workspaces, not a consumer browser OAuth callback. The browser-only
OAuth/subscription requirement remains open; no login or inference was attempted.
See `docs/ai-connection-priority.md` for source links. The current computer-use
inventory exposes no browser tabs, and read-only Gateway credit remains
negative (`-0.00456495`), so those live acceptance runs did not start.

Sep 25 WebGL navigation fixture closure: source/evidence `fcb1f84` uses a
stationary platform at the same 12 km saved group/entity position for a
focused production WebGL SwiftShader run. The original animated crystal
made pixel-centroid overlay checks invalid: WebGL bobs and spins crystals in
edit mode. Astra checked the static screenshot, calibrated its mint/ground
pixel signature offline, and reviewed the final report. Zoom buttons
(600→480→600%), pan (70 px marker movement), wheel (600→453%), heading
reset (28°→0° with zoom retained), and both chat/control overlay drags (0 px
shift) passed. The selected entity ID and group/entity positions remained
exact; there were zero provider calls, page/console errors, external origins
or unexpected API paths. The direct `north_reset` state test passed 20/20 in
its focused suite, establishing target/distance preservation; browser
screenshots alone do not directly expose world target. Earlier partial runs
are retained as diagnostic evidence. This closes the desktop WebGL fixture
navigation checks, not native-GPU, physical multi-touch or full unbounded
world acceptance. Evidence: `docs/evidence/world-navigation-browser/`.

Sep 25 mobile navigation overlay release: source `9dafeea` confines the
compatibility advisory and saved-state toast to a left column in portrait and
places the short-landscape navigation controls in a left rail with notices
above the chat sheet. A deterministic no-model-call production-build fixture
passed non-overlap, viewport bounds, dismissibility, saved entity/selection and
zero unexpected request/error checks at 390×844, 390×640 and 844×390. Vercel
deployment `dpl_4kJ822fSm7AbChCFg3BhZ1tx7BnQ` is Ready and aliased to
`https://orbsie.com/`; the same three checks passed against the served site
after release. Evidence: `docs/evidence/mobile-navigation-overlays/`. This is
Chromium touch emulation on the Canvas2D path, not physical mobile or native
GPU certification. The published player was outside the CSS selectors.

Sep 25 production navigation fixture: source/evidence `03929eb` exercises a
12 km grouped marker through deterministic intercepted generation with zero
provider calls. Desktop Canvas2D passed zoom buttons, mouse pan/wheel, compass
north reset preserving zoom/location, overlay isolation, and stable saved
selection/position. Mobile-sized Canvas2D passed touch drag, CDP pinch,
overlay isolation and saved-state checks. WebGL SwiftShader passed zoom
buttons, pan and wheel; its marker signature fell below the harness's
100-pixel post-wheel threshold, so later WebGL compass/overlay assertions
were not reached. Astra inspected the retained screenshots and found mobile
advisory/toast overlap with navigation; the later release above corrects it.
Evidence: `docs/evidence/world-navigation-browser/`. This is partial browser
acceptance, not physical multi-touch, provider or full unbounded-world
validation.

Sep 25 Android growing-world diagnostic: source/evidence `aa2530c` adds a
reproducible Android 15/API 35 midrange-emulator Chrome 124 SoftwareWorld
fixture harness with owned ADB/CDP/emulator cleanup, touch-travel and
frame/heap collection when the page reaches readiness. Four bounded attempts
all failed before scene readiness: 160 entities at 5,000 m, 120 at 5,000 m,
120 at 100 m, and 120 at 100 m with CDP Performance enabled only after
readiness. The instrumented 120-entity baselines loaded the 4.39 MB fixture
before Chrome closed the tab; the last attempt closed during navigation. One
filtered ActivityManager log
confirms a Chrome sandboxed child process died while Chrome's main process
remained. It does not establish why it died or prove OOM. No travel cycles,
screenshots, frame percentiles or heap samples were collected, so Android
growing-world acceptance remains open. All attempts used zero model calls and
external requests; syntax, Prettier and diff checks pass; owned ADB mappings
and emulator were removed. Evidence:
`docs/evidence/android-growing-world-runtime/`. This is separate from prior
passing Android published-game checks and does not establish an app-wide
mobile regression.

Sep 25 growing-world browser measurement: source/evidence `08a7b10` adds an
opt-in 160-entity stress fixture and a repeatable six-cycle home-to-outer
travel/reentry probe. All cycles held 48 full formations and 112 proxies,
kept the selected distant entity resident, and returned with no active
formation replay. Settled WebGL counts were 184 geometries, 5 textures and 7
programs at home in every cycle (180/5/7 at the outer cluster). Chromium 153
on SwiftShader measured 708 animation intervals: p50 16.7 ms, p95 50 ms, p99
66.6 ms. CDP heap samples are retained but fluctuate with garbage collection;
they do not establish a stable memory ceiling. The direct SoftwareWorld path
was ready at both locations. Astra reviewed the report and screenshots and
confirmed the synthetic objects are tiny colored primitives, so this is
resource-bounded traversal evidence, not representative high-detail modeling,
native-GPU/physical-mobile performance, or full growing-world acceptance.
There were zero model calls, external requests and page/console errors. Node
syntax, Prettier and diff checks passed. Evidence is in
`docs/evidence/growing-world-runtime/`.

Sep 25 browser procedural isolation: source `b0d5d48` adds a production-editor
fixture with four intercepted `/api/generate` responses and no model calls.
It created a valid QuickJS/Manifold object, seeded a random synthetic canary in
ephemeral same-origin storage, then ran hostile source that probed host APIs,
storage and network. The source reached the worker, made zero external
HTTP/WebSocket requests and changed neither the saved entity nor revision.
An infinite loop produced a fresh bounded failure in 2,638 ms and its worker
was terminated before a valid targeted recovery edit. Source, geometry and
stable entity ID survived reload without re-evaluating procedural code.
The reviewer caught and corrected an earlier stale-toast false positive; only
the final passing report is retained in
`docs/evidence/browser-procedural-isolation/`. Node syntax, Prettier and diff
checks pass. Existing worker and editor evidence covers byte/memory/mesh limits,
cancellation and geometry rejection. This closes the current browser modeling
isolation contract gate, not a full security audit, live-provider run or
physical-device test. The prior local Next server had stale chunk references;
production served the fixture instead. Gateway credit still reads
`-0.00456495`, so no Gateway inference was started, and computer-use browser
inventory remains empty.

Sep 25 desktop standalone compatibility notice: source `c369062` positions
the dismissible Canvas2D advisory 48 px above the viewport bottom, retaining
the portrait/landscape touch overrides and fatal renderer guidance. A local
standalone retest of the saved 12 km export showed the object unobscured and a
9 px measured gap above the footer at 1280×900. The optimized build passed;
production deployment `https://orbsie-28si08bmh-grappeggias-projects.vercel.app`
is Ready and aliased to `https://orbsie.com/`, whose served player CSS SHA-256
matches local `b937627d2f7032caa4d33f93e71274a69e75c6aa11859c2d1f0f3bd6eccccc8e`.
No model calls ran. Evidence:
`docs/evidence/standalone-graphics-advisory-20260925/`. This is not a fresh
publication or physical-device acceptance run.

Sep 25 production far-world fixture acceptance: the current `https://orbsie.com/`
editor accepted deterministic intercepted commands to create a group and
marker at X=12,000 m, then a selected geometry edit preserving ID and world
position. WebGL/SwiftShader and forced Canvas2D both passed initial automatic
framing, zoom-away/manual Frame, editor Play visibility, local reload, exact
ZIP project persistence, and independent standalone playback with distant
content visible. No provider or external requests, page errors or unexpected
API requests occurred. Astra reviewed the report and renderer screenshots;
the desktop standalone Canvas2D compatibility notice touches/overlaps the
small distant platform. Evidence:
`docs/evidence/far-world-browser/production-current-20260925/`. This is a
fixture with intercepted generation, not live provider authoring, sustained
long-distance traversal, physical mobile, or growing-world performance.

Sep 25 provider SSE EOF resilience: source `0af88e2` processes a complete
trailing provider `data:` line when the stream closes without a final newline.
A valid structured finish marker can now release its deferred commit. Regression
tests prove that malformed trailing JSON and a provider reader error still
withhold the commit and show failure; the generation/envelope suites pass 34/34,
and the optimized build passes. Deployed Ready at
`https://orbsie-9bvf04hwi-grappeggias-projects.vercel.app`, aliased to
`https://orbsie.com/`; read-only root/config/GET-generate smoke passed and
served standalone player JS still matches the committed hash. No model call ran.
This addresses one deterministic clean-EOF case, not the full recurring
interruption issue or live-provider interruption acceptance. Gateway credit
remained `-0.00456495` on a read-only check at 02:27 UTC.

Sep 25 portrait play framing release: source `a6295cf` makes the temporary
play-camera minimum scale with viewport aspect in both WebGL and Canvas2D,
including WebGL residency selection, while preserving authored navigation.
The compatibility graphics notice moves above touch controls instead of
covering the scene. The optimized build, 41 focused navigation/software tests,
and local portrait/landscape touch fixture passed. Production deployment
`https://orbsie-nglpuf7ix-grappeggias-projects.vercel.app` was aliased to
`https://orbsie.com/`; served player JS/CSS exactly match local hashes
`4767933f3f96337cfd7cdb0673918ce0fbc653b2ed64cfe79742e8765d5f1179`
and `2753ee819e34f3b5a51bd1a12f2f9086ea54f82d9cb407bae09152b62bef238c`.
An initial fresh publication reached Ready but correctly failed the runtime
byte check because production still served the prior version. After the
release, a second fresh no-model-call publication passed exact runtime,
snapshot and generated-model hashes plus signed-out desktop/portrait/landscape
gameplay at
`https://orb-1ac45d0e2e7da2db7f45-ms8v1d285-grappeggias-projects.vercel.app`.
The same public deployment passed Android 15 emulator Chrome touch score 7,
restart, win and loss with forced Canvas2D, zero cookies, generation/external
requests or page errors. Astra inspected ready and scored screenshots: the
tree and mushroom are fully in frame and the notice no longer covers them.
Evidence: `docs/evidence/player-touch-layout/portrait-framing-20260925/`,
`docs/evidence/provider-artifact-publication-framing-20260925/` (failed
version gate),
`docs/evidence/provider-artifact-publication-framing-corrected-20260925/`,
and `docs/evidence/android-gateway-publication/portrait-framing-20260925/`.
This does not establish model-authored visual delight or physical-device
performance. No live model call ran.

Sep 25 exact-publication Android acceptance: `scripts/verify-android-gateway-publication.mjs`
loaded the immutable Gateway-authored deployment below on an Android 15
midrange-profile emulator (Chrome 124, 412×786 CSS viewport), forced Canvas2D
compatibility rendering, and passed real touch score 7, restart, win and loss.
It observed zero cookies, provider/generation/external requests or page errors;
one WebGL initialization error was expected from the forced fallback. Astra
reviewed the report and screenshots in
`docs/evidence/android-gateway-publication/current-runtime-20260925/`.
Portrait framing clips the left tree, and the compatibility notice obscures
part of the scene. Functional emulator acceptance passed; visual mobile polish
and physical-device acceptance remain open.

Sep 25 current-runtime production publication: a no-model-call run of
`scripts/verify-provider-artifact-publication.mjs` copied the saved
Gateway-authored revision-9 world into a new isolated account/project,
uploaded its two exact generated GLBs, and published a new per-Orb Vercel
deployment `dpl_H96YU3pFSRdVLxJRhHz7u7eNysr6` at
`https://orb-847864082049ad60fd35-b4hptmcr5-grappeggias-projects.vercel.app`.
The saved/public project snapshots and generated-manifest hashes match; served
player JS/CSS match current local SHA-256
`25cc0d9d1d704b731e525968100544d2008d00e51192e0b82eb52b27af87e8bb`
and `76bb712dc7a4e36f80b1668357b07ecc2a379c31d1444b6c5445e839bb6c1026`.
Signed-out desktop keyboard, portrait touch and landscape touch passed score
7, restart, win and loss with zero cookies, generation requests, external
requests or page errors. Astra reviewed report and mobile screenshots.
Evidence: `docs/evidence/provider-artifact-publication-current-20260925/`.
This closes current-runtime baked-publication acceptance for an existing
Gateway-authored artifact, not new Gateway inference or physical mobile.

Sep 25 current OpenRouter input-game acceptance: the first bounded local
browser run returned HTTP 403 before reaching OpenRouter because the browser
origin differed from `BETTER_AUTH_URL`. Astra traced this to `checkOrigin`;
the valid key and Luna catalog entry were independently confirmed by read-only
provider endpoints. Source `scripts/provider-browser-e2e.mjs` now sends an
invalid-body, no-model-call origin preflight and requires HTTP 400 before
connecting a public API-key/free provider. A corrected local run with exact
server/browser/auth origins passed one Luna creation and one Luna edit at the
4,096-token cap, both HTTP 200, with no retry or fallback. It created two
refined generated objects and a three-rule input game; selection, targeted
material edit, game rules, local reload, ZIP export and signed-out standalone
keyboard gameplay passed. Astra visually reviewed the retained image: the
tree and mushroom are simple shapes, so this is functional, not delightful
model-quality acceptance. No cloud save or publication was requested. Sanitized
evidence: `docs/evidence/provider-e2e/openrouter-current-20260925/` and
`docs/evidence/provider-e2e/openrouter-origin-corrected-20260925/`. The two
focused harness suites pass 12/12, Node syntax and diff checks pass. Gateway
credit remains negative and ChatGPT owner authorization is not connected.

Sep 25 owner-visible ChatGPT challenge: after the owner permitted displaying
the URL and code, production created a fresh isolated guest session and issued
one official OpenAI device challenge. Its URL and one-time code were shown in
chat; read-only status stayed pending/disconnected until expiry, then
idle/disconnected. Cancellation returned HTTP 200 and the private mode-0600
local test-session file was removed. No ChatGPT inference ran. Browser control
inventory remained empty. A fresh challenge is needed when the owner is ready
to complete it within the ten-minute window.

Sep 25 production release: source/evidence through `114e13c` deployed Ready
as `dpl_H73dfGFRGszuuy9LFMVdymEvU4vc`, aliased to `https://orbsie.com/`
(immutable `https://orbsie-gkg6k3qvn-grappeggias-projects.vercel.app`).
Read-only root, robots, sitemap and config returned HTTP 200; both review-start
GET routes returned expected 405. Config reports `authoringReview:false`,
`chatgptHosted:true`, `chatgptGeneration:true`, accounts and publishing true.
Deployed player runtime and source exactly match committed bytes (SHA-256
`25cc0d9d1d704b731e525968100544d2008d00e51192e0b82eb52b27af87e8bb`
and `db1e21001e710a7241fa67748d12d9eb36293211f6e5c01b0cdf3ca83ff900d1`).
The release carries disabled review-recovery code; it is not live-provider or
production-enabled review acceptance.

Sep 25 signed-in review reload recovery: source `de4dece` restores and
validates the authoritative cloud snapshot before a paid review-only start;
source `457a2ba` also permits an existing local-only draft to create its first
cloud row and an exact remote snapshot to resume without an unnecessary
journal lookup. The refreshed player artifacts are in `87f04ba`. Astra
reviewed both corrections. The optimized build and deterministic browser
review matrix passed, including guest reload/reopen/resume, signed-in reload
and correction journaling, stale-cloud rejection before another model request,
WebGL/Canvas2D, mobile bounds and Play preservation. A separate focused run
passed local-only draft and exact-snapshot resume. Evidence:
`docs/evidence/authoring-review/review-reload-cloud-integration-20260925/`
and `docs/evidence/authoring-review/review-signed-in-baseline-regressions-20260925/`.
The fixture made zero live model calls. Production review remains disabled;
live provider and owner-session acceptance remain open.

Sep 25 interrupted-review reload recovery: source `00160c7` persists a
versioned, key-free continuation record bound to the exact saved local scene
and the ledger's 15-minute window. A guest browser fixture passed failed
review → reload → reopen saved world → explicit review-only resume. Focused
store tests, TypeScript and an optimized build passed. Astra review found that
an originally selected object can legitimately be removed by generation;
source `2d5aabd` retains its bounded ID in the persisted request, and 31
focused tests pass. The signed-in reload fixture exposed a separate gap:
after local recovery the cloud baseline revision/token is null, so a resumed
correction PUT lacks the expected base and fails. Do not claim signed-in
reload recovery until the authoritative cloud baseline is restored and
verified before another model call. No live provider call ran.

Sep 25 Gateway credit preflight: a read-only GET to the test key's official
credits endpoint returned HTTP 200 and balance `-0.00456495`; no model calls
were made. Paid Gateway acceptance remains on hold until the balance is
positive. Sanitized evidence:
`docs/evidence/gateway-credit-check-20260925/report.json`.

Sep 24 review-resume release: source through `19c825d` deployed Ready as
`dpl_45mnfJ6qPud2mnPkbTBAosUEyfN7`, aliased to `https://orbsie.com/`
(immutable `https://orbsie-bspsrutaq-grappeggias-projects.vercel.app`).
Read-only root, robots and sitemap returned HTTP 200; the public and hosted
review-start routes returned expected GET 405. `/api/config` reports
`authoringReview:false`, `chatgptHosted:true`, `chatgptGeneration:true`.
Deployed player `runtime.js` and `source.json` exactly match the committed
bytes (SHA-256 `9d0bf6f2e5c443677002335a71f582ed3eea71ad6536cd4be48d4b5aabc8b7bf`
and `d462222e679a34e160fed4d903adc866eed3ca87dec6c1bc7c0a5e26da9c77fc`).
No live provider call or production-enabled review acceptance ran. The local
optimized build and full deterministic browser matrix passed before deploy.

Sep 24 explicit interrupted-review UI integration: sources `e38f09f` and
`5fc62eb` add **Resume review** beside the existing **Continue improving**
draft action. The former uses the saved failed run, original provider/model
binding, and the store's review-only path; it never resends `/api/generate` or
duplicates the user prompt. Free fallback resumes with its original free
connection even when an unconfigured provider remains in the selector, and
its balance is refreshed after an attempt. The control shows the relevant
provider cost and signed-in corrections reuse the existing cloud journal.
Astra reviewed both diffs. The full deterministic browser review-loop matrix
passed against the optimized production build, including WebGL and Canvas2D
success cases, partial/final review, two corrections, failed-review drafting,
explicit resume, lost-start-response retry, cloud conflict, and a signed-in
resumed correction segment. The resume fixture kept one create request, one
user prompt, stable entity IDs, saved revision and Play; the signed-in segment
recorded a cloud snapshot and ordered correction run. Desktop and 390x844
screenshots passed visual review, with no unexpected external requests.
Evidence: `docs/evidence/authoring-review/review-resume-integration-20260924/`.
TypeScript, Prettier, diff checks and optimized build pass; regenerated player
artifacts are in `8e4381f`. This is deterministic browser evidence, not a
live provider acceptance or production-enabled review release. A lost model
review response still has an unknown outcome and no automatic replay.

Sep 24 second owner-visible ChatGPT device challenge: after the owner said the
code and URL could be shown here, a new official device code and URL were
posted in chat. Read-only Orbsie status remained pending/disconnected until
its ten-minute expiry, then idle/disconnected. The challenge was cancelled
(HTTP 200) and its mode-0600 local test-session file removed. No ChatGPT
inference ran. Wait for a fresh owner `ready` message before issuing another
time-limited challenge. Computer use again reported no available browser
surface.

Sep 24 review-start response recovery: source `7343d1f` makes an explicit
retry of a lost `/review/start` response reuse the previously issued,
untouched review-only child when its identity, provider/model/effort, request
fingerprint, saved revision/digest, live phase, and all three review slots
match. The unique parent-child index still prevents a second free claim; a
free retry reports the current balance, including zero. A consumed, terminal,
expired, or mismatched child remains a safe conflict. Astra reviewed the diff;
31 admission tests and 13 PostgreSQL ledger tests, TypeScript, Prettier and
diff checks pass. This does not retry a lost model review response or prove a
live-provider recovery. The editor still needs an explicit resume control and
browser validation.

Sep 24 explicit review recovery client core: source `51bf796` adds a
review-only request builder and store action. The saved failure now retains a
prior run ID and original request/provider/model/effort/selection/browser
modeling binding without saving an API key. An explicit store call captures the
saved revision before admission, starts a new review run, and shares the normal
verdict/correction sequence without replaying initial generation or duplicating
the user prompt. It preserves the local committed scene and optional cloud
correction journal. Astra reviewed the diff and corrected a post-admission
capability-change cost leak in `45e3dff`: the resumed review now uses the
catalog's actual image support, falling back to structural scope when needed.
The focused store/connection suites pass (35 tests before the follow-up;
30 store tests after), TypeScript and Prettier pass. The editor action was
subsequently added above. Lost start/review responses initially had unknown
admission outcome; no hidden retry occurs. A repeated explicit start is now
idempotent under the conditions above. Source `1f0936c` adds the same
allowlisted admitted-failure marker to hosted ChatGPT review responses as the
public route, without exposing raw provider errors or credentials. Six hosted
route tests, TypeScript and Prettier pass. No browser E2E or provider call has
exercised this path.

Sep 24 owner-visible ChatGPT device challenge: a fresh guest Orbsie session
issued the official OpenAI device URL and one-time code, which were shown to
the owner in chat. The ten-minute challenge expired without a grant; read-only
status returned idle/disconnected, cancellation returned HTTP 200, and the
mode-0600 private session file was removed. No ChatGPT inference ran. Wait for
an owner `ready` message before issuing another time-limited code.

Sep 24 review-only continuation ledger: source `ed6d908` adds a fresh
`completed` review run bound to an existing scene revision/digest, with three
review slots and an atomic one-unit claim for free-provider use. The existing
failed run remains terminal. Astra reviewed the diff; the PostgreSQL ledger
file passed 11/11, TypeScript and Prettier passed. Source `467588e` adds an
admission helper that checks the prior failed run's identity, request
fingerprint and last completed scene before issuance. Source `1c3b0b2` adds a
nullable recovery-parent column and unique index, so concurrent duplicate
requests roll back the second free-trial claim and return a safe conflict.
PostgreSQL ledger tests pass 13/13, admission tests 13/13, TypeScript and
Prettier pass; the SQL migration is idempotent in its local test. The route
and editor action remain open, and no provider call or browser E2E was made.
The additive schema was applied to the production database, and a read-only
check confirmed the column and unique index exist. Production review remains
disabled.
Source `ec03302` adds the public free/OpenRouter/Gateway review-only start
endpoint. It checks origin, feature flag, bounded request, model catalog and
the failed-run admission before returning a new run ID and image capability;
it does not call a model. Astra reviewed the route diff; 12 focused route tests,
TypeScript and Prettier pass. The route test mocks admission, while the real
ledger/admission suites above cover the underlying database path. Source
`d871b67` adds the hosted ChatGPT start route: it requires an existing guest
or account session, checks the hosted connection/model catalog and effort
before admission, and returns a run ID without inference. Astra reviewed its
diff and aligned the focused fixture with GPT-6 Luna in `e79127e`; six route
tests, TypeScript and Prettier pass. The client action and browser E2E remain
open.

Sep 24 interrupted-review continuation: source `1dd8d55` distinguishes an
actual failed review request from earlier capture/preflight failures. When the
current committed revision remains saved and writable, the parent chat offers
**Continue improving**, which drafts a follow-up grounded in the original
request without sending it. Stop, stale project/revision, failed save, and
non-review failures do not offer the action. Astra reviewed the diff and
synthetic HTTP 502 browser fixture at desktop and 390×844: revision 3 and
entity IDs survived, only create and review requests occurred, drafting made
zero extra calls, and Undo hid the stale action. The control is visible without
horizontal overflow; the fixture lantern is not quality evidence. Eighteen
focused tests, TypeScript, syntax/diff checks and optimized build pass. Evidence:
`docs/evidence/authoring-review/interrupted-review-20260924/`. No live model
call ran. Source `6dad43f` deployed Ready as
`dpl_J2YEefFxk4TiqCRFs3mZD8LM9Gd3` at `https://orbsie.com/` (immutable
`https://orbsie-omzjp668p-grappeggias-projects.vercel.app`). Root and config
returned HTTP 200; deployed player runtime and source exactly match local
artifacts. Config keeps `authoringReview:false` and `chatgptHosted:true`, so
the live public path does not yet exercise this review UI. This is an explicit
new generation continuation, not replay or resume of the terminal review
ledger phase. Backend review-only continuation and live provider recovery remain
open. Build refreshed the checked-in standalone player artifacts.

Sep 24 ChatGPT owner-code attempt: a fresh production guest session issued a
device challenge through `/api/provider-session` and `/api/chatgpt/start`,
without Orbsie email signup. The URL and code were shown to the owner, but the
challenge expired without authorization. Read-only status returned idle and
disconnected; cancellation returned HTTP 200 and the mode-0600 private test
session file was removed. No ChatGPT inference ran. The user's own browser
session was not changed. The read-only Gateway test-key balance remained
`-0.00456495`, so no paid Gateway inference ran. Computer use still reports
zero browser surfaces, and no physical Android device is attached.

Sep 24 review failure diagnosis: source `bd70b48` adds an allowlisted
`X-Orbsie-Review-Failure-Kind` response header only after a review was admitted
and failed or cancelled. The bounded OpenRouter acceptance harness records only
recognized values on failed review responses; it does not retain provider bodies,
raw errors, or credentials. Astra reviewed the route/harness diff and reran the
two focused suites (30 tests), TypeScript, and diff whitespace checks; all pass.
The optimized production build passed, and source `df6adc6` deployed Ready as
`dpl_7pz9TTmfsT41UXBBfKymL8sE9wtg` at `https://orbsie.com/` (immutable
`https://orbsie-db4g4ck5e-grappeggias-projects.vercel.app`). Read-only root,
robots, sitemap, config, player runtime and source returned HTTP 200; both
player files exactly match the checked-in bytes. Config still reports
`authoringReview:false` and `chatgptHosted:true`. No live model call exercised
the new header, so the previous HTTP 502 still has an unknown underlying cause.
The authoring ledger marks an admitted
failed review run terminal, clearing its phase token. Recovery therefore needs
an explicit, budgeted continuation bound to the saved revision; automatic replay
would risk duplicate paid inference. The previously saved revision 21 survived.
The owner-offered ChatGPT code could not be issued through the local acceptance
session because it is signed out, and computer use currently reports no browser
surfaces. The owner can initiate the connection from their signed-in Orbsie tab.

Sep 24 failed-review framing release: source `0fa9b2c` retains the first
automatic content-frame attempt after a new world settles with a recoverable
generation/review error or recovery notice, provided ready committed bounds
exist and the user has not navigated or entered Play. Empty failures,
later same-project edits and project switches keep their existing guards.
Astra reviewed the diff and the deterministic real-World browser fixture:
landing → new empty build → ready approximately 2 m procedural tree → settled
review-error state moves the camera from 100% to 589% and shows the fixture
tree clearly. The tiny saved-project baseline remains. Six focused tests,
TypeScript, optimized build, browser fixture, syntax/format/diff checks pass;
fixture has zero provider/API/external requests or browser errors. Evidence:
`docs/evidence/initial-project-framing-failure-20260924/`. This fixture
does not simulate a provider HTTP 502 or prove legibility for arbitrary
generated geometry. Built player artifacts are committed at `5659a1f`.
Source `d5e09b2` deployed Ready as `dpl_EC7n2ccYjDZTCbFb8toPskR2cKKJ`,
aliased to `https://orbsie.com/` (immutable
`https://orbsie-1zedh0xsz-grappeggias-projects.vercel.app`). Production root,
config, player runtime and source returned HTTP 200; runtime/source SHA-256
match checked-in artifacts. `/api/config` keeps `authoringReview:false` and
`chatgptHosted:true`. No live model call occurred for this release.

Sep 24 OpenRouter feedback-continuity live attempt: one isolated production
build with a disposable PostgreSQL database ran three of four allowed
`openai/gpt-6-luna` calls, all default tier, server-capped at 4,096 output
tokens, with no retries. Create committed revision 13; the initial visual
review returned `revise` and bound correction revision 21. The follow-up
review request carried nonempty prior-findings feedback, proving the new
client/server path was exercised, but returned HTTP 502 classified as
`provider-error` / `host-unavailable`; no final review ran. Astra inspected
private revision-bound screenshots and rejects the current shape: four blue
fruit are visible after correction but remain rounded ornaments with weak
caps/branch attachment, and the full view frames the tree very small. The
saved scene survived the failed review. This run is **failed/incomplete**, not
visual acceptance; the exact upstream 502 cause is unknown. Sanitized report:
`docs/evidence/authoring-review/openrouter-feedback-current-20260924/`.
No additional live retry was made.

Sep 24 review-feedback production release: source `f6d72bd` deployed Ready as
`dpl_4RfSmSTpLqtQxSP19obg49pJ1d3B`, aliased to `https://orbsie.com/`
(immutable `https://orbsie-alef910en-grappeggias-projects.vercel.app`).
Read-only root, robots, sitemap, config, player runtime and source requests
returned HTTP 200. Production player runtime/source SHA-256 hashes match the
checked-in built artifacts exactly; `/api/config` still reports
`authoringReview:false` and `chatgptHosted:true`. No provider call or full
authoring-quality acceptance ran as part of this deployment. The existing
browser-control inventory still reports zero visible browsers.

Sep 24 review-feedback continuity: source `3150a08` sends no feedback for the
initial scene review, then carries up to three sanitized findings from the
immediately preceding review into each next correction/final review. The
server treats that field as untrusted evidence, verifies it against the
current revision-bound scene/image, and distinguishes an initial from a
follow-up correction pass. Astra review removed two remaining static
"first review" instructions and corrected the touch-verifier test's
implicit-any type in `56fcbfc`. The combined 57 focused tests, full
TypeScript check, Prettier, diff check and optimized production build pass.
This is a local protocol/context improvement, not live-provider visual
acceptance; authoring review remains disabled in production pending a bounded
quality run that converges on a recognizable result.

Sep 24 flagship touch frame observer: source `b513820` adds a bounded
2,048-frame browser telemetry ring for the read-only published-platform
verifier. It correlates player and three moving-platform poses within each
rendered frame, rejects gaps/object loss, and applies the existing strict
saved-ZIP source-contact gate to adjacent frames. Astra review found that its
initial takeoff marker preceded Jump dispatch; source `ec0f840` now begins
post-takeoff ground proof only after adjacent frames show upward launch from
the initial ground band. Thirteen focused tests, syntax, formatting and diff
checks pass; Astra reran the 13 tests. One immutable-publication CDP-touch
probe made zero model, external or mutating requests, but stopped before Jump
with `uncorrelated-or-missing-frame-objects`. Its recorded verifier hash is
pre-fix, so it neither diagnoses gameplay nor live-validates the corrected
observer. Evidence: `docs/evidence/publication-flagship-openrouter/platforms-sequential-touch-frame-sampling/`.
The mobile touch three-platform route remains open; a future diagnostic run
must first establish a complete correlated frame and retain the no-ground
proof without relaxing contact tolerance.

Sep 24 OpenRouter visual review after palette guidance: source `dd630de` used
four capped `openai/gpt-6-luna` calls in an isolated production build: initial
create and three revision-bound image reviews, all HTTP 200 and no retries.
The model returned `revise` at the final call limit; outcome is
**bounded-incomplete**. Astra inspected the private screenshots and rejects the
result: only three of four blue fruit remain visually distinct, their rounded
silhouettes read as generic blobs instead of pointed strawberries, and the
large green caps/stems lack convincing branch attachment. This improves on the
earlier false `accept` by honestly reporting incomplete work, but it does not
close visual quality. Authoring review remains disabled in production. The
sanitized trace is `docs/evidence/authoring-review/openrouter-palette-current-20260924/`.
One own-origin `net::ERR_ABORTED` was recorded during review without a page or
console error; its effect is not established by this trace. Gateway's latest
read-only credit check remains negative, and no ChatGPT inference ran.

Sep 24 provider-readiness recheck at 20:49 UTC: the local OpenRouter key's
read-only status request returned HTTP 200, so a bounded Luna quality run is
recorded above after the catalog-palette guidance change. The Gateway test key's
read-only credit endpoint still returned HTTP 200 with balance `-0.00456495`;
no Gateway inference ran. Hosted ChatGPT's pinned App Server 0.153.4 and the
installed 0.156.1 both generate `TurnStartParams` without a per-turn token cap;
the official turn-start and configuration references likewise expose no hard
4,096-output-token field. Existing 180-second/512-KiB application bounds are
not token or billing bounds. Read-only schema evidence:
`docs/evidence/chatgpt-output-cap-audit-20260924/`. The owner has been asked
which bound governs a future hosted Luna test; no ChatGPT inference ran. A new
device code still awaits the owner's ready signal after five prior expirations.

Sep 24 published-player initial camera release: source `f8ff99d` starts the
standalone player at the existing 12-unit comfortable play minimum instead of
the editor's 24-unit default. The explicit prop is used only by the published
player; editor navigation, user zoom, saved projects and gameplay positions are
unchanged. Astra reviewed the Luna diff and corrected an evidence mismatch:
the initial screenshot came from an older ZIP. A same-ZIP comparison using the
current catalog mixed export at 1280×720 and 390×844 shows both tree and crystal
larger and uncropped, with ready pages and no browser errors. Evidence:
`docs/evidence/standalone-initial-camera-20260924/`. Targeted navigation tests
(18), TypeScript, Prettier, diff check and optimized build passed. Source
`f8ff99d` deployed Ready as `dpl_457wh7ZngJYaawrKwyfkW8HT16B9`, aliased
to `https://orbsie.com/` (immutable
`https://orbsie-h0y0goq6a-grappeggias-projects.vercel.app`). Production root,
player runtime and source returned HTTP 200 with exact checked-in player hashes.
The exact production frontend passed the catalog browser fixture, including all
11 asset loads, mixed export and standalone playback with zero real model calls,
external requests or page errors:
`docs/evidence/standalone-camera-production-20260924/`. The two-object initial
legibility gap is improved; broad model-authored visual quality, live-provider
and physical-device acceptance remain open.

Sep 24 eleven-asset catalog release: source `b5cfd63` fixes the cold-scene
cache race by keeping prepared geometry protected until every pending consumer
has acquired or abandoned its lease. Astra reviewed the worker diff, tightened
the concurrent-consumer hold, and verified 11 targeted tests, Prettier,
typecheck/optimized build, and the complete browser fixture. The pre-fix
diagnostic and post-fix local artifacts are in
`docs/evidence/catalog-worker-assetquest-20260924/`: all 11 worker decodes and
loads pass, the mixed scene renders and exports, direct/rebuilt standalone
playback works, and new-only asset reuse is rejected with zero model calls,
external requests, or page errors. Source `b5cfd63` deployed Ready as
`dpl_5o8L1QdSiftYKbNduMPLTgFBuCPL`, aliased to `https://orbsie.com/`
(immutable `https://orbsie-12kmnbr4f-grappeggias-projects.vercel.app`).
Production root, robots, sitemap, config, mushroom GLB, player runtime and
source all returned HTTP 200; the public mushroom GLB SHA-256 matches the
checked-in manifest. The exact production frontend passed the same synthetic
browser fixture, including all 11 models and standalone playback, with zero
real model calls or page errors; evidence:
`docs/evidence/catalog-worker-assetquest-production-20260924/`. This is not
live-provider or physical-device acceptance. The small exported two-object
fixture remains visually distant in the play camera; that legibility gap and
the broader prompt.md scope remain open.

Sep 24 textured catalog admission in integration: source `8beb1a0` admits a
reviewed Asset Quest Fly Agaric Basic self-contained GLB and exact bundled CC0
license as the 11th catalog asset. The official author page lists CC0; source
archive, original FBX/TGA, derivative GLB, license, and active-bounds hashes
are recorded in the manifest. The plain verifier passed 11 assets, 11 bounds
and two sources; 11 focused tests, typecheck and local optimized build passed.
A synthetic mixed create/export/standalone run loaded this exact mushroom and
exported exact GLB/license bytes with zero model or external requests:
`docs/evidence/catalog-assetquest-admission/`. This is not live-provider proof.
The first full 11-asset cold scene exposed a cache lease race: all worker
decodes succeeded, but the final entry displayed a load error after cache
trimming. The release note above records the subsequent fix and acceptance.
The standalone snapshot also renders this
small two-object world at a distant play-camera scale, a separate visual
legibility gap. Avoid treating functional playback as finished visual quality.

Sep 24 owner code follow-up: a fresh production ChatGPT device challenge was
shown to the owner with the official URL. Its status remained pending until
expiry and then returned idle/disconnected; cancellation returned HTTP 200 and
the mode-0600 private browser state was removed. No ChatGPT inference ran.
Sanitized evidence omits the code:
`docs/evidence/production-hosted-chatgpt/owner-code-followup-20260924-5/`.
The next code should only be issued when the owner is ready to enter it within
the ten-minute window. The required live model output-token cap is still
unenforceable through the installed App Server protocol.

Sep 24 free-prompt copy: `89dacdc` changes the three positive-allowance labels
to use singular “free prompt” when one remains, preserving the same allowance
and connection behavior. Astra reviewed the bounded Luna diff; TypeScript,
Prettier and diff whitespace checks passed. Source `1b4fcbb` deployed Ready as
`dpl_3vBBmF2VwTtfaKYCryCp73Agj9gY`, aliased to `https://orbsie.com/`.
At a 390×844 production browser viewport with one prompt remaining, the
Connections dialog showed “Use 1 free prompt,” with no incorrect plural,
overflow, browser errors, unexpected requests or model calls. Evidence:
`docs/evidence/free-prompt-copy-production-20260924/`.

Sep 24 saved-world framing release: source `78ddac4` deployed Ready as
`dpl_6eAVyVuC5pQ16dcgRNnu5EY9UKvi`, aliased to `https://orbsie.com/`
(immutable `https://orbsie-ospjd3n0r-grappeggias-projects.vercel.app`).
The exact production frontend opened an isolated saved one-asset tree project
and framed it at 600% with the asset loaded, no overflow, no browser errors,
zero provider calls and no external or mutating requests. Root, robots,
sitemap and config returned HTTP 200. This is a saved-project framing check,
not a full generated-asset or provider E2E. Evidence:
`docs/evidence/saved-world-framing-production-20260924/`.

Sep 24 saved-world initial framing: opening a populated project under a new
project ID now frames committed content once through the existing navigation
command. Same-project edits/undo, play, manual navigation, errors, generation
recovery and empty/unbounded scenes retain their prior safeguards. Astra
reviewed the Luna diff and the local source-bundled browser fixture: a small
saved subject changed from the default 100% camera to 600% framing, with zero
provider calls, external requests or browser errors. The fixture proves camera
repositioning, not the quality of generated geometry. Twenty-five related
navigation tests and the optimized build pass. Evidence:
`docs/evidence/initial-project-framing/`. The release above deployed it.

Sep 24 touch-launch ordering probe: the public flagship CDP driver now sends
Jump before directional touch input when launching from a moving platform, so
the direction cannot walk the player off a narrow edge before Jump is
dispatched. A targeted ordering test and the full 10-test verifier suite pass.
The single authorized read-only replay confirmed Jump activation but missed
platform 1 at a different moving-platform phase, before it could test the
platform-2 edge hypothesis. Its trace and video are retained at
`docs/evidence/publication-flagship-openrouter/platforms-sequential-touch-jump-first/`.
There were zero model, external or mutating requests. The full touch route and
the platform-2 cause remain unverified; this is not physical-device evidence.

Sep 24 published OpenRouter flagship touch diagnosis: a bounded read-only CDP
touch replay found that the platform verifier used today's catalog bounds for
an older exported/published snapshot. The saved ZIP's embedded manifest is now
the source of contact geometry; the verifier records its SHA-256 and source.
Nine targeted verifier tests pass, including a captured-trace regression that
distinguishes true contact Y 1.440625 from the mismatched 1.428125. The
corrected public run landed on platform 1 and recorded nine carry samples,
then failed platform 2 after a direction-plus-Jump touch sequence. It made zero
model, external or mutating requests. The full touch route remains open; the
published runtime hash differs from the saved ZIP runtime hash. Evidence:
`docs/evidence/publication-flagship-openrouter/platforms-sequential-touch-current/`
and `platforms-sequential-touch-snapshot-metadata/`. Astra review found the
player only 0.036 m from the platform's moving edge before the second jump,
while the prior verifier pressed Right before Jump with roughly 95 ms between
its pre-jump sample and combined-input log; at 4 m/s, support could be lost in
about 9 ms. The probe above did not reach that same platform-2 condition, so
this remains a hypothesis, not a proven gameplay-runtime defect.

Sep 24 ChatGPT sign-in tab release: source `beeeda5` deployed Ready as
`dpl_DRbtSyAhxcDTqyBYBkqqYYBEJSmC`, aliased to `https://orbsie.com/`
(immutable `https://orbsie-e6buf2pu1-grappeggias-projects.vercel.app`).
The exact production frontend passed intercepted signed-out direct-click
testing: one official OpenAI sign-in tab opened and the synthetic code remained
visible. A separate programmatic-start case opened no tab. Both tests blocked
external navigation and made zero real model calls. Root, robots, sitemap and
config returned HTTP 200. Evidence:
`docs/evidence/chatgpt-open-tab-production-20260924/`. This is synthetic UI
acceptance, not a successful owner authorization or ChatGPT inference test.

Sep 24 ChatGPT sign-in follow-up: the owner offered to use a code and URL, so
production issued one fresh OpenAI device challenge and displayed it in chat.
Authenticated status stayed pending/disconnected through expiry, then became
idle/disconnected. The challenge was cancelled and the mode-0600 private
browser state removed; zero ChatGPT model calls ran. Sanitized evidence:
`docs/evidence/production-hosted-chatgpt/owner-code-followup-20260924-4/`.
The installed Codex app-server `TurnStartParams` schema has no per-turn output
token ceiling, so the owner-mandated 4,096-token live-test cap still prevents
ChatGPT inference acceptance. A bounded Luna UI change now opens the official
device sign-in page on direct Connect/Retry/Reconnect clicks while preserving
the visible code and fallback link; programmatic starts do not open a tab.
Astra reviewed the diff and the worker's fixture result: 18 connection tests,
five hosted-UI fixture scenarios, typecheck, formatting and syntax passed.
The optimized production build also passed. The release above deployed it.

Sep 24 free-provider recovery release: source `afb2fd3` deployed Ready as
`dpl_AeXC9mJ8aFxCChi8oKvtun8MbfLg`, aliased to `https://orbsie.com/`
(immutable `https://orbsie-9nawgxeph-grappeggias-projects.vercel.app`).
Read-only root/robots/sitemap/config/trial checks all returned HTTP 200.
The exact production frontend passed the intercepted HTTP 402 browser journey
on desktop and mobile: original prompt retained, provider settings visible,
unusable free CTA hidden, no horizontal overflow or browser/network errors,
and zero real model calls or external requests. Astra reviewed the production
mobile screenshot. Evidence:
`docs/evidence/production-release-20260924-free-ux/` and
`docs/evidence/free-unavailable-browser-production-20260924/`. Upstream
funding/credit remains unresolved, so real free generation and live Gateway
refund were not retested. The repository-wide Vitest run after the release
passed 1,789 tests with 27 skipped. A read-only Gateway test-key credits GET
returned HTTP 200 with balance `-0.00456495`; this credential does not expose
the server-funded free key's exact balance. No paid inference ran.

Sep 24 signed-out free-provider 402 recovery: `FREE_PROVIDER_UNAVAILABLE` now
survives the server-to-store path, preserves the rejected prompt and opens
provider settings directly without Orbsie email/password login. The settings
modal suppresses the unusable "Use free prompts" CTA while that failure is
active. Astra reviewed the Luna diff and visually inspected desktop/mobile
screenshots from an intercepted, isolated optimized build at 1440×900 and
390×844. Both passed prompt preservation, connection controls, no overflow,
one intercepted 402, zero live model/external/unexpected API calls and zero
page/network errors. Twenty-four focused tests, typecheck and optimized build
pass. Source commits `e18aa17` and `beae2d5`; evidence:
`docs/evidence/free-unavailable-browser-20260924/`. The release above deployed
this UI change.

The latest owner-visible ChatGPT device challenge also expired without a
grant before 18:40 UTC. Authenticated status became idle/disconnected, the
challenge was cancelled, and the mode-0600 private state file was removed.
Zero ChatGPT model calls ran. Sanitized evidence:
`docs/evidence/production-hosted-chatgpt/owner-code-followup-20260924-3/`.
Official
[Codex App Server documentation](https://learn.chatgpt.com/docs/app-server)
currently describes the managed browser OAuth callback as a `localhost`
callback served by app-server and separately documents device-code sign-in.
The documentation does not establish a supported arbitrary HTTPS callback to
`orbsie.com`; treat direct-return subscription OAuth as unverified, not as
implemented or categorically impossible.

Sep 24 free-prompt refund release: source `95f074a` built and deployed Ready
as `dpl_4ktCbEy1YRGqAa49hG2Ep4EMS2fw`, aliased to `https://orbsie.com/`
(immutable URL
`https://orbsie-popxkbfvb-grappeggias-projects.vercel.app`). Read-only
checks of `/`, robots, sitemap, config and trial all returned HTTP 200. No
production model call ran after the release because the prior free edit had
returned a billing HTTP 402. Evidence:
`docs/evidence/production-release-20260924-free-refund/report.json`. The
refund is therefore validated in focused route and real isolated PostgreSQL
tests, but its live 402 path remains unconfirmed; provider funding remains a
separate blocker for free generation.

Sep 24 free-prompt 402 accounting fix: after the live second prompt was
rejected by Gateway, `POST /api/generate` now transactionally refunds a
successfully claimed legacy free prompt only when the upstream provider
returns HTTP 402 before streaming. The response keeps the user-safe error and
reports the restored remaining count. Other provider failures and the separate
authoring-review admission path do not use this refund. Astra reviewed the
Luna diff, ran 22 focused route tests, typecheck, formatting and diff checks,
and ran both trial-database tests against an isolated PostgreSQL 16 container;
all passed. The container was removed. Commit `da3b54b`; the release above
deployed it but did not restore funding for free generation.

Sep 24 second owner-visible ChatGPT follow-up: after the owner offered to use
a shown URL/code, a fresh isolated production session received a real OpenAI
device challenge. The code was displayed in chat, but the final read after its
expiry was HTTP 200, idle/disconnected. The session was cancelled, its private
state file removed, and zero ChatGPT model calls ran. Sanitized evidence omits
the code: `docs/evidence/production-hosted-chatgpt/owner-code-followup-20260924-2/`.
Wait for the owner to be ready before issuing another timed challenge.

Sep 24 WebKit mobile smoke: Playwright 1.63/WebKit 26.6 touch emulation at
390×844 and DPR 3 passed signed-out editor landing, WebGL2-ready rendering,
and the current standalone player ZIP with score 7, restart, win, and loss.
The observed pages had no viewport overflow, external/model/write requests,
or page/network errors. Astra reviewed the harness and editor/score/win
screenshots. The player used hashes of the current checked-in runtime and
workers. The editor's isolated optimized build came from `2a39aad`; subsequent
commits before the smoke changed documentation only. An older local server at
`:3001` served four static assets as HTTP 500; its failed attempt is retained
separately, and the clean isolated build passed. Evidence and replay harness:
`docs/evidence/webkit-mobile-smoke-20260924/` and
`scripts/verify-webkit-mobile-smoke.mjs`. This is browser emulation, not
physical iOS Safari or a physical-device performance result.

Sep 24 production free-prompt check: a fresh isolated visitor made two
`openai/gpt-6-luna` requests through the server-funded Gateway path. The first
returned `reserve_entity`, `set_geometry`, and `commit_revision` and applied
cleanly. The second, a material edit, returned HTTP 402 after 371 ms with
"Free generation is temporarily unavailable"; no retry or third model call
ran. The trial counter fell from two remaining to one on that rejected call.
The earlier Sep 8 passing report remains at `docs/evidence/free-trial.json`;
the new failed report is at `docs/evidence/free-trial-20260924.json`. This is
a current production billing/availability blocker for free prompts, not a
recipe or client-transport failure. The read-only test-key credit check still
shows a negative balance, but it is a separate credential and does not prove
the funded free key's exact balance. Do not rerun until funding or configuration
changes; investigate the consumed prompt on an upstream 402.

Sep 24 sitemap release: source `a85004c` built on Vercel as Ready deployment
`dpl_5UUfXcttXjS4eqSC6evg2ku2riZC` and was aliased to
`https://orbsie.com/` (immutable deployment
`https://orbsie-c9brzis86-grappeggias-projects.vercel.app`). Read-only live
checks returned root/robots/sitemap HTTP 200; the sitemap includes home and
ten promoted public Orbs. A sample public share page returned HTTP 200 with
indexable robots, canonical URL and title in the Googlebot HTML head. Public
config still reports hosted ChatGPT enabled and authoring review disabled.
Zero model calls ran. Evidence:
`docs/evidence/production-release-20260924-sitemap/`. This verifies crawler
markup and discovery surfaces, not actual search-engine indexing or provider
generation quality. GitHub browser control still exposed no surface, so local
commits have not been pushed through the owner's required Chrome workflow.

Sep 24 hosted ChatGPT owner-code follow-up: an isolated anonymous production
session received a fresh OpenAI device challenge and the URL/code were shown
to the owner. Status remained disconnected and the challenge ended idle without
a grant; the session was cancelled and its local private state removed. No
ChatGPT model call ran. Sanitized evidence omits the code:
`docs/evidence/production-hosted-chatgpt/owner-code-followup-20260924/`.
Do not start another timed challenge until the owner is available to complete
it. The requested direct-return subscription OAuth remains unverified.

Sep 24 published-Orb crawlability and Android renderer distinction: promoted
public `/o/{id}` pages now permit indexing, and the dynamic sitemap lists
only rows with both a public URL and a promoted revision, never private drafts
or pending releases. Eight targeted SEO/share-page tests, typecheck and the
Next optimized build pass; `/sitemap.xml` is dynamic. Source commit `8f1abf9`.
The current
Android 15 emulator replay with WebGL requests allowed passed real touch score
7/restart/win/loss at 412×786, but the only WebGL2 context was the capability
probe backed by Android Emulator SwiftShader. Orbsie's existing policy selected
Canvas2D, so Android WebGL and native GPU performance are **not** accepted.
The player hashes match the current checked-in artifacts; there were zero model
calls, unexpected network requests or page errors. Astra inspected the winning
screenshot and the worker diff. Evidence:
`docs/evidence/android-webgl-current-artifact-20260924/`.

Sep 24 late-stream fence rendered acceptance: the real-editor intercepted
stream fixture now holds a provisional old edit open, uses the visible Stop
control, commits a newer explicit edit, then releases the old material change
and `commit_revision`. The newer saved project remained revision 17 with the
same selected tree, unrelated entity, IndexedDB draft/library and undo history;
the stopped run retained `client-abort`, the newer run retained `completed`,
and no automatic third request occurred. The existing active-run fence passed
without a product-code change. The combined fixture passed 16 intercepted
requests with zero model calls, blocked origins, unexpected API calls or page
errors. Targeted journal tests (10), Node syntax, Prettier and diff checks
passed. Sanitized evidence: `docs/evidence/stream-resilience-late-run-20260924/`.
This is a local rendered race check, not live-provider or cloud-journal
interruption acceptance.

Sep 24 post-segment Android current-artifact acceptance: the Android 15
`droidlm_api35_midrange` emulator Chrome replayed an existing signed-out
published ZIP with the four current checked-in player files replacing the
older runtime. Exact SHA-256 hashes in the report match the current runtime,
CSS, generated-geometry worker and asset-geometry worker. With WebGL forced
unavailable, Canvas2D loaded at 412×786 without overflow; real touch input
scored 7, restarted, won and lost. Provider calls, generation requests,
external requests, unexpected local requests, failed responses and page errors
were all zero. Astra reviewed the Luna diff/report and the scored/win images.
The worker removed its ADB mapping and stopped the emulator. Evidence:
`docs/evidence/android-current-artifact-20260924-post-segment/`. This does not
certify physical Android, Android WebGL, editor login, or model-authored
generation on the device. The historical Android report remains intact.

Sep 24 stream-recovery case expansion: the real-editor intercepted-response
fixture now covers provider-error, provider `length`/output-limit, and
mid-record EOF after a provisional operation, in addition to its prior clean
EOF, rejected body read, invalid commit and split UTF-8 cases. The new cases
assert exact bounded terminal class and toast, unchanged saved baseline,
visible Try again/Use last working, no automatic retry, and an explicit retry
preserving stable IDs and the unrelated entity. The output-limit record now
matches the server's `TRUNCATED_SCENE_STREAM` diagnostic; its retry forwards
that safe code. One Android-sized 390×844 toast check passed with both controls
within the viewport and no horizontal overflow. Prompt text is omitted from
the report and masked in four restored full-page desktop/phone screenshots.
Astra reviewed the Luna diff, the output-limit toast crop and Android edit
image. The fixture passed 14 intercepted requests, zero live calls, zero
blocked external requests, zero unexpected API calls and zero page errors;
Node syntax, Prettier, diff, privacy and type checks passed. Evidence:
`docs/evidence/stream-resilience-recovery-cases-20260924/`. This is
deterministic client recovery evidence, not actual cross-provider interruption
or proof that production stream failures have decreased. Current production
logs sampled during this turn contained no relevant generation request and
could not establish a failure cause.

Sep 24 combined fresh-gameplay fixture isolation: after a WebGL-pass and
Canvas2D Undo movement failure, diagnostics showed a roughly 3.8-second gap
in both RAF and the page heartbeat while Canvas2D drawing stayed below 26 ms.
A separate software-only run passed the full five→seven→Undo five journey,
so no deterministic product-renderer defect was established. The fixture now
launches and closes a separate Chromium process for each renderer, preserving
its real-input, fresh-observation, movement, contact and report assertions.
An isolated production build and combined WebGL/Canvas2D run then passed all
three gameplay phases, including grounded platform contacts, bounce, wins and
resets; zero provider/model calls ran. Node syntax, Prettier and diff checks
passed. Temporary browser evidence was removed after worker verification.
One passing isolated run does not rule out future host-wide scheduling pauses.

Sep 24 owner-visible ChatGPT device challenge: production created an isolated
anonymous Orbsie acceptance session and returned a real OpenAI device URL/code.
The code was shown to the owner, but the challenge expired without a grant;
the final authenticated status was HTTP 200, idle/disconnected. The temporary
session state was removed, no code or credential was retained in evidence,
and no ChatGPT model call ran. Evidence:
`docs/evidence/production-hosted-chatgpt/owner-code-20260924/report.json`.
Wait until the owner is ready before starting another ten-minute challenge.
A same-day Gateway credits GET still returned HTTP 200 with balance
`-0.0033684`; paid Gateway inference remains on hold.

Sep 24 production release after focused capture and segment integration:
the full Vitest suite passed (1,783 passed, 27 skipped) and the optimized
Next.js build passed at source `d11058b`. Vercel deployment
`dpl_Gtz4xyNC4LN2m9XjXSH6XswFoUVA` reached Ready and was aliased to
`https://orbsie.com/` (immutable URL
`https://orbsie-5vff13kr0-grappeggias-projects.vercel.app`). The signed-out
read-only release smoke passed: root HTTP 200, protected generation-runs
HTTP 401, visible landing canvas/composer, no page errors/non-GET/external
requests, and exact SHA-256 matches for the shipped player runtime and five
geometry-worker artifacts. Astra inspected the landing screenshot. Public
`/api/config` reports accounts, publishing, hosted ChatGPT and generation
enabled, with `authoringReview:false`; robots and sitemap return HTTP 200.
Evidence: `docs/evidence/production-release-20260924-focused-segment/`.
This is release health, not live OpenRouter/Gateway/ChatGPT provider E2E or
visual-quality acceptance. Regular Chrome remains unavailable to computer
use, so the local commits have not been pushed to GitHub through the owner's
required browser workflow. Gateway credit remains last observed negative;
ChatGPT still needs a real owner grant; the current
[App Server turn documentation](https://learn.chatgpt.com/docs/app-server#turns)
does not document an enforceable 4,096-output-token field for the approved test.

Sep 24 catalog palette guidance: the ten model-facing Kenney summaries now
describe their actual authored GLB material colors; notably the default tree,
pine and bush use teal foliage rather than conventional forest green. The
generation prompt states that entity.color does not recolor catalog materials
and should select procedural/custom geometry when a catalog palette or form
conflicts with the request. Review guidance now judges catalog palette and
contrast as well as silhouette. Astra reviewed the Luna diff against each
checked-in GLB material factor; 66 focused catalog/generation/review tests,
typecheck, Prettier and diff checks pass. This is a no-provider prompt/catalog
change, not a live quality acceptance. Do not rerun paid inference solely for
this wording; the Sep 24 live false accept remains the quality baseline.

Sep 24 focused-capture-plus-segment live OpenRouter acceptance: the isolated
production build and disposable PostgreSQL migration passed; the malformed
JSON origin preflight returned HTTP 400 with no inference. One authorized
four-call `openai/gpt-6-luna` default-tier run at 4,096 output tokens/call,
without retries, returned HTTP 200 for all calls. Create saved revision 9;
reviews revised 9→13 and 13→17; final review bound to revision 17 returned
`accept`. Every review had camera-view observations and an exact captured PNG.
Reload recovered revision 17 without browser key storage. Sanitized evidence:
`docs/evidence/authoring-review/openrouter-focused-segment-20260924/`.
The harness passed, but Astra inspected all exact review PNGs, bounded
findings and the final scene before removing private evidence and rejected
visual quality: only three oversized blue berries surround a cyan canopy,
with stems not visibly connected to its branches. The model's `accept` is a
false positive. The structural report counted zero segment parts, so this
run does not prove live adoption of the new primitive. One own-origin
`net::ERR_ABORTED` request was observed, without page/console errors or
blocked external origins. The isolated server, database, build worktree and
temporary credentials were removed. Keep production authoring-review off.
Next: improve actual subject/support construction and review calibration;
do not repeat a paid run merely to chase an `accept` verdict.

Sep 24 procedural support segments: `geometry.parts` accepts a bounded
`segment` with local `from`/`to`, radius and color, so models can join visible
stems, branches and other supports by endpoint instead of Euler rotation.
Segments reject less than 0.001m length and nonpositive/out-of-range radius;
legacy parts remain valid. Generation and review guidance points the model to
actual contact locations. Astra reviewed the Luna diff and tightened the
near-zero guard. Forty-six focused geometry/strict-schema/review tests,
typecheck, formatting and the production build pass. A zero-provider browser
fixture passed in WebGL and forced Canvas2D with endpoint stems in a fruit
tree, including revision-bound initial/replacement captures and no unexpected
external requests. Astra inspected both initial images and saw all three
stems. Evidence: `docs/evidence/scene-review-segment-20260924/`. The software
fixture logs the expected WebGL-context failure before fallback; no other
page/console error occurred. This proves rendering, not live model use of
segments or final quality. Next meaningful milestone is one bounded Luna-only
live quality run with the focused review image and new support primitive;
inspect its exact private images/findings before deleting them.

Sep 24 focused scene-review capture: the review PNG now frames the projected
union of committed entity world bounds when a crop offers meaningful zoom.
Unknown bounds, unstable/eye-crossing projections, offscreen-only scenes, and
marginal crops retain the full game-canvas capture. Both WebGL and Canvas2D use
their current camera matrices; WebGL removes its render-local origin from
world bounds. The existing one-PNG, 128 KiB and rendered-revision contract
remains. Astra reviewed the Luna diff and ran a fresh production build plus
the zero-provider WebGL/Canvas2D browser fixture. Both renderers passed with
visible blue fruit and exact revision/readiness bindings. The images are much
more legible: WebGL initial blue fruit pixels increased from 3,563 in the
previous full-frame fixture to 8,105; Canvas2D initial increased from 383 to
4,518. Astra inspected the four actual captures. Evidence:
`docs/evidence/scene-review-focused-capture-20260924/`. The first fixture
attempt accidentally targeted unrelated H3 Studio on port 3040; it made no
Orbsie or provider call and its failed evidence was discarded before the
isolated production run. One remaining quality risk is that close framing
alone cannot make the model attach fruit stems or choose the right silhouette.
Do not run another paid quality test until the next substantive modeling
change; production authoring-review remains off.

Sep 24 camera-aware OpenRouter quality run: a fresh isolated production build,
Postgres migration, and exact-origin malformed-JSON HTTP 400 preflight passed.
Exactly four `openai/gpt-6-luna` default-tier calls, each capped at 4,096 output
tokens with no retry, returned HTTP 200. Creation saved revision 13; two
visual+structural reviews corrected it to revisions 24 and 30; the final review
of revision 30 still returned `revise`, so acceptance remains bounded-incomplete.
Each review request had the expected camera-view observations and exact PNG
captured privately; reload recovered revision 30 without persisting the key.
Sanitized evidence: `docs/evidence/authoring-review/openrouter-camera-aware-20260924/`.
Astra inspected all three exact review images and the final close-up before
deleting private evidence. The review images show the entire tree very small
(roughly 100 pixels tall in a 768×533 frame), making detail judgments hard;
the close-up confirms five blue berries with caps but floating/disconnected
stems, weak branch attachment, and fruit profiles that are too symmetric. The
model's camera-aware corrections improved visible count but did not resolve
these core defects. One own-origin generation request reported
`net::ERR_ABORTED`; there were no page/console errors or blocked external
requests. The isolated server, database and credentials were removed. Keep
production authoring-review off. Next: improve review framing to make the
subject legible while preserving scene context, then address attachment and
silhouette quality before spending on another live quality run.

Sep 24 exact review-input evidence: the opt-in live OpenRouter verifier now
writes each permitted review request's validated PNG into fixed-name mode-0600
files in its mode-0700 private directory, never in the repository. Its public
report retains only dimensions, decoded byte count, SHA-256 and write status;
unavailable/invalid inputs add no image text. The call cap and retry gate are
unchanged. Review-call summaries also record whether camera-view observations
were present, so the next live run can confirm that the new feedback reached
the route. Astra reviewed the Luna diff; 19 focused tests, typecheck, syntax,
formatting and diff checks pass. A direct Node 22 invocation wrote and removed
a private 1×1 PNG successfully. No provider call ran for this change. This
will allow the next live reviewer verdict to be compared against the exact
scene PNG it saw; private files must be removed after Astra inspects them.

Sep 24 camera-aware scene review: the renderer capture now optionally records
the camera's world-space position and forward direction with the exact rendered
revision. WebGL adds the render-local origin; Canvas2D uses its world camera.
The client forwards only this bounded numeric view, and the server validates
finite position, normalized direction and the existing project/revision
binding. Reviewer guidance now moves hidden or tiny details toward the actual
camera-facing support surface, keeps attachment contact, and avoids enlarging
the support as a shortcut. Legacy captures still work. Astra reviewed the
Luna diff and tightened surface-contact wording; 43 focused tests, typecheck,
formatting, syntax, and diff checks pass. A fresh isolated production build and
zero-provider revision-bound browser fixture passed in WebGL and forced
Canvas2D. Both renderer captures reported a normalized camera view facing the
fixture scene; fruit remained visible, revisions/readiness stayed bound, and
no unexpected external request occurred. Evidence:
`docs/evidence/scene-review-camera-view-20260924/`. The temporary server and
worktree were removed. A live camera-aware quality recheck remains pending.

Sep 24 higher-detail OpenRouter quality run: an isolated production build,
database migration, and exact-origin malformed-JSON HTTP 400 preflight passed.
The single bounded run made four `openai/gpt-6-luna` default-tier calls at
4,096 output tokens/call, no retry, all HTTP 200. Creation saved revision 13;
two visual+structural reviews corrected to revisions 20 and 27; final review
of 27 returned `revise`, so acceptance remains bounded-incomplete. Reload
recovered revision 27 without storing the key. Sanitized report:
`docs/evidence/authoring-review/openrouter-higher-detail-20260924/`. The
private findings and scene image were retained until Astra inspected them,
then removed. The dominant defect is now concrete: a very large brown canopy
occludes nearly all five blue berries; their caps, stems, tapered shapes and
branch connections are unreadable. Earlier reviews also found the subject too
small and moved/scaled it, but visibility remained poor; the final reviewer
additionally claimed top cropping, which the separately captured page image
did not obviously support. The browser recorded one `net::ERR_ABORTED`
generation request, no page/console errors, and no blocked external requests.
The test server, database and private credential files were removed. Keep
production authoring-review off. Next: provide camera-facing placement evidence
to review and target occluded details directly before another paid quality run.

Sep 24 review-image detail: the scene capture now tries a 768-pixel maximum
edge before its existing 512/384/256/192/128 fallback ladder, preserving the
single PNG API, aspect ratio, no-upscale behavior, and 128 KiB encoded limit.
The earlier procedural-fruit fixture's WebGL 512×360 image was only 44.7 KiB,
so it had unused room for detail; the software image was 94.1 KiB and may
need the prior fallback. Astra reviewed the narrow Luna diff; nine focused
capture tests, typecheck, formatting, and diff checks pass. A fresh isolated
production build and zero-provider browser fixture passed in WebGL and forced
Canvas2D. WebGL initial/replacement captures were 768×540 at 81.9/72.3 KiB;
Canvas2D initial fell back to 512×360 at 94.1 KiB, then replacement used
768×540 at 61.9 KiB. All retained visible blue fruit, exact revision/readiness
bindings, and no unexpected external requests. Astra inspected the scene PNGs;
the initial Canvas2D framing still renders the tree small. The fixture now
waits for the final rendered replacement revision instead of attempting an
intermediate revision. Evidence:
`docs/evidence/scene-review-capture-high-detail-20260924/`. This does not
prove live model quality or a completed authoring review.

Sep 24 authoring-review diagnostics: the four-call quality run's sanitized
report retained verdicts and revisions but lost the reviewer's defect text,
while its private scene image was removed before Astra inspection. The live
OpenRouter verifier now records bounded issue counts and own-origin failure
categories in its sanitized report. When private evidence is requested, it
writes a fixed-name, mode-0600 findings file outside the repository with only
bounded review issue summaries; summaries resembling credentials or links are
omitted. Future workers must keep private findings and the scene-only image
until Astra reviews them, then remove them. Sixteen focused tests, typecheck,
syntax, formatting, and diff checks pass; no provider or full E2E call ran.
The quality cause is still unproven, and the production authoring-review flag
stays off. A future live run should be tied to a substantive quality-loop
change, not diagnostics alone.

Sep 24 four-call live OpenRouter quality check: the first isolated setup attempt
stopped at exact-origin preflight because a backgrounded `next start` died with
its launcher shell; zero model calls ran. With a foreground server and verified
malformed-JSON HTTP 400 preflight, the single corrected test made exactly four
`openai/gpt-6-luna` default-tier calls, each capped at 4,096 output tokens and
without retries. All four returned HTTP 200: creation saved revision 17, two
visual+structural reviews corrected to revisions 24 and 30, and a final
revision-bound review returned `revise` with no calls left. Reload recovered
revision 30; no key appeared in browser storage. Sanitized evidence:
`docs/evidence/authoring-review/openrouter-four-call-quality-20260924/` (failed
zero-call setup) and `openrouter-four-call-quality-corrected-20260924/`
(bounded-incomplete). The worker reported five pointed blue fruit with green
caps and stems but subtle branch attachment; its private screenshot was removed
during cleanup before Astra could inspect it, so independent visual acceptance
is not established. One browser request failure lacks a classified cause; there
were no page/console errors or blocked external requests. Isolated resources
were removed. Keep the production authoring-review flag off; diagnose quality
feedback and preserve private images long enough for Astra review on the next
meaningful live run. Gateway credit remains negative, and ChatGPT live grant
remains unverified.

Sep 24 combined Canvas2D/coarse-pointer acceptance: one fresh production-server
run passed while the generation stream remained open and player movement
advanced 1.0664 units. The same browser then completed five collectibles,
portal win/reset at revision 22; seven collectibles, win/reset at revision 31;
and UI Undo back to five collectibles, win/reset at revision 32. The 844×390
coarse-pointer landscape checks passed with the chat sheet both closed and
open, no page overflow, and an accessible Edit hit target when open. Astra
inspected the report and desktop/phone screenshots. Evidence:
`docs/evidence/fresh-gameplay-software-coarse-20260924-rerun/`. Zero provider
calls; the temporary 3041 production server was stopped. The prior Undo stop
was intermittent and its root cause remains unisolated; this single green run
does not prove it cannot recur. Physical-device mobile acceptance is separate.

Sep 24 Android exported-wall acceptance: the `droidlm_api35_midrange` Android
15 emulator's Chrome 124 opened the freshly exported deterministic wall ZIP
through a read-only local server. With WebGL deliberately unavailable, the
actual Canvas2D player rendered the wall and touch controls at 412×786 without
viewport overflow. Holding the wall-directed Back touch reached a fresh wall
contact, scored 11, and left the player center at z=6.724 before the wall face
at z=6.944; the rear collectible stayed uncollected. No model, generation, or
external request ran. Astra inspected both screenshots and the bounded report;
syntax, formatting, and cleanup checks pass. Evidence:
`docs/evidence/android-solid-wall/`. Chrome's first cold CDP attachments were
unstable before the app loaded; the verifier waits for a stable initial tab and
reuses it. The final run passed and stopped the emulator/ADB mappings. This is
emulator software-renderer evidence, not physical-device or Android WebGL
acceptance.

Sep 24 solid-wall browser acceptance: the committed opt-in wall behavior now
passes one deterministic production-build fixture in the real editor. WebGL
keyboard and forced-software touch each blocked a ready wall, fired its
collision rule, and slid alongside it; visual-only static walls remained
traversable. The downloaded ZIP retained the ready solid wall and rule. Its
standalone player ran without external requests and kept the player at z=6.724
in front of the wall face at z=6.944 under held input, with wall contact and
score 11. The fixture made zero provider calls and recorded only the two
expected WebGL initialization errors from deliberately forcing software mode.
Astra reviewed the script, report, and WebGL/software/standalone screenshots;
syntax, formatting, and diff checks pass. Evidence:
`docs/evidence/solid-wall-browser/`. This is headless Chromium, not physical
Android or live model-authored wall acceptance.

Sep 24 bounded solid-wall milestone: Luna added an opt-in `solid` entity
behavior. Shared gameplay now blocks horizontal traversal using committed
geometry bounds transformed into world space, slides along walls, allows
vertical clearance, and emits wall contact IDs for game rules. Seed/coarse,
unready, and unbounded entities do not block. Astra reviewed the diff and
generation guidance, which limits physical-wall claims to bounded box-like
objects while leaving islands/cliffs visual. The focused gameplay, protocol,
and prompt tests (72 total), typecheck, diff check, and production build pass.
The prebuild regenerated the tracked standalone-player bundle and source
snapshot. This is local source-level evidence, not a live generated-world,
browser-wall, exported-playback, or physical Android acceptance result.
Gateway credit remains negative; computer-use Chrome remains unavailable, so
neither paid Gateway nor signed-in ChatGPT acceptance ran. Next: deterministic
browser wall traversal in both renderers and exported playback, then the
remaining provider/mobile gates when their prerequisites are available.

Sep 24 Canvas2D diagnostic completion: a clean `dd74a9e` production-build
coarse-pointer full fixture passed generation movement; five, seven, and Undo
back to five collectibles; win/reset for each; and landscape closed/open
bounds. It then timed out on the fixture's 5-second stable-frame gate for the
landing composer. The page stayed visible with a running renderer and no
runtime error, but headless SwiftShader had a 2.15-second RAF gap; the failure
screenshot showed the composer in bounds. Only the landing/reopened fixture
checks now allow 12 seconds for two stable RAF frames, with the same strict
viewport/overflow assertions. A production-build coarse-pointer layout-only
replay passed landing, reload, and reopened layout. Evidence:
`docs/evidence/fresh-gameplay-software-coarse-diagnostic-dd74a9e-20260924/`
and `fresh-gameplay-software-coarse-layout-settle12s-dd74a9e-20260924/`.
These runs are deterministic and headless; no live provider or physical-device
acceptance is implied. A single combined all-green report remains open.

Sep 24 combined Canvas2D/touch fixture follow-up: a production-build run
passed movement and all three gameplay phases, then failed only at the final
saved-world reopen check. The screenshot showed the composer in bounds; the
fixture was selecting between landing/workspace composers ambiguously. It now
selects the active main-mode composer and waits for a stable visible box. A
coarse-pointer layout-only replay passed desktop, portrait, landscape closed
and open, landing, reload, and reopened workspace. A subsequent combined run
passed movement, five collectibles, and seven collectibles, but stopped during
Undo gameplay before layout. The wrapper had discarded the underlying error
and masked the current phase's traversal with the earlier five-item result.
The harness now retains a bounded redacted failure summary and prefers the
failing phase's traversal; this correction has only syntax/format validation
so far. Evidence is under
`docs/evidence/fresh-gameplay-software-coarse-combined-20260924/`,
`fresh-gameplay-software-coarse-layout-reopen-20260924/`, and
`fresh-gameplay-software-coarse-combined-final-20260924/`. A single full
combined passing report and the cause of the intermittent Undo stop remain
open; no live provider calls were made.

Sep 24 fresh-gameplay renderer and mobile-fixture milestone: Astra reviewed
Luna's bounded freshness fix. A 50 ms JavaScript heartbeat stayed responsive
while headless SwiftShader delayed requestAnimationFrame by up to 2.7 seconds;
the deterministic gameplay observer now waits at most three seconds and still
requires a strictly newer observation. Focused tests cover delivery after one
second and rejection of stale frames. WebGL and Canvas2D fixture gameplay both
completed five collectibles, a seven-collectible edit, and Undo back to five,
each with win/reset. The subsequent Canvas2D workspace check initially failed
because Undo returned to Edit; it now explicitly enters Play. The landscape
fixture then confused a fine-pointer desktop viewport with mobile CSS and, in
coarse-pointer mode, treated the intentionally collapsed chat sheet as an open
panel. The corrected touch layout fixture checks the reachable closed handle,
opens the sheet, verifies the composer fits at 844×390 without page overflow,
and tests Edit. Its production-build layout-only run passed; no product CSS
change or provider call was needed. Evidence is under
`docs/evidence/fresh-gameplay-software-*20260924/`, especially the passing
`fresh-gameplay-software-webgl-regression-20260924` and
`fresh-gameplay-software-coarse-pointer-layout-20260924` reports. A combined
full Canvas2D gameplay-plus-touch-layout run and physical Android performance
remain open. Fine-pointer 844×390 short-window overflow is separately known;
the fixture now labels its coarse-only landscape check as skipped there.

Sep 24 production ChatGPT connection attempt: an isolated anonymous Orbsie
session on `https://orbsie.com/` received one real OpenAI device challenge,
but 183 status polls saw no grant before its ten-minute expiry. The attempt
was cancelled; a subsequent authenticated status read showed
idle/disconnected with no pending challenge. The expired private browser state
was removed. Zero ChatGPT model calls ran. The owner's signed-in Chrome still
was not exposed through computer use. A new read-only production browser
verifier checks exact-origin, mode-0600 session state, connection persistence
and local draft recovery while blocking all inference and writes. Its four
focused tests, typecheck, syntax and formatting checks pass. A live
disconnected-session run reached the app cleanly with no blocked API requests,
external requests or browser errors, then reported
`connection-not-established` before inference. Evidence:
`docs/evidence/production-hosted-chatgpt/`. The current Codex App Server
protocol exposes no provider-enforced 4,096-output-token field, so the
owner's live-test cap cannot yet be attested for hosted ChatGPT calls; the
verifier fails closed. This interim device flow also does not fulfill the
requested direct-return OAuth requirement.

Sep 24 Gateway read-only credit recheck: HTTP 200 still reported a balance of
`-0.0033684`. No Gateway inference ran. Keep the paid Gateway acceptance on
hold until this key has positive credit.

Sep 24 live-acceptance harness handoff: the OpenRouter browser harness now
recognizes the two-correction/final-verdict sequence, preserves the prior
three-call default, and requires both a four-call limit setting and an
explicit approval setting before allowing a fourth call. It checks the Luna
model, 4,096 output-token cap, default tier, no browser-visible retry,
decreasing review slots, exact revision/evidence chain, and reload recovery.
Astra reviewed the Luna diff and corrected final-review partial-verdict
validation so a nonmutating `revise` result is not rejected. All 13 focused
tests, typecheck, syntax, and formatting checks pass. No live model call was
made; the owner has been asked separately to approve one bounded four-call
OpenRouter quality run. Production feature flag remains off. Gateway credit
remains negative, and computer-use exposes no signed-in Chrome surface for
ChatGPT acceptance.

Sep 24 signed-in recovery milestone: production-build deterministic browser
fixture passed a four-request authoring review with three independent cloud
journal segments, chained snapshot tokens, and reload/recovery of final revision 8. The conflict path still stopped before a correction segment. Astra reviewed
the script diff and phone screenshot. Evidence:
`docs/evidence/authoring-review/signed-in-three-segment-20260924/`. Zero live
model calls; provider quality acceptance and production feature enablement
remain open.

Sep 24 external acceptance check: Vercel AI Gateway credit remained
`-0.0033684` on a single read-only authenticated request (HTTP 200; zero model
calls). Evidence: `docs/evidence/gateway-credit-check-20260924/report.json`.
Gateway live inference remains withheld until credit is positive. Browser
computer-use inventory still exposed no app or browser surface, so the owner's
existing signed-in Chrome could not be used for live ChatGPT acceptance.

Sep 24 real PostgreSQL admission check: a synthetic free-provider run completed
creation, admitted two correction reviews at remaining budgets two and one,
then admitted a final verdict at zero. Exact revised scene bindings and replay
rejection were exercised against temporary PostgreSQL 16; all three route/DB
tests passed with no model calls. The isolated database was removed.

Sep 24 four-call local integration: the browser loop now supports two bounded
correction-bearing reviews, each with a saved finding, independent cloud journal
segment, fresh canvas evidence, and exact scene binding check, followed by a
verdict-only final review. It stops on a nondecreasing second-review budget and
keeps the last committed scene. The 50 focused tests and typecheck pass. The
deterministic real-editor browser fixture passed WebGL and software paths,
including the new four-request software path: revisions 3 → 6 → 8, three
distinct rendered image digests, saved final state, desktop/phone screenshots,
and zero live model calls. Evidence:
`docs/evidence/authoring-review/four-call-browser-20260924/`. Astra inspected
both new screenshots. Production feature flag remains off. Next: production
build and full integration review, then a separately authorized bounded live
quality run before enabling the flag; Gateway still needs positive credit and
ChatGPT still needs a verified account grant.

Sep 24 bounded second-review implementation in progress: parser commit
`291bd90` accepts a remaining budget of two; ledger/migration commit `8f2cd9b`
issues three review slots for new runs, permits two correction-bearing reviews,
then one final verdict, and fences each by run, identity, exact revision/digest,
token, and expiry. Astra reviewed the diff, reran 15 targeted tests, and tested
the migration on both fresh and legacy PostgreSQL 16 schemas, including an
existing completed row, new default, widened constraint, and idempotent rerun.
The browser loop and four-call deterministic fixture are the current handoff.
Production feature flag remains off. This does not supersede the live
OpenRouter three-call authorization; a paid four-call run is not authorized.

Sep 24 post-form OpenRouter quality acceptance: one isolated local browser run
against `bb6ec50` used exactly three `openai/gpt-6-luna` default-tier calls
at 4,096 output tokens, all HTTP 200 without retries. Create saved revision
13, review corrected to revision 24, and final visual/structural review still
returned `revise`: bounded-incomplete. Revision 24 survived reload; no key was
stored in the browser. The aggregate report shows five lathe, five cone, and
five cylinder parts. Astra inspected the private image: all five blue fruit
are visible and taper toward a point, improving on prior round/occluded
results, but a convincing leafy calyx and visible branch attachment are still
missing. Evidence:
`docs/evidence/authoring-review/openrouter-blue-strawberry-form-20260924/`.
The isolated server/database were removed. Repeated three-call runs now show
that prompt guidance improves one defect at a time but the first-review-only
correction loop cannot finish the remaining defect; investigate a bounded
second correction/review phase with explicit cost and revision guards before
enabling production authoring review. Do not repeat the same paid test with
only another wording tweak.

Sep 24 post-visibility OpenRouter quality acceptance: one fresh isolated local
browser run against `bc3ee65` made exactly three `openai/gpt-6-luna`
default-tier calls at 4,096 output tokens, all HTTP 200 with no retries.
Create reached revision 13, first review corrected to revision 19, and final
visual/structural review still returned `revise`; outcome bounded-incomplete.
Revision 19 survived reload, no key was stored in browser storage, and there
were no page/console errors. Sanitized shape counts show five lathe, five cone,
and five cylinder parts. Astra inspected the private final image: all five
blue fruit are now visible with green caps/stems, an improvement over the
occluded previous run, but they look round rather than strawberry-shaped and
some appear detached. Evidence:
`docs/evidence/authoring-review/openrouter-blue-strawberry-visibility-20260924/`.
The isolated server and database were removed. Production authoring review
remains off; do not treat visibility improvement as full visual acceptance.

Sep 24 handoff after the latest quality diagnosis: commit `bc3ee65` adjusts
creation/review guidance to keep plural attached details recognizable from the
starting play view. It specifically tells the first review to move existing
obscured instances toward the visible side instead of shrinking them into
invisibility. The 45 focused prompt/review tests and formatting checks pass.
This latest wording has **not** had a new live provider run or deployment;
avoid claiming it fixed quality. The prior bounded run below proved that
lathe use was already working while visibility remained poor. Next meaningful
acceptance is one bounded live visual review after improving visibility
feedback/correction, followed by the production feature-flag decision. A
read-only Vercel AI Gateway credit request returned HTTP 200 and the same
negative balance `-0.0033684`, with zero model calls; paid Gateway inference
remains withheld. Computer-use still exposes no owner Chrome browser surface,
and live ChatGPT account grant remains unverified. The owner was asked to
complete a fresh ChatGPT connection in their own Orbsie browser and report
the resulting state.

Sep 24 post-proportion OpenRouter quality acceptance: an isolated local app
with fresh PostgreSQL used exactly three `openai/gpt-6-luna` default-tier calls
at 4,096 output tokens, without retries. Create, review, and final review all
returned HTTP 200. Initial revision 13 was corrected to revision 19; final
review still said `revise`, so acceptance is bounded-incomplete. Revision 19
survived reload and no key was stored in the browser. The new aggregate
telemetry confirms five lathe parts among 25 custom parts and shows their
declared scale-factor bins all moved from `halfToOne` to `belowHalf` at first
review. Astra inspected the private final image: most blue fruit is obscured
behind the canopy, with only a tiny visible fruit. Shape selection works;
placement, visibility, and one-pass correction quality remain open. Evidence:
`docs/evidence/authoring-review/openrouter-blue-strawberry-proportion-20260924/`.
The isolated server and database were removed; no live publication occurred.

Sep 24 proportion guidance and live telemetry: creation and visual review now
explicitly compare attached details to their supporting object and tell the
first review to resize or reshape disproportionate forms. The 45 related
focused tests and local production build passed. Astra reviewed and committed
Luna's sanitized live-harness shape/scale histograms; six targeted tests,
syntax, formatting, and diff checks passed. The telemetry is capped aggregate
evidence only, not actual world-space mesh dimensions.

Sep 24 ChatGPT failure-feedback release: Vercel deployed source commit
`115830b` to `https://orbsie.com/` (deployment
`https://orbsie-k5pb3tvfo-grappeggias-projects.vercel.app`). The read-only
production smoke passed: root 200, protected generation route 401, matching
player/worker hashes, visible browser canvas, no page errors or writes. Astra
inspected the landing screenshot. A production synthetic failed-completion
browser scenario also passed and exercised its retry action with two mocked
starts and zero external requests. Evidence:
`docs/evidence/production-release-20260924-chatgpt-feedback/`. This is not a
live ChatGPT grant or generation acceptance.

Sep 24 ChatGPT failure feedback: the failed device-login completion now carries
only a bounded, allowlisted failure category through the local session and
public route. The connection dialog shows a visible retry action and specific
guidance when the host reports disabled device-code sign-in; unrecognized raw
host errors stay private. Astra reviewed the Luna diff and browser fixture.
The 61 focused tests and production build passed. All 13 synthetic connection
scenarios passed in a local production browser run, including signed-out
anonymous connection, failed completion/retry, stale connection, mobile, and
logout paths; Astra inspected the failure screenshot. Evidence:
`docs/evidence/chatgpt-failure-feedback-20260924/`. This verifies failure
handling only. The prior live device attempt failed before a grant, and the
actual host failure reason remains unknown; no ChatGPT inference acceptance
has occurred.

Sep 24 lathe release promotion: Vercel deployment
`https://orbsie-7263rj9n6-grappeggias-projects.vercel.app` built and was
aliased to `https://orbsie.com/`. Read-only desktop release smoke passed with
root200, protected route401, no browser errors or writes, and deployed player
and geometry-worker hashes matching the local build. Astra inspected the
desktop landing screenshot. Android 15 emulator Chrome visual check also
passed on production: software renderer ready, 19,693 sampled visible planet
pixels, no page errors, blocked requests or horizontal overflow. Astra
inspected that screenshot. Evidence:
`docs/evidence/production-release-20260924-lathe/` and
`docs/evidence/android-production-landing-20260924/lathe-release/`. These
smokes do not establish live model quality, physical-device gameplay or fresh
publication acceptance.

Sep 24 ChatGPT local grant retry: with a separate ephemeral PostgreSQL
database, local optimized app and private browser session, anonymous provider
session creation and `/api/chatgpt/start` returned HTTP 200. A fresh OpenAI
device URL/code was shown to the owner. Before its stated expiry, host status
changed from pending/disconnected to failed/disconnected; the route exposed no
failure reason. No grant or ChatGPT inference occurred. The attempt was
cancelled (HTTP 200), and the local server, database, watcher, temporary env
file and private browser state were removed. Do not reuse that code. Further
work needs to diagnose the early host failure or start a fresh coordinated
challenge; the prior attempt does not prove direct subscription OAuth.

Sep 24 post-lathe OpenRouter quality acceptance: one fresh isolated local run
used exactly three Luna default-tier calls at 4,096 output tokens, with no
retries. Create, review, and final review all returned HTTP 200. Review bound
revision 11 to 17; final review of revision 17 still said revise, so outcome
is bounded-incomplete. Five ready entities had 20 custom parts, including four
blue. Reload recovered revision 17. Astra inspected the private scene capture:
two oversized smooth blue forms hang below a tree-like green form, without a
clear strawberry silhouette or small details. The shape histogram was not
captured, so actual lathe use is unknown. This is a model composition/scale
quality failure despite the working geometry capability. Evidence:
`docs/evidence/authoring-review/openrouter-blue-strawberry-lathe-20260924/`.

Sep 24 bounded lathe geometry integrated: custom parts can now carry a
finite, bounded [radius,height] profile revolved around Y. Existing part
shapes remain supported, and the schema rejects profiles on them. Generation
and first/final review guidance now emphasizes distinctive silhouettes over
color alone, and describes when to use a colored lathe part. Astra reviewed the
Luna diff; 74 focused tests, typecheck, formatting, and optimized production
build passed. The synthetic revision-bound capture passed in WebGL and forced
software rendering with tapered blue fruit still visible after an unrelated
catalog replacement; Astra inspected both renderers. No live model calls.
Evidence: `docs/evidence/scene-review-capture-lathe-20260924/`. The capture
shows stylized pointed blue fruit, but live model selection and detailed
strawberry quality remain to be validated with a new bounded provider run.

Sep 24 OpenRouter blue-strawberry structure acceptance: one isolated local
authoring-review run used exactly three Luna default-tier calls at 4,096 output
tokens each, all HTTP 200 with no retries. The initial saved revision 9 had
four ready entities and 12 custom parts (six blue); review revised to revision
13 with 21 parts (12 blue), recovered after reload. Final visual+structural
review still said revise; outcome bounded-incomplete. Astra inspected the
private scene capture: blue fruit is present but spherical, reading as
blueberries rather than strawberries. A generic colored lathe part is being
implemented to give the authoring model a useful tapered silhouette. Sanitized
evidence: `docs/evidence/authoring-review/openrouter-blue-strawberry-structure-20260924/`.
No key or private screenshot is in the repo.

Sep 24 Android production landscape landing check: on Android 15 emulator
Chrome at 866x308 landscape, the software renderer reached ready and the
planet/composer remained visible and within the viewport, without horizontal
overflow, page errors or blocked requests. Astra inspected the screenshot.
Evidence: `docs/evidence/android-production-landing-20260924/landscape/`.
This is landing-only emulator evidence, not full landscape or physical-device
gameplay acceptance.

Sep 24 existing-publication mobile check: an older signed-out published Orb
loads its controls but has a blank world on Android Emulator SwiftShader; its
immutable artifact predates the fix. The same public project/index data served
locally with the current committed player runtime rendered the island and
controls through compatibility graphics, ready with no page errors/blocked
requests/overflow. Astra inspected both screenshots. Evidence:
`docs/evidence/android-published-replay-20260924/`. Fresh publication of the
fixed runtime remains unverified pending the publication approval; old
artifacts would need a separately authorized republish/migration to improve.
The current standalone player also passed the Android 15 touch/gameplay
fixture with software rendering enforced: score reached 7, restart, win and
loss paths passed, no cookies or external/model requests, and test resources
were removed. Evidence: `docs/evidence/android-current-artifact/` (rerun at
2026-09-24T09:36Z). This is emulator evidence, not a physical-device gate.

Sep 24 Android fallback production promotion: local and Vercel optimized
builds passed, and deployment
`https://orbsie-r62i23137-grappeggias-projects.vercel.app` was aliased to
`https://orbsie.com/`. The Android 15 emulator Chrome visual verifier passed
against production: software renderer ready, 19,688 sampled planet pixels,
no page errors, blocked requests or horizontal overflow. Astra inspected the
live screenshot; the planet is visible. Desktop read-only release smoke also
passed and Astra inspected its WebGL landing; deployed player and geometry
worker hashes match the local build. Evidence:
`docs/evidence/android-production-landing-20260924/production-after-fix/`
and `docs/evidence/production-release-20260924-android-fallback/`. This
closes the emulator landing defect, not the physical-device/mobile E2E gate.

Sep 24 ChatGPT local challenge: `POST /api/provider-session` and
`POST /api/chatgpt/start` both succeeded under a matching local auth origin.
The fresh device URL/code was shown to the owner, but no authorization
completed during the 180-second browser watch. No generation call was made.
A fresh device challenge is needed only when the owner is ready to authorize
promptly; the old code must not be reused.

Sep 24 Android renderer correction, local acceptance: a known Android Emulator
Google SwiftShader WebGL2 renderer now routes to the existing Canvas2D scene
before R3F mounts. This avoids a browser page error and preserves WebGL for
other renderer names. The Android 15 emulator visual verifier passed against
the local app: software renderer ready, 19,692 planet pixels in the sampled
region, no page errors, blocked requests or horizontal overflow. Astra
inspected the screenshot; the planet is clear behind the composer. A desktop
SwiftShader browser still selected WebGL and reached ready with no page errors.
Focused detection tests and typecheck passed. The visual verifier correctly
failed production before the fix with zero planet pixels. Production build,
deployment and repeat Android production check remain pending. Evidence:
`docs/evidence/android-production-landing-20260924/local-after-fix/`.

Sep 24 live-review observability: the bounded OpenRouter authoring-review
verifier now records stage, geometry-kind, procedural-part, and coarse color
counts for the initial and final saved revisions. The report excludes raw
colors, labels, prompts, object IDs and positions; counts are capped at the
scene schema limits. Astra reviewed the Luna diff; six focused tests,
typecheck, syntax, formatting and diff checks passed. No model calls were
made. A fresh bounded OpenRouter run is still needed to distinguish absent
fruit geometry from geometry that renders too small or out of view.

Sep 24 Android production landing diagnostic: Android 15 emulator Chrome
renders the production composer but the WebGL planet is absent even after
20 seconds. The page reports graphics ready, produces draw calls, and the
WebGL framebuffer contains planet color, but Android's displayed canvas is
blank. The same browser visibly renders the planet when forced onto Orbsie's
Canvas2D fallback. The WebGL renderer identifies as Android Emulator Google
SwiftShader. The original DOM-only smoke report was a false pass; visual
mobile acceptance remains open while a specific fallback fix is tested.
Evidence: `docs/evidence/android-production-landing-20260924/`.

Sep 24 procedural-parts production promotion: after the shared geometry fix,
full Vitest passed 1,717 tests (26 skipped) and the local/Vercel production
builds passed. Commit `8651a9c` refreshed the standalone player bundle. The
Vercel deployment at
`https://orbsie-80yqr4yev-grappeggias-projects.vercel.app` was aliased to
`https://orbsie.com/`. Signed-out read-only smoke passed: landing canvas and
composer visible, root200, protected endpoint401, no browser errors/writes or
external requests; deployed player and geometry worker hashes matched the
local build. The screenshot was visually inspected. `/api/config` still says
`authoringReview:false`, with hosted ChatGPT and generation enabled. Evidence:
`docs/evidence/production-release-20260924-procedural-parts/`. The live domain
serves the renderer fix, but no new provider-backed scene or public game was
created by this smoke.

Sep 24 rendered procedural-part acceptance: the zero-provider revision-bound
scene-capture fixture now builds a procedural `tree` with three blue fruit
parts and checks actual PNG pixels in both WebGL and forced Canvas2D before
and after an unrelated object's catalog replacement. It passed with no model
calls or external requests; both renderers kept the fruits visible. Astra
inspected all four scene captures: WebGL shows distinct blue spheres on the
front canopy; Canvas2D also shows them, though its initial framing makes the
tree small (224 blue pixels versus 932 in WebGL at 512px capture width).
Software catalog readiness reports only catalog assets, so the fixture now
asserts that renderer-specific contract. Evidence:
`docs/evidence/scene-review-capture-procedural-parts-20260924/`. Syntax,
formatting, and diff checks passed. This proves the fixed rendering path, but
the previous live OpenRouter project was removed; it does not establish whether
the model supplied `parts` in that run. Next: capture private scene structure
and an object-focused review view during one bounded live test; inspect whether
requested details are absent, tiny, or occluded before changing the loop.

Sep 24 procedural attachment fix: the scene schema had allowed `parts` on
built-in procedural kinds, but the shared geometry builder silently rendered
parts only when `kind:custom`. Built-in bases now retain their geometry and
append optional parts once, so a tree can carry colored fruit or other
requested details in the same object. The shared builder is used by WebGL,
Canvas2D and standalone playback. The generator guidance now exposes this
capability to the model. Astra reviewed the diff and adjusted the test fruit
position to touch the canopy; 29 focused geometry/prompt tests, typecheck,
formatting and diff checks passed. This is a concrete rendering-contract fix,
but the earlier live scene was not retained, so it does **not** prove that
ignored `parts` caused that run's missing blue fruit or that a fresh model run
will now be delightful. Next: zero-provider rendered WebGL/Canvas2D fixture for
built-in parts, then a bounded fresh provider quality test at a milestone.

Sep 24 production promotion: the accumulated branch through `e039b21` passed
the full Vitest suite (1,715 passed, 26 skipped) and an isolated production
build. Vercel production deployment at
`https://orbsie-n30t1nvrg-grappeggias-projects.vercel.app` completed and was
aliased to `https://orbsie.com/`. A signed-out, read-only production browser
smoke passed: landing canvas/composer visible, root 200, protected
generation-runs endpoint 401, no page errors, writes, or external requests.
The deployed player runtime and all geometry worker bytes match the current
local build; the landing screenshot was inspected. `/api/config` reports
accounts/publishing and hosted ChatGPT enabled, with `authoringReview:false`.
Evidence: `docs/evidence/production-release-20260924-review-off/`. This is
release health, not live ChatGPT/Gateway or new-publication acceptance. The
local build refreshed tracked player runtime/source snapshots because the
software renderer diagnostics changed; those generated files are committed
with this checkpoint and match the deployed runtime bytes.

Sep 24 OpenRouter live review after exact-origin preflight: isolated production
build and migrated DB passed; zero-inference malformed-JSON preflight returned
HTTP 400. One fresh `openai/gpt-6-luna` default-tier run used exactly three
calls at a 4,096-output-token cap, all HTTP 200 with no retry. Visual+structural
review revised initial revision 11 to revision 17; final review inspected
revision 17 with the same binding digest and returned `revise`. Revision 17
survived reload, the key was absent from browser storage, and no external
requests were blocked. The private scene-only capture was inspected and
removed: a rounded green canopy and brown trunk were visible, but no blue
strawberries were discernible at play scale. Thus the new prompt guidance has
**not** achieved subject-feature quality acceptance. Evidence:
`docs/evidence/authoring-review/openrouter-blue-strawberry-origin-preflight-20260924/`.
Next: collect bounded scene-structure/visibility evidence and improve the
correction loop or modeling recipe, not another prompt-only tweak. Production
authoring review remains disabled pending acceptance. The run's first build
caught a test-only TypeScript mock error; Astra corrected it (`0ee1129`), then
typecheck, focused tests, and the isolated production build passed. No further
live retry was made.

Sep 24 live-review origin preflight: before the browser can submit a model
request, the focused OpenRouter harness now sends malformed JSON from the exact
configured loopback Origin to `/api/generate` and requires the route's parser
HTTP 400. It never sends a key or prompt, cannot reach inference, does not
enter the three-call ledger, and rejects mismatched/rejected origins explicitly.
The preflight response body is not recorded. Astra reviewed the bounded change;
three focused tests, syntax, formatting, and diff checks passed. This is a
harness fix, not a successful rerun. Next: verify loopback `BETTER_AUTH_URL`
matches `ORBSIE_TEST_URL`, then run a fresh bounded OpenRouter quality test.

Sep 24 OpenRouter quality rerun after guidance change: isolated production
build/migration and model catalog preflight passed, but the browser's first
create request returned HTTP 403 before any scene revision. The harness
observed one create-route request and no review/final-review calls or retry;
upstream inference/billing is unverified. The sanitized diagnostic said
`transport-error`/unknown, not a classified provider rejection. A separate
read-only OpenRouter `/api/v1/key` request returned 200 for the local key. In
source, the route's `checkOrigin` throws an HTTP 403 before provider setup when
`Origin` differs from `BETTER_AUTH_URL`, while an upstream provider 403 becomes
a `GenerationProviderError`; therefore a loopback origin mismatch is the
leading **inference**, not yet proven. Evidence:
`docs/evidence/authoring-review/openrouter-blue-strawberry-rerun-20260924/`.
Next: add a zero-inference origin preflight to the harness, verify the local
app origin is configured consistently, and only then schedule a new bounded
live quality test. The prompt change has no fresh visual acceptance evidence.

Sep 24 blue-strawberry quality follow-up: generation and review guidance now
prioritizes defining silhouette, relative scale, visible attachment/support,
and unobscured requested features. When a catalog piece cannot express a
defining feature, the model should add custom/procedural geometry while
retaining suitable catalog pieces. The first review prioritizes root geometry
and visibility corrections; final review requires remaining core defects to
be reported rather than accepted. Astra reviewed the bounded diff; 45 focused
tests, typecheck, formatting, and diff checks passed. This is prompt guidance,
not a demonstrated quality fix. Next: one fresh bounded OpenRouter
create/review/final-review run, at most three Luna calls with 4,096 output
tokens each and no retry; inspect scene quality and revision persistence.

Sep 24 fresh OpenRouter blue-strawberry review: an isolated production app and
migrated database ran exactly three live `openai/gpt-6-luna` calls at default
service tier and 4,096 output tokens each. Initial creation saved revision 13;
visual+structural review revised it to revision 20, then final review examined
revision 20 with the same binding digest and returned `revise`. The quality
outcome is **bounded-incomplete**. A private scene-only capture showed a simple
aqua conical tree with blue fruit and green tops, so the recent subject-detail
prompt guidance has not established delightful output. The harness recorded
`failed` because an old fixed activity-text assertion rejected the new
remaining-issue message before reload verification. The browser local snapshot
contained revision 20, but reload persistence was not checked. Astra corrected
the harness to recognize the fixed partial-review prefix as a boolean without
recording the model's issue text; syntax, formatting and diff checks passed.
Sanitized evidence: `docs/evidence/authoring-review/openrouter-blue-strawberry-20260924/`.
No retry was made. Next: improve the generator/correction design using this
quality failure, then run a fresh bounded live review; do not claim acceptance
from this run.

Sep 24 Canvas2D fresh-gameplay stall diagnosis: two valid isolated software
fixture runs reproduced `no-fresh-observation` during the creation-phase first
platform approach. An opt-in component snapshot showed a mounted, visible,
focused page, active Play state, scheduled RAF and no renderer exception; the
second run measured a 1,133 ms RAF scheduling gap while the preceding frame
took 7.4 ms and its slowest draw took 24.6 ms. A separate 538 ms browser long
task occurred earlier and does not explain the final gap. Source and fixture
now expose bounded, opt-in boundary diagnostics; no timeout or gameplay change
was made because the scheduling cause remains unknown. Evidence:
`docs/evidence/fresh-gameplay-software-stall-diagnostic-20260924/`. Focused
software/gameplay tests passed 39/39, along with typecheck, syntax, and diff
checks. No provider calls ran. Next: capture browser scheduler/tracing evidence
or test the same lane on a different browser/device before changing the
freshness policy. Canvas2D seven/Undo gameplay is still unaccepted.

Sep 24 second local ChatGPT grant attempt: the owner offered to receive the
URL/code in chat, and a fresh isolated local production app, in-memory
PostgreSQL database, private Orbsie browser session, and Vercel-hosted runtime
issued one real OpenAI challenge. The verification URL/code were sent promptly,
but the challenge expired without Orbsie observing a grant. The two-call
Luna-only create/edit harness did not run and there were **zero model calls**.
The pending host was cancelled (HTTP 200), local app/database stopped, private
browser state removed, and ports 3159/35432 cleared. No code remains active.
The owner can request a new code when ready to approve it within ten minutes;
direct Orbsie HTTPS subscription OAuth remains unproven.

Sep 24 fresh flagship gameplay depth: the browser runner now resolves targets
from each saved revision and, for fresh worlds, requires real input traversal,
collection, portal win and reset after the seven-crystal edit and again after
UI Undo restores five crystals. Checkpoint-resume mode remains explicitly
structural-only. The deterministic zero-provider WebGL fixture completed all
three phases on one project (revisions 22, 31, 32; scores 5, 7, 5), and a
separate five-crystal run passed with the original platform spacing. The full
fixture used a shorter B-to-C gap and still required moving/bounce platform
contacts. Canvas2D failed during the creation-phase platform-B approach with
`no-fresh-observation`; its seven/Undo lanes were **not run**. Evidence:
`docs/evidence/fresh-flagship-gameplay-five-seven-undo-20260924/report.json`.
Astra removed formatting-only diff churn, preserved the seeded-mode HUD/Play
transition, reviewed the final change, and verified 82 focused tests,
typecheck, syntax, and `git diff --check`. No provider calls ran. Next: diagnose
the software observation stall, then run the fresh live story at a bounded
provider milestone; do not describe Canvas2D or live provider gameplay as
accepted yet.

Sep 24 fresh ChatGPT grant attempt after the continuation change: an isolated
Docker PostgreSQL database, local production app, and private browser session
issued a real OpenAI device-code challenge. The URL/code were shown to the
owner in chat, but the challenge expired without a grant. No ChatGPT inference
ran. The local two-call Luna/standard-tier harness passed its no-model
preflight only. The isolated ChatGPT host logout returned HTTP 200, the Vercel
Sandbox list shows the project hosts stopped, the local app/database were
stopped, and the temporary private environment/browser-state files removed.
No fresh code remains active. Browser computer use still listed no Chrome
surfaces. A new challenge requires a coordinated owner action and separate
live acceptance run; direct-return subscription OAuth remains unproven.

Sep 24 partial-review continuation: final `revise` results now put a concrete,
bounded finding into the parent conversation, save it when message capacity
allows, and offer an explicit button that drafts a follow-up prompt without
starting another model call. The action is tied to the saved project revision
and clears on a new run or project/revision change. The earlier review finding
is also saved before a correction journal segment begins. A production-browser
fixture caught two integration issues: a forming mesh settled just after the
five-second capture deadline, and generic suggestion CSS hid the follow-up
button. Review capture now waits up to ten seconds and the action has its own
visible desktop/phone styling. Focused store tests passed 12/12, typecheck and
production build passed. The deterministic production-browser review fixture
passed WebGL, software, partial-final-review, and signed-in journal scenarios
with zero live model calls; the 390px phone screenshot was inspected. Evidence:
`docs/evidence/authoring-review/partial-continuation-r3-20260924/`.
This does not establish live provider quality or physical Android performance.

Sep 24 hosted ChatGPT local acceptance preparation: with an isolated local
PostgreSQL database and production build, the browser created a transparent
private Orbsie session and obtained a real OpenAI device-code challenge. The
owner was given the verification URL/code in the live conversation. The code
expired without a completed grant; **no ChatGPT model call** occurred. The
isolated Vercel Sandbox host was explicitly deleted, local Next server and
database stopped, and temporary database credentials removed. Computer-use
still enumerated no Chrome browser surfaces. Luna prepared a two-call,
Luna-only, opt-in local hosted create/edit browser acceptance harness
(`30b1a46`); Astra reviewed its route guard and removed raw browser/console
message persistence. Syntax, formatting, opt-in refusal, and no-model preflight
passed. It has not run end to end and needs a fresh user-approved device grant
and private browser storage state. This interim code flow does not satisfy the
direct Orbsie HTTPS subscription OAuth requirement.

Sep 24 visual-quality follow-up: Astra reviewed Luna's small generation-guidance
change (`84740ff`) to prioritize a subject's defining silhouette, attached
forms, proportions, and requested colors at play-camera scale. Focused prompt
tests passed 20/20 and typecheck passed. This was prompted by the live blue
strawberry-tree scene's simplistic blue spherical crown and pink faceted
mushroom; it is a prompt-level improvement only and has **not** yet been
validated with a fresh provider call or shown to resolve the final `revise`
verdict.

Sep 24 follow-up OpenRouter review: a new three-call isolated browser run
completed without HTTP error after adding allowlisted review failure kinds
(`d2ae11c`; targeted tests 10/10, typecheck and production build passed).
The first visual+structural review corrected revision 14 to revision 16; the
final review checked that exact corrected revision and returned `revise`, so
acceptance remains **bounded-incomplete**. Revision 16 survived reload, the
provider key was absent from browser storage, and no external browser request
was allowed. The private screenshot was visually inspected; the shapes are
simple and the model identified a remaining issue. Sanitized report:
`docs/evidence/authoring-review/openrouter-live-3call-diagnostic-20260924/`.
The earlier 502 did not reproduce, so its exact cause remains unknown. The
old private scene capture included composited UI despite being called a canvas
screenshot; the harness now temporarily hides overlays and a no-model-call
browser check confirmed a scene-only image and restored composer. Do not use
the older private screenshot as privacy-isolated canvas evidence.

Sep 24 live OpenRouter authoring review: a new bounded three-call harness
(`0eeb1de`) ran against an isolated local production app/database with
`openai/gpt-6-luna`, standard processing and a 4,096-output-token ceiling.
Generation committed revision 15; the first visual+structural review requested
a correction and bound revision 17. The browser sent a final review for that
exact project/revision/run, but the route returned HTTP 502 after 6.7 seconds.
There were exactly three live calls and no retry. This is a failed/incomplete
acceptance, not an accept verdict. The sanitized report is in
`docs/evidence/authoring-review/openrouter-live-3call-20260924/`. Existing
terminal logs do not distinguish provider rejection from malformed response or
semantic validation; a bounded diagnostic improvement is in progress. The
failure path did not verify revision-17 reload persistence. The harness now
captures sanitized post-failure scene evidence on future runs (`bcba3ea`).

Sep 24 Android current-artifact acceptance: `scripts/verify-android-current-artifact.mjs`
repacked the pinned Gateway-generated revision-9 ZIP with the current local
runtime/CSS and both geometry workers, served it on loopback through ADB reverse,
and drove actual Android 15 emulator Chrome by CDP with WebGL forced unavailable.
The standalone game reached Canvas2D readiness with both generated objects
visible; touch Right scored 7, Restart reset, Forward won, Restart reset, and
Left lost. There were zero provider/generation/external requests, failed
responses, unexpected page errors, cookies, or viewport overflows. Four
screenshots were inspected; the simple software silhouettes and large optional
graphics advice are visible but do not obscure the score or controls. Report
and screenshots: `docs/evidence/android-current-artifact/`. This proves a
repacked **local** artifact on an emulator, not a newly published current-runtime
URL or physical-device quality. A read-only Sep 24 Gateway credit check again
returned -0.0033684, so paid Gateway inference remains withheld. Current
OpenAI App Server docs still show a localhost browser callback or a code-based
device flow; the requested direct Orbsie HTTPS subscription OAuth grant remains
unverified (see `docs/chatgpt-subscription-oauth-feasibility-20260922.md`).

Sep 24 fresh provider-artifact publication acceptance prepared: the saved
Gateway-generated revision-9 ZIP is pinned by canonical digest and its two
generated GLB hashes. `scripts/verify-provider-artifact-publication.mjs`
passes offline preflight and gates production execution behind
`ORBSIE_LIVE_E2E=1`, an exact `https://orbsie.com` origin, and an explicit
evidence directory. A live run will create one private test account, upload
the saved models, cloud-save the copied game under a fresh project ID,
publish it, and verify exact snapshot/runtime/model/manifest bytes plus
signed-out desktop and touch gameplay. `scripts/verify-android-gateway-publication.mjs`
is ready to check the resulting URL in Android 15 emulator Chrome with the
software renderer. The old published runtime failed this emulator preflight;
that result is not a test of the current runtime. No live publication has yet
run: account creation and public publication approval is pending. Browser
computer-use still exposes no Chrome surfaces, Gateway credit remains below
zero, and OpenRouter's two-call review run remains bounded-incomplete.

Sep 23 production promotion: Vercel production deployment
`dpl_7rrUPQyL4DE8RLTZw2WKWaQaxY5n` built Ready from the camera-framing
release and was promoted to `https://orbsie.com/`. Domain inspection resolves
to that deployment. The signed-out read-only browser smoke passed: landing
canvas and composer visible, root200, generation-runs unauthorized401, no page
errors, non-GET requests or external requests. Player runtime and five
geometry-worker hashes match local build bytes. `/api/config` retains
`chatgptHosted:true`, `chatgptGeneration:true`, accounts/publishing true and
`authoringReview:false`. Evidence:
`docs/evidence/production-release-20260923-auto-frame/`. No live model call,
signed-in ChatGPT consent or fresh publication was part of this release check.

Sep 23 initial-world camera integration: `dd9bc59` auto-frames committed
bounds once after a new landing-page build succeeds, using the shared
WebGL/software navigation command. Manual navigation, project changes,
playing, errors/recovery and later edits cancel or bypass that candidate.
The far-world deterministic browser journey passed in both Chromium
SwiftShader and forced Canvas2D: an object at 12 km appeared automatically
(5,591 and 48,849 centered teal pixels), then a manual zoom-out and Frame
restored it. Targeted edit, Play, reload, ZIP export and independent standalone
playback also passed in each lane with zero provider/external calls. Focused
navigation tests 21/21, typecheck and production build passed. Evidence:
`docs/evidence/far-world-browser/auto-frame-20260923-r2/`. The first harness
attempt used a disallowed `127.0.0.1` dev origin and stopped before canvas;
the passing rerun used `localhost`. Evidence reports pre-commit HEAD `5316714`;
the tested diff was committed unchanged as `dd9bc59`. Visual camera movement
can snap if a build completes after descent; smooth interpolation and review-
capture framing remain open. The change is now deployed as noted above.

Sep 23 second live OpenRouter authoring-review milestone: an isolated local
production server and fresh PostgreSQL database ran `openai/gpt-6-luna` with
standard processing, a 4,096-output-token ceiling, and exactly two permitted
calls. The first call committed project revision 18. A real revision-bound
visual-plus-structural review requested a correction; the browser applied it
and persisted revision 20. The third final-review request was blocked before
the server by the two-call guard. Reload recovered revision 20, the key was
not persisted in browser storage, and no external browser requests were made.
The run is explicitly bounded-incomplete, not a verified accept verdict.
Sanitized report: `docs/evidence/authoring-review/openrouter-live-accept-20260924/`.
The isolated test server and database were stopped after evidence capture.
A fresh Gateway read-only credits check still returned -0.0033684, so Gateway
inference remains withheld. Official OpenAI App Server docs rechecked this
turn still document a localhost browser callback and a device-code URL plus
code, with no proven hosted Orbsie subscription OAuth callback.

Sep 23 bounded software-landing performance probe: Luna measured five Canvas
gradient constructions and 16 color-stop calls per frame on the forced-software
Android 15 emulator at 412-by-786 CSS pixels. A temporary cache produced a
zero-difference frozen-frame image, but six-second frame-interval median
remained 33.4 ms and p95 varied from 66.8 to 83.3 ms. Callback median only
shifted from 0.8 to 0.7 ms. Astra accepted the no-change conclusion rather
than shipping an optimization without a reliable frame-time gain. The 21
targeted software-world tests passed; no new source or deployment resulted.

Sep 23 production release: local commit `0a28ae0` passed `npm run build`,
then Vercel deployment `dpl_2K6W21xkePP1Egkv9brNrbBEZFc4` built Ready in the
production environment and was promoted to `https://orbsie.com/`. Vercel
inspection resolves the domain to that deployment; the served player CSS SHA-256
matches the local build. A signed-out 390-by-844 production Chromium smoke with
WebGL deliberately disabled rendered the software planet and prompt composer,
with HTTP 200, zero generation requests, and only the expected failed-WebGL
initialization error. Evidence: `docs/evidence/production-release-20260923/`.
The same signed-out fallback also loaded in actual Android 15 emulator Chrome at
412-by-786 CSS pixels with a painted planet, prompt composer, and zero
generation requests; it remains emulator evidence, not physical-device proof.
A signed-out production mobile Connections check showed ChatGPT, OpenRouter,
Vercel AI Gateway and the three Quality/Balanced/Budget presets without an
Orbsie password. It did not start provider consent or inference.
This does not establish live provider create/edit, physical-device performance,
or publication acceptance. Production `/api/config` still reports
`authoringReview:false`; the three-call visual inspect/correct loop is not yet
enabled for users.

Sep 23 Android standalone current-player check: a previous real OpenRouter
world ZIP was locally repackaged with the current player build and loaded in
Android 15 midrange-emulator Chrome with WebGL forced unavailable. A 700 ms
Forward touch moved the player 2.79 world units; after release, movement
settled to zero within the following 500 ms. Jump raised the player 0.65
units. The software renderer stayed playable and made zero external requests.
The expected Three.js WebGL-context error appeared once during fallback.
The screenshot exposed compatibility advice overlapping the title and score.
The rebuilt player CSS now places the advice below the score in portrait and
above the controls in short landscape viewports, where the redundant footer
is hidden. Android DOM rectangles and screenshots show no overlap with the
header, score or controls in both orientations. The current-player touch
layout script passed portrait/landscape gameplay and synthetic safe-area
checks after this change. Evidence:
`docs/evidence/android-current-standalone-20260923/`. This is a local runtime
repackage, not a fresh provider export, public deployment, or physical-device
acceptance.

Sep 23 compact landscape advice: on short coarse-pointer landing viewports,
the compatibility-graphics banner now sits below the prompt composer and the
duplicate software-renderer status is hidden. The Android 15 emulator Chrome
production build at 866-by-308 CSS pixels showed the banner, composer and
topbar with no rectangle overlap; the gap below the composer was 4.95px.
Screenshot: `docs/evidence/android-software-landing-20260923/landing-android15-landscape-guidance-fixed.png`.
The fix does not address the emulator's WebGL compositor fault or prove a
physical phone's layout.

Sep 23 Android software-renderer resolution: phone-sized portrait and
landscape canvases now cap their 2D backing DPR at 1; larger canvases retain
the prior cap of 2. A local Android 15 emulator production-build check
observed a six-second settled median frame interval drop from ~50 ms to
~33.4 ms in both orientations with the planet still visible. The 95th
percentile remained ~83 ms in portrait and fell from ~100 ms to ~83 ms in
landscape, so frame pacing is still uneven. Evidence and both screenshots:
`docs/evidence/android-software-landing-20260923/`. The 866-by-308 landscape
capture exposed a separate overlap between graphics guidance and the composer;
the compact-landscape fix above resolved it. These measurements do not prove
physical-phone performance or automatic recovery from the emulator compositor
fault.

Sep 23 graphics failure acceptance: repaired the deterministic production-
browser script for the current parent-thread authoring activity messages and
added a direct software-canvas planet pixel check. The local production run
passed fallback visibility, fatal guidance, explicit retry/recovery, trial
preflight, active-generation cancellation and normal readiness with two
synthetic generation requests, zero live model calls, zero external requests
and zero unexpected page errors. Report:
`docs/evidence/webgl-failure-acceptance-20260923-r3/report.json`. A read-only
Vercel AI Gateway model-list request returned HTTP 200 with `openai/gpt-6-luna`
listed; that does not verify account credit or paid inference. Computer use
still enumerates no Chrome browser surfaces. The latest ChatGPT device
challenge expired without a grant.

Sep 23 software landing visual fix: the forced-WebGL-failure renderer now
draws a prominent planet, stars and dark sky during landing/descent rather
than a cream backdrop with a faint ellipse. The older workspace/play draw
path remains separate. Astra reviewed the Luna diff, corrected an initial
overpaint and reduced cached planet texture preparation to 256² samples.
`tests/software-world.test.ts` passed 21/21, typecheck and production build
passed, and an Android 15 emulator Chrome screenshot of the production build
confirmed the visible software planet at a 412-by-786 CSS viewport. See
`docs/evidence/android-software-landing-20260923/`. Physical Android, native
WebGL compositing and gameplay performance remain unverified.

Sep 23 Android graphics diagnosis: the current production build shows the
landing planet in desktop Chromium at the same 412-by-786 mobile viewport,
but Android 15 emulator Chrome shows only the page background and controls.
The emulator reports WebGL2 ready, issues thousands of draw calls with no
shader/link/GL errors, and `readPixels` finds planet-colored pixels in the
framebuffer. A separate minimal WebGL2 page cleared a canvas to red and read
back red `[255,0,0,255]`, yet the emulator screenshot remained blue (the CSS
page background) after settling. This isolates the observed blank screen to
that emulator's WebGL canvas compositing path; it does not establish a product
scene regression or physical Android behavior. Do not use this emulator's
WebGL screenshots as visual acceptance until its graphics backend is fixed or
replaced. The Orbsie software renderer remains available but was not a visual
match in this check. A fresh ChatGPT device challenge is pending owner grant;
do not record the one-time code here.

Sep 23 live authoring-review acceptance reached the first real review route on
an isolated local Postgres database and production build. The new
`scripts/verify-live-authoring-review.mjs` gates exact OpenRouter GPT-6 Luna,
default processing, a server/client 4,096-output-token ceiling and two total
live calls, blocks external browser traffic, and writes only allowlisted
sanitized evidence. A no-key browser preflight passed with zero model calls.
The first credentialed attempt failed before provider inference because the
local server inherited `VERCEL=1` from `.env.production.local` and therefore
expected a trusted Vercel forwarded-IP header; the server was restarted with
`VERCEL=0`. The corrected run made exactly two Luna calls: initial generation
committed revision 7, and a revision-bound visual+structural review returned a
targeted revise verdict. The browser applied the correction through revision
10, saved it, and recovered the same project/revision after reload. The third
final-review request was blocked before the server by the owner-approved
OpenRouter two-call cap; full review acceptance, Undo, gameplay, export and
publication are not established. Reports:
`docs/evidence/authoring-review/openrouter-live-create-20260923/` and
`openrouter-live-create-20260923-r2/`. Sanitized server events confirm distinct
request IDs and the review's admitted/revised terminal outcome. The direct
PostgreSQL review suite passed 14/14 after changing one stale GPT-5.6 fixture
to GPT-6 Luna (`050ca01`). Gateway still lacks credit. The fresh ChatGPT device
code expired without a grant, and browser computer use currently exposes no
Chrome tabs. Await owner guidance before raising the OpenRouter per-run cap.

Sep 23 far-world play start and camera accepted locally: an optional bounded
`game.spawn` supplies an explicit world-space player start for authored games;
legacy authored games without it keep the origin start. Rule-free worlds with
only distant ready content now start near the nearest resolved object, choosing
stable IDs on ties and preserving the origin when nearby or unresolved content
exists. WebGL and software Canvas share the same start on first Play entry,
project switch and reset. A temporary minimum Play camera distance keeps a
previously framed 600% editor view from clipping the world, without changing
the saved editor view. The standalone player was rebuilt. Astra reviewed and
returned empty-program, first-Play and multi-cluster gaps for correction.
`npm run build`, worker targeted tests/typecheck and the final deterministic
browser journey passed. Evidence:
`docs/evidence/far-world-browser/standalone-spawn-20260923-final/` (WebGL and
software Play/standalone visibility, edit/reload/ZIP, zero provider/external
requests); `standalone-origin-gap-20260923/` and
`standalone-spawn-20260923-r3/` retain the two observed pre-fix failures.
This does not prove live provider generation, authored far-game traversal,
physical mobile performance or fresh public deployment.

Sep 23 far-world deterministic browser acceptance: `scripts/verify-far-world-persistence.mjs`
ran against the local production build with fixture-intercepted generation in
Chromium SwiftShader WebGL and forced software Canvas. Each lane created a group
and entity at 12 km, framed the object with visible pixel evidence, edited its
geometry while preserving ID and coordinates, reloaded the local project,
exported a ZIP, and opened the same snapshot in an isolated standalone server
and browser context. Both passed with two fixture requests, zero model calls,
external requests or page errors. Evidence:
`docs/evidence/far-world-browser/acceptance-20260923-r6/`. Astra reviewed the
worker's first pass, required direct visibility assertions, calibrated them
against the actual WebGL and software screenshots, and reran the final script.
The published player starts at the origin, so this does not demonstrate a
playable 12 km traversal. Native GPU, growing-world memory/frame-time,
physical mobile and live provider far-world acceptance remain open. A fresh
read-only Gateway credit check still returned -0.0033684; no inference was run.
The owner-shared ChatGPT device code expired without a grant.

Sep 23 OpenRouter browser OAuth diagnosis: `Connect with OpenRouter` from
the local app navigated to OpenRouter's documented PKCE authorization route
with a localhost callback and S256 challenge. In the accessible Chrome profile,
OpenRouter's sign-in page showed “This action couldn't be completed” before
credentials were entered; a separate direct visit to its sign-in URL showed
the same message. The local PKCE and draft unit tests passed (12 tests).
The actual account grant/callback is therefore unverified; the prior API-key
live create/edit path is a separate passed milestone. No credentials or terms
were submitted during this diagnosis.

Sep 23 release visibility: the accessible GitHub Chrome tab is signed out and
shows remote `main` at `422e03b` (Sep 10). Local `main` is 617 commits ahead of
`origin/main` before this handoff. Current local features are therefore not
represented by that GitHub page; browser-based GitHub push/review and a fresh
deployment remain outstanding. A new ChatGPT device challenge was issued in a
separate local tab and its temporary code/official URL shared with the owner for
owner-entered consent; no grant or inference has been observed yet.

Sep 23 Android emulator touch-hold fix: the current OpenRouter standalone ZIP
loaded in Android 15 Chrome via loopback and displayed its movement controls.
A 700 ms hold moved the world but opened Chrome's text-selection toolbar on
the arrow. `src/player/player.css` and editor `src/app/globals.css` now suppress
selection/callout on touch buttons; the rebuilt player CSS candidate moved
without the toolbar on the same emulator. The old ZIP remained immutable.
`scripts/verify-player-touch-layout.mjs` passed portrait/landscape and
synthetic safe-area checks. Before/after screenshots are in
`docs/evidence/android-touch-hold-20260923/`. This is an emulator/CSS
candidate check, not a fresh export/publication or physical-device pass.

Sep 23 current-build OpenRouter live acceptance (`openrouter-post-residency`):
an isolated local production server with exact origin and 4,096-token ceiling
ran the standard two-call browser journey on `openai/gpt-6-luna`, low/default.
Both `/api/generate` calls returned HTTP 200; creation, selected material edit,
local recovery, export and standalone playback passed with no fallback,
external request or generation-budget violation. The harness checkout was
clean at `c1e8621`; the application source commit remained unrecorded in the
report, so this is not remotely attested deployment evidence. The captured
world has a structurally present island/tree/crystal but a small, sparse visual
composition. It does not satisfy delightful-asset, full flagship gameplay,
publication, or physical-mobile acceptance. Sanitized artifacts and the
exact-two-call report are in
`docs/evidence/provider-e2e/openrouter-post-residency/`. The isolated server
was stopped. During setup, a worker accidentally included the local test key
in a private tool result; it is absent from committed artifacts and was not
repeated. Owner should rotate that key when convenient.

Sep 23 renderer residency browser fixture accepted locally after Astra review:
`scripts/verify-formation-residency.mjs` drives an isolated 120-entity scene
through the actual WebGL World and software Canvas renderer. Chromium
SwiftShader observed 48 full formations/72 proxies after framing, after a
distant pan, and on reentry; offscreen selection retained one full formation.
The software path painted proxy markers at home, distant, and reentry and kept
its rendered revision settled. Desktop and 390×844 viewport screenshots and
bounded resource snapshots are in
`docs/evidence/formation-residency-browser/`. Astra tightened the harness so
unavailable WebGL, a missing capped state, page/console errors, or stale
software review state cannot report a pass. The rerun passed with zero model
calls or external requests, and TypeScript, syntax, and formatting checks pass.
These are SwiftShader/viewport observations, not native GPU, physical mobile,
or growing-world frame-time certification.

Sep 23 browser access and ChatGPT acceptance handoff: the owner's Chrome
extension surface is available again. A local production build is running at
`http://localhost:3001` with an explicit process-only
`BETTER_AUTH_URL=http://localhost:3001` override; `.env.production.local`
otherwise sets the public origin, so private-session POSTs from localhost are
correctly rejected. The browser created a private Orbsie session and received
a real ChatGPT device challenge. The existing Chrome profile recognized the
owner's ChatGPT account. The challenge expired without submission; final
authorization awaits browser-control confirmation for a new hosted Codex CLI
grant, then a fresh code must be issued. No ChatGPT inference or credential
export has occurred. The challenge/code is intentionally omitted from this
checkpoint. WebGL2 failed to initialize
in this Chrome profile, and the software Canvas fallback rendered. Local
browser integration, real ChatGPT create/edit, and representative GPU/mobile
acceptance remain open. The separate deterministic residency fixture was
completed and reviewed as noted above.

Sep 23 two-renderer formation residency integration accepted locally:
WebGL (`261f8c4`) and software Canvas (`a0e862a`) now cap completed ready
full visual resources through the shared policy while keeping cheap,
selectable proxies at resolved world bounds. Non-ready, pending replacements,
unknown-placement entities and current authoritative gameplay remain intact;
Canvas releases only owned clones and retains a proxy during lease reentry.
The worker's 44 focused Canvas tests, TypeScript, formatting and diff checks
passed; Astra reviewed the completed diff and fixed review/culling/per-face
issues during handoff. Integrated suite: 199 passed/6 skipped files, 1,693
passed/26 skipped tests. Next production build/TypeScript passed, standalone
player regenerated. These are deterministic checks: no browser memory/frame
times, Android/iOS physical-device checks, live provider create/edit, or fresh
signed-out publication acceptance has been established. Coarse proxy visuals
need design and mobile evaluation before release.

Sep 23 WebGL ready-formation residency accepted locally (`261f8c4`): after a
ready recipe has completed, Scene keeps at most the policy's 48 full visual
resources near/visible/selected and renders other completed entities as cheap
selectable world-space proxies. Unknown placement, forming, and new-recipe
objects stay on the full Formation path. Proxy selection promotes full detail;
same-recipe reentry uses completion hydration. Astra reviewed the worker diff
and corrected scene-review readiness for offscreen, collected, and game-hidden
proxies so they cannot strand a review. The worker's 36 targeted tests and
root's 23 focused tests, TypeScript, Prettier, and diff checks passed.
Integrated full suite, standalone player rebuild, browser visuals, memory,
frame time, and mobile acceptance remain open. Coarse boxes are only a proxy
approximation. Next slice: software renderer parity
(`docs/software-formation-residency-task.md`).

Sep 23 visual lease/gameplay authority accepted locally (`57ef4f4`): WebGL
tracks the recipe actually committed by each Formation rather than global
asset readiness, and both renderers keep metadata-backed ready collisions and
collection when a visual lease is absent. Pending targeted replacements use
the last displayed recipe until commit; generated jobs without bounds remain
provisional. Project-scoped display records and objective identity checks
prevent cross-project/stale-recipe leaks. Astra reviewed the diff, requested
per-entity and project-switch regressions, and accepted the corrections. Full
suite: 198 passed/6 skipped files, 1,676 passed/26 skipped tests; production
build/TypeScript passed and standalone player regenerated. Browser gameplay
and residency measurements remain open. Next bounded slice: a lightweight,
selectable ready-object proxy before Scene can evict full Formation resources.

Sep 23 completed-formation hydration accepted locally (`84f7479`): Scene
records only a ready, successfully loaded formation that actually reaches
progress 1; a same-recipe remount can show its final mesh without replaying
seed particles. Astra review caught a stale-resource race and required each
resource to carry its recipe identity before completion or review readiness
can advance. Records clear on project/entity/recipe change. Twelve targeted
tests, TypeScript, formatting and diff checks passed. No resource is evicted
yet; browser visuals remain unchecked. The current bounded worker slice
decouples committed collision metadata from visual lease readiness in both
renderers (`docs/visual-lease-gameplay-authority-task.md`).

Sep 23 pure ready-formation residency policy accepted locally (`85e7016`):
deterministic selection defaults to at most 48 full ready resources within a
256-unit focus radius plus 64-unit retention hysteresis, prioritizes selected
and visible IDs, and reports placeholders/reasons for other ready entities.
Non-ready formations remain outside the heavy-ready budget. Six focused tests,
TypeScript, formatting and diff checks passed; the selector is not wired to
renderers yet. The current bounded worker task preserves completed formation
presentation across an intentional same-recipe remount. Placeholder rendering,
asset lease release, collision readiness and scene-review integration remain
separate. Browser/mobile memory measurements remain open.

Sep 23 gameplay draw-culling parity accepted locally: software (`2ae0145`)
and WebGL (`9f45a28`) now skip offscreen rendering/picking using current
effective transforms and the player-follow camera while keeping complete
gameplay simulation and mounted formation state. The WebGL frustum updates
after the Player frame and before Formation callbacks, using renderer-local
camera and mesh matrices after origin rebasing. Forming, selected, unknown
and portal bounds remain conservative. Astra reviewed both diffs. Full
suite: 195 passed/6 skipped files, 1,657 passed/26 skipped tests; Next
production build/TypeScript passed and standalone player was regenerated
(`1c7eeed`). Browser draw-count/frame-time and mobile acceptance remain
unmeasured. Resource eviction is the next bounded requirement; visual asset
readiness currently influences collision fallback, so preserve game authority
while bounding memory (`docs/distant-formation-resource-task.md`). A pure
resident-ready selection policy is the current worker slice; renderer hooks,
placeholders, formation hydration and collision readiness are separate
integration steps.

Sep 23 software gameplay draw culling accepted locally (`2ae0145`): the
fallback renderer uses cached geometry-local bounds transformed by the
current runtime/game matrix and the player-follow camera frustum to skip
offscreen drawing and visual picks. Unknown or invalid bounds stay visible;
full simulation/contacts remain untouched. A game-program teleport becomes
visible without a project revision. Astra reviewed the diff; worker reported
14 focused tests, TypeScript, formatting and diff checks. Integrated build,
browser performance and visual behavior have not yet been checked for this
slice. WebGL gameplay draw culling is the current bounded worker task.

Sep 23 WebGL render-origin integration accepted locally (`c15f0ca`): settled
world content, player and terrain share a parent shifted by a stable quantized
origin, and the camera uses the matching local pose. Planet and transition
remain at zero until settled. Astra review fixed a light-coordinate mismatch:
the key light and target remain in the local visible frame rather than moving
another million units. Projection tests simulate Float32 positions at the
origin, 10km and both coordinate limits, including rebase continuity. Full
suite: 195 passed/6 skipped files, 1,651 passed/26 skipped tests; Next
production build/TypeScript passed and standalone player was regenerated
(`9870bcb`). Actual GPU shadow precision, browser visuals, Android frame
times and memory are unmeasured. Gameplay draw culling and distant formation
resource eviction remain open before release. Software gameplay draw culling is
the current bounded worker slice (`docs/gameplay-draw-culling-task.md`): skip
only rendering/picking work using effective current transforms; simulation
and contacts remain authoritative.

Sep 23 render-origin core accepted locally (`9374254`): a 1,024-unit
quantized origin with a 768-unit rebase threshold keeps camera-relative
positions small and avoids oscillation at cell midpoints. World/local and
camera-pose conversions reject invalid input without mutating authoritative
coordinates. Astra review found and corrected a midpoint thrash in the first
threshold. Five focused tests, TypeScript, formatting and diff checks passed.
`Math.fround` inspection showed a 0.1-unit offset at 1,000,000 world units
becoming 0.125, motivating the repair; this is not a GPU measurement.
WebGL scene integration is the current bounded worker task. Software Canvas
uses CPU double-precision projection and is not changed by this helper.

Sep 23 player-follow parity accepted locally: WebGL (`a74fef3`) and software
(`8f9ff03`) cameras now derive a temporary play view from the authoritative
player position while retaining saved editor heading/zoom. Both terrain
selections recenter on world-aligned 64m cells and conservative 4m height
buckets; software far clipping follows its active view. Stopping play returns
to the editor view, and map controls are hidden during play. Astra reviewed
both diffs. Full suite: 193 passed/6 skipped files, 1,642 passed/26 skipped
tests; Next production build/TypeScript passed and standalone player assets
were regenerated (`02194e3`). Browser visual, Android performance, precision
near coordinate limits, gameplay draw culling, memory eviction, provider E2E,
and deployment remain open. The next bounded rendering contract is in
`docs/gameplay-draw-culling-task.md`; resource and origin contracts are in the
adjacent task docs.

Sep 23 WebGL gameplay-follow slice accepted locally (`a74fef3`): a pure
temporary play navigation follows the authoritative player position while
retaining the saved editor heading/zoom. The WebGL camera uses the Player's
frame-priority -1 position without per-frame project writes, terrain refreshes
on world-aligned cell/height bucket changes, the far plane follows the active
view, and editor map controls are hidden during play. Astra reviewed the diff
and hid the disabled control cluster entirely; worker reported 29 targeted
tests, TypeScript, formatting and diff checks. This slice has not yet had the
integrated build or browser visual check. Software play-view parity is the
current bounded worker task; precision and resource eviction contracts are
recorded in `docs/render-origin-precision-task.md` and
`docs/distant-formation-resource-task.md`.

Sep 23 integrated render milestone accepted locally: WebGL settled-editing
formations are now frustum filtered without remounting (`2ebb664`), and the
software renderer clips entity polygons to the camera frustum before
projection (`f55f4d5`). Astra reviewed both diffs and focused tests. The
standalone player was rebuilt (`fed178c`). Full suite: 193 passed/6 skipped
files, 1,638 passed/26 skipped tests; Next production build and TypeScript
passed. No browser visual/mobile acceptance or deployment occurred. A bounded
player-follow contract is recorded in `docs/gameplay-camera-follow-task.md`;
that is the next slice. Geometry/asset memory eviction, distant-coordinate
precision, published playback and live provider acceptance remain open.

Sep 23 software visibility adapter accepted locally (`831afbc`): settled
editing caches world AABBs by project identity/revision and a visible-ID set by
camera/navigation/viewport, skipping offscreen `drawEntity` work. Gameplay
and transition paths remain uncullled because dynamic overrides must not
disappear. Picks and selected/portal markers now require finite centers inside
the viewport and camera depth range. Worker reported 14 targeted tests,
TypeScript, formatting and diff checks; Astra reviewed the cache and selection
gates. Software entity triangles still need near-plane clipping, and browser
visual behavior is unverified. WebGL draw culling is the current slice.

Sep 23 shared visibility core accepted locally (`9208cfd`): reusable keyed
world AABBs now include ready, coarse and seed entities through nested group
transforms, expand legacy moving entities by their root-space amplitude, and
retain unknown bounds as visible. A Three perspective-frustum selector keeps
invalid-bound entities rather than dropping authored content. Ready-only
frame-content behavior remains unchanged. Worker reported 22 targeted tests,
TypeScript, formatting and diff checks pass; Astra reviewed the far-coordinate
and motion semantics. The software editing-only draw/pick adapter is the
current slice; gameplay paths remain uncullable until dynamic overrides can
be included. WebGL adapter, precision and player follow remain open.

Sep 23 software open-ground slice accepted locally (`75bcec2`): after the
settled transition, the Canvas 2D renderer fills the view with the project's
ground color and clips its bounded world-aligned tile projections against the
camera frustum, preserving the landing gradient/ellipse. Root review removed
tile-by-tile tint seams and an unnecessary gradient allocation during editing;
software far clipping now follows the WebGL ground footprint. Focused tests
cover near-plane and offscreen tile projection. An unrelated but required
integration fix accepts finite distant structural review bounds near the new
world coordinates (`29806af`). Full suite: 190 passed/6 skipped files,
1,624 passed/26 skipped tests; production build/TypeScript pass and standalone
player was regenerated (`7d86397`). The fallback ground is intentionally a
flat solid color; its appearance variation and visual/mobile measurement are
still open. Entity culling, picking precision and gameplay camera follow are
next. This remains local, not deployed.

Sep 23 WebGL open-ground slice accepted locally (`b63b674`): the planet
descent keeps its small circular patch, then hides cylinder, water, pebbles
and contact shadows as a bounded 7×7 world-aligned tile neighborhood becomes
visible at flat y=0. Tile keys preserve overlapping geometry and root review
added explicit disposal for evicted geometry props after checking installed
R3F behavior. Camera far clipping covers the selected ground footprint. A
valid below-ground camera target now returns bounded selection rather than
throwing (`6522ea6`, 9 focused tests). Integrated suite: 190 passed/6 skipped
files, 1,621 passed/26 skipped tests; Next production build/TypeScript passed,
and independent player artifacts were regenerated (`a8b6d35`). No browser
visual seam or precision acceptance was possible here. Software ground and
entity culling are still open; do not deploy this partial renderer parity.

Sep 23 terrain chunk-selection core accepted locally (`435a158`): signed
world-aligned 64m base keys, power-of-two LOD, a bounded 7×7 selection sized
for the shared 43-degree/30-degree camera footprint including focus height,
and deterministic world-coordinate appearance at flat y=0. Root reviewed
negative-boundary, seam, revisit, 10km, coordinate-limit and max-zoom cases;
8 focused tests, TypeScript, formatting and diff checks passed. This is pure
selection, not rendered terrain. WebGL ground integration is the current
bounded task; software ground, visibility, precision and mobile measurements
follow. The disabled OrbitControls path was removed (`087a275`) after shared
gesture migration; TypeScript and formatting passed.

Sep 23 software gesture adapter accepted locally (`723ee55`): both renderers
now use the World-owned navigation controller/state, so fallback retains the
target, heading and zoom. Software pointer starts use current projected picks
to preserve entity selection; recognized drags/pinches suppress selection on
pointer-up. The software canvas scopes touch action and wheel handling to its
surface, and cancels gestures on blur/visibility/resize/unmount. Root reviewed
the diff. Integrated suite: 189 passed/6 skipped files, 1,612 passed/26
skipped tests; Next production build/TypeScript passed. Standalone player
artifacts were regenerated (`dcf1563`). Browser-level pointer timing, mobile
layout/gestures, and WebGL-to-software visual parity remain unverified because
the available browser control blocks Orbsie. This is still local and not
deployed. Next: ground/chunking, culling and precision slices, then real
browser/mobile and provider acceptance.

Sep 23 WebGL gesture adapter accepted locally (`32a0f18`): scene-surface
background drag pans, secondary drag rotates, wheel and touch pinch zoom;
entity-hit starts keep object interaction, and recognized navigation suppresses
selection clicks. Raycast picks the nearest visible relevant surface, touch
action is scoped to the scene canvas, and cancellation/resize/fallback reset
gesture state. Root review fixed a stale pointer-less click fallback and rapid
rotation reading an old React prop by using the live navigation state. Worker
reported 30 targeted tests, TypeScript, Prettier and diff checks pass. Pointer
timing remains untested in a browser. Software gesture input is the next task;
this is not deployable yet.

Sep 23 pure navigation gestures accepted locally (`2c9c1c3`): a renderer-neutral
controller emits pan, rotate, pinch and wheel commands from normalized pointer
inputs, tracks click suppression by pointer, defers object-hit starts, and
cleans up cancellation/blur/reset. Nine focused tests, TypeScript, formatting
and diff check passed. Astra reviewed the emitted coordinates against the
shared 30-degree camera elevation and heading contract. The WebGL adapter is
the current bounded worker task; software input integration and browser/mobile
acceptance follow. The contract assumes adapters supply CSS-pixel positions,
normalize wheel deltas, and exclude overlays/game controls.

Sep 23 empty-world frame-content correction: framing with no committed bounds
returns the default 24m camera distance at the origin, including on narrow
screens, instead of an arbitrary 20m workspace that pushed the camera far
away. The 15 focused navigation tests and formatting check pass (`9c801e9`).
Shared drag, pinch and wheel gestures remain in progress; no visual acceptance
or deployment is claimed.

Sep 23 shared navigation buttons accepted locally: one World-wrapper control
cluster serves WebGL, software fallback, editor and independent player. It
offers zoom in/out, a heading compass/north reset preserving target and zoom,
and frame content from committed ready-entity bounds. Bounds use actual local
geometry or checked-in catalog/generated metadata and nested world transforms;
tests cover distant groups, catalog assets and generated models. Root review
reset button readiness at WebGL fallback and removed an unnecessary landscape
chat-sheet resize. Full suite 188 passed/6 skipped files, 1,602 passed/26
skipped tests; production build/TypeScript and formatting pass, with regenerated
standalone player files. This remains local: mouse/wheel/touch gestures and
mobile/WebGL/software visual acceptance are not done, nor is streamed terrain.

Sep 22 navigation camera adapters accepted locally: the `World` wrapper owns
one project-scoped navigation state across WebGL-to-software fallback; both
renderers project the same target/heading/distance after the planet entrance
settles, reset on project change, and extend the far clip plane with distance.
Root review corrected transition start and end look targets to avoid visible
orientation jumps. The bundled independent player was regenerated from the
same sources. Full suite 188 passed/6 skipped files, 1,599 passed/26 skipped
tests; production build/TypeScript and formatting pass. This is not deployable
yet: OrbitControls are disabled until the shared buttons and pointer/trackpad
gestures replace them. Streamed terrain, precision and visual acceptance also
remain open.

Sep 22 shared-navigation core accepted locally: immutable commands now cover
world-space pan, zoom, clockwise heading from north (-Z), north reset retaining
target/distance, and frame-content from committed world-space bounds. Frame
distance accounts for portrait versus landscape aspect and vertical FOV. Root
reviewed the Luna diff and requested the viewport correction; 8 focused tests,
TypeScript and formatting pass. No renderer/UI adapter or gesture acceptance is
claimed. The next bounded slice is to wire this state into the shared `World`
wrapper and both renderers without crossing gameplay or object picking.

Sep 22 unbounded-world phase 1 accepted locally: entity/group position and
transform commands now allow finite ±1,000,000m coordinates, while local
geometry/scale/rotation limits remain bounded; gameplay no longer clamps the
player to radius 8.4, and the authoring prompt no longer assumes a mandatory
island. Tests cover far scene operations, v1 serialization, movement and
game-program interaction. Root reviewed the Luna diff. A full suite exposed a
pre-existing ChatGPT route-test mock omission introduced by the credential
recovery change; the two mocks now export the host idle lifetime (`a76ad27`).
Full suite 187 passed/6 skipped files, 1,586 passed/26 skipped tests;
production build/TypeScript, formatting and diff checks passed. This phase is
local only: fixed-island rendering, shared camera navigation, observation
bounds and chunked terrain/precision still need implementation and integrated
acceptance before deployment. The navigation contract is
`docs/unbounded-navigation-task.md`.

Sep 22 official OpenAI docs recheck: the documented App Server browser login
still sends its callback to localhost; the hosted success-page option does not
document a replacement HTTPS callback. External-token mode assumes the host
already owns authorization, and plugin OAuth runs in the reverse direction.
No public source established Orbsie's client registration or subscription
inference entitlement. Evidence and exact links:
`docs/chatgpt-subscription-oauth-feasibility-20260922.md`. Direct-return
subscription OAuth stays open as a provider dependency; the deployed device
code remains interim. Read-only Gateway credit recheck returned HTTP 200 with
balance -0.0033684 and no model call; paid Gateway E2E remains unavailable.

Sep 22 follow-up local acceptance: a process can die after reserving
`pending:<epoch>` and before binding a ChatGPT host. The vault now permits
explicit restart only after the placeholder is at least 11 minutes old (the
10-minute claim lifetime plus one-minute margin), with no current owner host
or remembered connection, using a database-time exact epoch/placeholder
comparison. A real PostgreSQL/service regression covers fresh and claimed
attempts, remembered credentials, restart and old-epoch callback refusal.
Worker 23 focused unit tests and two PostgreSQL cases passed; root reviewed
the diff and production build/TypeScript/format checks passed. Commit `faf6c48`
was deployed as `dpl_Bs1Sgzyuyc6i39mcVFW4uQMfnHF8`; Vercel CLI reported
Ready and the `orbsie.com` alias. No live model call or browser acceptance.

Sep 22 expired ChatGPT challenge repair accepted locally: a real PostgreSQL
reproduction confirmed that status hid the expired host while its bound owner
intent caused `/api/chatgpt/start` to return 409. The service now checks host
state and replaces only the exact expired intent under the owner epoch fence;
live pending logins, remembered connections, late callbacks and Disconnect
remain protected. Genuine live conflicts receive a safe status-check action.
The synthetic browser fixture shows expired → restart → new code with zero
provider requests (`docs/evidence/chatgpt-expired-challenge-recovery-20260922/`).
Root reviewed the diff and screenshots; full suite 187 passed/6 skipped files,
1,579 passed/25 skipped tests, production build/TypeScript, formatting and
diff checks passed. `next-env.d.ts` regenerated by the worker's dev server and
returned to its original tracked contents during the production build. Commit
`d2f5468` deployed to Vercel production `dpl_43oGviYEL27i59V2scKEF9s6s8Sk`;
CLI inspection reported Ready and the `orbsie.com` alias. ChatGPT consent,
model discovery and inference remain open because browser control's URL policy
rejected the Orbsie tab. No fresh device code or live model call occurred.

Sep 22 Android Chrome layout check: the live `orbsie.com` home page and
Connections dialog rendered in portrait and landscape on the Android 15
midrange emulator, using its software graphics renderer. ChatGPT and other
connection controls were reachable by scrolling. Evidence and exact limits:
`docs/evidence/android-chrome-20260922/` (commit `6a4925f`). No prompt,
provider connection, live model call, gameplay, or physical-device performance
was tested. Regular Chrome was subsequently launched with the owner's profile,
but computer use rejected binding the Orbsie tab under its browser URL policy;
the rejection explicitly forbids browser-surface workarounds. Browser-based
ChatGPT consent and signed-in acceptance remain unavailable in this session.

Sep 22 stream recovery accepted locally: unfinished initial/edit operations
remain visible while streaming but roll back to the last committed scene on
clean EOF, invalid output, read loss or Stop. Saved local state, Undo/Redo,
selection and gameplay state use that same baseline; a cloud journal's
provisional checkpoint remains available only through explicit recovery.
Provider, parser, transport, deadline, output-limit and completion-record
failures now have bounded terminal classifications and safe browser copy. The
API and hosted ChatGPT adapters withhold commit until durable completion.
Root reviewed the final worker diff, the rendered desktop/390×844 recovery
fixture (`docs/evidence/stream-resilience-20260922/`), diagnostic replay,
full suite (1,575 pass, 24 skip) and production build. No live model calls or
deployment; cross-provider live recovery acceptance remains open. Next bounded
implementation: `docs/chatgpt-expired-challenge-recovery-task.md`.

Sep 22 signed-in Chrome ChatGPT acceptance attempt: the owner approved the
current device-code grant, but the earlier challenge had expired and a fresh
`/api/chatgpt/start` returned HTTP 409 before issuing a new code. The browser
and software renderer are functional; no new consent or model call occurred.
An orphaned pending owner intent is a specific hypothesis, not yet proven by
the status-only production log. Reproduce and repair the expired-challenge
recovery with a Luna worker before retrying the consent. Direct redirect-based
OAuth is a separate requirement and remains unverified.

Sep 22 browser-access repair: regular Chrome was not running. The installed
ChatGPT extension in the Default profile connected after Chrome was opened on
the desktop. Computer use now exposes Chrome, and a fresh ChatGPT tab shows the
owner's signed-in Pro account. Use that browser for subsequent ChatGPT acceptance;
no live model calls were made during this check. Recheck the browser surface at
test time, since process/session availability can change.

Sep 22 browser review loop accepted locally: the editor now carries an explicit
review opt-in, saves the initial revision, captures revision-bound renderer
feedback, applies at most one targeted correction under a fresh cloud journal
segment, and publishes a final verdict. The root reviewed the worker diff and
the production-build WebGL/software desktop/phone fixture. Signed-in synthetic
cloud success and a conflicting latest-token refusal both pass, including
reload/recovery of the completed second segment. Evidence:
`docs/evidence/authoring-review-loop-20260922/`. Full unit suite: 1,570 pass,
24 pre-existing skips; production Next build and TypeScript pass. No live model
calls, deployment, or real provider review acceptance yet. The next bounded
implementation handoff is stream resilience; live authoring-review acceptance
still needs OpenRouter, funded Gateway, and the now-visible signed-in ChatGPT
browser.

Sep 22 default-model migration: Astra remains Quality; GPT-6 Luna replaces
GPT-5.6 Luna for app Balanced, hosted Balanced/Budget, free prompts, future
Luna worker configuration, and current live-test harness defaults. Budget for
API providers remains GLM-5.3-Flash. Provider model pages list the new ID;
local tests and production build pass, but no GPT-6 inference has run yet.

Sep 23 next independent handoff: `docs/stream-resilience-acceptance-task.md`
pins the unchecked stream-resilience requirement to actual provider/route/client
failure boundaries. The existing clean-EOF toast implies connection loss without
evidence; synthetic fixtures do not yet prove interrupted-run save/undo recovery
or the cause of frequent production failures. Implement after browser review
integration with one Luna worker, then gather live provider evidence when access
and Gateway credits permit. No stream-resilience completion claim yet.
`docs/authoring-live-review-acceptance-task.md` defines the subsequent live gate:
the older provider harness alone does not prove review calls, and the five-call
Gateway cap requires separate create/edit tests when each may use three calls.
Unbounded-world audit now identifies the shared ±100 protocol vector and
island-only model instructions in addition to player/camera/terrain limits;
`docs/unbounded-world-task.md` separates world coordinates, shared navigation,
chunked rendering and integrated acceptance into sequential Luna handoffs.

Sep 22 integration seam: `2b601cd` exposes `authoringReview` from server
configuration and preserves hosted opt-in; `ee97d7a` adds the API model's
admitted image-input header. Browser review request/response contracts are
`02d689b` and `bdf82a3`; shared structural feedback is `bf46488`. Private
ChatGPT review transport `e468f32` is accepted after root review: real
backend→handler→managed-runtime HTTP fixture proves accept, stale epoch and
abort/late reply; root 52 focused tests, typecheck, host bundle build and
format pass. Hosted web orchestration `d8b1504` is now accepted: credential
lease/status preflight precedes ledger admission, private results are bounded
and replayed independently, and seal/save/clear plus an exact-token failure
fence precede the public result. Root 56 focused tests, whole-tree typecheck,
format/diff checks, host bundle and production Next build passed. The real
durable→private HTTP→managed handler fixture includes accept, binding/epoch
tamper and held-work abort with mocked RPC/vault/admission. No live calls.

Sep 22 root browser handoff: `4c0c513` adds
`assertAppliedAuthoringReviewBinding` for the browser to recompute the authored
scene digest after correction; its focused test and format check pass. Browser
task `docs/authoring-browser-review-task.md` now requires this guard, re-derives
correction asset policy from the reviewed project, and pins the review opt-in
at submission. It also requires a fresh cloud journal segment for corrections:
the initial `commit_revision` closes the first journal. The browser review loop
is now integrated as described above. Feature remains off and undeployed; do
not claim live-provider E2E until its separate gate is accepted.

Updated 2026-09-22. Full goal remains **all prompt.md, E2E validated with
OpenRouter, Vercel AI Gateway and ChatGPT**. Not complete. Previous detailed
acceptance history: checkpoint-history/2026-09-13-before-durable-release.md and
checkpoint-history/2026-09-13-before-client-diagnostics-release.md.

## Execution

Astra low/default owns contracts, every diff review, integration and acceptance.
One Luna xhigh/default worker, no nested agents, Fast off. Hosted initial authority
handoff accepted after root review of final source, actual private HTTP wire
mutations, safe writer errors and non-cooperative late completion. Worker affected
five-suite61passed, HTTP/backend36passed; final private HTTP22passed and final
whole-tree typecheck passed. Root private-host bundle build and node syntax check
passed. Evidence authoring-hosted-authority-20260914. Private completion records
are negotiated before inference, consumed only after clean private EOF and stripped
from public output. Cancel fences completion; post-scene credential seal failure
stays separate. No live calls/deployment or complete browser review-loop claim.
Reviewer executor accepted after three focused handoffs and root final prompt
correction. Worker23targeted tests/typecheck passed; root final6targeted tests passed
(17 omitted by name filter), whole-tree typecheck and diff check passed. Actual
QuickJS expression evaluation and browser-style operation/provenance binding match
the server correction result. Evidence scene-review-execution-20260914. Both API
providers and hosted generator adapter return validated correction batches; exact
selection, configured format, API output cap, clean completion, image scope,
semantic all-or-none application and cancellation tested. Hosted generator is mocked;
not actual private-hop/browser/live E2E. No public review endpoint enabled/deployed.
Next is public review admission + managed hosted review operation + browser loop
under docs/agentic-review-loop-task.md, including its recorded review-ledger late
COMMIT cancellation gaps and diagnostics. Do not repeat finished investigation.

USAGE RESUMED: authoritative quota 31%used/69%remaining on 2026-09-22.
The owner's below20% stop rule remains active. Goal returned to active after
prior blocked audit. Review-phase ledger fence accepted locally: signal-aware
bounded admission/completion, retained exact private token through COMMIT
acknowledgement, independent cancellation cleanup and stale-token isolation.
Worker and root confirmed 21/21 ledger tests on real PostgreSQL15 and whole-tree
typecheck. No model calls. Root committed public/hosted review handoff contracts
54173bb and 18181a2. Public review coordinator/route for free, OpenRouter and
Gateway is accepted locally: shared signed identity/fingerprint, exact scene
binding admission, catalog/image preflight, one-call executor, failure cleanup,
typed review diagnostics and fixed low reasoning for recommended API models.
Root final 47 focused tests passed on real PostgreSQL, with typecheck and format
checks. It remains feature-flagged off and is not browser E2E. Next single Luna
task is the managed hosted private review transport in
docs/authoring-hosted-review-task.md; browser task follows in
docs/authoring-browser-review-task.md. Root committed the earlier
review-route/browser contract ef8e773. Initial/editor
review still not wired or deployed; current E2E objective remains incomplete.
Gateway credit read 2026-09-22 HTTP200 still -0.0033684 with zero model calls;
evidence docs/evidence/gateway-credit-check-20260922. Owner asked asynchronously
for funded test key/credits, no key requested in chat. CUA browser inventory on
2026-09-22 exposed no browsers/apps; owner signed-in Chrome is not yet selectable
in this session. Preserve owner request to use existing signed-in browser and
computer use for GitHub. These external blockers do not stop local integration.
Sep 23 read-only credit recheck remains HTTP200 -0.0033684, zero model calls
(`docs/evidence/gateway-credit-check-20260923/report.json`); current CUA
inventory still has no browser or app surface. Do not run paid Gateway
inference until credit is positive.

Initial API task finished. Root
accepted final API initial issuance/completion/failure wiring after three focused
review fixes. Retained initial token fences abort during COMMIT acknowledgement;
review admission atomically replaces it. Pool acquisition and local DB lock/query
waits are bounded, late acquired clients released. Free opt-in charges one prompt
and reserves three global units atomically; linked API has no email/free-charge
gate. Existing one-call path preserved. ORBSIE_AUTHORING_REVIEW=1 plus request
opt-in required; production not enabled, no public review endpoint/browser loop.
Root seven integration checks passed (no skips), including actual PG durable
commit held before acknowledgement -> cancellation -> failed -> review denied,
production route/parser malformed output and scrubbed writer rejection. Worker
54route/ledger compatibility checks,6PG ledger checks, final6pool acquisition checks
and typecheck/format passed. Evidence authoring-initial-integration-20260914.
No live calls, production migration/deployment or browser E2E in this handoff.
After hosted authority: reviewer execution and browser integration under
docs/agentic-review-loop-task.md. Full goal intact. Root separate accepted-source
production build2d02761 passed in/tmp/orbsie-authoring-initial-build-20260914.
Desktop/phone synthetic diagnostics regression passed, root viewed screenshots;
raw parser toast wording remains a recorded recovery UX gap. Evidence
authoring-initial-build-20260914. Build5290/fixture66708 exit0; server15549 stopped130.
This excludes active worker WIP; no deployment, live calls or physical-device claim.
Synthetic PG15 container orbsie-authoring-route-20260914 stopped and auto-removed
after acceptance; only synthetic test data. Initial integration commit3a97e3f.
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
Private completion-record schemaaf2213e is now wired through the authenticated
host transport in43113e8; schema13focused tests preceded the integration evidence
above. Initial/hosted contracts9d819f6 are accepted locally. Production enablement
waits for the complete bounded review loop.
Binding accepted after root regressions: production server/browser procedural
digests match, trailing NDJSON commit->command->commit fails without completion,
and pending-hook cancellation fails once and consumes late results. Shared
abort-aware lifecycle controller; ordinary Manifold recipes retained, source hashes
and stale provenance checked, failure-only hooks cannot turn failed or cancelled state into completion.
Worker broad targeted pass54tests before final two fixes; final focused30tests,
typecheck/format/diffcheck passed. Root reviewed all final changes and independent
production-path probes. Evidence scene-binding-review-20260914; rejected baseline
scene-binding-review-baseline-20260913 retained. No browser/live-provider E2E claim.
Important next integration constraint: callback AbortSignal alone cannot cancel a
DB transaction. Carry cancellation through lock/commit and inspect settled ledger
state; failure cleanup needs independent bounded headroom. Contract appended to
docs/agentic-review-loop-task.md. Do not enable public multi-call yet.
Root added flagshipJourneyAcceptance to every provider report/CLI:12focused
contract tests and2follow-on tests pass; two historical partial reports correctly
remain incomplete. Evidence flagship-journey-gate-20260913. Actual seven/undo/
standalone/publication traversal producers remain required. Whole-tree
typecheck passed with the first binding handoff; its behavioral review failed.

Quota last31%used/69%remaining: stop workers/live calls below20%. Read
/home/marcos/.cache/orbsie/read-codex-quota.py; stop workers/livecalls below20%.
Goal token accounting is not subscription quota. Live model tests Luna only;
end-user model choice unrestricted. API4096 output/call, Gatewaymax5/test,
flagship3calls, no blind retries. Hosted180s/512KiB are runtime/output bounds.
Never echo credentials. Use completion notifications, avoid status-only turns.

Browser availability rechecked Sep14: CUA getState still reports
CUA_REPL_ENABLED_SURFACES required. Registered Chrome DevTools list_pages works,
but existing ChatGPT page3 snapshot shows Log in/Sign up and OpenRouter page2 is
on sign-in. No new login flow, cookie access or raw CDP; owner signed-in profile
still unavailable. Do not treat the reachable signed-out profile as owner E2E.

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

Owner requires existing signed-in Chrome. The Chrome extension surface became
available on Sep 23 and the owner profile now presents its existing ChatGPT
account on the official device page. No raw CDP or cookie copying. The local
device challenge expired without submission; a fresh one can be issued after
the authorization decision noted above.
GitHub operations via computer use; push pending.

Android emulator API35/Chrome124/2cores3GiB/SwiftShader preflight and saved Gateway
world replay passed (7score/win/reset/loss/restart), root viewed6screenshots;
android-player-replay-20260913. Not new generation/currentpublication/physicalperf.
Emulator removed/stopped; ADB physical devices absent on lastcheck. Terms consent
for specific USJuly30,2026 Google terms granted, noaccount/reportingoff. Shared
3040/3096 servers left untouched. Synthetic Postgres container stopped/removed.

Sep27 exact OpenRouter flagship ZIP Android replay (SHA256
7630cb95236386713f84c5fc40559273e37fec18b204ea242c6c8ba8f595978a) served the
archived runtime unchanged on API35/Chrome124. Readiness, Canvas2D fallback,
viewport, three moving-platform bounce contacts, five crystal collections, and
score5 portal win passed. Play again visibly returned to score0, but the single
run failed before fresh post-restart frame state was confirmed; report code
mislabels this as an incomplete collectible objective. Wrapper now waits for a
new frame; this fix was not rerun, so acceptance remains partial. Zero provider
or external requests; emulator evidence only, with WebGL untested. See
`docs/evidence/android-openrouter-flagship-20260925/retry-exported-zip-20260927/`.

OpenRouter .env.openrouter.local0600; Gateway private
/home/marcos/.cache/orbsie/provider-tests/gateway.env0600. No secret in reports.
Root local servers10522 terminal0 and98456 terminal130 intentionally stopped.
Production browser synthetic fixture47567 passed/terminal0: exactly1 synthetic
Budget request+reply and all recovery cases. Evidence chatgpt-startup-live-fixture-
20260913; root viewed phone screenshot. No provider calls. No root processes remain.

Gateway funding recheck: GET /v1/credits returned200 with balance-0.0033684 again
on2026-09-14T07:57Z (local Sep14); no model calls or billing changes. New evidence
gateway-credit-check-20260914; previous Sep13 evidence retained. Existing owner
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
