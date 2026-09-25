# Android growing world runtime probe

Result: **failed**. Android Chrome static control-page diagnostic; no fixture JavaScript or SoftwareWorld.

Mode: static HTML control page; fixture bundle and SoftwareWorld omitted. Device: droidlm_api35_midrange, Android 15 (API 35), Chrome 124.0.6367.219. Renderer requested: none; static HTML control page. Provider calls: 0; external requests: 0.

Chrome 124's `/json/version` endpoint responded, but Playwright's `connectOverCDP` timed out after the websocket connected. No page object was created, so the run attempted zero control-page navigations. Filtered logcat matched no Chrome failure lines; the Chrome main process and sandboxed child processes remained listed. The attachment timeout's cause is unresolved.

Control mode permits one navigation only after CDP attachment; this run attempted 0. The intended static page contains no fixture bundle, script, canvas, or SoftwareWorld. The JSON includes lifecycle timing, filtered/redacted Chrome renderer, low-memory, or ANR logcat lines, and Chrome process state. This emulator diagnostic does not establish application behavior or acceptance. Screenshots captured: none. See [report.json](./report.json).
