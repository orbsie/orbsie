# Published flagship touch run — Jump-first input ordering

This 390×844 run used CDP touch emulation against the published URL in
`report.json`. It is browser emulation, not a physical phone test.

The driver dispatched Jump before Forward (`launchKeys`: `" "`, then `"w"`).
The first flight sample rose from player center Y 0.42 to Y 1.186988, showing
that the touch jump activated. The route then failed to prove a landing on
platform 1, so it did not reach the platform-2 edge condition this input-order
change was intended to test. The next cause remains uncertain; this trace does
not establish a product-runtime defect.

The run made zero model calls and recorded only same-origin GETs. It had no
external or mutating requests, blocked API requests, or page errors.
