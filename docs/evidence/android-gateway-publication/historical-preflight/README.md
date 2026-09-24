# Historical Android publication preflight

This check intentionally targeted a prior Gateway deployment to exercise the
Android CDP harness before a fresh publication. It failed before gameplay:
after forcing WebGL unavailable, that older runtime did not expose
`main[data-ready="true"]`. Its runtime SHA-256 (`825e0fea…`) differs from the
current player build (`381f1060…`), so it cannot validate the current fallback.
The new publication must be checked separately. No provider calls, generation
requests, cookies or external page requests occurred.

The single WebGL initialization page error is expected when the test forces
the compatibility renderer. Later harness revisions count that event
separately from unexpected errors.
