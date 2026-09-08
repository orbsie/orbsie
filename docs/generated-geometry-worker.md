# Generated geometry worker

Generated-model rendering now prepares GLBs in a browser worker. One job runs at a time, with at most eight waiting jobs and a 30-second execution deadline. Cancelling an active job terminates its worker; queued cancellation removes the job. Browser worker failures are reported rather than silently moving decoding onto the UI thread.

The worker reads local generated assets from IndexedDB, checks their integrity, validates the supported GLB subset, applies transforms/material colors and merges geometry. Attribute buffers transfer back to the renderer without a second merge. Standalone playback fetches its known relative asset paths and transfers those bytes into the same worker. Catalog decoding and cloud upload/download admission validation are separate paths and have not moved to this worker.

`generated-geometry-worker.js` is included in ZIP/source exports and publication manifests. New publication manifests use version 3 and require that file; verification retains support for historical version 1 and 2 manifests.

Evidence in `docs/evidence/generated-worker/` demonstrates a real browser worker decode and the existing Astra-generated vase playing with the current standalone runtime. The small decode took approximately 57 ms while five 10-ms main-thread timer callbacks ran. The standalone worker returned 3,024 vertices with the expected content hash, both asset requests returned 200, and the screenshot was visually inspected. These checks prove the functional path; they do not establish responsiveness under a demanding scene or superiority to the previous loader.

For the bounded decode probe, serve `public/` on loopback port 3021 and run `node scripts/verify-generated-worker.mjs`. The standalone probe expects the checked-in vase ZIP extracted into a local directory with the current `public/player/runtime.js`, `runtime.css` and `generated-geometry-worker.js` replacing its runtime files; serve that directory on loopback port 3031 and run `node scripts/verify-generated-worker-standalone.mjs`.
