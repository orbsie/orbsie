# Input consumption integration

One corrected local Chromium/SwiftShader run passed using the shared World renderer and production pointer handlers. Root reviewed the screenshot, source path and raw report. Two accepted presses (keyboard and CDP touch) produced 5.4 ms and14 ms acceptance-to-consumption samples. Held keyboard/touch duplicates did not add samples; no delayed press appeared after blur. Zero page errors or external/provider/model requests.

This proves measurement plumbing only. Two samples on an empty fixture do not estimate representative performance, rendered feedback, frame rate, or physical mobile latency. Blur evidence covers no delayed queued press after blur, not all held-input or OS-background behavior.

The immutable raw report labels its nearest-rank50th percentile as medianMs (5.4 ms). The ordinary two-sample median is9.7 ms. The current verifier calls this statistic nearestRankP50Ms to avoid ambiguity; no browser rerun was needed for that reporting-label correction. Raw source hashes identify the executed verifier. The earlier readiness timeout is preserved separately under input-consumption-latency.
