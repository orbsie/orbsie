# Android growing world runtime probe

Result: **failed**. Lower-cost baseline with 120 default fixture entities, 4 Android touch travel/reentry cycles.

Mode: default 120-entity fixture diagnostic baseline. Device: droidlm_api35_midrange, Android 15 (API 35), Chrome 124.0.6367.219. Renderer requested: direct SoftwareWorld Canvas2D. Provider calls: 0; external requests: 0.

The 120-entity default fixture also lost its page target, weakening attribution to the added 40-entity cluster. This run retained the 5000 m distance, so it does not isolate that distance as a cause. Filtered logcat did not confirm a Chrome-attributed renderer, low-memory, or ANR cause.

The JSON includes page/browser lifecycle times, local response timing, travel readiness, rAF percentiles and CDP heap metrics when reached. The JSON also includes lifecycle timing, screenshots when captured, and only filtered/redacted Chrome renderer, low-memory, or ANR logcat lines plus Chrome process state. This emulator diagnostic does not establish physical-device behavior or application acceptance. Screenshots captured: none. See [report.json](./report.json).
