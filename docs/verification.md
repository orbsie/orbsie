# Verification — 2026-09-07

This is an implementation in progress. The local editor/player and live local model path have evidence; hosted accounts and cloud saves are verified; dedicated publication still needs corrected Vercel token permissions.

Latest application production verification: source `4132ff8` deployed to https://orbsie.com (`orbsie-8slyaftkl-grappeggias-projects.vercel.app`). The anonymous provider-connection browser flow passed with one synthetic generation, zero real provider/auth requests and zero page errors. Actual route checks returned400 for a missing provider key and401 for unsigned publication; the live model catalog returned293 selectable models with ranking metadata and estimated prices. No paid model calls occurred. Production accounts/cloud saves and private archives were verified earlier; individual Orb publication remains blocked by the token’s project-creation permission. See [route evidence](evidence/production-byok.json) and [provider UI](provider-ui-verification.md).

## Passing checks

- 65 deterministic tests and TypeScript checking pass. Coverage includes operation ordering, provider framing, Astra selection/cancellation, immutable archives, gameplay objectives/platform edits, atomic draft preservation, monotonic undo/redo, cloud conflict recovery, publication compare-and-swap, and project-scoped response handling. No model calls occur in this suite.
- Production build passes. The editor keeps the large cosmic globe and centered composer, exact placeholder “What experience to build?”, and microphone button.
- Chromium desktop/mobile fixture flow passes: formation, island, selected mushroom edit, undo, keyboard/jump input, ZIP download, refresh recovery, signed-out snapshot playback, flower garden, and touch controls. Zero page exceptions and no mobile horizontal overflow.
- Presets show only Quality, Balanced, and Budget. Advanced shows searchable models ordered by an external 3D-ranking snapshot, with live provider input/cached-input/output estimates per million tokens; unknown rates remain unavailable. Both providers return the recommended IDs; changing provider clears the entered key. Desktop/mobile settings and actual Astra snapshots render without exceptions.
- Private development Google Cloud Storage: Vercel OIDC → Google token exchange → archive upload → create-only retry passed. Production/development identities and buckets are separate. Production authenticated cloud saves also completed their private archive writes.
- Downloaded standalone ZIP installs and rebuilds from included source, then builds with Vite and plays through an independent static server. Gameplay source is included. No editor/API/model service requests and zero runtime exceptions. Vite reports a large ~1.53 MB JavaScript chunk (~402 KB gzip); code splitting remains a performance task.

## Real Astra low evidence

Managed local ChatGPT authentication and model/list resolved gpt-6-astra with low reasoning. No raw login tokens were inspected or copied. The trusted stdio harness opens no server listener and is separate from the hosted app.

The small moon garden produced 13 validated operations/three entities; a two-operation recolor preserved selected geometry and unrelated entities. A separate flagship run produced 59 operations/19 ready entities in 54.480 seconds, with first reservation at 9.320 seconds: five crystals, three moving platforms, portal, two trees and pond plus other structures.

The initial flagship edit tried to reserve an existing ID and was rejected. Correcting the system prompt to reserve only new IDs allowed one edit-only retry to pass: five operations in 6.498 seconds, a large pink mushroom, and all 18 unrelated entities/environment unchanged. The retry requested Fast; the accepted service tier was not exposed. Every live attempt used Astra low. See [flagship details](flagship-live-verification.md).

After the owner's clarification, Fast is limited to Codex development agents. Orbsie's local model harness explicitly requests standard processing on every thread and turn, retaining Astra low. A deterministic regression verifies that separation; the historical Fast-requested retry has not been rerun.

Actual flagship creation and edited snapshots were rendered and visually inspected. Keyboard play collected one crystal in each. This proves basic play interaction, not a complete winning traversal. Runtime unit tests verify current collectible IDs gate the portal and platform edits preserve riders.

## Measurements and limits

AMD EPYC 9124, Linux, Chromium 153 headless, 1440 × 1000, SwiftShader software WebGL with recording: the 14-entity fixture completed in 10.248 seconds; 120 play frames measured median 66.7 ms, p95 116.7 ms. This does not meet the 60 fps target. A subsequent adaptive-resolution/instancing pass measured median 50.0 ms and p95 83.4 ms versus a separate baseline 66.7/100.1 ms, at lower backing resolution. These single development-server samples are indicative; native GPU results, geometry workers and real flagship full-path reachability remain unverified. See [measurement conditions](render-performance.md).

Separate production/development Neon Free databases are provisioned and migrated. Real production accounts/cloud saving passed acceptance. The supplied publishing token can read the main project but Vercel denies project creation (HTTP 403); per-Orb publication is not live certified. The main app deploys successfully using the existing CLI login. See [infrastructure](infrastructure.md) and [cloud acceptance](cloud-verification.md).

Two authorized direct OpenRouter Luna attempts used a 512 output-token cap: the first returned HTTP402; the second reached the model but failed command-schema validation. No successful OpenRouter scene is claimed. Production Gateway Luna completed three free turns, including creation and an edit; the fourth was blocked before inference. Local ChatGPT success does not establish public multitenant subscription relaying. Google sign-in UI, durable generation checkpoint/resume, arbitrary composable behaviors, imported assets, and a rigorous spherical parcel transition remain incomplete.

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

## Favicon deployment

Source `a6c9a58` is live at https://orbsie.com via `orbsie-5csqmzd63-grappeggias-projects.vercel.app`. Homepage metadata links the SVG favicon; HTTP200 and exact deployed/source equality passed. The icon was visually checked at16,32,64 and160px. This branding-only update followed the65-test/typecheck/build pass and successful anonymous provider UI verification. See [favicon evidence](evidence/production-favicon.json).

Organization avatar artwork is committed under `assets/brand`. Setting the GitHub organization avatar remains pending: browser inventory returned no available apps/browsers, so no authenticated upload was performed.

## Free prompts, waitlist and domains

Source `8cdad04` deployed successfully to `orbsie-d8sl7mkia-grappeggias-projects.vercel.app`. Three live server-key Gateway Luna turns completed in 5.476s, 2.418s and 1.029s; remaining allowance was2,1,0, and the fourth request received429. All commands passed the actual protocol and produced one ready crystal with a scoped material edit. See [trial evidence](evidence/free-trial.json). No alternate model or Fast processing was requested.

Dev Postgres integration tests admitted only3 of12 concurrent quota claims and blocked a changed visitor cookie sharing the network bucket; test records were removed. A separate concurrent waitlist test persisted one pending row without contacting email delivery. Production and development schemas are migrated. Waitlist delivery awaits Resend terms acceptance and verified sender configuration; no confirmation email has actually been sent.

Both `orbsie.app` and `www.orbsie.app` are attached to the same Vercel project and verified over HTTPS with308 redirects to `orbsie.com`, preserving query strings. See [domain evidence](evidence/domains.json).

Bounded undo/redo stacks now survive local reloads with snapshot validation and project-scoped recovery guards. Actual fixture winning traversal passed on desktop keyboard and mobile touch, collecting all5crystals and reaching the portal; this does not certify a full win in the model-generated flagship.

## Resumed delivery and ringless branding

The favicon and recommended GitHub avatar now contain only the orb and land shapes, with the orbital rings removed. The favicon was visually checked at 16, 32, 64 and 160 px ([size comparison](evidence/favicon-ringless-sizes.png)); the updated compact avatar is 1254×1254 and 965,276 bytes. GitHub organization upload remains pending because no controllable authenticated browser is connected.

Baseline rerun: 96 deterministic tests passed, two opt-in database tests were skipped, TypeScript and production build passed. The fixture browser flow, anonymous provider connection, and mocked dictation checks passed. The first mobile winning traversal on `next dev` hit the Next development indicator instead of the movement control; hit-testing and touch-event traces identified `NEXTJS-PORTAL` as the target. The identical script on `next start` passed desktop keyboard and mobile touch: all five crystals, portal, jump, no overflow, no page errors, and zero inference calls. Use a production server for traversal acceptance to avoid development overlays. These are fixture results, not new live-model or dedicated-publication claims. Reports are in [resumed delivery evidence](evidence/resumed-delivery/).

Publication input validation now rejects malformed project/revision fields with HTTP 400 before connecting to the database. Four focused regressions reproduced HTTP 500 before the fix and passed afterward; the existing publication compare-and-swap tests also passed.

The publication audit also identified follow-up work before full live certification: timeout recovery currently searches only ten recent deployments, and READY promotion checks anonymous HEAD reachability rather than validating all player assets and the served snapshot. Dedicated publication is still blocked by token permissions; no stronger release claim is made. Resend terms/sender configuration remains pending, and no email was sent during this pass.

Local generation now checkpoints the prompt and each operation that changes committed state. Blocked-stream regressions cover material/behavior recovery before final commit, exclusion of unfinished forms, and late stream/save completion after switching worlds. Recovery opens the local committed snapshot for a new generation; it does not resume the provider’s stream or provide cross-device run recovery. The integrated deterministic suite at this stage passed 106 tests with two opt-in database tests skipped; TypeScript passed.

Final Astra review approved the recovery and publication changes after adding early-stop descent handling and an atomic draft-pointer update. The final combined check passed 107 deterministic tests, with two opt-in database tests skipped, plus TypeScript and the production build. The publication browser regression failed before the fix and passed afterward: readiness checks continue after closing Share, the served revision/link is correct on reopening, stale project responses are ignored, and transient background failure retries without leaking an error into the account dialog. Client polling still stops when the page closes.

The exact final production build (`next start`, port 3016) passed both the publication-polling fixture and full browser flow. The latter covered formation, selected-object revision, undo, keyboard/jump, ZIP download, refresh recovery, signed-out snapshot playback, mobile garden and touch controls, with zero page errors and no overflow. Completion was 11.895 seconds; headless SwiftShader frame telemetry was median 83.2 ms/p95 133.4 ms, so this is not a 60 fps performance claim. No live inference or external writes occurred. See the final JSON reports in [resumed delivery evidence](evidence/resumed-delivery/).
