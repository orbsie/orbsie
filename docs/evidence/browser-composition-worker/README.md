# Browser composition acceptance

2026-09-09, base `19f03b2` with composition implementation under review. Three synthetic provider responses drove the real editor, geometry worker, persistence and standalone export. No live model calls.

Command: `ORBSIE_MODELING_SHAPE=composition node scripts/verify-browser-modeling-editor.mjs test-results/browser-composition-corrected` after rebuilding worker/player assets.

A unit box became a three-copy linear array, translated left, mirrored through the origin plane, composed with its mirror and copied into two rows. The final asset contained twelve disjoint boxes as one baked GLB mesh (144 triangles). Increasing the array spacing changed the asset hash while preserving outer bounds and all other recipe nodes. Exact undo/redo, invalid overlapping copies preserving the finished entities, reload, ZIP GLB hash verification and standalone rendering passed. No external requests or page errors. Astra visually inspected all twelve diagnostic columns. The fixture intentionally uses the harness's elevated entity position; it is a geometry test, not a designed game scene.

The first browser run failed because an unintended required mirror `origin` field conflicted with the agreed origin-plane contract. `prior-schema-failure.json` preserves the diagnostic. That field was removed; it was not added to the fixture to bypass the mismatch. Raw schema errors were separately replaced with a concise user-facing message in `19f03b2`.

These are baked copies in one mesh, not GPU instancing, scene parenting or independently editable entity children. Provider authoring, game completion, performance and publication are separate gates. Ready-marker time was3817 ms on this run and is not a performance-target pass.
