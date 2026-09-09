# Restricted authoring foundation

The actual Chromium worker run passed the expanded root-authored harness:
same-seed determinism, changed-seed variation, a nondegenerate zero seed,
absence of tested host APIs, malformed recipe rejection, ASCII and Unicode
output limits despite prototype tampering, infinite-loop interruption,
active cancellation and successful subsequent execution. The loop timeout
was observed after 2049.4 ms including worker startup. No external requests
or page errors occurred. This is synthetic source execution, not live model
generation or editor integration.

The evaluator creates a fresh QuickJS context/runtime, captures its bounded
serializer before evaluating source and validates the resulting JSON recipe
before geometry work. Worker startup has a separate ten-second watchdog;
guest execution has a two-second deadline. These are enforced bounds, not
representative device latency measurements. The library and WASM are pinned
to version 0.32.0 and shipped locally with license notices.

Store/protocol persistence, model capability advertising, geometry baking
from emitted recipes, failed-edit preservation and independent export remain
the next integration gate. The initial failed diagnostic run is retained in
`../browser-procedural-foundation/`.
