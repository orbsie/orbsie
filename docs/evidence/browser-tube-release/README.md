# Capped path tube release

Source `1d08574` deployed 2026-09-09 to https://orbsie.com from https://orbsie-97utbp68t-grappeggias-projects.vercel.app. The remote production build and TypeScript checks passed. ChatGPT connection and generation flags were enabled in the deployment command.

Read-only production smoke passed root rendering, canvas, signed-out recovery rejection, and exact hashes for the player, both rendering workers and the browser modeling worker. Astra inspected the landing screenshot. The verifier now includes `modeling/worker.js` in every release check. No model calls, account login, generated-world publication or live tube authoring occurred in this smoke test. Local fixture tube editing/export evidence is in `../browser-tube-worker/`.
