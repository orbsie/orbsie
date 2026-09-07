# Verification — 2026-09-07

This report covers the first approximately 30-minute implementation. It is an experience prototype with working local creation/edit/play/export flows, not completion of every requirement in prompt.md.

## Passing evidence

- Production Next.js build and strict TypeScript checks.
- 10 unit tests: sequence/run/revision rejection, idempotency, unknown references, invalid numeric input, checkpoint cleanup/restoration, stable unrelated entity identities, both deterministic fixtures, share encoding, two provider transport framing tests, invalid model-command rejection.
- Browser flow against https://orbsie.com in Chromium 153: island creation, visible formation, object selection, tree-to-mushroom revision, undo, keyboard movement/jump input, ZIP download, refresh recovery, signed-out snapshot-link playback, mobile garden and visible touch controls. No page exceptions; no horizontal overflow at 390 × 844.
- Latest design: roughly 80vh planet on desktop, dark starfield, branding/headline/footer removed and essential controls retained. Desktop and mobile screenshots are in `evidence/landing-space.png` and `evidence/mobile-space.png`.
- Independent local projects: created an island, returned to the planet, created a garden, and verified both could be reopened from the local library.
- Independent export: downloaded ZIP, installed its dependencies, rebuilt runtime from included source, ran its Vite production build, and opened the built game with a separate static HTTP server. `project.json` was fetched successfully; zero external service requests and zero page exceptions. See `evidence/export-report.json` and `evidence/standalone.png`.
- orbsie.com was added as a verified project domain. An unauthenticated request returned HTTP 200 after its project-domain registration. The app also uses orbsie.vercel.app. Vercel deploys through the authenticated CLI; GitHub push milestones are in repository history.

Screenshots and recordings are in `docs/evidence/`. The browser report contains the tested immutable demo share URL. Some early captures predate the dark-space design. The latest interaction video includes the dark-space design and the complete tested flow.

## Measurements

AMD EPYC 9124 (16 cores / 32 logical CPUs), Chromium 153 headless, Linux x86_64, 1440 × 1000, SwiftShader software WebGL with video recording. Island fixture contains 14 semantic entities. Its scripted generation completed in about 10.1 seconds. Over 120 animation frames during play: median 66.7 ms, p95 116.7 ms. This software-rendered run does not meet the 60 fps target; native GPU performance and adaptive quality need further work. These are measured values for this test environment, not model-latency claims. First-reservation/control/objective timing instrumentation is incomplete.

## Not verified or incomplete

- Live OpenRouter / AI Gateway generation: adapter code and mocked framing tests pass, but no user API keys were supplied. Model behavior and real latency are unverified.
- Accounts, cloud saving, database migrations and dedicated per-Orb Vercel publishing: implemented boundaries/adapters are disabled until database, auth secret and deployment configuration are supplied. Not live-tested. No claim that the published app has working cloud accounts.
- Dedicated publication UI does not yet poll/recover deployment status automatically. The authenticated status endpoint exists. Rate limits, concurrent cloud publish retry recovery and public deployment protection need live tests.
- Google sign-in server configuration exists; a Google sign-in UI flow is not implemented.
- ChatGPT subscription integration is intentionally unavailable. See chatgpt-integration.md.
- The bounded runtime supports a small behavior vocabulary, not arbitrary composable rules, custom scripting, remote assets or full physics. Moving-platform carry, bounce behavior, exact collision reconciliation and automated win-condition coverage remain.
- Local drafts are recovered; cross-tab writer arbitration and history recovery across reload are incomplete. Use one editing tab per project. Durable server generation checkpoints and asset storage are not implemented.
- The planet descent is an artistic scale/geometry transition, not yet a rigorous tangent-basis parcel representation. The form is repositioned rather than using a fully coordinated animation controller. Geometry preparation currently runs on the main thread.
- Formation normal/shadow interpolation, arbitrary multipart correspondence, model-driven material animation and GPU performance need more refinement.
- Production GitHub auto-deployment linkage needs the Vercel account's GitHub Login Connection. Manual CLI deployments succeeded.

## Reproduce

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run start
npx playwright install chromium
TEST_URL=http://localhost:3000 node scripts/verify-flow.mjs
```

The browser script's text selectors may require updates when copy changes. `scripts/capture-entrance.mjs` verifies the simplified entrance; standalone verification expects a separately served export on port 3010. All test provider keys are dummy strings. No production credentials are in these artifacts.
