# Development checkpoint

Keep this handoff compact and update it in place. Never include secrets.

- Objective: implement all of `prompt.md` with E2E OpenRouter, Vercel AI Gateway
  and browser ChatGPT journeys. The full goal is incomplete.
- Policy: Astra low reviews/integrates; one Luna xhigh worker, regular/default,
  no nested agents, Fast off. Only Luna for live tests; user model choices remain
  unrestricted among supported models. Batch validation at meaningful milestones.
- Standing owner approval: up to five Gateway calls/test; OpenRouter remains
  two calls/run. Both use Luna only and 4096 output tokens/call,
  no automatic retries, for bounded OpenRouter/Gateway acceptance milestones.
  Do not treat this as unlimited inference. Sign-in must use computer use.
  Latest explicit next-milestone approval is narrower: one fresh create/edit test
  per OpenRouter/Gateway, maximum two calls each, 4096 output tokens/call, no retries.
- Production is source `7e74569` at https://orbsie.com, with smoke evidence
  in `docs/evidence/recovery-diagnostics-release`. Local HEAD must be checked on resume.
- Latest accepted feature: `60f91c7`, explicit Try again / Use last working actions.
  Original prompt/selection survive retry; latest valid increments survive failure;
  unfinished reservations are removed; stale recovery clears on revision changes.
  Eleven targeted tests, typecheck, production build, seven-request fixture browser
  regression passed. Evidence: `docs/evidence/generation-failure-recovery/`.
  Recovery and diagnostic changes are deployed; read-only production smoke passed.
- Priority bug: exact owner prompt `a tree with blue strawberries` failed on
  production free path (browser request confirmed). Gateway BYOK reproduction
  `57fee42` used one Luna low/default call,4096; HTTP200, seed5948ms, operation4
  INVALID_SCENE_JSON with finishReason null. No edit/retry; private key deleted.
  Sole worker `/root/republish_acceptance_harness` investigates parser/framing
  offline and diagnostic gaps; no more live calls assigned yet.
- Provider-logo request: official assets committed `fe5b647` in public/providers;
  connection-button UI hookup still queued after the generation failure.
- Mobile layout accepted in `db12ed8` and `042c486`: settled atomic checks cover
  portrait plus 844x390/667x375 landscape composer states, toolbar/HUD, recovery,
  touch controls and composer. Root visually reviewed. Two fixture requests,
  zero live calls. Physical-device and capture-loss limitations remain open.
  Earlier production build passed; latest mobile changes are not deployed.
- Input fixes committed `43c7482`: pointer identities, keyboard aliases, cancellation,
  lifecycle clearing, focused-button Space release. Real CDP multitouch/capture,
  ordinary release, touchCancel and synthetic-blur checks passed in editor/player.
  `input-touch-lifecycle/report.json` stays partial: direct releasePointerCapture
  did not emit a loss event even after movement; actual Android/iOS tests remain.
  Earlier mocked capture report is retained separately, not accepted as real touch.
  First real-touch failure was a success-toast overlap, corrected in db12ed8.
- Owner authorized Android emulator installation. Isolated AVD `orbsie_api35_phone`
  is booted as `emulator-5580` (root process session4786), Android35 Google Play
  x86_64, Pixel6 profile, KVM, SwiftShader,3GiB/2cores. Use SDK adb at
  `/home/marcos/android-sdk/platform-tools/adb` (system adb was unreliable).
  Chrome is installed; welcome flow awaits owner approval of Google Terms effective
  July30,2026. Root opened the terms link only; no consent/account created.
  Do not bypass onboarding or accept terms without the pending explicit approval.
- Owner mobile target: a recent midrange Android phone (not a flagship); exact
  physical model/OS not yet supplied. Emulator results remain separate evidence.
- Mobile is an explicit release gate (`63f7332`): full workflows and actual-device
  iOS Safari/Android Chrome validation. Emulation alone cannot establish completion.
- Diagnostics accepted in `a698cbf`; alias resolution/integration in `7e74569`.
  Forty-four generation tests, typecheck and local/remote production builds pass.
- Gateway input-game passed (`39b8c90`): two HTTP200 Luna low/default calls, cap4096,
  create/edit, reload recovery, export and standalone win/loss/restart. Evidence:
  `provider-e2e/gateway-input-game-diagnostics`, local built source7e74569. Key deletion
  verified; server/browser stopped. No account/cloud/publication in this run.
- OpenRouter post-union input-game passed (`694c904`): exactly two HTTP200 calls,
  creation/edit, recovery, export, standalone win/loss/restart. Evidence directory
  `provider-e2e/input-game-union-policy`; app source905b682 is operator-supplied.
- Gateway key also exists as sensitive Vercel production `AI_GATEWAY_TEST_KEY`.
  Never print it or commit local env files. Existing CLI deploy auth works.
- ChatGPT browser subscription consent/discovery/inference remains unverified.
  Chrome DevTools snapshot/click tools now work. Root opened Orbsie sign-in in
  page2; owner must enter credentials there, then root can continue connection.
  CUA itself still exposes no browser. Do not export browser cookies/profiles.
  Historical local-companion evidence does not satisfy browser-only acceptance.
- Republish evidence `republishing-browser-live/resume-report.json` proves same
  Vercel project, distinct deployments, served revision2, signed-out readiness,
  exact revision1/2 snapshots. Pending-window availability was not observed.
- Saved flagship evidence proves keyboard/touch crystal/portal win/reset and
  separate carry probes for all three platforms (`flagship-program-traversal`,
  `flagship-platforms`, `flagship-platform2-corrected`), not one continuous route.
- Modeling feedback, durable journals/checkpoints, share metadata and browser-only
  modeling are implemented. See current reconciliation in `docs/scope-audit.md`;
  conflicting historical rows are obsolete. Native Blender packaging is superseded.
- Memory-cap regression accepted `71c50c8`: valid recipe after4MiB allocation passes,
  above8MiB rejects as execution (not timeout); all13 procedural tests pass.
- Other open gates: hosted ChatGPT, complete provider-publication journeys,
  representative GPU/mobile performance and timing, and full requirement audit.
- Avoid status-only turn churn. Await the existing worker without spawning another;
  review its diff/evidence before acceptance, commit coherent progress, then move on.
