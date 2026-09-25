# Android growing world runtime probe

Result: **failed**. Readiness-only diagnostic with 1 fixture entity at 100 m; no travel cycles.

Mode: 1-entity scene-readiness diagnostic with post-ready page CDP session. Device: droidlm_api35_midrange, Android 15 (API 35), Chrome 124.0.6367.219. Renderer requested: direct SoftwareWorld Canvas2D. Provider calls: 0; external requests: 0.

Navigation aborted before DOMContentLoaded, before the fixture or page CDP session was ready. All-buffer logcat records two Chrome sandbox services dying around the failed navigation; retained exit info classifies both as `EXIT_SELF`, not a low-memory exit. Chrome's main process remained. The child exits do not establish why the page target closed.

This is a scene-readiness-only run; it performs no travel gesture and records no rAF or heap result. The page CDP session and Performance domain are created only after fixture.ready(). The JSON also includes lifecycle timing, screenshots when captured, filtered/redacted Chrome and ActivityManager lines from all AVD log buffers, Android process-exit records, and current Chrome process state. This emulator diagnostic does not establish physical-device behavior or application acceptance. Screenshots captured: none. See [report.json](./report.json).
