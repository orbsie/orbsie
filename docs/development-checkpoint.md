# Development checkpoint

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
