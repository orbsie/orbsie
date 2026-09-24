# Published flagship touch route — partial pass, then platform-2 failure

This run used the existing published flagship URL in `report.json` at 390×844
with CDP touch emulation. It is browser emulation, not a physical phone test.

The verifier selected the catalog manifest embedded in the saved ZIP
(SHA-256 `584e992217fc0f617e89f37b09f180b5fb88eabf7be4230861beab43bbd57726`),
which matches this snapshot's contact geometry. Platform 1 landed at its
canonical contact height, Y 1.440625, and all nine rendered carry samples
showed the same player/platform displacement.

The sequential route then failed to land on platform 2 and recorded ground
contact. The driver logged `d` plus Jump, but the first sample after the press
showed player center Y falling from 1.440625 to 1.250227. This evidence does
not distinguish CDP touch dispatch from jump handling after a moving-platform
landing, so the full touch route remains unaccepted and no product-runtime
cause is claimed here.

The saved project SHA-256 is
`fdaabbd42a80478b3395e9220d5385706d646f457e523e2a7010ece3d47837a0`; its
runtime JavaScript SHA-256 is
`3d2fa966dc49a46eee64bd453e4db5861f57b565d71ec953f26b05c8ae4c7742`. The
published runtime JavaScript SHA-256 is recorded separately in the report.
The run made zero model calls and recorded only same-origin GETs, with no
external or mutating requests, blocked API requests, or page errors.
