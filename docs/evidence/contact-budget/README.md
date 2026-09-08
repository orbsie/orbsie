# Contact preparation budget

The browser player passes only the current program's collision-trigger entity IDs into the physics step. The session caches this set until the program changes. Worlds without collision rules use an empty set. This removes unused contact-bound preparation while leaving pickup, portal and platform physics checks intact.

`cpu-preparation.json` measures seven cold samples per configuration with 80 fresh procedural tree recipes on the recorded host. Median CPU preparation was 33.074 ms for all objects, 0.030 ms for no collision targets and 0.489 ms for one target. Setup is excluded. This is an isolated preparation measurement, not a browser FPS, GPU, input-latency or background-modeling result.

Tests verify that geometry preparation is not called for unrequested targets, requested bounds are cached, equivalent program snapshots retain their target set and changed/removed programs update it. The actual editor and downloaded standalone ZIP browser test now includes collision-triggered scoring and passes with score 23 after collection, timer and input actions. It uses fixture generation and makes no provider calls.

Remaining work: reuse already prepared render bounds, move expensive preparation away from the interaction loop, and measure representative browser responsiveness under active generation and local modeling.
