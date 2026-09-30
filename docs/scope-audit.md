# Orbsie full scope audit

## Current reconciliation — 2026-09-29

- The model-driven inspect-and-revise loop now has live passes on two
  providers with `openai/gpt-6-luna` at the 4,096-token cap: OpenRouter
  accepted a tiny-island mushroom after zero or one correction, and Gateway
  turned a sunken pink blob into a legible stemmed, spotted mushroom through
  two targeted corrections and a final accept. Claude inspected every settled
  Edit/Play capture. Evidence:
  `docs/evidence/provider-e2e/authoring-review-*-20260929/`. Single samples;
  quality still varies, hosted ChatGPT review is not live-validated, and
  production `authoringReview` remains off.
- First native-GPU desktop frame sample (Quadro RTX 8000 via ANGLE/Vulkan):
  median 16.7 ms at 60 Hz for the 14-entity fixture, tail matching an
  empty-page baseline on a loaded host. Evidence:
  `docs/evidence/render-performance-native-gpu-20260929/`. Not a laptop,
  larger-scene or mobile certification.
- Gateway flagship: creation gameplay and the mushroom edit passed; the third
  edit failed with an unapplicable response (see the checkpoint).
- Touch platform crossing: `scripts/verify-flagship-platforms.mjs` only
  supports the older catalog-asset `move` platform layout, so it cannot check
  current bounce-platform flagships (a Sep 29 attempt stopped at its layout
  assertion, no model calls). The current layout's touch route already passed
  in the Sep 27 Android 15 emulator replay (grounded and bounce frames on all
  three platforms, five crystals, win, touch restart):
  `docs/evidence/android-openrouter-flagship-20260927/fresh-android-api35-touch-replay/`.
  Physical-device touch remains open.
- Still blocked on external resources: owner ChatGPT consent (no connected
  Chrome extension in this session) and physical iOS/Android devices.

## Current reconciliation — 2026-09-27

The full `prompt.md` objective remains open. Use
`docs/development-checkpoint.md` for the latest source and acceptance evidence;
older rows below are a historical inventory, not a completion claim.

- A fresh local-only OpenRouter GPT-6 Luna create/edit run used exactly two
  HTTP 200 model calls at the 4,096-token cap. It saved revision 9 to cloud,
  reopened it, exported it, and published that same project through the
  authenticated production app. Signed-out public snapshot and player loading
  passed. The first screenshot preceded catalog asset loading; a later desktop
  check saw the island and tree after both GLBs returned HTTP 200. Evidence:
  `docs/evidence/provider-e2e/openrouter-continuous-publication-20260927/`.
  This closes a small-scene OpenRouter create/edit-to-publication path; it does
  not prove fresh game-win publication, ChatGPT subscription auth, funded
  Gateway inference, physical mobile, or delightful visual quality.
- Production `/api/trial` currently returns `enabled:false` because free
  provider availability fails closed. The retained “princess in a castle”
  draft therefore offers provider connection rather than free generation.

- A stationary 12 km platform fixture now passes production WebGL SwiftShader
  zoom, pan, wheel, north reset, chat/control overlay isolation and exact
  saved ID/position checks. Prior crystal-based centroid failures were test
  ambiguity from edit-mode animation; the pure-state north-reset test verifies
  target/distance preservation. Evidence:
  `docs/evidence/world-navigation-browser/run-20260924-webgl-static-mask/`.
  This completes the desktop WebGL fixture lane, not native GPU or physical
  mobile acceptance.
- The compatibility notice and save toast no longer cover editor navigation
  controls in three tested mobile viewport layouts. Source `9dafeea` is Ready
  on `https://orbsie.com/`; the exact production fixture passed geometry,
  dismissibility and saved-scene checks with no model calls. Evidence:
  `docs/evidence/mobile-navigation-overlays/`. Physical-device and native-GPU
  checks remain open.
- An initial production 12 km navigation fixture passed desktop Canvas2D buttons,
  pan/wheel, compass north reset, overlay isolation and mobile-sized Canvas2D
  drag/pinch; WebGL SwiftShader stopped after wheel zoom because a pixel-count
  threshold became too strict for the shrunken marker. Evidence:
  `docs/evidence/world-navigation-browser/`. This is partial navigation
  acceptance, not the full unbounded-world or physical-device gate.
- Android 15 midrange-emulator Chrome 124 closed the direct SoftwareWorld
  growing-world fixture before readiness in four bounded configurations (160
  and 120 entities, 5,000 m and 100 m camera distance). One filtered system
  log confirms a Chrome sandboxed child process died, without establishing
  its cause. No travel, frame-time, or memory acceptance result was obtained;
  `docs/evidence/android-growing-world-runtime/` retains the failure and
  cleanup evidence. Prior Android published-game checks still stand.
- A 160-entity synthetic browser fixture passed six repeated distant-travel
  and home-reentry cycles with 48 full formations, 112 proxies, the distant
  selection retained, and settled WebGL resource counts unchanged by cycle.
  SwiftShader frame intervals were p50/p95/p99 16.7/50/66.6 ms; the direct
  SoftwareWorld path stayed ready at both locations. Evidence:
  `docs/evidence/growing-world-runtime/`. Tiny primitive fixtures, variable
  CDP heap, and software rendering do not establish high-detail or physical
  mobile performance; the broader growing-world gate remains open.
- The browser procedural isolation release gate now has an actual production
  editor fixture, not only isolated evaluator tests. Four intercepted generation
  requests created an object, rejected a hostile host-API/storage/network probe,
  bounded an infinite loop with worker termination, and completed a targeted
  recovery edit and reload under the same entity ID. The temporary browser
  canary never appeared in the saved project; no external HTTP/WebSocket attempt,
  provider call or page error occurred. The loop failure took 2,638 ms. Evidence:
  `docs/evidence/browser-procedural-isolation/`. Source `b0d5d48` adds the
  repeatable harness; this does not prove a full secret audit or live-provider
  recovery.
- The desktop standalone Canvas2D advice now sits below the scene and above
  the footer. Local screenshot/bounds and exact served CSS hash are recorded in
  `docs/evidence/standalone-graphics-advisory-20260925/`; touch overrides remain
  in place. A new public publication after this CSS-only release was not run.
- The current production editor passed a deterministic 12 km create/edit,
  framing, reload, ZIP and standalone playback journey in WebGL/SwiftShader
  and Canvas2D, with stable IDs/positions and no provider calls. Evidence:
  `docs/evidence/far-world-browser/production-current-20260925/`. Live
  model-authored far edits, physical Android, repeated long traversal and
  growing-world performance remain open.
- Source `0af88e2` is deployed. The provider SSE parser now consumes a complete
  final `data:` line without a trailing newline while refusing malformed or
  error-terminated streams before commit. Focused tests and the production
  build pass; the broader frequent-interruption and real-provider recovery
  acceptance remain open.
- Source `a6295cf` is deployed to `https://orbsie.com/` and a fresh
  Gateway-authored saved artifact was independently published with exact
  current-runtime and model hashes. Signed-out desktop and touch browser
  gameplay plus Android 15 emulator Chrome Canvas2D touch score/restart/win/loss
  pass. Portrait play framing now keeps both models in view and places the
  compatibility notice above touch controls. Evidence:
  `docs/evidence/provider-artifact-publication-framing-corrected-20260925/`
  and `docs/evidence/android-gateway-publication/portrait-framing-20260925/`.
  Model-authored visual quality and physical mobile remain open.
- The exact immutable Gateway-authored deployment passed Android 15 emulator
  Chrome touch score, restart, win and loss under forced Canvas2D fallback with
  no credentials or generation requests. Screenshot review found clipped tree
  framing and an intrusive graphics notice in portrait; mobile visual polish
  remains open. Evidence:
  `docs/evidence/android-gateway-publication/current-runtime-20260925/`.
- A fresh production account/project published an existing Gateway-authored
  revision-9 world with two generated GLBs into its own Vercel deployment.
  Exact public snapshot/model/runtime hashes and signed-out desktop, portrait
  touch and landscape touch gameplay passed without model calls, cookies or
  external requests. Evidence:
  `docs/evidence/provider-artifact-publication-current-20260925/`. This closes
  the current-runtime baked-publication gate, while fresh Gateway inference,
  visual quality and physical mobile remain open.
- A current local OpenRouter Luna input-game run passed two real calls at the
  4,096-token cap: original tree and mushroom geometry, exact input rules,
  targeted edit, reload, export, and signed-out standalone keyboard play. An
  origin preflight now catches a mismatched local `BETTER_AUTH_URL` before any
  model request. Evidence:
  `docs/evidence/provider-e2e/openrouter-origin-corrected-20260925/`.
  The retained visual is simple and does not certify the requested delight;
  cloud publication, physical mobile, Gateway and ChatGPT acceptance remain
  open.
- `https://orbsie.com/` is serving deployment
  `dpl_H73dfGFRGszuuy9LFMVdymEvU4vc` at this reconciliation. Read-only
  root, robots, sitemap, config and exact player runtime/source hash checks
  passed; the prior release's trial
  check passed. The previous crawler
  smoke found ten promoted public Orbs and an indexable share page. The latest
  free-provider 402 UI recovery passed both local and intercepted production
  browser checks at desktop and mobile sizes. This does not prove funded free
  generation, model-authored visual quality or the
  full provider E2E matrix.
- At one remaining trial prompt, the production Connections dialog now shows
  “Use 1 free prompt” at a 390×844 viewport. This is presentation validation,
  not a funded free-generation check.
- Opening a saved world now frames its committed content once. The production
  browser check loaded a saved catalog tree and changed the camera from the
  default view to 600% without model calls or page errors. This improves
  legibility on reopening. A deterministic first-build review-error fixture
  now also frames a preserved ready tree at 589% after the error, with no model
  calls. Neither result certifies generated-model quality.
- A new textured CC0 mushroom is admitted and deployed, with exact source,
  derivative GLB, and license hashes. The full 11-asset cold-scene cache race
  was fixed, and local and exact-production browser fixtures passed all 11
  model loads, mixed create/export/standalone playback, and new-only rejection
  with zero real model calls or page errors. The public mushroom GLB hash matches
  the checked-in manifest. Published playback now starts at the shared 12-unit
  play minimum. Same-ZIP desktop/mobile screenshots show its two subjects larger
  and uncropped, and the exact-production catalog browser fixture passes. Broad
  model-authored visual quality, live-provider and physical-device acceptance
  remain unverified.
- The latest bounded OpenRouter Luna authoring-review run completed four calls
  and ended `bounded-incomplete` with a final `revise` verdict. Astra's visual
  check confirms that the rounded blue fruit and oversized green caps still
  miss the requested strawberry silhouette and only three of four fruit remain
  distinct. This newer run reports the defect honestly; the preceding run
  falsely accepted a comparable tree. Follow-up reviews now receive the prior
  sanitized finding and current-image verification instructions; local tests
  and production build pass. A new single-run live attempt confirmed the
  follow-up request carried feedback, then stopped at provider HTTP 502 before
  a verdict; Astra still rejects the corrected round fruit on visual review.
  Production authoring-review remains off.
  Gateway credit is negative, so further paid Gateway inference has not run.
- Admitted review failures now return an allowlisted failure-kind header and the
  live OpenRouter harness records only recognized values on failed responses.
  Thirty focused tests and TypeScript pass; no later live 502 has exercised it.
  The ledger terminalizes a failed review run, so saved-scene continuation needs
  a new, explicitly budgeted review admission rather than automatic replay.
- A deterministic HTTP 502 browser fixture now proves that a saved scene offers
  **Continue improving** in the parent chat, drafting from the original request
  with zero automatic model calls; Undo hides the stale action. It does not
  resume the terminal review ledger phase or prove live-provider recovery.
- The ledger now supports fresh review-only runs against a revision/digest,
  charging one free trial unit atomically when applicable. A helper verifies
  the prior failed run's exact identity, request and last committed scene;
  a unique recovery-parent index prevents duplicate charging (`ed6d908`,
  `467588e`, `1c3b0b2`; 13/13 PostgreSQL and 13/13 admission tests). The
  public free/OpenRouter/Gateway start route validates a failed-run recovery
  and returns a run ID without inference (`ec03302`, 12 route tests). The hosted
  ChatGPT start route also validates its connected catalog before admission
  (`d871b67`, six route tests). The store now has an explicit review-only
  transport and shared verdict sequence (`51bf796`, `45e3dff`; focused tests
  pass); it captures the saved scene before admission and skips initial
  generation. The hosted admitted-failure marker is now present (`1f0936c`,
  six route tests). An exact, untouched review-start child can now be returned
  after a lost start response without a second free claim (`7343d1f`, 31
  admission and 13 PostgreSQL ledger tests). The editor now exposes explicit
  **Resume review** with provider-specific cost and retains the draft fallback
  (`e38f09f`, `5fc62eb`). The full deterministic browser fixture passed
  local free resume, lost-start retry, signed-in cloud-journaled correction,
  mobile bounds and Play/scene preservation at
  `docs/evidence/authoring-review/review-resume-integration-20260924/`.
  Production review is still disabled and no provider call has exercised the
  new path. The exact saved guest continuation now survives reload for the
  ledger's 15-minute window (`00160c7`, `2d5aabd`). Signed-in reload now
  restores and checks the authoritative cloud baseline before paying for a
  review-only continuation (`de4dece`, `457a2ba`); deterministic browser
  fixtures passed resumed correction, stale-cloud rejection, local-only draft
  and exact-snapshot cases. See
  `docs/evidence/authoring-review/review-reload-cloud-integration-20260925/`
  and `docs/evidence/authoring-review/review-signed-in-baseline-regressions-20260925/`.
  Live provider and production-enabled acceptance remain open.
- A fresh hosted ChatGPT device challenge shown to the owner expired without
  a grant; its private session was cancelled and removed. The production UI
  now opens the official sign-in tab on direct connection clicks, verified in
  an intercepted exact-production browser test. Programmatic starts do not
  open a tab. No ChatGPT inference ran. [Official App Server documentation](https://learn.chatgpt.com/docs/app-server)
  describes a localhost browser callback and a device-code flow, but does not
  establish an arbitrary HTTPS callback to Orbsie. The requested direct-return
  subscription OAuth remains unverified. Computer use currently reports no
  Chrome or other browser surface; do not claim access to the owner's signed-in
  session.
- An isolated combined WebGL/Canvas2D local fixture passed the five→seven→Undo
  five gameplay journey with real input and no model calls after giving each
  renderer its own Chromium process. This is not physical-device or
  model-authored published-game acceptance.
- The current post-segment standalone player passed signed-out touch scoring,
  restart, win and loss on an Android 15 emulator with Canvas2D forced and no
  unexpected network requests. Its four runtime/worker hashes match current
  source artifacts. A WebGL-allowed replay also passed touch gameplay, but the
  emulator's SwiftShader probe intentionally selected Canvas2D. Physical
  Android and Android WebGL remain unverified.
- A new read-only public flagship CDP-touch replay corrected a verifier
  snapshot-catalog mismatch, then proved platform-1 landing and carry. The
  platform-2 jump missed. A bounded Jump-first driver replay activated Jump
  but missed platform 1 at a different motion phase, so it did not resolve the
  platform-2 cause. A subsequent per-frame observer probe failed closed before
  Jump because its frame objects could not be correlated; the observer's
  corrected takeoff boundary has 13 focused passing tests but no live replay.
  The full touch route remains open. This is browser touch emulation, not
  physical Android.
- Playwright WebKit 26.6 touch emulation at 390×844 passed signed-out landing
  and standalone score 7/restart/win/loss with current player files and no
  overflow or unexpected requests. This is not physical iOS Safari evidence.

## Historical reconciliation — 2026-09-13

This section records the state observed on Sep 13; the Sep 24 reconciliation
and checkpoint supersede it where they differ.

- Real hosted ChatGPT device authorization and provider catalog succeeded in the
  owner's Chrome browser. The first Luna create failed with empty objects; no
  edit/retry occurred. Evidence: `chatgpt-owner-live-20260913/create-failure.json`.
  The exact hosted protocol completion mismatch and safe diagnostics are fixed
  in4eb9ce8, deployed with player artifactsb880edd.78 focused tests and production
  builds passed. Post-fix live inference/recovery/publication is unverified.
- WebGL failure now falls back to the shared Canvas2D game runtime. Editor and
  independent-player gameplay checks passed; owner Chrome confirmed software
  rendering with no fatal graphics dialog. Evidence:
  `game-actions-software-acceptance-final/report.json` and
  `software-owner-local/production.json`. This does not prove mobile performance
  or full visual parity. Fatal graphics failure requires both renderers to fail.
- Embedded-atlas decoder3d6a839 is accepted. Renderer/lifecycle/export integration
  remains in progress; no new textured catalog asset has been admitted.
- Browser control currently fails before access with
  `CUA_REPL_ENABLED_SURFACES is required`; restoration was requested. The prior
  browser-login obstacle is no longer the current blocker. No browser credentials
  are copied to compensate.

## Historical reconciliation — 2026-09-12

OpenRouter targeted catalog replacement now has fresh post-fix grounding evidence:
openrouter-support-contact at2e04040, two Luna calls, ID/unrelated preservation,
reload/export/standalone pass, computed supportgap0. Root reviewed screenshot.
Angular mushroom visualquality/fullflagship story remain open; this is a bounded
provider edit journey, not all-provider or full-scope acceptance.

Live canceled-replacement continuity now passed: publication-terminal-corrected
at8d870f3, two publication POSTs/one cancellation/zero modelcalls. Exact previous
snapshot and served revision/URL retained with fresh signed-out browser readiness.
This supersedes older statements that no terminal-failure run exists; actual
ERROR-state deployment and full gameplay/mobile are separate scopes.

Provider connection reconciliation — 2026-09-13: production28a1219 removes the
Orbsie email/password gate through isolated guest-session bootstrap. Production
schema migration and live bootstrap/start/status are verified in
`provider-session-bootstrap/production.json`; no ChatGPT inference yet. CUA now
controls the owner's extension-connected Chrome Person 1, with a signed-in
ChatGPT Pro session. Account selection reaches OpenAI device-code entry without
the previous Cloudflare loop. Code entry remains incomplete. Orbsie uses actual
isolated Codex App Server device authorization; the OpenAI Codex label matches
that documented transport, but does not prove successful account connection.

Performance inventory correction: src/lib/experience-metrics.ts already records
all seven named milestone slots plus accepted-update→draw samples, with bounded
retention; World/store/publish integration and focused tests exist. Historical
“no instrumentation” rows below must not trigger duplicate implementation.
Representative hardware measurements remain absent. Input acceptance→simulation
consumption telemetry is a separate bounded addition in progress; it will not
prove rendered feedback or physical-device input latency.

This section supersedes conflicting historical status below; it does not close the full plan.

- Catalog source-bounds audit found that all ten assets omitted their GLB node Y translation, and fence-gate metadata also omitted child transforms. Manifest bounds/origin notes are corrected and checked against active transformed vertices; original GLBs/licenses remain unchanged. This affects generation placement metadata and contact calculations. Historical ZIP traces use their bundled old catalog; they are not proof of updated-runtime contact. Source0489989 is deployed on orbsie.com; fresh production editor/exported CDP-touch fixture passes exact corrected support contact, automatic bounce and path motion with zero model calls (`catalog-bounds-release-browser/`). This does not prove new live-model placement or physical mobile. See `mushroom-visual-diagnosis/`.

- Latest OpenRouter moving-bounce milestone (`provider-e2e/openrouter-moving-bounce-guidance/`,3460f7a) passed two live Luna create/edit calls, reload/export/standalone loading and three bounce entities paired with three move_path actions. Guidance is now deployed at source0292df7; production build/TypeScript and HTTP200 smoke passed (`moving-bounce-guidance-release/deployment.json`). This demonstrates live structural adoption, not full route playability.
- Saved OpenRouter keyboard collection (`openrouter-moving-bounce-winning/`,f06a741) reached40/50; the ground/pickup-jump driver missed elevated crystal5. Final portal contact correctly withheld victory. The reviewed verifier derives50 from five ten-point collect rules. This failed run neither closes the three-platform route nor proves it impossible.
- Mobile test driver now preserves simultaneous direction/jump pointers and diagonals (`c1f763b`). The saved earlier OpenRouter world passed corrected CDP-touch collect/win/reset (`winning-multitouch-integration/`,57953d4). This supersedes the one-touch driver limitation below; newest moving-bounce routes and physical Android/iOS remain unverified.

- Current Gateway world is project `d8d48be6-dae2-4531-a7cb-77e8906b4c75`: creation26→mushroom30→goal7 revision37 used three successful Luna calls, including targeted geometry and path-duration changes. The giant replacement's transformed catalog dimensions exceed the original tree. Captured offline reload/export/seeded-undo passed (`gateway-captured-offline/`,68666a0); seeded history does not prove original live undo. Two generated assets are present in this newer world; do not confuse it with the older seven-generated-asset revision40 below.

- Current Gateway desktop route has reviewed partial proof (`gateway-current-bounce-route-attempt-1/` and `gateway-current-bounce-route-final/reviewed-trace.json`,0fdca17): three descending-contact→bounce-ascent transitions,106 samples with no ground contact during the sequence, no subsequent jump presses, and all seven collectibles. Portal win/reset remains open. Attempt2 missed the third platform at a different motion phase. Nine focused verifier tests passed after source-ID and observation-bound corrections. No new model calls.

- Moving-bounce fixture browser acceptance passed in `moving-bounce-browser-frame-aware/`: real editor creation/reload, desktop automatic rebound without post-release jump, exact ZIP export and390x844 CDP-touch standalone rebound with ongoing horizontal path. Root reviewed code/trajectory/screenshot. Zero live provider/model calls or external/page errors. Readiness and repeated-rendered-frame verifier fixes retain fall/flat negatives. This closes one fixture platform composition, not a three-platform route, live provider story, public deployment or physical mobile. Older raw failures are retained.

- Moving-bounce composition now has focused runtime proof: bounce behavior plus start-triggered move_path launches a descending player with no jump input (velocity7.08), continues moving and preserves an unrelated entity. Generation guidance explains this supported composition and jump-height margins.20 focused tests/typecheck passed. This is local functional evidence, not browser trajectory or live provider effectiveness. Captured Gateway revision40 still fails first-platform ground-jump acceptance (`gateway-seven-platforms-runtime-contact/`, c874d84); its bounce-named rule raises the platform instead.

- Failure-continuity source review at `35cf292`: `src/app/api/publish/route.ts` GET promotes `public_url`/`published_revision` only in the READY branch after artifact verification, guarded by deployment ID and revision. Non-READY returns retain the prior URL/revision. Existing `tests/published-page.test.tsx` checks promoted metadata isolation; `tests/publication-regressions.test.ts` now explicitly covers ERROR/CANCELED GET responses: previous URL/revision retained, stored metadata unchanged, one read-only owner-scoped query, and no promotion or artifact fetch. Together with `tests/published-page.test.tsx`, 26 targeted tests passed. The page checks are static server rendering, not signed-out browser acceptance. This offline regression is not live failed-deployment continuity proof.

- Replacement-sizing guidance is deployed from `a5b2769`; `docs/evidence/replacement-sizing-release/report.json` passes read-only production checks. Live effectiveness remains unverified.
- Gateway flagship story used three Luna calls across two stopped runs: one creation stopped on a catalog-tree classifier defect, then creation plus a selected pink-mushroom replacement stopped on a label classifier defect. The classifier fixes are committed; saved snapshots in `provider-e2e/gateway-flagship-story-catalog/gateway/` preserve the second run. Catalog bounds show the mushroom is shorter than the original tree, so giant-size acceptance remains open. Those initial runs did not reach the middle-platform edit. The subsequent checkpoint-resumed run (`provider-e2e/gateway-flagship-checkpoint-resume/`, commit `12ce90a`) used one additional Luna call, bringing this milestone to four calls total. It verified platform-2 speed 1.2 → 0.6, two added crystals, and preservation of other entities. All seven GLBs and revision 40 were captured. The saved portal rule requires crystals >= 7, but the real Play HUD showed only Score and the run stopped before reload, undo, export, or standalone checks. Runtime win gating and complete story acceptance remain open. This was a resumed checkpoint with hash-identical reconstructed assets, not a fresh uninterrupted E2E run. Earlier JSON-only replay lacked generated GLBs and remains limited evidence; the later asset-complete replay is recorded separately under `gateway/asset-complete-replay/`.

- Gateway seven-crystal world is independently published as a test clone, with exact snapshot, seven generated/four catalog assets and license/provenance checks (`publication-gateway-seven/report.json`). Signed-out public desktop and CDP-touch portal rejection at score0, score7/win/reset passed (`publication-gateway-seven/traversal/`). One signup/save/publication; zero inference/retries. This closes this captured-content publication/gameplay milestone, not original-project revision continuity, physical mobile, platform sequence, giant sizing or full provider E2E.

- Corrected Gateway revision40 saved-ZIP traversal passed desktop keyboard and 390x844 CDP touch with harness `265f026`: uniquely matched portal bounds, two overlapping observations at score0 with no win, then score7/win/reset. Evidence: `gateway-seven-gameplay-portal-bound/` and `gateway-seven-gameplay-touch/`. Zero inference/external/mutating requests. This supersedes the contact limitation of the prior run only; publication, platform sequence and physical-device acceptance remain open.

- Gateway captured revision40 now exports independently with seven verified generated models (`provider-e2e/gateway-flagship-seven-export/`). Desktop keyboard traversal of that ZIP observed score7, Adventure complete and reset to score0, with zero inference/external/mutating requests (`gateway-seven-gameplay/`, recorded `d728199`). Root reviewed the winning screenshot. The raw report says passed, but root rejects early-portal contact proof: its mesh selector returned the planet bounds, not the portal. Preserve this run as partial; exact portal identification and a corrected runtime rejection check remain open. This is local saved-ZIP evidence, not a fresh provider story, mobile certification or independent publication.

- Saved Gateway offline continuation passed at `e0dff7c`, evidence `provider-e2e/gateway-flagship-offline-continuation/` recorded in `146332f`: exact edited revision40 reload, undo from seeded baseline history to revision41 with five crystals, reload, export and standalone loading. Zero generation attempts/external requests. The game-program HUD correctly shows Score without a goal denominator. This does not prove original live history, runtime seven-crystal win gating, settled visuals or publication; the screenshot includes formation orbs.

- OpenRouter input-game acceptance passed in `694c904`: `docs/evidence/provider-e2e/input-game-union-policy/openrouter.json` records exactly two live Luna requests (low/default, 4096 output tokens each), creation, selected material edit, recovery, export, and standalone input win/loss/restart. Application source `905b682` is operator-supplied, not remotely attested. No account, cloud recovery or publication was tested in this run.
- Gateway input-game acceptance passed in `39b8c90` (`docs/evidence/provider-e2e/gateway-input-game-diagnostics/`): exactly two Luna HTTP200 calls, low/default, cap4096, create/edit, reload, export and standalone input win/loss/restart. Local app source7e74569 is operator-supplied. No account/cloud/publication was exercised. Earlier failures remain retained; the passing run does not establish their causes.
- Same-project republishing is verified in `docs/evidence/republishing-browser-live/resume-report.json`: distinct deployments, served revision 2, and signed-out browser readiness. A later live run in `docs/evidence/publication-continuity-live/report.json` proves revision 1 remained available while revision 2 was INITIALIZING/BUILDING, then revision 2 became READY. Failed-deployment continuity remains unverified.
- Durable generation journals/checkpoints exist in `src/lib/server/generation-runs.ts` and their focused tests/evidence. Older claims that the journal is absent are obsolete; provider-stream resumption is not promised.
- Browser-only modeling is the current product requirement (`prompt.md`, browser-first runtime section). Historical portable native Blender packaging gaps are not current product release requirements.
- Saved OpenRouter flagship evidence verifies keyboard/touch crystal collection and portal win/reset, plus separate carry probes for all three platforms (`flagship-program-traversal`, `flagship-platforms`, `flagship-platform2-corrected`). The newer exact exported GPT-6 Luna ZIP passed Android 15 emulator Chrome 124 touch gameplay with moving bounce contacts on all three platforms, all five crystals, portal win at score 5, and a fresh post-reset score-0 frame (`android-openrouter-flagship-20260927/fresh-android-api35-touch-replay/report.json`). That replay forced Canvas2D and did not use a published URL or physical device. The earlier public `publication-flagship-openrouter/platforms-sequential-phase-aware/report.json` proves one desktop keyboard sequence across platforms 1 → 2 → 3 with landing/carry checks and no ground contact observed at its sampling intervals; it does not establish per-frame absence of ground contact. The published mobile-touch sequence in `publication-flagship-openrouter/platforms-sequential-touch/report.json` failed the first-platform carry check, so published touch-platform acceptance remains open.
- The later GPT-6 Luna OpenRouter flagship ZIP passed live Orbsie publication to one new Vercel Orb project with revision-1 asset/license checks, revision-2 same-project material republish, previous-release availability during build, and a stable signed-out share page (`publication-flagship-openrouter-gpt6-20260927/report.json`). The final public revision also passed desktop keyboard and emulated mobile-touch score-5 portal win and restart without inference or external requests (`publication-flagship-openrouter-gpt6-20260927/traversal/report.json`). This is a published clone of a saved provider-origin export; it does not close fresh provider-to-publication continuity, physical Android, or the separate moving-platform touch sequence.
- Real browser ChatGPT subscription consent/discovery/inference remains unverified. Historical local-companion tests do not satisfy the browser-only journey. Owner extension-connected Chrome now works through CUA; device-code completion and real subscription acceptance remain pending, as reconciled above.
- Memory-cap evidence is strengthened in `71c50c8`: a valid recipe succeeds after a 4 MiB allocation and rejects an 8 MiB + 1 allocation with execution error rather than timeout; all 13 procedural tests pass. Real-worker host API isolation, timeout, cancellation and recovery are separately recorded in `browser-procedural-foundation-worker/report.json`. This closes the specific weak allocation assertion identified in `33ee035`, not the whole geometry/isolation gate. Native Blender budget reports do not establish browser behavior.
- Representative native-GPU/mobile performance and complete live timing remain open. SwiftShader fixture observations are not representative-device certification.
- Visible failed-generation retry/last-working controls are accepted in `60f91c7`: eleven targeted tests, typecheck, production build and a seven-request deterministic browser regression passed (`docs/evidence/generation-failure-recovery/`). They are deployed in `7e74569`, with read-only smoke evidence in `docs/evidence/recovery-diagnostics-release/`. Broader behavior, catalog, provider-publication and full-plan requirements below still need requirement-specific reconciliation.
- Current standing owner authorization permits meaningful Luna-only provider milestones, up to five Gateway calls/test and two OpenRouter calls/run, with 4096 output tokens/call, with no automatic retries. Users' model selection is unrestricted by this testing policy. Historical requests for Astra live tests are superseded.

## Current evidence reconciliation — 2026-09-10 (HEAD `39710bd`)

The current deployed release is source `f88bcc9`, recorded by `39710bd`, at `https://orbsie.com`. The stale-load release report records a read-only production smoke, exact player/worker/WASM hashes, anonymous journal `401`, and the real browser placeholder/canvas check. It made no model calls and is not provider acceptance (`docs/evidence/stale-load-release/`).

The six later evidence commits close several stale claims. The JSON reports identify the live target, provider, model, processing tier, key scope, cap and request statuses; they do not embed an application source SHA. The source references below are therefore the exact references recorded by the companion acceptance note where present, with the evidence-recording commit listed separately. A recording commit is not proof that the run used the current `HEAD`.

| Evidence | Source reference / recording commit | Exact live configuration and result | Boundary |
|---|---|---|---|
| Deformation (`browser-deformation-openrouter/`) | source reference `86b20f8`; recorded `a5eb98e` | Live browser OpenRouter API key; `openai/gpt-5.6-luna`, low reasoning, `default`, local-only key, 512 output tokens; two HTTP 200 requests; twist+taper creation/edit, export and standalone playback passed. | This is a bounded geometry-family acceptance, not Gateway, ChatGPT, gameplay, publication or performance evidence. |
| Seeded variation (`browser-vary-openrouter/`) | source reference `86b20f8`; recorded `4e7b83f` | Same live OpenRouter/Luna/low/default/local-only configuration and 512-token cap; two HTTP 200 requests; `vary(seed 7)` creation and amplitude-only edit, export and standalone playback passed. | Do not generalize to other recipes or authorize another call from this prior cap. |
| Flagship (`flagship-openrouter/`) | source reference `f59e78b`; recorded `561a542` | Live browser OpenRouter API key; `openai/gpt-5.6-luna`, low reasoning, `default`, local-only key, owner-authorized raised 4096-token cap behind `ORBSIE_OPENROUTER_RAISED_CAP=1`; two HTTP 200 requests; 28 operations/13 mixed catalog-procedural-generated entities, material edit, export and standalone playback passed. | The raised cap was bounded to this journey class; it does not close the input-game or other providers. |
| Garden second scene (`garden-openrouter/`) | app source SHA not recorded in report; recorded `fafe0fa` | Live browser OpenRouter API key; `openai/gpt-5.6-luna`, low reasoning, `default`, local-only key, same owner-authorized 4096-token raised cap; two HTTP 200 requests; 18 operations/8 entities, scoped edit, export and standalone playback passed. | This closes the OpenRouter second-scene gate only; no Gateway/ChatGPT claim. |
| Browser procedural authoring (`browser-procedural-live-openrouter/`) | app source SHA not recorded in report; recorded `73a7388` | Live browser OpenRouter API key; `openai/gpt-5.6-luna`, low reasoning, `default`, local-only key, same owner-authorized 4096-token raised cap; two HTTP 200 requests; retained QuickJS source/hash, new-only procedural creation and source-revision edit, export and standalone playback passed. | The earlier observed 429/invalid-update record is superseded for this bounded case. No new cap or retry is authorized by that success. |
| Production publication (`publication-live/`) | app source SHA not recorded; platform deployment `orbsie-29rse4uja`; recorded `2632a40` | Live account/cloud/Vercel publication and signed-out zero-cookie browser; no provider, model or output cap because the vehicle was a deterministic protocol-geometry world; sign-up, revision-1 cloud save, per-Orb project/deployment, HTTP 200/data-ready/canvas/no-page-errors passed. | It closes the baked deterministic publication path. It does not prove model-backed production creation, full gameplay, republishing recovery or provider-specific publication. |

The OpenRouter input-game record was attempted three times at the owner-authorized raised 4096-token cap: one recipe failure involving touching solids, followed by two harness rejections of non-procedural entities, with HTTP 200 provider responses and no fallback (`docs/evidence/provider-e2e/browser-input-game-openrouter/`). Review identified that the harness excluded valid baked browser-generated geometry. The corrected harness uses canonical project validation and actual IndexedDB GLB digest checks while retaining the game/edit/export assertions; targeted tests pass, but no live retry has validated this correction. The older 512-token truncation/429 attempt remains historical. No further live call or cap increase is authorized by these failures. Hosted ChatGPT browser fixtures remain synthetic for account/inference/cloud; production device issuance/cancellation is real, but consent and subscription generation are unverified. Gateway has only the historical server-funded free path; no BYOK test key is configured.

Browser modeling implementation and deterministic editor evidence cover revolve, custom meshes, tubes, composition/mirroring/baked arrays, hierarchy, twist/taper, seeded variation and restricted procedural execution. The full objective remains incomplete. Historical rows below are retained as requirement inventory; this reconciliation and the current gate list take precedence over their older status claims.

## Historical evidence checkpoint — 2026-09-08

This checkpoint supersedes conflicting historical statements below. The full plan remains incomplete. Evidence records a particular run and source revision; it is not a fresh observation of production.

| Area | Verified evidence | Remaining scope |
|---|---|---|
| Production release | `docs/evidence/publication-recovery-release/report.json` records source `385b662`, homepage 200, anonymous journal 401, exact player/worker hashes and browser smoke. The publication change passed 56 targeted tests and a production build. The earlier batched suite at `f6e5801` passed 498 tests with 7 skips. Accepted entity-update draw metrics are included in this platform release. | This read-only deployment check does not prove live generation or dedicated per-Orb publication. |
| Real ChatGPT interruption recovery | `docs/evidence/provider-e2e/chatgpt-reload-recovery/chatgpt-local.json` and `wrapper.json` record document-reload recovery, explicit continuation, targeted edit, persistence, export and standalone playback, with three generation requests. Fresh-context recovery records zero generation requests. | Does not prove provider-stream resumption or equivalent Astra OpenRouter/Gateway workflows. |
| Interrupted formation revisions | `3a8829a` and `0b57752` implement bounded area-weighted particle bridges and worker-prepared asset samples. `docs/evidence/formation-continuity/report.json` covers three families, interrupted position/color continuity, real-time handoff and solid recolor. `docs/evidence/prepared-particle-workers/report.json` covers both actual decoder workers. | Broader visual acceptance and normal-GPU frame-time certification remain open. Current regular Chrome uses SwiftShader despite a physical RTX 8000; see `docs/evidence/browser-renderer/report.json`. |
| Development usage policy | `675a48f`; `AGENTS.md`, `prompt.md`, `.codex/config.toml`, and the Luna role specify Astra low review, one Luna xhigh worker, concise context, batched validation, standard processing and Fast disabled. | Enforce one-worker orchestration even if the host permits more. |
| Public sharing metadata | `0ef34d6`, `5baf75a`, and `aa464e5` capture immutable revision title, bounded thumbnail and public creator; promote only with verified publication; truncate mobile attribution. Publication metadata tests, renderer thumbnail capture and responsive page fixture evidence are checked in. Both database metadata columns were migrated. | Dedicated per-Orb Vercel Project creation remains permission-blocked. Platform deployment and page fixtures do not prove successful independent publication. |
| Provider preflight | `03840eb` and `3636b02` declare catalog/contract capabilities and reject absent or known-incompatible models before quota or inference. `docs/evidence/provider-capabilities/` and `generation-preflight-release/` record real catalog reads and deployed rejection checks without model calls. | Funded/authorized Astra-low creation and edit E2E through OpenRouter and AI Gateway remain unverified; historical Luna evidence is not a substitute. |
| Experience milestones | `23c26d4` records submission, reservation, seed draw, controls, objective readiness, generation completion and publish readiness independently in bounded browser memory. Twenty-four focused tests and the actual renderer fixture pass. See `docs/evidence/experience-metrics/README.md` for precise semantics. | Fixture observations do not establish live provider latency, objective reachability or normal-device performance. |
| Portable local modeling | Local isolated Blender execution, generated assets, persistence and exports have prior real ChatGPT evidence. | A release-certified portable runtime with dependency/license/source closure and clean-host validation is still absent. |

Flagship revision follow-up: `docs/evidence/flagship-revisions/report.json` now records a passed actual-editor fixture run: selected giant pink mushroom with unrelated entities preserved, middle-platform speed 1 → 0.3, two added crystals, HUD goal 7, exact undo restoration to goal 5, and reload recovery. Astra reviewed the harness and screenshots. Fonts are explicitly stubbed and motion reduced; this is not live-provider, animation, or dedicated-publication evidence. The real-provider matrix and signed-out dedicated publication remain required.

Kernel pinning and license follow-up: `package.json` pins exact versions (`manifold-3d` 3.3.2 matching `BROWSER_MANIFOLD_KERNEL_VERSION`, `three` 0.185.1, `zod` 4.5.4) with a committed lockfile, and `public/modeling/` locally hosts the kernel/interpreter wasm files alongside `manifold-LICENSE.txt`, QuickJS license texts and `manifold-provenance.json`. The vendored package ships the Apache-2.0 license text. This confirms the pinning/license review for the modeling runtime; deployment/publication license packaging remains gated on live publication acceptance.

Browser deformation and seeded variation follow-up: commits `952ff2b` and `5b19d2a` implement bounded `twist`/`taper` deformation and deterministic seeded `vary` in the browser Manifold kernel with mesh-validated topology, preserved Y extents, bounded parameters, zero-height and collapse rejection, and WASM cleanup on success and failure. Fixture editor evidence in `docs/evidence/browser-modeling-editor-deformation/` and `docs/evidence/browser-modeling-editor-variation/` proves real-editor creation, targeted revisions (twist preserved/taper widened; seed stable/profile changed), exact undo/redo, invalid-edit preservation, reload, ZIP export and standalone rendering without inference. Unit tests compare deformed vertices against independently computed expectations. The new node kinds remain unadvertised to providers; live-provider and representative-device acceptance stay open, as does the cross-request retry log (durable operation envelopes) that remains architectural.

Latest local measurement follow-up: `f9967e2` adds accepted entity-update-to-draw timing, and `b48d9bd` includes that instrumentation in the standalone player. `docs/evidence/input-feedback-normal-motion/` records next-RAF feedback at 106.9 ms, exceeding the 100 ms target. `docs/evidence/render-performance-no-recording/` records SwiftShader frame intervals of 33.4 ms median and 50.1 ms p95; this is not normal-GPU certification. `docs/evidence/catalog-comparison/` verifies actual catalog response bytes and worker decoding across procedural, catalog and mixed modes without inference; catalog-only and mixed all-entity draw times exceeded 100 ms. These measurements keep the performance gate open.

Portable-runtime follow-up: `docs/evidence/native-notices/` maps 342 installed-system files to 289 package notices, whose bytes/hashes were independently verified. This does not supply the absent official runtime archive, corresponding sources, an installer, or clean-host certification. The bundled Node launcher is implemented and tested separately in `docs/evidence/packaged-node-launcher/`; older statements that every package requires host Node are historical.

Composer continuity follow-up: `docs/evidence/composer-continuity/` proves the desktop keyboard Enter path keeps the same focused textarea and canvas during normal logical descent while a fixture response is held. A follow-up draft typed without refocusing survives completion, and the original message appears exactly once. Blur/focusout counts are zero; the final reviewed run has 129 continuity samples without violations. This is deterministic fixture evidence, not partial-stream gameplay, mobile, live-provider, or performance certification.

Play-during-stream follow-up: `docs/evidence/play-during-stream/` derives a deterministic stream from the saved ChatGPT one-crystal input-rule game. The real Play button and ArrowRight produce score 7 before commit; a material update persists before EOF while the same game program, score and Play mode remain intact. After commit/EOF, ArrowUp wins with score 7. One response remains open between those phases. This proves this input-rule path under incremental scene updates, not physical traversal or live-provider streaming.

Publication recovery follow-up: the retry path now searches bounded Vercel v7 pages with decreasing timestamp cursors and exact immutable metadata, separating the Vercel project ID from the Orb ID. Incomplete/aborted searches fail closed before deployment creation. A three-page regression caught and corrected a cursor-direction defect; 56 publication-focused tests and the production build passed. See [publication recovery](publication-recovery.md). Live dedicated publication remains unverified.

Garden interaction follow-up: `docs/evidence/garden-interaction/` proves the current no-demo editor creates the distinct garden via one test-only fixture response, reloads the authored world, and exports its 15 entities including 12 bloom behaviors. Stable rendered flower pixels expand after a real pointer click and return near their original area/position on a second click, in both editor and independent ZIP player. Astra reviewed the source/screenshots and strengthened the initial evidence with baseline and reversible-toggle checks. Normal-motion SwiftShader desktop checks passed with no live provider calls or page errors; this is not live-provider, mobile, or dedicated-publication evidence.

Current test authorization and follow-up: owner restricts new live model tests to Luna, while end users retain supported model choice. `docs/evidence/provider-e2e/luna-chatgpt-input-game/` passes real managed ChatGPT Luna low/default creation, scoped edit, reload, export and standalone input-rule win/loss/reset in exactly two calls with no fallback. This supersedes the Astra-only test requirement in historical audit rows, but does not prove the full flagship, OpenRouter/Gateway matrix or dedicated publication. `docs/evidence/agent-blender-runtime/` separately verifies real installed-Blender GLB construction through the new agent CLI; portable delivery remains open.

Luna provider matrix after authorization clarification: the existing `docs/evidence/provider-e2e/openrouter.json` proves OpenRouter Luna creation, scoped edit, reload, export and standalone loading. `docs/evidence/provider-e2e/blender-openrouter/openrouter.json` additionally proves one generated Blender asset with no catalog reuse, followed by edit/reload/export/standalone loading at a 512-output-token cap. These are valid historical Luna runs, not new measurements. The new ChatGPT Luna report covers its input-rule game. Gateway's `docs/evidence/provider-e2e/blender-gateway-free/free.json` stopped before generation because fewer than two free prompts remained; it supplies no successful Gateway/Blender E2E. A funded Gateway credential and test spending cap are requested. The full flagship on each provider, portable Blender delivery and dedicated publication remain unproven; do not repeat completed small OpenRouter checks merely to refresh dates.

## Historical audit and supporting evidence

The sections below retain earlier findings as a requirement backlog. Their older test counts and missing/unverified claims must be reconciled with the checkpoint above and relevant evidence before use; they are not a current completion certificate.

The stable parcel anchor/tangent basis and renderer transition are implemented. `docs/evidence/parcel-transition/report.json` covers descent, local reopen, return, repeated arrival and reduced motion using a stubbed generation fixture, with one canvas and no page errors. Full production timing, interaction responsiveness and camera/composer coordination remain open; historical transition rows below should be read with this narrower new evidence.

Audit date: 2026-09-07/08. This audit compares the complete current `prompt.md` (including the owner additions at lines 5 and 111) with the source, tests, and checked-in evidence. It does not reduce the target scope to the current implementation.

Status meanings: **proven** means the requirement has matching source and credible checked-in test or browser evidence; **partial** means a bounded slice exists but a material requirement is absent; **missing** means no implementation was found; **unverified** means an implementation exists but the required live or external evidence is absent or failed; **conditional** means the brief explicitly allows the current boundary (for example, a trusted ChatGPT companion) pending the stated condition.

Snapshot note: this audit was written during parallel implementation. Root's no-demo changes are now committed as `cacbd7a` with production-build browser evidence in `docs/evidence/creation-access/report.json`; the ringless GitHub avatar was verified in `a6b59b3`. Publication integrity and catalog integration subsequently shipped in `0b8b88a`, with evidence in `7387f0c`; the catalog section below has been refreshed. Other historical rows require revalidation against current source. Status rows below remain an audit backlog, not a completion certificate. Historical model restrictions include an owner-authorized local-only Luna exception for the supplied OpenRouter credential; do not use that credential with Astra without fresh authorization.

Interpretation: example state names, suggested libraries, a dedicated background publication worker and provider-level stream continuation are not independent mandatory requirements. Equivalent implementations must satisfy the observable behaviors and durability requirements.

Local checks at audit time: `npm test` passed with 107 tests and 2 opt-in database tests skipped; `npm run typecheck` passed; `npm run build` passed. These checks do not establish live provider, dedicated-publication, asset-catalog, or production-performance completion.

## Owner updates and execution constraints

| Requirement | Status | Evidence | Remaining action |
|---|---|---|---|
| Remove user-facing demo mode. Use free prompts or a linked provider/account; preserve the prompt and request connection/sign-in when unavailable. Fixtures are test infrastructure only. | **proven in current worktree** | Current `src/components/orbsie.tsx` and `src/lib/store.ts` remove the old `demo` state and fixture execution path; `src/app/api/trial/route.ts`, `src/lib/server/trial.ts`, `docs/free-prompts.md`, and `docs/evidence/free-trial.json` cover the free path. | Re-run the production browser flow after the root changes and remove stale “Demo” wording/evidence from `docs/provider-ui-verification.md` and `.vercel/provider-ui` if those artifacts remain user-facing claims. |
| Apache 2.0 licensing. | **proven** | `LICENSE`, `package.json`, `README.md`, and generated export metadata in `src/lib/export.ts`. | Keep license/provenance metadata in the new asset pipeline and every export. |
| Astra low/standard defaults, Luna worker exception, Orbsie standard processing, Fast disabled. | **partial** | `src/lib/model-modes.ts`, `src/lib/server/generation.ts`, `scripts/local-chatgpt.mjs`, `docs/chatgpt-integration.md`, `docs/flagship-live-verification.md`. | Verify the exact current provider IDs and run every live provider test with discovered Astra low and standard processing; do not reuse the historical Luna OpenRouter test as current evidence. |
| Owner’s Google Cloud project `orbsie` and Neon PostgreSQL. | **proven for configured cloud infrastructure** | `docs/infrastructure.md`, `docs/cloud-verification.md`, `src/lib/server/storage.ts`, `scripts/schema.sql`, production cloud evidence. | Continue to document any environment-specific values without recording secrets. |
| Quality, Balanced, Budget recommendations with the full compatible catalog under Advanced. | **proven in code; documentation inconsistent** | `src/lib/model-modes.ts`, `src/lib/model-catalog.ts`, `src/app/api/models/route.ts`, `tests/model-catalog.test.ts`, `docs/evidence/preset-catalog.json`, `docs/model-selection.md`. | Reconcile stale `docs/model-recommendations.md` (it still describes Sol/Luna mappings that differ from the current code) and refresh catalog evidence when IDs change. |
| Exact `What experience to build?` placeholder, no Island/Garden selectors, microphone dictation. | **proven** | `src/components/orbsie.tsx`, `src/lib/use-dictation.ts`, `scripts/verify-dictation.mjs`, `docs/evidence/dictation-report.json`, final browser-flow evidence. | Keep the exact selector-free landing assertion in future browser checks. |
| Live model-backed tests use Astra low, discover the real ID, and fail rather than fall back. | **unverified/partial** | Local ChatGPT harness and tests (`scripts/local-chatgpt.mjs`, `tests/local-chatgpt.test.ts`, `docs/chatgpt-integration.md`) satisfy this boundary locally; `docs/verification.md` records failed OpenRouter Luna attempts and Gateway Luna trial evidence. | Run compliant Astra-low OpenRouter and Gateway tests with no fallback and retain provider-specific evidence. |
| Frequent reviewed commits/pushes and Vercel deployment. | **partial** | `git remote -v`, commit history, `docs/evidence/resumed-delivery/production.json`, `README.md`. | Root should commit/push the current coherent changes and re-record the exact deployed commit. |
| Entrance planet roughly 80% of viewport, dark space, and substantially reduced clutter/text. | **partial** | `src/components/world.tsx`, the landing overrides near the end of `src/app/globals.css`, `docs/evidence/landing-space.png`, `docs/evidence/landing.png`, mobile landing captures. | Measure/inspect the final production layout at desktop and mobile after current UI changes; preserve the dark landing while keeping the workspace readable. |

The execution plan is mostly a process contract rather than a product feature. The repository shows Astra-oriented planning/review notes and many focused reports, but delegation choices, processing tiers, and “final quality ownership” cannot be proven from source alone. Treat those as **partially evidenced process requirements** and retain per-worker changed-file/check/risk reports for future work.

## 1. Product, ownership, and delivery scope

| Explicit requirement | Status | Evidence | Remaining action |
|---|---|---|---|
| Product is Orbsie; owner-controlled `orbsie.com`, GitHub organization, and intended production URL are connected with verified configuration. | **partial/proven for deployment, conditional for ownership assertions** | `README.md`, `git remote -v`, `docs/evidence/resumed-delivery/production.json`, `docs/evidence/domains.json`, `docs/infrastructure.md`. `a6b59b3` plus `assets/brand/README.md` record the ringless organization-avatar upload and visual verification. | The pending-avatar follow-up is closed: `docs/verification.md` now states the avatar upload is complete and verified. Keep domain/repository/deployment evidence tied to the deployed commit. |
| Apache-licensed open-source Vercel web app using the `orbsie` repository. | **proven** | `LICENSE`, `package.json`, `README.md`, Git remote, production evidence. | None beyond preserving the license in distributed assets/exports. |
| Nontechnical audience can create, revise, play, and share Orbs. | **partial** | `src/components/orbsie.tsx`, browser-flow screenshots, `docs/evidence/final-browser-flow.json`, account UI evidence. Provider setup and publication permission failures still impose technical friction. | Complete the public provider and publishing paths, then recheck the first-run flow with no developer terminology. |
| Incremental responsive creation is the defining feature. | **partial/unverified for required live providers** | `src/lib/protocol.ts`, `src/lib/store.ts`, `src/components/world.tsx`, formation screenshots/video, local Astra structural evidence. | Prove the same visible incremental path with compliant live OpenRouter and Gateway runs; retain intermediate-morph evidence. |
| Each Orb is an independent project; planet/parcels are a visual metaphor, with no multiplayer, marketplace, or shared land simulation in this release. | **partial** | Local library IDs, cloud `orbs` rows, `src/lib/export.ts`, `scripts/schema.sql`; no multiplayer/marketplace code found. Dedicated per-Orb Vercel publication is blocked. | Complete one independent published project per Orb and signed-out playback; keep the deferred social/marketplace scope out of this slice. |
| Complete vertical slice: prompt → streamed creation → playable preview → scoped revision → save → publish → public game. | **partial** | Fixture browser flow and winning traversal prove the local core; account/cloud evidence proves saving; `docs/cloud-verification.md` records publication HTTP 403/502. | Resolve team-token project/deployment permission, run a real publish/re-publish/public-playback check, and repeat with a live provider. |
| Visual quality/responsiveness ahead of later social feeds, billing, collaboration, multiplayer, and marketplaces. | **proven as scope boundary** | Source contains no such feature inventory; `README.md` and docs state this is in progress. | Keep these later features out while closing mandatory core gaps. |
| Routine assumptions recorded; missing external credentials/configuration documented; existing resources preserved. | **proven** | `docs/architecture.md`, `docs/infrastructure.md`, `docs/verification.md`, `.env.example`; publication and Resend gaps are explicitly recorded. | Refresh reports after root changes and retain the no-secrets rule. |

## 2. Nonnegotiable experience

| Explicit requirement | Status | Evidence | Remaining action |
|---|---|---|---|
| Landing is dominated by a slowly rotating glowing planet. | **proven visually for the landing prototype** | `src/components/world.tsx:60-191`, `src/app/globals.css`, `docs/evidence/landing-space.png`, landing browser evidence. | Recheck final production after current changes and keep the planet dominant at all supported sizes. |
| Floating composer is the obvious entry point over the planet. | **proven** | `src/components/orbsie.tsx`, exact placeholder assertions in `scripts/verify-flow.mjs`/`scripts/verify-dictation.mjs`, landing captures. | None beyond regression coverage. |
| Submission starts generation and the continuous transition together. | **implemented; fixture-browser proven; live timing unverified** | `src/lib/store.ts` enters `descending`/`building` before consuming `/api/generate`; `src/components/world.tsx` advances a renderer-owned parcel transition independently. `docs/evidence/parcel-transition/report.json` records one stubbed generation request with early, mid, and settled descent observations. | Capture first reservation timing on the current free/provider path; the fixture request and screenshots do not establish live-provider timing. |
| Composer moves left into chat/history while preserving prompt, focus, and continuity. | **implemented; desktop fixture-browser proven; current-build/mobile coverage unverified** | `src/components/orbsie.tsx`, `.chat-panel`/`arrive` CSS, `scripts/verify-composer-continuity.mjs`, and `docs/evidence/composer-continuity/report.json` cover the actual keyboard Enter path: 129 normal-motion samples, zero blur/focusout events, unchanged canvas, a draft typed without refocus, and one exact original message. | Repeat the focused browser check against the current build at mobile/reduced-motion widths; the checked-in run uses a deterministic fixture and does not establish live-provider or performance behavior. |
| Planet reveals a chosen parcel and camera moves toward it. | **implemented; fixture-browser proven for repeated and reduced-motion local arrivals; production visual/performance unverified** | `parcelFrame`/transition helpers in `src/lib/parcel-transition.ts`, `Scene` camera/planet progress in `src/components/world.tsx`, `tests/parcel-transition.test.ts`, and `docs/evidence/parcel-transition/report.json` cover deterministic frames, initial descent, direct open, return, repeated arrival, and reduced motion with one canvas and no page errors. | Measure/inspect the current production transition on mobile and normal hardware; the fixture run does not establish live-provider timing or device performance. |
| Parcel resolves to a locally flat usable game area while feeling like a landing. | **bounded blend implemented; fixture-browser proven; full scale-change concealment unverified** | `Scene` blends the parcel tangent frame into the flat island using `patchBlend`, surface position, orientation, and globe scale in `src/components/world.tsx`; the parcel-transition screenshots cover early/mid/settled descent and return. | Complete or measure the horizon/terrain/lighting and scale-occlusion blend; fixture screenshots do not certify the production visual result. |
| Objects arrive at intended locations as glowing orbs and progressively become requested objects. | **partial/unverified live** | `src/lib/geometry.ts`, `Formation` in `src/components/world.tsx`, fixture operations, `docs/evidence/formation.png`, video evidence, local Astra command evidence. | Prove the current production user path with real Astra-low provider commands; the current no-demo policy means fixture events must remain test-only. |
| User can play and request changes while creation continues; completed parts remain responsive. | **fixture-proven for a narrow input-rule path; live-provider and broader traversal unverified** | `scripts/verify-play-during-stream.mjs` and `docs/evidence/play-during-stream/report.json` derive a held NDJSON stream from the saved one-crystal ChatGPT replay. Real Play and ArrowRight produce score 7 before commit; a material update persists while the response remains open, preserving score, game rules, and Play mode; commit/EOF is followed by a real ArrowUp win. | Run the same browser scenario against a live provider stream and add physical traversal or other compatible gameplay edits; the replay is deterministic fixture transport, not live streaming or physical traversal. |
| Clicking an object highlights it and supports a scoped instruction. | **proven for fixture/local path** | Selection halo/chip in `src/components/world.tsx`/`src/components/orbsie.tsx`, `docs/evidence/mushroom-edit.png`, browser flow, `tests/local-chatgpt.test.ts`. | Repeat against a live API-key path and verify selection during an in-flight generation. |
| Publishing creates a real independently accessible URL. | **missing/unverified** | `/api/publish` and `/o/[id]` exist; `docs/cloud-verification.md` records Vercel project creation denied with 403. | Obtain a team token that can create projects/deployments, publish an Orb, and verify signed-out playback. |
| Experience must not be generic chat + blank canvas, spinner + finished scene, or post-generation-only animation. | **partial** | Persistent canvas, streamed reducer, formation shader, and screenshots meet the local fixture intent. Required live-provider/public evidence is still absent. | Preserve the visual event evidence in final acceptance and reject any path that degrades to prose-only generation. |

## 3. Visual direction and language

| Explicit requirement | Status | Evidence | Remaining action |
|---|---|---|---|
| Bright turquoise/green/blue/warm/lilac/coral cosmic art direction, not a dark developer dashboard. | **partial** | Planet colors/materials in `src/components/world.tsx`, CSS palette, landing/workspace captures. Landing is intentionally dark after the owner update, while workspace is bright. | Review final visual balance at production desktop/mobile and retain crisp controls over selective bloom. |
| Planet has depth, atmosphere, cloud movement, rim light, gentle rotation, land/life, and stylized rather than photorealistic treatment. | **proven for renderer implementation** | `Planet` in `src/components/world.tsx:60-191`, screenshots/video. | Verify the final interaction path, reduced motion, and performance on real hardware. |
| Rounded typography, spacing, translucent high-contrast composer; no dense nav/marketing hero. | **proven/partial** | `src/app/globals.css`, current landing UI, clutter-reduction owner update, captures. | Remove stale copy in old evidence/docs and inspect the current root UI at production widths. |
| Suggested copy is editable; user controls use Orb/Create/Play/Change this/Publish/Share; diagnostics and provider credentials stay in appropriate places. | **partial** | `src/components/orbsie.tsx` uses the requested control vocabulary and settings modal; schema/diagnostics are not exposed as editor UI. | Audit all current visible strings after the no-demo changes and keep provider names confined to connection settings. |

## 4. Planet-to-parcel transition

| Explicit requirement | Status | Evidence | Remaining action |
|---|---|---|---|
| One persistent renderer/canvas spans landing, descent, editing, and play; camera/UI share a transition controller. | **partial; one-canvas/renderer transition fixture-proven; shared UI controller unimplemented** | `World` is mounted once in `src/components/orbsie.tsx`; `Scene` owns renderer progress in `src/components/world.tsx`; `docs/evidence/parcel-transition/report.json` records one canvas across descent/open/return/repeated/reduced-motion scenarios; `docs/evidence/composer-continuity/report.json` keeps that canvas and textarea continuous while the composer enters the workspace. UI motion remains CSS-driven and phase state has no explicit play/publishing controller. | Consolidate camera and composer motion into an explicit controller covering landing, descent, editing, and play, then measure the coordinated timings. |
| Stable parcel anchor/tangent basis, pre-descent orientation, decelerating planet rotation. | **implemented; unit- and fixture-browser proven; production visual unverified** | `parcelFrame`, `planetSpinRate`, and `stepParcelTransition` in `src/lib/parcel-transition.ts`; `tests/parcel-transition.test.ts` checks deterministic orthonormal frames and slowing spin; repeated-arrival and reduced-motion screenshots are recorded in `docs/evidence/parcel-transition/`. | Retain repeated-arrival coverage in the current production/mobile visual pass; the checked-in evidence uses a deterministic local fixture and does not establish live-provider or normal-device rendering. |
| Globe-to-local patch geometry/lighting/horizon/terrain blend with LOD/occlusion/framing. | **partial; transform blend fixture-proven** | `Scene` applies tangent orientation, globe scale/offset, smooth patch blend, island scale, and landing/workspace lights in `src/components/world.tsx`; `docs/evidence/parcel-transition/report.json` covers early/mid/settled screenshots. No LOD/atmospheric occlusion or measured horizon/terrain concealment is evidenced. | Add and visually measure the matching horizon/terrain/lighting and scale-occlusion treatment, including current device framing. |
| No planetary gravity or rotating playable ground. | **proven** | Flat island and local `stepGameplay` in `src/components/world.tsx`/`src/lib/gameplay.ts`; planet is hidden as workspace activates. | Keep this invariant while improving the transition. |
| Start generation immediately. | **implemented in code; fixture request/descent proven; live timing unverified** | `src/lib/store.ts` sets the initial descending/building state before consuming the relay; `docs/evidence/parcel-transition/report.json` records the single stubbed `/api/generate` request alongside early/mid/settled descent. | Capture first reservation timing under a real provider/free run; the fixture cannot prove production request latency or reservation ordering. |
| Composer motion ~0.7–1.0 s, descent ~3–5 s, no artificial hold of ready content. | **partial; bounded source timing and fixture visual pass** | `.arrive` is 0.75 s, the store uses a 4.2 s reduced-motion-aware phase timer, and `Scene` uses renderer-owned damped progress; parcel and composer reports show the path completing under a held fixture response but record no motion timings. | Measure actual composer/descent/ready times and remove the fixed phase hold if ready content arrives sooner; current evidence does not establish the target ranges. |
| Desktop chat panel ~320–380 px and responsive framing. | **proven for CSS target** | `.chat-panel` is 342 px, with responsive overrides in `src/app/globals.css`; mobile captures show the sheet. | Recheck current production build after root UI changes. |
| Small Back to planet control; existing Orbs reopen directly with optional short arrival. | **partial/proven locally** | Back control and `load`/recovery in `src/components/orbsie.tsx`/`src/lib/store.ts`. | Verify reopening cloud/public independent projects and avoid repeating the full entrance unnecessarily. |
| Mobile collapsible bottom sheet, reduced motion, unsupported-WebGL fallback. | **proven** | Mobile CSS, `prefers-reduced-motion`, `Boundary`/Canvas fallback in `src/components/world.tsx`, `docs/evidence/resumed-delivery/dictation.json`, final browser flow. | Keep a real-browser WebGL fallback check in the final suite. |
| Explicit landing/descending/building/editing/playing/publishing states with independent camera/build progress. | **partial** | `Phase` has landing/descending/editing; `building` and `playing` are booleans; publication is modal/state polling rather than a phase. | Add explicit state modeling and prove network delay does not freeze camera/input. |

## 5. Orb formations

| Explicit requirement | Status | Evidence | Remaining action |
|---|---|---|---|
| Reusable `OrbFormation` core system. | **partial** | `Formation` component plus `entityGeometry`/`addFormationSource` in `src/components/world.tsx` and `src/lib/geometry.ts`; `docs/architecture.md:9`. | Refactor/document the formation contract as a reusable named system with explicit lifecycle and asset hooks. |
| Stable entity ID and reserved → seed → coarse → refined → ready lifecycle; reservations only after model identification; separate validated refinements. | **partial** | `src/lib/protocol.ts`, fixture command sequence, protocol/recovery tests. Schema has `seed/coarse/ready` and geometry has coarse/refined, but no explicit refined stage or reservation metadata. | Verify equivalent lifecycle behavior in live/provider and asset paths; the example state names do not require a schema rename. |
| Seed at intended position/footprint with subtle pulse/bounded growth. | **proven** | `Formation` render loop and CSS/visual formation evidence. | None beyond live-path browser proof. |
| Visible silhouette morph via correspondence/deformation; multipart GPU bridge; no unrelated-mesh opacity crossfade. | **partial** | Vertex shader interpolation from `aFrom` to target in `src/components/world.tsx`; merged procedural parts in `src/lib/geometry.ts`. No complex multipart particle/surface bridge or robust correspondence exists. | Implement/verify multipart transitions and current-form correspondence for arbitrary revisions. |
| Semantic multipart object is one formation event. | **proven for procedural geometry** | `entityGeometry` merges parts per entity; tree/arch fixtures. | Extend the same identity to catalog assets. |
| At least organic, hard-surface, and multipart formation families. | **proven for fixtures** | Trees, platforms, arches in `src/lib/fixtures.ts`/`src/lib/geometry.ts`; formation captures and protocol tests. | Reprove with live provider and curated-asset/mixed paths. |
| Refinements transform current visible form and preserve location, scale intent, identity, selection. | **partial** | `previous` geometry source, reducer identity preservation, scoped-edit tests. Source is the prior target geometry rather than sampled current GPU form; no timing test proves selection continuity during rapid updates. | Track/snapshot current visible form and coalesce rapid revisions without restarting from a stale target. |
| Smooth recolor, growth, static→moving edits without unrelated recreation. | **partial** | `set_material`, `set_transform`, `set_behavior`, gameplay tests, mushroom/browser evidence. Color changes are state/material updates rather than a dedicated smooth interpolation; live visual edit proof is absent. | Add material/transform tweening and a browser regression for each edit family. |
| Geometry prepared off the interaction loop; GPU/lightweight animation; resources reused/released. | **partial** | GPU shader/render-loop interpolation and disposal in `world.tsx`; `docs/architecture.md:9` says preparation remains main-thread. | Move heavy preparation to workers, bound catalog decode, and retain disposal tests. |
| Typical transition ~0.6–1.2 s, overlapping independent objects, rapid refinements coalesced. | **partial** | 0.9 s render-loop progression and staggered fixture events; no coalescing implementation/evidence found. | Add a revision queue/coalescer and measure transition timings. |
| Unfinished previews identifiable; colliders/gameplay change only at safe simulation boundaries. | **partial** | Gameplay filters `stage === ready`; committed snapshots omit unfinished entities. Collider reconciliation is not a separate boundary system. | Add explicit collider commit/reconcile handling and a player-under-edit regression. |
| Cancel/failure preserves completed changes and coherently removes/restores unfinished previews. | **proven** | `committed`, `stop`, `generation-recovery.test.ts`, `relay-completion.test.ts`, docs recovery reports. | Keep this behavior when asset/provider paths are added. |
| Visible stream is driven by real reservations/recipes/revisions, not prose; fixtures are test-only under the owner override. | **partial** | Provider NDJSON commands and reducer are real; current root removed fixture execution from the user store. Historical UI evidence contains demo-mode artifacts and must be treated as obsolete for this requirement. | Re-run current free/provider browser creation and update stale demo evidence. |

## Curated 3D asset collection (mandatory owner addition)

| Explicit requirement | Status | Evidence | Remaining action |
|---|---|---|---|
| Download/maintain high-quality permissively licensed models with exact license and provenance. | **proven for initial collection** | Ten Kenney CC0 GLBs; `assets/catalog/manifest.json`, preserved license and contact sheet; source commit `e104ad7`. | Continue source/license review for every addition. |
| Review polygon/material/origin/scale/collider quality and bound caching. | **partial** | Manifest review data; `asset-geometry.ts` verifies hash/size, preserves transforms/colors and bounds cache leases; gameplay uses catalog bounds. | Broaden visual/collider and device-performance evidence as the collection expands. |
| Bounded typed catalog references with useful mixed generation. | **proven for tested mixed path** | `protocol.ts`, `asset-catalog.ts`, provider prompt integration; real Astra mixed run in `docs/evidence/provider-e2e/chatgpt-mixed/report.json`. | Extend live-provider matrix and validate selection quality on broader prompts. |
| Explicit new/original requests override catalog, including follow-ups. | **proven for tested English constraints** | Sticky policy in `asset-policy.ts` and reducer; actual new-only ChatGPT evidence in `docs/evidence/provider-e2e/chatgpt-local.json`; regression tests. | Broaden language/ambiguity coverage; current interpretation is conservative and English-focused. |
| Incremental formation and stable IDs/selection/gameplay; heavy work off interaction loop. | **partial** | Actual asset worker decode/transfer and WebGL atlas lifetime/replacement/StrictMode/export acceptance in ff61fbc (`catalog-texture-render-final-5/report.json`); retained software geometry and gameplay. | Finish software atlas appearance and measure representative device responsiveness. Historical main-thread decode limitation is resolved. |
| ZIP/public artifacts include referenced assets and licenses; reject unknown IDs/URLs. | **partial** | `asset-bundle.ts`, publication manifest validation, exported standalone browser proof; `docs/evidence/catalog-release/production.json` verifies production asset hash. | Dedicated world publication remains unverified because project creation returns 403. Main-app hosting is not proof of that workflow. |
| Real-provider catalog-only/mixed/new-only matrix and performance comparison. | **partial** | Actual ChatGPT mixed and new-only scene/edit/reload/export runs; deterministic catalog browser regression. | Complete provider matrix and controlled performance comparison. Small functional timings do not establish a speed improvement. |

## Historical local Blender construction (superseded product architecture)

**Historical evidence below does not create a current installation or companion requirement.** Current prompt.md requires browser-only modeling; native portable packaging is superseded. Preserve baked-asset compatibility and licenses.

The typed modeling protocol, isolated Linux executor, authenticated local connection, editor integration, generated GLB persistence and ZIP export were implemented. The real Astra-low browser flow in `docs/evidence/provider-e2e/blender/chatgpt-local.json` created one new Blender model, recolored it without changing geometry, recovered it after reload and played the exported standalone world. This is a functional single-model proof, not a performance or gameplay-completeness result. Private generated-asset upload/read, owner-scoped registry checks, cloud restore and publication bundling are implemented in commit `094bfb8`; automated tests cover bounds, integrity, quota and ownership checks. Live generated-asset cloud save and fresh-browser restore now pass against development storage: `docs/evidence/generated-cloud/report.json` records upload/save/read statuses, restored byte hash and owner isolation. Production deployment remains separate. The official runtime repackaging prototype remains `portable: false`; dedicated publication, the other provider paths, supported-platform installation and measured editor responsiveness still need completion.

## 6. Incremental authoring architecture

| Explicit requirement | Status | Evidence | Remaining action |
|---|---|---|---|
| Persistent runtime with streamed validated operations; no whole-app regeneration/reload per edit. | **proven for current protocol path** | `src/lib/store.ts`, `src/lib/protocol.ts`, `src/lib/server/generation.ts`, relay/recovery tests. | Preserve this path while adding assets and richer behavior. |
| Typed versioned IR: environment/seed; entities/transform/semantic/geometry/material/physics; revision/export metadata. | **partial/proven for the implemented subset** | `src/lib/protocol.ts`, `scripts/schema.sql`, `src/lib/export.ts`. Physics/asset refs and full revision metadata are incomplete. | Expand IR for assets, behavior graph, generation runs, and independent export metadata. |
| Composable behavior graph: inputs, variables, conditions, triggers, actions, timers, paths, collisions, scoring, win/lose/reset. | **partial; implemented bounded program** | `game-program.ts`, `game-session.ts`, `set_game`, ready-entity reference checks and checkpoint validation; deterministic collision/collection/timer/input scoring and exported playback. `docs/evidence/provider-e2e/chatgpt-authored-input-game/` proves real ChatGPT creation, scoped recolor, reload, ZIP and input-driven score/win/loss/restart. | Rendered variables/conditions, click/color/visibility, position/path actions and rule-edit restart notices now pass in `docs/evidence/game-actions/` and `docs/evidence/game-rule-edits/`. Complete multi-object path/collision interactions, collider-edit reconciliation, equivalent live API-key workflows and cloud recovery. |
| Asset references with ownership/dependencies. | **partial** | Shared geometry schema includes known catalog IDs and generated model metadata; generated-asset owner registry, cloud restore and export bundling are tracked in the local-modeling section above. | Complete packaged companion delivery and independent-publication acceptance for generated assets. |
| Model supports new combinations/shapes/rules, not a handful of canned games; extension boundary for custom/imported assets. | **partial** | `custom` parts and multiple procedural kinds in protocol; local Astra flagship produced 19 entities; no imported assets/custom-script boundary. | Add catalog/generated mix and richer validated behavior without `eval`. |
| Listed framed commands (`reserve_entity`, geometry/material/transform/behavior/environment/remove/commit). | **proven** | `commandSchema`, `applyOperation`, generation system prompt, protocol tests. | Extend commands for assets/behavior graph while preserving compatibility. |
| Provider-neutral envelope with protocol/project/run/op/sequence/base revision; syntax/semantic validation and bounds. | **partial/proven for current fields** | `envelopeSchema`, `applyOperation`, tests for ordering/stale refs/nonfinite transforms/object limits; unknown behavior dependencies and full geometry/asset bounds are incomplete. | Add explicit semantic dependency validation and asset/behavior/recursive limits. |
| Complete validated calls/records; no half JSON; model capability declaration and clear unsupported-model handling. | **partial** | SSE buffering and line validation in `src/lib/server/generation.ts`, `tests/generation.test.ts`; catalog filters language/tool support but no adapter capability declaration or structured-tool path. | Declare per-model streaming/schema/tool support and reject unsupported combinations before generation. |
| Incremental transactions, pending vs committed state, idempotency/order/revision protection. | **proven for the durable journal; provider-stream resume deliberately excluded** | Cursor/reducer, pending `stage`, `committed`, recovery tests. The "no cross-request retry log" statement is outdated: `generation_operations` persists every envelope, identical retries are acknowledged idempotently, conflicting duplicates/sequence gaps are rejected, leases mark expired runs interrupted, and bounded replay plus recovery-checkpoint rebuild are tested (`tests/generation-runs.test.ts`, `tests/generation-runs-route.test.ts`, `tests/store-generation-journal.test.ts`). Reconnect opens the recovered checkpoint with a continuation prompt. | Provider-stream resume is excluded by design (documented); keep the journal tests green through future changes. |
| Last valid scene on errors; committed checkpoints; reconnect/resume from sequence/checkpoint; finite Vercel lifetime handling. | **partial** | Local IndexedDB checkpoints and recovery tests; 175/180-second generation bounds; `generation_runs` table is declared but not used for durable resume; docs explicitly say provider/cross-device resume is absent. | Persist generation runs/checkpoints server-side and implement reconnect/regeneration from known sequence. |

## 7. Editing and playing

| Explicit requirement | Status | Evidence | Remaining action |
|---|---|---|---|
| Click selection halo and “Change this…” composer; conversation chip retains stable ID. | **proven locally** | `src/components/orbsie.tsx`, `src/components/world.tsx`, browser mushroom evidence, protocol/store tests. | Re-run with current live provider path. |
| Scoped context includes selected/neighbors/revision/instruction and preserves unrelated scene. | **partial** | Generation request includes selected ID, full project, and messages omitted; tests prove unrelated preservation. Neighbor selection/context is not explicit. | Verify scoped behavior in provider E2E; the full bounded project already contains neighboring objects. |
| Play/Edit controls, inspect/play camera/input, text entry cannot move player. | **proven for fixture/player** | `src/components/orbsie.tsx`, `src/lib/gameplay.ts`, gameplay tests, winning traversal. | Keep text-entry and focus checks in mobile/desktop regression. |
| Play while generation continues; preserve player position/score/timers/camera/unrelated entities. | **partial** | Separate authored project and transient `PlayerState`/score; moving-platform carry tests. No integrated browser stream+play test. | Add that end-to-end scenario and compatible patch reconciliation. |
| Rule/ground edits reconcile safely with checkpoint/reset notice. | **partial** | Moving-platform carry logic and reset controls; no ground-removal reconciliation path. | Add explicit safe-reset/checkpoint behavior for collider-affecting revisions. |
| Undo/redo/history, stop, retry, last working revision. | **partial/proven locally** | Store actions, bounded history, stop/recovery tests and browser flow; retry is manual prompt re-submission with no dedicated retry affordance. | Add visible retry/last-working controls and a failed-run browser test. |
| Follow-ups during a run use queue/cancel policy and prevent concurrent writers. | **partial** | `active?.abort()` cancels prior generation; local writer lease/Web Locks and recovery tests exist. No durable queue or cross-device lock. | Document the cancel-and-replan policy in UI and persist/coordinate writer state for cloud runs. |
| Keyboard and touch initial demo; public players need no account/AI key. | **proven for fixture/public hash and standalone player** | `docs/evidence/winning-traversal.json`, resumed winning traversal, `src/player/main.tsx`, `docs/evidence/export-report.json`. Dedicated Vercel public player remains unverified. | Re-run signed-out dedicated deployment after token permissions are fixed. |

## 8. Suggested implementation stack (optional guidance, not a missing mandatory feature)

| Suggestion | Status | Evidence/notes |
|---|---|---|
| Next.js, TypeScript, React, Vercel routes | **proven** | `package.json`, `src/app`, production build/deployment. |
| Three.js + React Three Fiber + small GLSL | **proven** | `src/components/world.tsx`, `src/lib/geometry.ts`. |
| Tailwind + Motion or equivalent | **optional equivalent proven** | Plain CSS and CSS animations are used; no Tailwind/Motion dependency. This is acceptable guidance, not a scope failure. |
| Zustand and transient per-frame state | **proven** | `src/lib/store.ts`, render-loop refs in `world.tsx`. |
| Zod | **proven** | `src/lib/protocol.ts`, API routes, tests. |
| Vercel AI SDK/provider-maintained OpenRouter transport | **optional/partial** | Direct OpenAI-compatible `fetch` adapter exists in `src/lib/server/generation.ts`; no AI SDK package. Keep only if direct transport remains well-tested. |
| IndexedDB drafts/operation log/cache/recovery | **partial** | `idb-keyval` local snapshots/history and recovery are proven; replayable operation log and asset cache are absent. |
| Managed Postgres/object storage, Drizzle/auth, optional Google sign-in | **partial/proven subset** | Neon/Postgres, GCS OIDC, Better Auth are documented/proven; raw SQL replaces Drizzle, and Google sign-in UI is not exposed. |
| Rapier or browser physics where needed | **optional equivalent partial** | Custom bounded movement/collision loop exists; no Rapier. The suggested engine is optional, but full behavior scope remains mandatory. |
| Vitest + Playwright | **proven** | 107 deterministic tests, browser scripts, screenshots, and recordings. |
| Explicit compatible pinned packages, lockfile, WebGL2 path | **proven** | `package-lock.json`, explicit versions, `next build`, Canvas/WebGL2 fallback. |
| Client rendering/physics/cache/export; server auth/relay/cloud/deployment; no browser secrets | **partial/proven subset** | Current split is visible in source and docs; workers, asset pipeline, and dedicated deployment remain incomplete. |
| Clear reusable modules and standalone runtime/schema | **partial** | Modules exist and standalone ZIP rebuild/playback passes; formation/assets/behavior graph boundaries need expansion. |
| Careful Three.js geometry lifecycle | **partial/proven subset** | Disposal and merged geometry are implemented; arbitrary morph correspondence and all asset lifecycle cases are absent. |

## 9. AI connections

| Explicit requirement | Status | Evidence | Remaining action |
|---|---|---|---|
| Working OpenRouter API-key path behind the common generation contract. | **proven for bounded browser-modeling journeys; incomplete overall** | Endpoint/relay in `src/lib/server/generation.ts`; live Luna reports in `docs/evidence/provider-e2e/flagship-openrouter/`, `garden-openrouter/`, `browser-procedural-live-openrouter/`, `browser-deformation-openrouter/`, and `browser-vary-openrouter/` record exact model/caps, two HTTP 200 generation requests, no fallback, targeted edits, export and standalone playback. | Keep the exact `openai/gpt-5.6-luna`/low/default/local-only scope and recorded 512 or owner-authorized 4096 cap boundaries. Close the OpenRouter input-game and full playable-story gaps only with fresh authorization. |
| Working Vercel AI Gateway API-key path, distinct from a Vercel deployment token. | **partial/unverified for required BYOK path** | Gateway endpoint/UI/catalog in source; production server-owned Gateway Luna free trial passed three turns in `docs/evidence/free-trial.json`; `.env.example` distinguishes `AI_GATEWAY_API_KEY_*` and `VERCEL_DEPLOY_TOKEN`. | Run the actual Gateway API-key path with Astra low/standard processing and retain a successful provider-specific scene/edit report. |
| ChatGPT subscription through supported Codex integration is preferred and requires a feasibility spike. | **conditional/proven for trusted companion** | `scripts/local-chatgpt.mjs`, `scripts/run-local-chatgpt.mjs`, `docs/chatgpt-integration.md`, local Astra evidence. It uses managed login/stdio, no public listener, and no copied cookies/tokens. | Keep the adapter as a clearly documented trusted-local companion. Do not add an enabled public Connect ChatGPT control unless a separately isolated supported route is proven. |
| Evaluate ChatGPT access/isolation/credential lifecycle; do not treat subscription credentials as API keys or use cookies/undocumented endpoints. | **proven for current boundary** | `docs/chatgpt-integration.md`, adapter constraints, no browser/public relay. | Revisit only if a new supported hosting model is proposed. |
| Provider/model selection, exact catalog IDs/capabilities, Astra preference, no invented IDs or silent billing substitution. | **partial** | Live catalog route/tests/evidence and `src/lib/model-modes.ts`; direct adapter does not fully declare capabilities and stale recommendation docs disagree with current mappings. | Add provider capability records and compliant live tests; refresh docs/catalog evidence. |
| Keep credentials out of project/prompt/code/browser bundle/localStorage/export/logs; authenticated server relay; optional encrypted remembered credentials; disconnect revocation. | **partial/proven session-only** | Tab-memory connection state in `src/components/orbsie.tsx`, server relay, `src/lib/export.ts`, `.env.example`, storage tests. No remembered credential feature exists, so encrypted remembered storage/revocation is unimplemented but not needed for the session-only path. | If remembered credentials are added, encrypt server-side and add revocation tests; otherwise keep session-only language explicit. |
| Preserve initial prompt through setup; no-key visitor access must be a real clearly marked demo under the original brief, but the owner override removes user-facing demo mode. | **proven under owner override for prompt/free path; historical demo evidence obsolete** | Current root UI preserves prompt and uses free-trial/provider connection; `docs/evidence/free-trial.json`, `.vercel/free-trial-ui`; owner update at `prompt.md:5` explicitly overrides the earlier demo requirement. | Keep deterministic fixtures only in tests and update stale demo-mode reports. |
| Connection/quota/retry messages preserve the Orb. | **partial/proven free/quota subset** | Provider error mapping in `generation.ts`, trial quota in `trial.ts`, current UI `generationErrorCode`, `docs/free-prompts.md`/free-trial evidence. | Add live provider quota/retry browser coverage for both required API-key paths. |

## 10. Independent projects and Vercel publishing

| Explicit requirement | Status | Evidence | Remaining action |
|---|---|---|---|
| One Vercel Project per published Orb under the configured team; local drafts/previews do not provision projects. | **proven for one live bounded Orb** | `/api/publish` deterministic project name/DB mapping; `docs/evidence/publication-live/report.json` records real account signup, revision-1 cloud save and per-Orb Vercel provisioning/deployment. | Verify the no-provision draft path and repeat only when testing later-revision/idempotency behavior. |
| First publish provisions; later revisions deploy to same project. | **first publish proven; later revisions unverified live** | `docs/evidence/publication-live/` records first provisioning and a ready deployment. | Exercise a second committed revision and recovery/idempotency against the same live Orb when the publication milestone is next targeted. |
| Stable IDs, mappings, serialized concurrent attempts, idempotent retries, no duplicate projects after timeout. | **partial** | DB row `FOR UPDATE`, deterministic name, deployment metadata/recovery search, publication tests; recovery only searches ten recent deployments and no durable promotion worker exists. | Widen/strengthen immutable artifact lookup and verify timeout/retry against Vercel. |
| Static client output with runtime/snapshot/assets only; no editor/model services or credentials. | **proven for ZIP/hash player; unverified dedicated deployment** | `src/lib/export.ts`, `src/player`, `scripts/verify-standalone.mjs`, `docs/evidence/export-report.json`; dedicated deployment blocked. | Verify dedicated public artifact after permissions and asset support are complete. |
| Independent source export with pinned metadata/deps, assets, README, build/run scripts; no unpublished workspace dependency. | **proven for current procedural runtime, partial for assets** | `src/lib/export.ts`, generated ZIP evidence, standalone report. No curated 3D asset/license packaging yet. | Add asset/license manifest and verify mixed/catalog export builds. |
| Publish an immutable committed revision; editing cannot mutate in-flight artifact; previous release stays live. | **partial** | `publication_revision`, CAS promotion, committed snapshot, current uncommitted artifact manifest code, publication tests. No live previous-release test. | Complete and run immutable artifact/revision publication regression against live Vercel. |
| Truthful queued/building/ready/error status, persistence, refresh reconnect. | **partial** | `/api/publish`, client polling, publication-polling evidence/tests. Client polling stops on page close and no durable background promotion worker exists. | Prove persisted status and refresh/reconnect against live deployment. A background reconciler is a possible implementation improvement, not an explicit requirement. |
| Return actual deployment URL, verify public playback, handle deployment protection/signed-out access. | **proven for deterministic protocol-geometry world** | `docs/evidence/publication-live/report.json` records actual deployment and sharing URLs, HTTP 200, `data-ready`, canvas, zero cookies and no page errors; the vehicle has no model/provider dependency. | Verify mixed/catalog/model-authored assets and later-revision publication behavior separately. |
| Stable `/o/{slug}` share page with title/thumbnail/creator, independent link/embed, Make your own; no full feed. | **partial** | `src/app/o/[id]/page.tsx` has title/revision/embed/Make your own; no thumbnail or creator fields found. | Add metadata/thumbnail/creator fields and verify the page against a live public deployment. |
| Server-only deployment credentials, owner checks, quotas, rate-limit handling. | **proven for current route** | `/api/publish`, auth/ownership tests, `MAX_PUBLISHED_ORBS`, infrastructure docs. | Re-test after token scope correction and retain no-secret evidence. |
| Public Apache platform repo; never publish private drafts/credentials or create per-user GitHub repos. | **proven** | Repo/license/export paths; no GitHub publication code. | Keep this invariant when asset/export automation is added. |
| Verify current Vercel create/deploy request shapes. | **partial/unverified** | Route uses documented endpoints and records 403 from live permission check; no successful create/deploy. | Verify request/response shapes with a permitted team token. |

## 11. Accounts, saving, and trust boundaries

| Explicit requirement | Status | Evidence | Remaining action |
|---|---|---|---|
| Basic accounts/cloud saving are in scope; first screen invites creation; local draft before sign-in; sign-in for cloud ownership/publish; preserve Orb. | **proven for account/cloud/local paths** | Better Auth route/UI, `src/lib/store.ts`, `docs/cloud-verification.md`, account UI evidence, local recovery tests. | Confirm current no-demo first-run flow after root changes. |
| Store users, projects, chat/entity messages, revisions, generation runs/checkpoints, assets, publication mappings with owner/public scoping. | **partial** | Better Auth, `orbs`, `orb_revisions`, `generation_runs` schema, snapshot messages, publication columns; assets are absent and generation-runs/checkpoints are not actively persisted. | Implement durable generation-run/checkpoint and asset tables, plus explicit chat/entity records if needed for queryability. |
| Local durable edits reconcile with cloud revisions; one active writer; another tab cannot silently overwrite. | **proven for tested local/cloud conflict path** | IndexedDB store, writer leases/Web Locks, Postgres `FOR UPDATE`/revision CAS, `tests/generation-recovery.test.ts`, `tests/ownership.test.ts`, cloud evidence. | Add cross-device/cloud active-run conflict handling; preserve local branch recovery. |
| Generated content is untrusted; bounded validated language in trusted runtime; no `eval`; separate-origin sandbox if arbitrary JS ever added; renderer persists. | **proven current bounded subset; conditional arbitrary-script boundary** | Zod protocol, no `eval`/script execution, generation tests rejecting invalid commands, public iframe sandbox. No arbitrary JS support exists. | Keep arbitrary scripts out or add a separately isolated origin with explicit budgets before introducing them. |
| Bound geometry/object/assets/behavior/recursive complexity; validate sources; prevent arbitrary server fetches; public origin gets no editor credentials/cookies. | **partial** | Entity/parts/stream/request bounds, no remote asset fetch, public export strips messages/keys; asset/source validation and full behavior/recursive limits absent. | Add curated asset/source/license validation and comprehensive behavior/asset budgets; verify public cookies/credentials after deployment. |

## 12. First demonstration and acceptance story

| Acceptance requirement | Status | Evidence | Remaining action |
|---|---|---|---|
| Exact island prompt drives deterministic fixtures and real-model runs. | **proven for bounded OpenRouter live flagship; partial overall** | `docs/evidence/provider-e2e/flagship-openrouter/` records the live Luna flagship creation, mixed scene, scoped edit, export and standalone playback under the owner-authorized 4096-token cap; fixture and prior local evidence remain in `scripts/test-flagship-chatgpt.ts` and `docs/flagship-live-verification.md`. | Reconcile playable objective behavior, input-game authoring and the same story through Gateway/ChatGPT; do not infer those from the OpenRouter scene artifact. |
| Prompt becomes first chat message during descent. | **proven fixture/local** | `src/lib/store.ts`, browser-flow evidence, flagship snapshots. | Reconfirm in current production flow. |
| Sensible seed reservations for trees/crystals/platforms/portal. | **proven fixture/structural live** | `src/lib/fixtures.ts`, protocol tests, flagship structural evidence. | Validate positions visually in a browser using a real provider result. |
| Coarse then final recognizable forms. | **proven fixture/partial live** | Fixture command sequence, formation evidence, Astra command assertions. | Browser-render a live provider snapshot and capture intermediate morph. |
| Movement/scoring/platform/portal become functional as ready behavior arrives. | **proven fixture; unverified model-generated full path** | `src/lib/gameplay.ts`, gameplay tests, `docs/evidence/winning-traversal.json`. | Run a full winning traversal against the live flagship snapshot. |
| Collect crystals and win/reset. | **proven fixture/public hash** | Winning traversal desktop/mobile and player runtime. | Repeat after dedicated publication is live. |
| Tree → giant pink mushroom preserves the rest. | **proven fixture and local Astra protocol path** | `docs/evidence/mushroom-edit.png`, `tests/local-chatgpt.test.ts`, flagship/live edit evidence. | Verify with a live hosted API-key generation and current no-demo UI. |
| Slow middle platform + two crystals reconciles the goal. | **proven as deterministic fixture playthrough** | `docs/evidence/flagship-revisions-goal-gating/report.json`: real-editor run proves the speed edit (1 → 0.3), seven unique collectibles, actual portal gating (early portal visit does not win), a real played win at 7/7 through the portal, play reset, exact undo to goal 5, and reload recovery. Also fixed fixture drift: added-crystal reserves are now geometry-less per the tightened model-command schema. | Live-provider reconciliation remains part of the live acceptance matrix. |
| Undo restores; refresh recovers. | **proven locally** | `src/lib/store.ts`, history/recovery tests, final browser flow. | Keep the test after root changes. |
| Publish gives real URL and signed-out visitor plays same revision without AI key. | **proven for one deterministic protocol-geometry publication; incomplete story-wide** | `docs/evidence/publication-live/` records live account/cloud save, per-Orb deployment, signed-out zero-cookie HTTP 200, `data-ready`, canvas and no page errors. | Verify the same revision's complete gameplay, model-authored/mixed assets and later-revision republishing. |
| Different garden interaction proves non-hardcoding. | **proven fixture/local browser and bounded live OpenRouter** | Garden fixtures and `docs/evidence/garden-interaction/` prove reversible bloom behavior; `docs/evidence/provider-e2e/garden-openrouter/` records a real Luna garden with 18 operations, 8 entities, scoped edit, export and standalone playback under the owner-authorized 4096-token cap. | Extend the second-scene story to required providers only when their live credentials are available. |

## 13. Performance and verification

| Explicit requirement | Status | Evidence | Remaining action |
|---|---|---|---|
| Instrument input feedback and valid scene update near 100 ms under representative load. | **missing/unverified** | No input/validation latency instrumentation; generation evidence records first reservation but not the full target. | Add timestamps for prompt, validation, first reservation/seed, and input response; report representative hardware/load. |
| Target 60 fps recent laptop and usable 30 fps weaker devices with device/scene/frame distribution/browser recorded. | **unverified and current sample misses target** | `docs/render-performance.md`, `docs/verification.md`: SwiftShader sample median 50–83 ms and p95 83–133 ms; adaptive budget tests pass but native GPU is unverified. | Measure production builds on representative native GPU/mobile devices, tune geometry/workers, and report actual frame distributions. |
| Measure prompt submission, first reservation, first visible seed, first controls, first objective, generation completion, publish readiness separately. | **partial** | Flagship evidence has first reservation/duration; browser reports completion/frame data; no complete seven-metric instrumentation. | Add the seven separate milestones to browser/live reports. |
| Camera/chat responsive during preparation; DPR cap, instancing, no React per-frame animation. | **partial/proven subset** | `render-budget.ts`, instanced pebbles, refs in `world.tsx`, performance docs. Workers/preparation and full responsiveness evidence absent. | Add worker geometry prep and measure camera/chat/input under load. |
| Validate cancellation, interruption, duplicate/order/stale/invalid operations, selected edits, undo, refresh, failed publication preserving old public release. | **partial/proven subset** | Protocol/generation/recovery/publication tests and final publication-polling evidence cover many cases; live failed-publication/old-release preservation is not proven. | Complete missing failed-release and asset/behavior tests. |
| Fixture tests first, then each implemented provider with real credentials; distinguish evidence. | **partial** | `tests/`, `docs/verification.md`, and the new provider reports distinguish fixture, live OpenRouter, synthetic hosted ChatGPT, server-funded Gateway free path, account/cloud and publication evidence. | Add Gateway BYOK and browser ChatGPT consent/inference evidence; retain the exact model/cap/source scope for each run. |
| Generated content cannot access secrets or escape execution contract. | **proven for current bounded runtime** | No `eval`, server-only keys, export stripping, protocol bounds, generation invalid-command tests, architecture docs. Dedicated deployment remains unverified. | Verify the deployed public origin after publishing and add asset-source tests. |
| Independent export builds/plays without editor; published URL signed-out when available. | **proven export and one live deterministic publication** | `scripts/verify-standalone.mjs`, provider export/standalone reports, and `docs/evidence/publication-live/` prove editor-free playback; the latter also proves signed-out zero-cookie production playback for one deterministic protocol world. | Verify model-authored/mixed asset packaging and complete signed-out gameplay on a later published revision. |
| Desktop/mobile real-browser visual inspection captures landing, descent, intermediate morph, editing, public playback, and recording. | **partial/proven fixture** | Screenshots and videos under `docs/evidence/`, final browser-flow and winning traversal evidence. Current root changes need fresh production captures; live-provider intermediate morph is absent. | Re-capture current no-demo free/provider path and a real live-provider morph. |

## 14. Execution order and deliverables

| Milestone/deliverable | Status | Evidence | Remaining action |
|---|---|---|---|
| Experience prototype: planet, composer, descent, flat parcel, persistent renderer, three formations. | **proven fixture prototype / partial target** | Renderer, fixture formation, screenshots/video, browser flow. Spherical parcel rigor and current no-demo production proof remain. | Finish parcel controller and re-run current production flow. |
| Authoring runtime: typed project, incremental ops, selection, behavior/input, undo, local recovery, playable fixture. | **partial** | Protocol/store, catalog/generated refs, bounded game programs, checkpoints and standalone runtime; real ChatGPT input-game creation/edit/reload/export evidence. | Complete broad gameplay reconciliation, cloud recovery and all required live provider acceptance scenarios. |
| Real generation: OpenRouter/Gateway working, stream/tool adapters, model checks, checkpoints, cancellation, real revisions; ChatGPT spike not blocking. | **partial** | Relay/tests and live OpenRouter Luna browser-model reports now prove bounded creation/edit/export/standalone journeys, including flagship, garden, procedural, deformation and variation. Durable application journals/checkpoints and replay/recovery are implemented and tested; Gateway BYOK, ChatGPT browser consent/inference, full gameplay and cross-provider live recovery remain open. Provider-stream resumption is not required or claimed. | Close the required Gateway BYOK and browser ChatGPT paths, then reconcile cancellation/recovery/play/publication across providers. |
| Ownership/publication: accounts, cloud, independent export, one Vercel project/Orb, deployment status, public sharing. | **partial/proven bounded publication** | Accounts/cloud/export plus `docs/evidence/publication-live/` prove one live account, cloud save, per-Orb deployment, sharing URL and signed-out playback; later-revision/idempotency and story-wide publication remain open. | Exercise later revision/recovery and full playable/model-authored publication when the provider matrix is ready. |
| Finish/prove: visual/refinement, touch/reduced motion, performance, tests, second scene, deployment verification. | **partial** | Responsive/reduced-motion/garden/tests/evidence exist; performance misses target and dedicated deployment/live provider/assets remain. | Complete measurements, asset matrix, live provider/public deployment verification. |
| Working source, Apache license, lockfile, README. | **proven** | `LICENSE`, `package-lock.json`, `README.md`, build/type/test checks. | None. |
| `.env.example` placeholders/setup for auth, DB/storage, credential encryption, Vercel access, optional AI test creds; distinguish deployment token/Gateway key. | **partial** | `.env.example` has placeholders and distinguishes variables; no remembered-credential encryption exists because session-only is implemented. | Document that encryption is conditional on adding remembered credentials, and include asset/catalog config if introduced. |
| Architecture document covering protocol, formations, local/cloud, export, publishing. | **proven but gap-aware** | `docs/architecture.md`. | Update it for curated assets, behavior graph, and any final publication artifact changes. |
| ChatGPT decision note with current official docs and implemented/conditional status. | **proven** | `docs/chatgpt-integration.md`. | Keep it aligned with any future companion/public adapter decision. |
| Test/verification report separating fixture, live provider, account, export, and cloud evidence. | **partial** | `docs/verification.md` and evidence reports do this, but stale demo/avatar/model statements exist and required OpenRouter/Gateway/asset/publication evidence is incomplete. | Refresh the report after the root commit and this audit. |
| Screenshots and short recording where supported. | **proven for fixture/local paths** | `docs/evidence/*.png`, `docs/evidence/video/*.webm`. | Add current no-demo/live-provider/deployed-public captures. |
| Final handoff with actual URLs, run instructions, measured limits, and missing external config. | **partial** | `README.md`, `docs/infrastructure.md`, `docs/verification.md`, production/domain evidence. | Reissue after successful dedicated publication or clearly retain the token-permission blocker. |
| Success criterion: nontechnical person describes, lands, watches forms grow, plays during development, changes an object by talking, and shares a real playable Orb. | **partial** | Fixture/local runtime, bounded live OpenRouter creation/edit/export, distinct live garden/procedural/deformation/variation cases and one deterministic signed-out publication are proven. Gateway BYOK, browser ChatGPT consent/inference, input-game/full playable live story, representative performance and later-revision publication remain open. | Close the external provider gates, then run one complete signed-out gameplay story against a model-authored revision. |

## Current remaining acceptance gates

The rows above are historical inventory, not a current completion checklist. Latest owner requirements and source-specific evidence take precedence.

1. **Browser ChatGPT subscription.** Real consent, model discovery after consent and subscription inference remain unverified. Computer use currently exposes no browser surfaces; the Sep 24 owner-visible Orbsie device-code challenge expired without a grant. The requested direct OAuth redirect remains unproven. Historical local-companion and synthetic fixtures do not close this requirement.
2. **Live game story breadth.** OpenRouter and Gateway each passed bounded Luna input-game create/edit/reload/export/standalone journeys (see the current reconciliation above). Do not repeat those runs merely to refresh evidence. Full flagship behavior, play during construction, targeted revisions, undo and signed-out gameplay on the same model-authored published revision still need end-to-end evidence.
3. **Cross-provider recovery and publication.** Application journals, ordered replay and completed-checkpoint recovery are implemented and tested; provider-stream resumption is not required. Same-project later-revision deployment is verified separately. Gateway now has a bounded live reload/cancelled-checkpoint/explicit-continuation cloud recovery pass at `c586d74`, including fresh cookie-only reopening (`docs/evidence/provider-e2e/gateway-reload-recovery`). The same Gateway project revision9 was subsequently published and passed signed-out scoring/win/loss/restart with no external requests (`docs/evidence/provider-e2e/gateway-reload-recovery-publication`). The free strawberry mixed catalog/generated export now has exact public snapshot, asset/license/provenance byte and signed-out loading evidence (`docs/evidence/publication-free-strawberry`). OpenRouter flagship independent mixed-asset publication and signed-out desktop/CDP-touch five-crystal/portal/reset traversal now passed (`docs/evidence/publication-flagship-openrouter/traversal-current`); separate public keyboard platform1→2→3 traversal now passed with bounded waits for reachable gaps and no sampled ground contact (`docs/evidence/publication-flagship-openrouter/platforms-sequential-phase-aware`). Touch platform crossing remains open. OpenRouter recovery, browser ChatGPT recovery/publication, broader mixed-scene gameplay, and preservation of the prior release during failed publication still need matching evidence. Pending-release continuity now passed in a bounded deterministic production run (`docs/evidence/publication-continuity-live`): previous browser/snapshot checks were followed by BUILDING/servedRevision 1, then READY/revision 2 in the same project.
4. **Mobile usability and lifecycle.** Owner-required full editor and published gameplay journeys must work in portrait and landscape, with touch, keyboard, safe areas and interruption recovery. Browser touch emulation and an Android 15 emulator cover bounded input/rendering slices; direct capture-loss observation remains partial. Toast/control layout corrections are deployed and passed bounded portrait/landscape fixtures; full device acceptance remains open. The emulator is currently stopped. Physical Android and iOS Safari evidence remains absent.
5. **Representative performance.** Native-GPU/mobile frame-time, input/scene-update latency, memory and all seven milestone timings remain open. SwiftShader and fixture measurements do not close this gate.
6. **Final reconciliation.** Recheck every original requirement against current artifacts after these gates close. Preserve the historical inventory and distinguish synthetic, live-provider, account/cloud and publication evidence.

The published player’s control instructions, touch visibility and safe-area handling are now corrected. Gateway revision 10 was republished with the current runtime and passed exact public snapshot and JS/CSS hash checks plus signed-out desktop/portrait/landscape touch gameplay (`docs/evidence/provider-e2e/gateway-reload-recovery-republish-resume`). This used no new model calls and does not establish physical-device acceptance. The existing Gateway recovery world has passed exact-snapshot publication and signed-out gameplay without new model calls. Hosted runtime provenance/reconnect is deployed at source `44c7fa1`; GET/HEAD release evidence is `docs/evidence/chatgpt-runtime-release`. Gateway live reload recovery passed with exactly three Luna calls. Further live development calls are authorized within the owner's per-test limits, but current Gateway balance blocks paid inference. Browser ChatGPT still requires Orbsie consent; Android Chrome terms acceptance was authorized but device validation remains open. Production free-trial inference now passed separately with the exact strawberry prompt, selected edit, reload/export and standalone readiness: `docs/evidence/provider-e2e/free-strawberry-current`, two calls, remaining 2→1→0. Failure preservation and full visual/gameplay quality remain separate gaps. Preserve bounded Luna-only live milestones and the 20%-remaining Codex stop rule.

All active modeling and rendering run with browser resources. Native Blender and local ChatGPT companions are historical prototypes and must not be required or surfaced. Suggested libraries in section 8 are implementation options; the required capabilities and behavior remain the acceptance criteria.
