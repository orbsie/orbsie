# Published flagship touch platform sequence — failed

Run on 2026-09-12 against the existing independent flagship deployment using
verifier commit `65872bf`, a 390×844 mobile viewport, and real CDP touch events.

The verifier reported landing on platform 1, then failed its rendered carry
check. Platforms 2 and 3 were not attempted. This is not a passing mobile
sequence acceptance result; diagnosis must distinguish input, gameplay, and
measurement behavior before changing the implementation.

The report preserves telemetry and the video preserves the run. The source
snapshot comparison passed. There were 20 same-origin GET requests, no model
calls, no external or mutating requests, and no page errors. No account,
publication, or deployment was created.

## Diagnosis

The apparent platform-1 landing was a verifier false positive. The accepted
sample had player center Y `1.167747`, while the catalog collision contact
height was `1.440625`. Its previous sample was already below contact height
(`1.391445`) but still inside the existing `0.08` crossing tolerance; the
player only became horizontally overlapping on the later, below-platform
sample. Subsequent samples fell to ground Y `0.42`, and no rendered carry was
observed. The saved video shows the same pass-through.

The verifier correction preserves the runtime crossing tolerance but also
requires the accepted sample to be within `1e-5` of canonical contact height.
This rejects the saved touch sample while retaining true desktop phase-aware
contacts. The check is still sampled telemetry and cannot prove continuous
contact between frames. The touch driver and product runtime were not changed.
