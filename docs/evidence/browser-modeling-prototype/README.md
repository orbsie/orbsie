# Browser modeling backend prototype — preliminary

An isolated temporary npm project installed exact `@bitbybit-dev/manifold-worker@1.1.1` and `manifold-3d@3.3.2` with lifecycle scripts disabled. The app package and lockfile were not changed. The retained prototype lock records dependencies for reproduction; it is not a completed distribution-license review.

The direct Node WASM probe passed: initial arch 152 triangles, volume 23.288210523297796; taller cutter result 136 triangles, volume 22.65263264294031. Both returned NoError and bounds [-3,-2,-0.75] to [3,2,0.75]. One local observation measured initialization 11.50 ms and combined construction/edit 7.96 ms. These are not browser or representative-device benchmarks. Every constructed Manifold object is explicitly deleted in finally.

To reproduce, create a temporary npm project, copy `prototype-package-lock.json` as `package-lock.json` with its matching root dependencies, install with `--ignore-scripts`, copy `direct-probe.mjs` alongside its node_modules, and run it with Node. The script checks valid geometry and reduced volume after the opening edit.

Still required: Bitbybit worker comparison, actual browser execution, recipe integration, output validation, rendering inspection, cancellation/resource bounds and full provider editing/export/publication. No backend selection has been finalized and no model inference was used.

Bitbybit comparison: its actual worker message handler (`initializationComplete` / `onMessageInput`) passed the same arch/edit geometry checks in Node. It returned 152 / 136 triangles, matching direct Manifold volumes and bounds, and NoError for both results. The probe uses cache handles and calls `cleanAllCache` in finally. One observation measured initialization 11.70 ms and construction plus inspection 10.04 ms; this includes different instrumentation from the direct probe and is not a comparative performance benchmark.

Reproduce `bitbybit-probe.mjs` in the same temporary project by bundling with esbuild (`--bundle --platform=node --format=esm --external:manifold-3d`) and running the resulting `.mjs` there. The unminified Node probe bundle was 344.6 KiB, excluding external Manifold; this is not production browser download size. No third-party bundled code is retained in the repository.

The adapter must convert Orbsie's radians to the backend rotation convention and restrict method dispatch to validated recipe operations. Bitbybit's generic dispatcher is an implementation detail, not an API to expose directly to model output. Browser worker lifecycle and cancellation are still untested by this probe.
