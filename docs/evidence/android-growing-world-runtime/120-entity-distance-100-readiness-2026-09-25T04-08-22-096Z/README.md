# Android growing world runtime probe

Result: **failed**. Readiness-only diagnostic with 120 default fixture entities at 100 m; no travel cycles.

Mode: default 120-entity scene-readiness diagnostic. Device: droidlm_api35_midrange, Android 15 (API 35), Chrome 124.0.6367.219. Renderer requested: direct SoftwareWorld Canvas2D. Provider calls: 0; external requests: 0.

At 100 m, the default fixture again lost its page target. Filtered ActivityManager logcat says a Chrome sandboxed Chromium child process died and its service was scheduled to restart; Chrome’s main process remained. This explains the closed target and shows 5,000 m is not required for the failure. The log does not establish whether the emulator/Chrome environment or fixture triggered the child-process death; OOM is unproven. The early screenshot attempt ended after the target closed, and no ready screenshot was captured.

This is a scene-readiness-only run; it intentionally performs no 1200 m travel gesture and records no rAF or heap result. The JSON also includes early/failure screenshots when captured, and only filtered/redacted Chrome renderer, low-memory, or ANR logcat lines plus Chrome process state. This emulator run does not establish physical-device behavior, native GPU performance, visual quality or 60 fps. Screenshots captured: none. See [report.json](./report.json).
