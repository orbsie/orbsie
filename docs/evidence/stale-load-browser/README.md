# Recovery integration after stale-load fix

Source: a81f748. Actual browser run on 2026-09-11 against a fresh local Next
development server at http://127.0.0.1:3061.

Command: `TEST_URL=http://127.0.0.1:3061 node scripts/verify-local-storage-recovery.mjs`

Passed heavy-data mount, recovered draft, storage estimate, lazy library loading
and manual reset at a 390×844 viewport. The fixture seeded 12 library worlds
and observed 13 draft entries. Reload-to-canvas observation was 409 ms for this
run, not a representative-device performance guarantee. The draft-list image
was visually inspected.

Deferred-read unit regressions cover the stale-load race. This browser check
covers surrounding storage/UI integration, not live provider inference or cloud
authorization. An initial run against the pre-existing port 3058 server stopped
at the initial canvas check; it did not exercise recovery. The fresh-server run
passed without changing application code or weakening assertions.
