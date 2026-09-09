# Browser modeling editor acceptance

Run `TEST_URL=http://localhost:3047 node scripts/verify-browser-modeling-editor.mjs NEW_DIRECTORY` against the current development build. The harness creates a new evidence directory and never overwrites an earlier run.

This run used the real editor, browser Manifold worker, GLB decoder and IndexedDB. Two deterministic intercepted provider responses created a stone arch and widened its opening. Assertions verify trusted browser provenance, ready geometry, stable entity ID, changed model hash and identical saved entities after reload. The harness waits for Resume and opens the saved world; Astra inspected the final screenshot and confirmed the edited arch is visible. Fonts use a local empty stylesheet fixture. No live inference was called.

The source included commits b5e10c9 and fb3ca0e plus the in-progress browser capability transport changes. This is a local development integration check, not acceptance of a deployed commit, gameplay, export, cloud publication or any live provider.

Earlier sibling directories retain investigation evidence: `browser-modeling-editor-initial` exposed a stale decoder and a selector that omitted the ready-state text; `selection` and `rebuilt` ran while capability changes were incomplete and did not create geometry. `capabilities` passed persistence checks but its reload screenshot remained at the start screen because the optional Resume check raced hydration. Its reload-render claim is superseded by this run, which explicitly waits for and clicks Resume.
