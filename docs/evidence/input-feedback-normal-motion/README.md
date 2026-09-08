# Normal-motion input feedback

The production build of app source `f9967e2` was checked with normal motion (`no-preference`) on 2026-09-08. The harness observed the trusted submit event, then the workspace, matching user message and building feedback, including ancestor style and viewport checks. It waited for the next animation-frame observation before reading the result.

DOM feedback was observed at 43.6 ms. The next frame callback was observed at 106.9 ms, exceeding the 100 ms target in this single sample. The report preserves `nextAnimationFrameWithin100ms: false`; its overall passed status refers to functional assertions, not universal performance acceptance. Generation completed with all 14 fixture entities, one intercepted fixture request and no page/console errors.

This is a Chromium SwiftShader observation with fallback fonts, not physical-input latency, paint timing, INP or normal-device GPU certification. It does not establish a reliable performance difference from the earlier reduced-motion sample. No live model call was made.

```sh
TEST_URL=http://localhost:3029 \
ORBSIE_APP_SOURCE_COMMIT=f9967e2 \
ORBSIE_INPUT_FEEDBACK_EVIDENCE_DIR=docs/evidence/input-feedback-normal-motion \
node scripts/verify-input-feedback.mjs
```
