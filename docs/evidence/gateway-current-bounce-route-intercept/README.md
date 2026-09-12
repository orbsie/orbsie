# Gateway current route intercept correction — bounded integration

The raw run in this directory used the exact Gateway revision-37 ZIP and one
real desktop keyboard browser session. It was captured under harness base
commit `347fde7d7de103c844ad7659eb704a1aacbe8398` before the final 0.01-unit
edge-steering correction. No model, provider, external, or mutating request
occurred; the source ZIP was unchanged.

The run proved p1 contact and ascent, then missed p2. The trace places the
player at x≈−0.686 while p2’s source half-width is≈0.670, so the prior 0.08
dead zone released movement just outside the strict landing footprint. The
intercept log also correctly observed p2’s loop wrap and predicted the
post-wrap target. Root review removed the predictor: wall-clock velocity and an arbitrary
fixed horizon did not establish simulation contact timing. The final harness
uses only `sourcePlatformContact` runtime bounds and a 0.01-unit inward
margin. Eleven focused tests passed, including both missed boundary sides,
inset edge points and points safely inside. Syntax and diff checks passed.
No browser rerun was performed; this is a statically checked driver fix,
not complete route, portal or reset acceptance.

See [`summary.json`](summary.json) and the retained raw
[`report.json`](report.json)/screenshot for evidence. The prior two bounded
attempts remain immutable; this was the one authorized intercept run.
