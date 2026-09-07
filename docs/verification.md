# Verification — 2026-09-07

This is an implementation in progress. The local editor/player and live local model path have evidence; hosted accounts and dedicated publication still need external setup.

Latest production verification: source commit `0c087d7` deployed to https://orbsie.com (deployment `orbsie-5f32hhzp8-grappeggias-projects.vercel.app`). Production dictation/layout checks and live-catalog/Astra-snapshot browser checks passed with zero exceptions and no inference calls. Production reports accounts/publishing disabled, matching the outstanding setup.

## Passing checks

- 42 deterministic tests and TypeScript checking pass. Coverage includes operation ordering, provider framing, Astra selection/cancellation, immutable archives, gameplay objectives/platform edits, atomic draft preservation, monotonic undo/redo, cloud conflict recovery, publication compare-and-swap, and project-scoped response handling. No model calls occur in this suite.
- Production build passes. The editor keeps the large cosmic globe and centered composer, exact placeholder “What experience to build?”, and microphone button.
- Chromium desktop/mobile fixture flow passes: formation, island, selected mushroom edit, undo, keyboard/jump input, ZIP download, refresh recovery, signed-out snapshot playback, flower garden, and touch controls. Zero page exceptions and no mobile horizontal overflow.
- Live provider catalogs populate Quality (Astra), Balanced (Sol), Budget (Luna), and Advanced. Both providers return the recommended IDs; changing provider clears the entered key. Desktop/mobile settings and actual Astra snapshots render without exceptions.
- Private development Google Cloud Storage: Vercel OIDC → Google token exchange → archive upload → create-only retry passed. Production/development identities and buckets are separate. Production archive writes remain untested until authenticated saving is enabled.
- Downloaded standalone ZIP installs and rebuilds from included source, then builds with Vite and plays through an independent static server. Gameplay source is included. No editor/API/model service requests and zero runtime exceptions. Vite reports a large ~1.53 MB JavaScript chunk (~402 KB gzip); code splitting remains a performance task.

## Real Astra low evidence

Managed local ChatGPT authentication and model/list resolved gpt-6-astra with low reasoning. No raw login tokens were inspected or copied. The trusted stdio harness opens no server listener and is separate from the hosted app.

The small moon garden produced 13 validated operations/three entities; a two-operation recolor preserved selected geometry and unrelated entities. A separate flagship run produced 59 operations/19 ready entities in 54.480 seconds, with first reservation at 9.320 seconds: five crystals, three moving platforms, portal, two trees and pond plus other structures.

The initial flagship edit tried to reserve an existing ID and was rejected. Correcting the system prompt to reserve only new IDs allowed one edit-only retry to pass: five operations in 6.498 seconds, a large pink mushroom, and all 18 unrelated entities/environment unchanged. The retry requested Fast; the accepted service tier was not exposed. Every live attempt used Astra low. See [flagship details](flagship-live-verification.md).

After the owner's clarification, Fast is limited to Codex development agents. Orbsie's local model harness explicitly requests standard processing on every thread and turn, retaining Astra low. A deterministic regression verifies that separation; the historical Fast-requested retry has not been rerun.

Actual flagship creation and edited snapshots were rendered and visually inspected. Keyboard play collected one crystal in each. This proves basic play interaction, not a complete winning traversal. Runtime unit tests verify current collectible IDs gate the portal and platform edits preserve riders.

## Measurements and limits

AMD EPYC 9124, Linux, Chromium 153 headless, 1440 × 1000, SwiftShader software WebGL with recording: the 14-entity fixture completed in 10.248 seconds; 120 play frames measured median 66.7 ms, p95 116.7 ms. This does not meet the 60 fps target. Native GPU results, adaptive quality, geometry workers and full path reachability remain unverified.

Neon provisioning is waiting for the owner's integration terms acceptance. DATABASE_URL and migrations are absent. Vercel refused API creation of a publishing token; the owner must set production VERCEL_DEPLOY_TOKEN. Accounts/cloud saving/per-Orb Vercel publication therefore remain gated and are not live certified. Their regression tests use deterministic database/transport substitutes. The main app itself deploys successfully using the existing CLI login. See [infrastructure](infrastructure.md).

Hosted OpenRouter/Gateway inference has not been tested with API keys. Local ChatGPT success does not establish public multitenant subscription relaying. Google sign-in UI, durable generation checkpoint/resume, reloaded undo history, arbitrary composable behaviors, imported assets, and a rigorous spherical parcel transition remain incomplete.

Dictation tests simulate Web Speech API events: corrections, prefix preservation, stop, manual edits, stale results, permission denial and unsupported browsers. Real microphone audio/transcription remains untested. Orbsie stores no audio; browser speech services may process it remotely.

## Reproduce

```sh
npm ci
npm test
npm run typecheck
npm run build
npx playwright install chromium
TEST_URL=http://localhost:3001 node scripts/verify-flow.mjs
TEST_URL=http://localhost:3001 node scripts/verify-dictation.mjs
```

Start the app on the chosen test URL first. Stored-live-scene scripts require the evidence files written by the separate authorized live harness; they do not call a model themselves. Screenshots, JSON reports and recordings are in docs/evidence/. Earlier captures may represent previous UI iterations. Provider test keys are dummy values, and credentials are excluded from artifacts.
