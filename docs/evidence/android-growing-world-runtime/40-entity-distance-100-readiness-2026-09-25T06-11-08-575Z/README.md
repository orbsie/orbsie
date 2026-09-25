# Android growing world runtime probe

Result: **passed**. Readiness-only diagnostic with 40 fixture entities at 100 m; no travel cycles.

Mode: 40-entity scene-readiness diagnostic with post-ready page CDP session. Device: droidlm_api35_midrange, Android 15 (API 35), Chrome 124.0.6367.219. Renderer requested: direct SoftwareWorld Canvas2D. Provider calls: 0; external requests: 0.

The 40-entity diagnostic fixture reached scene readiness at 100 m. It used a diagnostic-only fixture transform and did not exercise the 120- or 160-entity acceptance scene; no travel cycles were run.

This is a scene-readiness-only run; it performs no travel gesture and records no rAF or heap result. The page CDP session and Performance domain are created only after fixture.ready(). The JSON also includes lifecycle timing, screenshots when captured, and only filtered/redacted Chrome renderer, low-memory, or ANR logcat lines plus Chrome process state. This emulator diagnostic does not establish physical-device behavior or application acceptance. Screenshots captured: early-domcontentloaded.png, ready-scene.png. See [report.json](./report.json).
