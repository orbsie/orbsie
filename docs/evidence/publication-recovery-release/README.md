# Publication recovery release

Source: `385b66206f7b827bdab9da1c5b7a9356f5c5a11b`.
Deployment: https://orbsie-i4hxwdwir-grappeggias-projects.vercel.app (production alias https://orbsie.com).

The publication retry now searches bounded deployment pages using decreasing timestamp cursors and exact immutable metadata. Incomplete or aborted searches fail closed before creating another deployment. Astra reviewed the implementation and corrected cursor direction after a three-page regression failed. The five targeted publication test files passed all 56 tests, and the production build passed before deployment.

`report.json` records the read-only production smoke on 2026-09-08: homepage HTTP 200, anonymous generation journal HTTP 401, matching player and geometry-worker hashes, visible canvas, exact composer placeholder, no page errors, and no non-GET browser requests. The only external browser request was Google Fonts CSS. `landing.png` is the captured browser state.

This check made no model calls and did not create a per-Orb deployment. Successful dedicated publication and the remaining live provider matrix are still unverified. The earlier 498-test integration suite belongs to source `f6e5801`; it was not rerun for this release.
