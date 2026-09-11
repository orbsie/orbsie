# Authorized OpenRouter input-game attempt

The owner authorized one create/edit run with at most two Luna calls and 4096
output tokens per call. The run made one generation request (HTTP 200), observed
the first reservation after 3830ms and a seed orb, then failed browser geometry
validation: `node tree-shape contains touching or overlapping solids`.
No edit request, fallback, export or standalone acceptance occurred.

Preflight setup attempts made no provider call: the local-only credential gate
rejected the production URL, the output-cap check rejected the initial local
configuration, and the app origin check rejected the local request until
`BETTER_AUTH_URL` matched the loopback origin. The final report supersedes those
setup reports. Local production server and harness have stopped.

The current model instructions already prohibit compose/array/instance overlap
and direct merged surfaces to boolean union. This failure does not justify
weakening that validation. No additional model retry was performed.
