# Publishing permission recovery

The owner supplied a replacement team token. Production VERCEL_DEPLOY_TOKEN was updated through the Vercel API (HTTP 200); no credential is retained in this evidence. The CLI sensitive-variable update failed, so the API updated only the existing variable's value.

Source a890fa7 deployed successfully to https://orbsie-5pjfoqmdh-grappeggias-projects.vercel.app and was aliased to https://orbsie.com. Production build and TypeScript checks passed.

The existing authorized acceptance Orb published successfully: POST returned HTTP 200 and an independent deployment ID. The subsequent status request returned READY, servedRevision 64, after the app's artifact integrity verification. The prior token-permission blocker is resolved.

A fresh signed-out Chromium page received HTTP 200 from the standalone deployment, displayed a canvas, and recorded no page errors. Astra inspected the retained screenshot. This check proves publication and visible public rendering of the saved Orb; it does not establish every gameplay assertion or live-provider browser-modeling acceptance.

Evidence: publication-new-token-recheck.json, publication-new-token-status.json, publication-new-token-public.json and publication-new-token-public.png.
