# Flagship revision acceptance

Run the deterministic browser acceptance against the app origin:

```sh
TEST_URL=http://localhost:3028 node scripts/verify-flagship-revisions.mjs
```

The harness opens a fresh Chromium context, fulfills the existing Google Fonts stylesheet with empty fixture CSS and blocks and records every other non-origin HTTP(S) request, installs `scripts/fixture-generation.mjs`, and drives the actual editor UI through the flagship island prompt, selected tree edit, platform and collectible edit, undo, play HUD, and reload recovery. It reads the saved project from the app's IndexedDB library after each committed revision. The fixture is test-only; server-side provider activity is outside this browser harness's scope.

`report.json` records the observed source commit, intercepted generation request count, browser errors, assertion status, revisions, entity-preservation checks, and the final reload state. `revised-goal-7.png` captures the seven-collectible play HUD; `reopened-goal-5.png` captures the restored five-collectible goal after undo and reload. A `failure.png` screenshot is written only when a run fails.

Pass an explicit source revision for evidence, for example `ORBSIE_APP_SOURCE_COMMIT=23c26d4a9b955148a9ef724a98d477d4cb606dbf`. Without it, the report records `unverified`. This is fixture-only browser evidence and does not establish live-provider behavior, full end-to-end coverage, publication, or production state.

The run uses fallback fonts and reduced motion. Its screenshots support scene/HUD state review, not typography or animated formation acceptance. The first strict-network run completed the scenario but failed on Google Fonts; the final harness explicitly stubs that known stylesheet without allowing network access. Three rewritten fixture transport `ERR_ABORTED` events were observed despite complete saved revisions; they are retained in the report, not hidden.
