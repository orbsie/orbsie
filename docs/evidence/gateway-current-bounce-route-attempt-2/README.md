# Gateway current seven bounce route — attempt 2

This is the second and final bounded offline browser attempt against the same
unchanged Gateway export. It used real desktop keyboard events and read-only
rendered telemetry. No teleport, state mutation, provider call, model call,
external request, or page error was observed.

The route reached and verified bounce ascent for `platform-1` at
`25807.2 ms → 25940.3 ms` and `platform-2` at `28827.2 ms → 28982.0 ms`, but
did not establish a descending contact followed by ascent for `platform-3`.
The player subsequently returned to ground. The two allowed browser attempts
are exhausted, so this evidence does not claim a complete Gateway win/reset.

See [`desktop-route-failure.png`](desktop-route-failure.png) and
[`report.json`](report.json) for the retained raw trace.
