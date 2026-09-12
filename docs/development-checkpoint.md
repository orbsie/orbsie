# Development checkpoint

Keep this handoff compact and update it in place. Never include secrets.

- Objective: implement all of `prompt.md` with E2E OpenRouter, Vercel AI Gateway
  and browser ChatGPT journeys. The full goal is incomplete.
- Policy: Astra low reviews/integrates; one Luna xhigh worker, regular/default,
  no nested agents, Fast off. Only Luna for live tests; user model choices remain
  unrestricted among supported models. Batch validation at meaningful milestones.
- Standing owner approval: two calls/provider/run, 4096 output tokens/call,
  no automatic retries, for bounded OpenRouter/Gateway acceptance milestones.
  Do not treat this as unlimited inference. Sign-in must use computer use.
- Production is source `7e74569` at https://orbsie.com, with smoke evidence
  in `docs/evidence/recovery-diagnostics-release`. Local HEAD must be checked on resume.
- Latest accepted feature: `60f91c7`, explicit Try again / Use last working actions.
  Original prompt/selection survive retry; latest valid increments survive failure;
  unfinished reservations are removed; stale recovery clears on revision changes.
  Eleven targeted tests, typecheck, production build, seven-request fixture browser
  regression passed. Evidence: `docs/evidence/generation-failure-recovery/`.
  Recovery and diagnostic changes are deployed; read-only production smoke passed.
- Active worker: `/root/republish_acceptance_harness`, one post-diagnostics Gateway
  input-game milestone on built source7e74569, port3018. Evidence target
  `provider-e2e/gateway-input-game-diagnostics`; max2 Luna calls, cap4096, no retries.
  Revalidate worker before any follow-up. Worker must delete temporary key afterward.
- Diagnostics accepted in `a698cbf`; alias resolution/integration in `7e74569`.
  Forty-four generation tests, typecheck and local/remote production builds pass.
- Latest Gateway run (`b899115`) stopped after one HTTP200 Luna creation call,
  low/default, cap4096, local build60f91c7; no edit/retry. Evidence directory
  `provider-e2e/gateway-input-game-union-policy`. Server stopped and root verified
  private key deletion. Cause is not yet established; Gateway remains unverified.
- OpenRouter post-union input-game passed (`694c904`): exactly two HTTP200 calls,
  creation/edit, recovery, export, standalone win/loss/restart. Evidence directory
  `provider-e2e/input-game-union-policy`; app source905b682 is operator-supplied.
- Gateway's preceding run failed on overlapping solids before edit; retain
  `provider-e2e/gateway-input-game-approved`. No passing result claimed yet.
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
