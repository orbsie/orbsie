# Browser custom mesh integration — preliminary

2026-09-09, local development server on port 3047; base commit `281cc1a` with the in-progress custom mesh implementation. This is synthetic-provider evidence, not live inference or a production release.

Command: `ORBSIE_MODELING_SHAPE=mesh node scripts/verify-browser-modeling-editor.mjs test-results/browser-mesh-editor-1` after rebuilding the static browser worker/player with `node scripts/build-player.mjs`.

The real editor and Manifold worker created a four-vertex pyramid, changed its apex height from 1.25 to 1.6 while preserving its base and other entity state, and rejected a globally inverted revision without replacing the last finished object. Reload restored the accepted revision. ZIP export contained the exact stored GLB, and an independent browser context rendered the extracted standalone player with no external requests or page errors. Astra visually inspected `standalone.png` and confirmed the pyramid appears on the parcel.

The three provider responses were intercepted fixtures. This does not prove model-authored complex mesh quality, general geometric robustness, interactive game completion, performance targets, or publication. Numerical tolerance and total pair-visit budget review remains open; rerun this integration check after relevant validator changes before accepting the implementation.
