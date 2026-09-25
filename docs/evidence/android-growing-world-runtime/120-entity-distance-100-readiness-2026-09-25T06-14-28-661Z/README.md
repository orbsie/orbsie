# Android growing world runtime probe

Result: **passed**. Readiness-only diagnostic with 120 fixture entities at 100 m; no travel cycles.

Mode: default 120-entity scene-readiness diagnostic with post-ready page CDP session. Device: droidlm_api35_midrange, Android 15 (API 35), Chrome 124.0.6367.219. Renderer requested: direct SoftwareWorld Canvas2D. Provider calls: 0; external requests: 0.

With the same 120-entity, 100 m fixture settings, this run reached ready after creating the page CDP session and enabling Performance only afterward; the prior run with pre-navigation CDP setup closed before ready. This favors pre-navigation page CDP instrumentation as a possible contributor, but one run does not prove causality. The 1200 m route still needs multiple swipes or a bounded zoom-out/travel/zoom-in sequence; no travel cycles were run here.

This is a scene-readiness-only run; it performs no travel gesture and records no rAF or heap result. The page CDP session and Performance domain are created only after fixture.ready(). The JSON also includes lifecycle timing, screenshots when captured, and only filtered/redacted Chrome renderer, low-memory, or ANR logcat lines plus Chrome process state. This emulator diagnostic does not establish physical-device behavior or application acceptance. Screenshots captured: early-domcontentloaded.png, ready-scene.png. See [report.json](./report.json).
