# Catalog comparison evidence

`node scripts/verify-catalog-comparison.mjs` builds the actual `World` renderer and the checked-in asset geometry worker, then serves both with the checked-in Kenney tree GLB from a local HTTP server. It runs three fresh browser contexts with the same project ID, seed, environment, positions, transforms, colors, and refined entities:

- three procedural trees;
- three `kenney.nature.tree-default` catalog trees;
- two procedural trees and one catalog tree.

The verifier requires finite draw samples for all three entities, no browser errors, no external requests, the expected catalog bytes in asset modes, byte-for-byte equality with the checked-in GLB, and successful decoded geometry from the built asset worker. Catalog draw samples are recorded only after the asset geometry is ready, so fallback seed geometry cannot satisfy the timing.

`report.json` contains raw submission-to-draw timings, preparation frame intervals, renderer/browser details, scene complexity, and cold-context metadata. These are deterministic local render/load observations for this run. `performancePass` is deliberately `not-evaluated`; the evidence does not claim a speed improvement, normal-device performance, or a general performance guarantee.

Reviewed run (SwiftShader, one fresh context per mode):

| Mode | First entity draw | All three drawn |
|---|---:|---:|
| procedural-only | 80.3 ms | 80.5 ms |
| catalog-only | 103.2 ms | 103.4 ms |
| mixed | 50.2 ms | 121.4 ms |

Timing starts after the blank renderer has drawn a frame, immediately before applying fixture entities. It excludes model inference. Fresh contexts reset browser asset caches but do not establish cold operating-system or GPU caches. Different geometry and one sample per mode prevent a general speed comparison. The mixed catalog entity exceeded the roughly 100 ms update target in this run; functional success does not certify that performance gate.
