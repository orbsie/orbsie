# Terminal publication attempt

One bounded production run created a dedicated test account/world, published revision1, and verified its exact snapshot plus signed-out browser readiness. It saved and submitted revision2. Exactly two publication POSTs occurred, with zero model calls and zero cancellations.

Root's pre-cancellation guard incorrectly required the POST candidate deploymentUrl to equal the old served URL. Source src/app/api/publish/route.ts returns the candidate URL on POST; owner GET carries served-release status. This test-contract mismatch stopped the run before any direct Vercel call. The corrected verifier defers old served-URL equality to the terminal-status helper, while retaining exact ID/project/pending-state checks before cancellation. It also preserves replacement submission metadata before assertions. No retry was run.

The raw report and first-release screenshot are preserved. Neither a canceled deployment nor terminal-failure continuity was observed. This is not evidence of a product publication defect.
