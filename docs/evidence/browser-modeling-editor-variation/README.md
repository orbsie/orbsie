# Browser modeling seeded-variation acceptance

Run `ORBSIE_MODELING_SHAPE=variation TEST_URL=http://localhost:3047 node scripts/verify-browser-modeling-editor.mjs docs/evidence/browser-modeling-editor-variation` against the development build. The harness creates a new evidence directory and never overwrites an earlier run.

This run used the real editor, browser Manifold worker, GLB decoder and IndexedDB. Three deterministic intercepted provider responses created a boulder (`cylinder → vary seed 7 amplitude 0.3`), increased the amplitude to 0.45 without changing the seed, and rejected "Try an invalid variation" (amplitude 0). Assertions verify trusted browser provenance, ready geometry, preserved Y extents (±1.5) with changed XZ profile bounds, stable seed and entity data, exact undo/redo geometry, invalid-edit preservation of the finished object, reload, ZIP export, and standalone rendering without errors. No live inference was called.

The variation node scales input slices radially about the XZ center with seeded coherent Y-lattice noise, so identical recipe and seed reproduce identical geometry. This is a local development integration check, not acceptance of a deployed commit, publication or any live provider. Twist/taper/vary remain unadvertised to the model until the advertising change lands.
