# Generated geometry undo/redo

2026-09-09, application source `1d08574` / current base `0614296`, local real editor/worker with three synthetic provider responses. The tube radius edit changed the baked GLB; undo restored the exact first entity snapshot, redo restored the exact edited entities, and a subsequent invalid reversing-path edit preserved them. Reload, exact GLB export and independent standalone playback passed without external requests or page errors.

Command: `ORBSIE_MODELING_SHAPE=tube node scripts/verify-browser-modeling-editor.mjs test-results/browser-tube-undo-redo-valid`.

The first test placed undo after the failed prompt and expected the geometry to revert immediately. That expectation failed: each attempted prompt is an authoring-history entry, so the first undo removed the failed prompt while preserving the edited geometry. Its report is retained. The accepted test exercises undo/redo immediately after the successful edit, then verifies failed-edit preservation independently. No runtime change was needed, and this does not prove live-provider undo or arbitrary interrupted-turn recovery.
