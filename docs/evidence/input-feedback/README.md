# Input feedback timing

Run the deterministic browser measurement against the fresh editor build:

```sh
TEST_URL=http://localhost:3029 \
ORBSIE_APP_SOURCE_COMMIT=f9967e2 \
node scripts/verify-input-feedback.mjs
```

The harness opens a fresh Chromium context at a fixed `1440 × 1000` viewport, fulfills only the exact Google Fonts `/css2` stylesheet with empty CSS, and blocks and records every other off-origin HTTP(S) request. It reuses `scripts/fixture-generation.mjs`, submits the exact flagship island prompt through the real Playwright form click, and waits for all 14 fixture entities to finish.

The submit timestamp is captured by a document-level capture-phase listener before React's form handler. The report then records when the actual `.app.is-workspace`, matching `.message.user`, and visible `.building-message` are all present, followed separately by the next animation-frame observation. The `domFeedbackWithin100ms` and `nextAnimationFrameWithin100ms` fields are computed from those observations; they are not hardcoded performance passes and do not claim pixels, paint timing, or INP.

`report.json` records the explicit app source commit (or `unverified` when the environment omits it), repository commit, browser/device/WebGL metadata, viewport, fixture request count, page and console errors, request failures, blocked off-origin traffic, entity count, and timing observations. `final.png` is one optional final editor screenshot. The fixture run makes no live model calls and does not establish production or normal-GPU performance.

The reviewed run uses reduced motion and fallback fonts. It observed feedback at 32.6 ms and the next animation-frame callback at 94.8 ms, with one completed fixture request and no page/console errors. Astra added assertions for a trusted submit event, visible ancestors and viewport intersection, and required the next-frame observation to finish before reading it. These style/layout checks still do not establish pixel visibility or paint timing. The clock starts when the submit event is dispatched, not at physical input arrival. Normal-motion, varied-load and device measurements remain open. The transport's recorded `ERR_ABORTED` is retained despite successful completion; it is not hidden from the report.
