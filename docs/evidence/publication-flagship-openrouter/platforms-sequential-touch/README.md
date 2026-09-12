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
