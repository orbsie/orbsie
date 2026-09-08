# Catalog worker browser acceptance

Run `TEST_URL=http://127.0.0.1:3035 node scripts/verify-catalog-worker-browser.mjs` against the current built app. Three fixture authoring requests exercise mixed creation, forbidden reuse rejection, and a full ten-model catalog scene. No real provider calls are made.

The probe observes actual worker messages, checks visible tree pixels, exports the ZIP with models and licenses, plays it directly, rebuilds its included source with existing local dependencies, builds the Vite output and plays that output. Both standalone paths decode through the included worker without external requests. Screenshots were visually reviewed. Full-catalog output contains ten successful worker results.

`standalone-before-visual-investigation.png` captured formation too early despite successful decoding. The final probe waits for visible pixels; `standalone.png` and `built-standalone.png` show the tree. `legacy-standalone-diagnostic.png` preserves a comparison with the old catalog ZIP. The earlier observation was not accepted as visual completion.

This proves functional worker integration, not latency or frame-rate budgets, Blender installation, fresh provider acceptance or independent cloud publication.
