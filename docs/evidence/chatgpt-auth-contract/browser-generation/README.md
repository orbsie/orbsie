# Hosted ChatGPT browser generation integration

Run `node scripts/verify-hosted-chatgpt-generation-ui.mjs` against the local development server (`TEST_URL`, default port 3047).

The account, catalog, inference stream, and cloud endpoints are synthetic fixtures. The editor, browser Manifold geometry generation, incremental entity updates, and local persistence are real. This is not live subscription authorization or inference evidence.

The passing run created a triangular prism, changed its recipe and mesh while preserving its entity ID, reloaded the saved geometry, and recovered from a simulated expired session. A second submission after expiry reopened settings and retained the prompt, with zero free-generation calls. No page errors or unexpected network requests occurred.

The initial run exposed inaccessible selector labels; a subsequent run corrected an overly narrow test locator that omitted the object's visible ready status. The final report records the passing assertions. Production deployment and real login/inference remain outstanding.
