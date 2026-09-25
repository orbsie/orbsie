# Android growing world runtime probe

Result: **failed**. Lower-cost baseline with 120 default fixture entities, 4 Android touch travel/reentry cycles.

Mode: default 120-entity fixture diagnostic baseline. Device: droidlm_api35_midrange, Android 15 (API 35), Chrome 124.0.6367.219. Renderer requested: direct SoftwareWorld Canvas2D. Provider calls: 0; external requests: 0.

The JSON includes page/browser lifecycle times, local response timing, early/failure screenshots when captured, and only filtered/redacted Chrome renderer, low-memory, or ANR logcat lines plus Chrome process state. Travel readiness, rAF percentiles and CDP heap metrics are included when reached. This emulator run does not establish physical-device behavior, native GPU performance, visual quality or 60 fps. Screenshots captured: none. See [report.json](./report.json).

The 120-entity default fixture also lost its page target, weakening attribution to the added 40-entity cluster. This run retained the 5,000 m distance, so it does not isolate that distance as a cause. Logcat had one low-memory warning for an unidentified PID; Chrome’s main process remained, but the warning does not identify the PID as Chrome. Renderer/OOM causation remains unproven. The CDP session detach was not acknowledged directly, then the harness closed its browser connection and emulator.
