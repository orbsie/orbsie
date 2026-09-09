# Browser extrusion acceptance

`ORBSIE_MODELING_SHAPE=extrusion node scripts/verify-browser-modeling-editor.mjs docs/evidence/browser-extrusion-worker` passed using the real Chromium editor, Manifold WASM worker, GLB baking and IndexedDB. Synthetic provider commands created a triangular prism, deepened it under the same entity ID, then reloaded the saved geometry. No live model calls or companion requests occurred. Astra inspected the reloaded image.

The initial run in `../browser-extrusion/` failed because the worker adapter lacked the new extrusion forwarding method. That integration was fixed before this successful run.

Six targeted browser-modeling test files passed (39 tests), including concave outlines in both winding directions with expected volume 3. TypeScript passed. The exported source bundle also rebuilt successfully using installed dependencies with no network install (`node scripts/verify-source-rebuild.mjs`).

This supports simple outlines with 3–64 points and positive depth, centered along Z. Holes, twist and bevel are not supported. This fixture acceptance does not establish live-provider extrusion quality or the complete plan.
