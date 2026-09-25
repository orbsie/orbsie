# Android growing world runtime probe

Result: **failed**. Readiness-only diagnostic with 1 fixture entity at 5000 m; no travel cycles.

Mode: 1-entity scene-readiness diagnostic with post-ready page CDP session. Device: droidlm_api35_midrange, Android 15 (API 35), Chrome 124.0.6367.219. Renderer requested: direct SoftwareWorld Canvas2D. Provider calls: 0; external requests: 0.

The fixture reached `fixture.ready()`, then the page target closed during `software-scene-readiness-sample`; the first state sample failed with a closed-target error. An early screenshot was captured. All-buffer logcat and retained exit info record a sandbox child as `OTHER KILLS BY SYSTEM / ISOLATED NOT NEEDED` after the closure; this does not establish the trigger.

This is a scene-readiness-only run; it performs no travel gesture and records no rAF or heap result. The page CDP session and Performance domain are created only after fixture.ready(). The JSON also includes lifecycle timing, screenshots when captured, filtered/redacted Chrome and ActivityManager lines from all AVD log buffers, Android process-exit records, and current Chrome process state. This emulator diagnostic does not establish physical-device behavior or application acceptance. Screenshots captured: early-domcontentloaded.png. See [report.json](./report.json).
