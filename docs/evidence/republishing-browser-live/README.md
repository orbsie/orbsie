# Live republishing acceptance — stopped at revision-2 state gate

- **Run:** 2026-09-12T00:48:54Z–2026-09-12T00:49:08Z
- **Service:** `https://orbsie.com`
- **Account:** `orbsie-publication-republish-20260912t0050@example.com`
- **Orb:** `pub-accept-mtxo31fj`
- **Vercel project:** `prj_V9pT4WWQIY4XJAgch4x5rFPOdv7F`
- **Deployment submissions:** 2 total; no retry or account rotation.

Revision 1 submitted deployment `dpl_4wuESSXkNkiLEJwRisQCSXLC7NX7` at
`https://orb-b587ad1428b5a164063e-f1prp0i8u-grappeggias-projects.vercel.app`.
Its signed-out browser check passed: `data-ready=true`, canvas visible, and zero
page errors. Its snapshot was revision 1 with title `A tiny island to share` and
crystal material `#a1f0d7`.

Revision 2 saved with the title `A tiny island to share — Sunset crystal garden`
and crystal material `#ff8f6b`, then submitted deployment
`dpl_8JN8fg8Jtk3be331TNaNPjWGbZRp` at
`https://orb-b587ad1428b5a164063e-pd2gp9jx9-grappeggias-projects.vercel.app`.
Both POST mappings exposed the same Vercel project ID. The original run stopped
before the previous-release check because revision 2 returned `INITIALIZING`;
the then-current harness required `QUEUED`, `BUILDING`, or `VERIFYING` before
claiming that window. Revision 2 readiness, old-release preservation, and final
snapshot were therefore not asserted in that run.

`report.json` contains the incremental sanitized progress and no password,
cookie, token, or page contents. Deployments were left in place for review.

## Same-account resume

The pending-state fix accepts Vercel `INITIALIZING`, matching the publication
route's direct `readyState` passthrough. Focused tests cover that state. The
first same-account resume at 2026-09-12T00:54:09Z used a transport that omitted
the production Origin header and stopped at HTTP 403 sign-in; its sanitized
record is preserved as `resume-report-403.json`.

The durable Origin-corrected resume then used one normal sign-in, one owner
status GET, and signed-out reads only. It observed status `READY`, served
revision 2, the expected Vercel project, and distinct known deployment IDs.
Both the immutable revision-1 deployment and final revision-2 deployment passed
browser readiness (canvas visible, zero page errors) and exact project snapshot
revision/title/material checks. The pending interval remains unproven because
the resume began after it elapsed; no late read is treated as pending-window
evidence. See `resume-report.json`. No cloud save, publish request, retry, or
account rotation occurred during either resume attempt.
