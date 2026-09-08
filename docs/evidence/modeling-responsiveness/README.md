# Local modeling responsiveness baseline

The final `report.json` records a functional pass using the actual editor, loopback companion and isolated system Blender 4.0.2. Provider responses are fixtures; no real inference was performed. Three new GLBs were constructed and rendered while typing, camera dragging and selection remained operable. `completed.png` was visually reviewed and shows the retained tree/crystal and three pink/teal generated models.

| Measurement | Result |
| --- | --- |
| Completed Blender jobs | 1,329 / 1,268 / 1,317 ms |
| Stop to confirmed cancellation | 128 ms |
| Sampled peak Blender RSS | 253,710,336 bytes |
| Sampled Blender CPU time | 3.84 seconds |
| Idle frame interval p95 | 66.8 ms |
| Active creation frame interval p95 | 83.3 ms |
| Idle event dispatch to next frame callback p95 | 48.1 ms |
| Active event dispatch to next frame callback p95 | 63.8 ms |
| Adaptive canvas backing buffer | 960 × 600 for a 1280 × 800 viewport |

This host uses SwiftShader software rendering on an AMD EPYC 9124 with 32 logical CPUs and about 67 GB RAM. **The 33.33 ms fallback frame budget was not met.** A passing functional probe does not certify the performance target, hardware-GPU laptops, a portable Blender package or clean-machine installation. The comparison covers the whole creation workload (two entities growing to five, decoding and modeling); it does not isolate Blender CPU impact. Event timing measures dispatch to a JavaScript frame callback, not physical input latency or completed display presentation. Process samples can miss short-lived work; GPU memory was unavailable.

Reproduce against the locally built app with `TEST_URL=http://127.0.0.1:3035 node scripts/verify-modeling-responsiveness.mjs`. The host needs the development system Blender runtime and its isolation prerequisites. Stop is tested only after positive progress from Blender's trusted modeling program.

Earlier diagnostic files are retained transparently: `before-pairing-assertion-fix.json`, `before-submit-wait-fix.json`, `before-object-toggle-fix.json` and `before-selection-toggle-fix.json` document probe synchronization/selector errors, not successful runs. `output-budget-rejection.json` records a larger workload rejected by the 2 MB GLB limit; the final workload uses eight spheres with 16 segments per model. `failure.png` belongs to an earlier unsuccessful probe.

`dpr-reset-diagnostic.json` exposed an application bug: typing reset the canvas from 960 × 600 to 1280 × 800. Commit a28339a gives React ownership of the adaptive DPR so editor updates preserve it. The separate `../adaptive-resolution-editing/` regression uses an explicitly synthetic slow-frame stimulus and must not be treated as a benchmark. No controlled before/after performance claim is made here.
