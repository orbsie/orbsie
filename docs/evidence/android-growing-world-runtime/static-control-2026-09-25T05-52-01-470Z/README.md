# Android growing world runtime probe

Result: **failed**. Android Chrome static control-page diagnostic; no fixture JavaScript or SoftwareWorld.

Mode: static HTML control page; fixture bundle and SoftwareWorld omitted. Device: droidlm_api36_latest, Android 16 (API 36), Chrome 133.0.6943.137. Renderer requested: none; static HTML control page. Provider calls: 0; external requests: 0.

Chrome's DevTools endpoint did not become ready, so Playwright never attempted CDP attachment or control-page navigation. Control navigation attempts: 0. Filtered logcat matched 0 Chrome failure lines; this does not identify the endpoint failure's cause. The original report template misstated this stage; `report.json` retains its original wording in `reviewCorrection` while the observed timings and events are unchanged.

The control mode permits one static HTML navigation after CDP attachment; this run attempted 0. The page contains no fixture bundle, script, canvas, or SoftwareWorld. The JSON also includes lifecycle timing, screenshots when captured, and only filtered/redacted Chrome renderer, low-memory, or ANR logcat lines plus Chrome process state. This emulator diagnostic does not establish physical-device behavior or application acceptance. Screenshots captured: none. See [report.json](./report.json).
