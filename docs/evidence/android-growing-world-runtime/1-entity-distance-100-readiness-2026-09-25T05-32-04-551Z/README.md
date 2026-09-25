# Android growing world runtime probe

Result: **failed**. Readiness-only diagnostic with 1 fixture entity at 100 m; no travel cycles.

Mode: 1-entity scene-readiness diagnostic with post-ready page CDP session. Device: droidlm_api35_midrange, Android 15 (API 35), Chrome 124.0.6367.219. Renderer requested: direct SoftwareWorld Canvas2D. Provider calls: 0; external requests: 0.

The 1-entity page target closed before fixture.ready(); this run never created the page CDP session or enabled Performance. Filtered logcat identifies a Chrome sandboxed Chromium child process death, but does not establish why it exited.

This is a scene-readiness-only run; it performs no travel gesture and records no rAF or heap result. The page CDP session and Performance domain are created only after fixture.ready(). Navigation aborted before DOMContentLoaded; ActivityManager recorded two Chrome sandboxed child-process deaths while the Chrome main process remained. The cause is unknown. The JSON includes only filtered/redacted Chrome renderer, low-memory, or ANR logcat lines plus Chrome process state. This emulator run does not establish physical-device behavior, native GPU performance, visual quality or 60 fps. Screenshots captured: none. See [report.json](./report.json).
