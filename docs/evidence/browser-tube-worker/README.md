# Browser capped tube acceptance

2026-09-09, base commit `b8f9ff0` plus reviewed tube implementation. Synthetic provider responses exercised the real editor, Manifold worker, persisted GLB and standalone player. No live inference was used.

Command: `ORBSIE_MODELING_SHAPE=tube node scripts/verify-browser-modeling-editor.mjs test-results/browser-tube-editor-1` after rebuilding static workers/player.

A three-point nonplanar path created a capped tube. A radius-only edit changed the baked mesh hash and increased its height bounds without changing its path. A reversing-path revision produced an error and preserved the exact last finished entities. Reload, exact GLB inclusion in ZIP, and independent standalone rendering passed with no external requests or page errors. Ready-marker time was 4046 ms, not a performance target pass. Astra visually inspected the bent tube and flat cap in `standalone.png`.

This proves the bounded recipe integration with fixtures, not provider-authored path quality, variable-radius or closed-loop sweeps, game completion or publication. Development review corrected the frame projection and restored cap centers to the path endpoints; no debugging bypass remains.
