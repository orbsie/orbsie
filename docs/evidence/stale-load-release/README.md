# Stale-load recovery production release

On 2026-09-11, the authorized Vercel project grappeggias-projects/orbsie deployed
source f88bcc9 to https://orbsie.com. Deployment ID:
8jgUGR3Ch8B2Jz5r7KSKRVyJANdf. The official CLI completed its production build
and alias update. Hosted ChatGPT flags were retained for this deployment.

The read-only production smoke passed: homepage and canvas, anonymous journal
401, and exact player/worker/WASM hashes. No inference or non-GET browser
requests were made. report.json contains deployment attribution and checks.

Recovery validation before release: 35 targeted tests, type checking, production
build, host-package verification, and the actual local browser storage flow in
../stale-load-browser/. This is not evidence of completed live provider journeys.
