# Browser modeling deformation acceptance

Run `ORBSIE_MODELING_SHAPE=deformation TEST_URL=http://localhost:3047 node scripts/verify-browser-modeling-editor.mjs docs/evidence/browser-modeling-editor-deformation` against the development build. The harness creates a new evidence directory and never overwrites an earlier run.

This run used the real editor, browser Manifold worker, GLB decoder and IndexedDB. Three deterministic intercepted provider responses created a twisted column (`box → twist 0.35 → taper 1/1.25`), widened the top taper to 1.6 without changing the twist, and rejected "Collapse the top taper to zero". Assertions verify trusted browser provenance, ready geometry, preserved Y extents (±1.5) with an increased top X bound, stable node data for the twist, exact undo/redo geometry, invalid-edit preservation of the finished object, reload, ZIP export, and standalone rendering without errors. No live inference was called.

This is a local development integration check, not acceptance of a deployed commit, publication or any live provider. Twist/taper remain unadvertised to the model until a real-provider acceptance run covers them.
