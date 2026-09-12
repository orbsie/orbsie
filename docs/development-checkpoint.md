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
- Production remains source `905b682` at https://orbsie.com, with smoke evidence
  in `docs/evidence/compound-policy-release`. Local HEAD must be checked on resume.
- Latest accepted feature: `60f91c7`, explicit Try again / Use last working actions.
  Original prompt/selection survive retry; latest valid increments survive failure;
  unfinished reservations are removed; stale recovery clears on revision changes.
  Eleven targeted tests, typecheck, production build, seven-request fixture browser
  regression passed. Evidence: `docs/evidence/generation-failure-recovery/`.
  This feature is not deployed yet.
- Active worker: `/root/republish_acceptance_harness`, one post-union Gateway
  input-game create/edit run on local build `60f91c7`, port3018, cap4096, exact
  `openai/gpt-5.6-luna`, low/default, local-only key. At most two calls; failed
  creation stops. Evidence target `provider-e2e/gateway-input-game-union-policy`.
  Revalidate worker status; do not restart an unobserved run. Worker must delete
  its private temporary Gateway env file and stop its server/browser afterward.
- OpenRouter post-union input-game passed (`694c904`): exactly two HTTP200 calls,
  creation/edit, recovery, export, standalone win/loss/restart. Evidence directory
  `provider-e2e/input-game-union-policy`; app source905b682 is operator-supplied.
- Gateway's preceding run failed on overlapping solids before edit; retain
  `provider-e2e/gateway-input-game-approved`. No passing result claimed yet.
- Gateway key also exists as sensitive Vercel production `AI_GATEWAY_TEST_KEY`.
  Never print it or commit local env files. Existing CLI deploy auth works.
- ChatGPT browser subscription consent/discovery/inference remains unverified.
  CUA exposes no browser; Chrome connector tab listing is not computer-use control.
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
- Next local verification gap: runaway-allocation test accepts any procedural error,
  so timeout could masquerade as memory-budget proof (`33ee035`). Strengthen evidence.
- Other open gates: hosted ChatGPT, complete provider-publication journeys,
  representative GPU/mobile performance and timing, and full requirement audit.
- Avoid status-only turn churn. Await the existing worker without spawning another;
  review its diff/evidence before acceptance, commit coherent progress, then move on.
