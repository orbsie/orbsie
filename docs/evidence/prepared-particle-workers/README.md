# Decode-worker surface preparation

`node scripts/verify-prepared-particle-workers.mjs` bundles and runs both actual worker entrypoints in Chromium using local catalog and generated GLBs. Both returned finite Float32 position/color surface attributes with 2048 points. Requests are intercepted locally; no model or external service is contacted.

Decoder integration computes these attributes after transforms/material colors and before geometry byte-limit enforcement. Existing generic attribute transfer and cache accounting carry them. Twelve focused decoder tests verify real decoded attributes and rejection when their additional bytes exceed the limit; eight sampler tests cover prepared reuse without triangle traversal. Type checking passed.

The formation browser benchmark recorded prepared dense-mesh reuse at 0.3–1.0 ms versus 11.7–62.9 ms for fresh sampling on the same run. This measures renderer-side reuse, not whole-worker decode latency or normal-GPU frame rate. The renderer also applies explicit asset tint to prepared colors. Browser fallback decoding still runs on the caller thread where workers are unavailable; procedural geometry remains synchronously sampled.
