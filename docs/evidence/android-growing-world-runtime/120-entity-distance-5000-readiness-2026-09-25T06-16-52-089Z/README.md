# Android growing world runtime probe

Result: **failed**. Readiness-only diagnostic with 120 fixture entities at 5000 m; no travel cycles.

Mode: default 120-entity scene-readiness diagnostic with post-ready page CDP session. Device: droidlm_api35_midrange, Android 15 (API 35), Chrome 124.0.6367.219. Renderer requested: direct SoftwareWorld Canvas2D. Provider calls: 0; external requests: 0.

The 120-entity page target closed before fixture.ready(); this run never created the page CDP session or enabled Performance. Filtered logs do not identify the failure cause; the emulator/Chrome environment and fixture remain possible contributors.

This is a scene-readiness-only run; it performs no travel gesture and records no rAF or heap result. The page CDP session and Performance domain are created only after fixture.ready(). The JSON also includes lifecycle timing, screenshots when captured, and only filtered/redacted Chrome renderer, low-memory, or ANR logcat lines plus Chrome process state. This emulator diagnostic does not establish physical-device behavior or application acceptance. Screenshots captured: none. See [report.json](./report.json).
