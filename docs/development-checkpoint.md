# Development checkpoint

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
