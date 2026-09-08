# Parcel transition browser evidence

This evidence is produced by `node scripts/verify-parcel-transition.mjs` against
the local Orbsie app. The harness uses the checked-in procedural fixture, seeds
one local IndexedDB draft, and stubs the initial `/api/generate` response with a
small deterministic command stream. It does not sign in, write cloud state, or
call a model provider. All external browser requests are blocked and reported.

The screenshots cover the initial descent, direct local workspace opening,
returning to the planet, repeated arrival for the same project, and the reduced
motion path. `report.json` records the fixture identity, canvas and overflow
checks, browser errors, blocked external requests, generation request count, and
the standalone player source inclusion check.
