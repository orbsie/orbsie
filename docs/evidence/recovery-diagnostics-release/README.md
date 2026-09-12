# Recovery and diagnostics production release

Source `7e74569` deployed to https://orbsie.com as
`FkMtXvy9srGMqZRbLnydoNSJxWzZ` at
https://orbsie-b98lk3s7g-grappeggias-projects.vercel.app.

Local and remote production build/typecheck passed. Four adjacent generation
suites passed (44 tests). The read-only smoke report verifies homepage/canvas,
anonymous journal rejection, and matching player/worker/WASM hashes, with no
page errors, mutations or external browser requests. It made no model calls.

This releases explicit failed-generation recovery controls and bounded JSON,
protocol and truncation diagnostics. Gateway and hosted ChatGPT live acceptance
remain open; deployment success does not establish those journeys.
