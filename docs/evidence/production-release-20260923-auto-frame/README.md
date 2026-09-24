# Production release smoke — September 23, 2026

Deployment `dpl_7rrUPQyL4DE8RLTZw2WKWaQaxY5n` was promoted to
`https://orbsie.com/` after its Vercel build reached Ready. The read-only,
signed-out Chromium smoke passed: the landing canvas and composer rendered,
generation-run access returned 401, no write or external browser requests were
made, and no page errors occurred. The deployed player and geometry-worker
bytes match the checked-in build by SHA-256. See [report.json](report.json) and
[landing.png](landing.png).

This smoke did not submit a prompt, sign in, run provider inference, or publish
a new world. Production still reports `authoringReview:false`.
