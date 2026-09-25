# Android growing world runtime probe

Result: **passed**. Android Chrome static control-page diagnostic; no fixture JavaScript or SoftwareWorld.

Mode: static HTML control page; fixture bundle and SoftwareWorld omitted. Device: droidlm_api35_midrange, Android 15 (API 35), Chrome 124.0.6367.219. Renderer requested: none; static HTML control page. Provider calls: 0; external requests: 0.

The static control page completed one navigation and a post-navigation CDP Runtime.evaluate with no fixture JavaScript or SoftwareWorld. This demonstrates the basic AVD, ADB, Chrome, and CDP navigation path for this run; it does not establish application behavior or explain earlier fixture failures.

The control mode permits one static HTML navigation after CDP attachment; this run attempted 1. The page contains no fixture bundle, script, canvas, or SoftwareWorld. The JSON also includes lifecycle timing, screenshots when captured, and only filtered/redacted Chrome renderer, low-memory, or ANR logcat lines plus Chrome process state. This emulator diagnostic does not establish physical-device behavior or application acceptance. Screenshots captured: control-page.png. See [report.json](./report.json).
