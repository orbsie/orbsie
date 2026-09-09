# Browser procedural authoring production release

Source `c56783c` deployed to
`https://orbsie-oprwh1i7g-grappeggias-projects.vercel.app` and was aliased to
`https://orbsie.com`. Vercel deployment ID:
`D57kaj1M8epFjYKtWXeS7QT8a98u`. The production build and TypeScript checks
passed. ChatGPT hosted connection and generation flags remained enabled.

The read-only production smoke passed homepage rendering, unauthorized
journal access returning 401, and exact player, geometry-worker,
procedural-worker and QuickJS WASM hashes. The browser showed the canvas and
composer with zero page errors, external requests or non-GET requests. The
landing screenshot was visually inspected. No inference was submitted by
the release check.

Acceptance evidence includes the actual QuickJS worker foundation and
editor create/edit/undo/reload/export fixtures. The integration's six focused
test files passed 43 tests; source-limit follow-up passed 20 tests; cloud
hash-integrity admission passed 32 tests; bounded stream diagnostics passed
eight tests. These are overlapping targeted runs, not a summed unique suite.
The ChatGPT bundle/private-file trace verifier also passed.

This release makes the tested procedural implementation available. It does
not certify live model-authored procedural workflows: OpenRouter attempts
included an invalid scene update and an observed upstream 429. Further
OpenRouter calls stopped after that rate limit. Real ChatGPT consent and
generation, Gateway BYOK, full provider gameplay/publication workflows and
representative performance remain open gates. Regular Chrome was still
unavailable to computer use during this release.
