# Android growing world runtime probe

Result: **failed**. Readiness-only diagnostic with 120 default fixture entities at 100 m; no travel cycles.

Mode: default 120-entity scene-readiness diagnostic with post-ready page CDP session. Device: droidlm_api35_midrange, Android 15 (API 35), Chrome 124.0.6367.219. Renderer requested: direct SoftwareWorld Canvas2D. Provider calls: 0; external requests: 0.

The page target closed during page.goto before fixture.ready(); this run never created the page CDP session or enabled Performance. Delaying target-level CDP instrumentation therefore did not prevent reproducing the failure. A prior 100 m run logged a Chrome sandboxed Chromium child-process death; this run had no matching logcat record, so the trigger remains uncertain across the emulator/Chrome environment and fixture.

This is a scene-readiness-only run; it intentionally performs no 1200 m travel gesture and records no rAF or heap result. The page CDP session and Performance domain are created only after fixture.ready(). The JSON also includes early/failure screenshots when captured, and only filtered/redacted Chrome renderer, low-memory, or ANR logcat lines plus Chrome process state. This emulator run does not establish physical-device behavior, native GPU performance, visual quality or 60 fps. Screenshots captured: none. See [report.json](./report.json).
