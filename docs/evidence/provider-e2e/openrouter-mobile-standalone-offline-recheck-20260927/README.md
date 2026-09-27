# Offline mobile standalone touch recheck

This is a separate, offline-only replay of revision 9 from the export ZIP retained from the live run documented in [the OpenRouter journey evidence](../openrouter-mobile-create-edit-corrected-20260927/README.md). It is not a second provider journey. The browser served only the exported files from a loopback static server; provider generation requests, editor API requests, and blocked external requests were all zero. The raw ZIP is not included.

The original live screenshot showed the desktop WASD footer after the harness's extra CDP touch-emulation override was detached. Replaying that same ZIP isolated the mismatch. After removing the redundant CDP override, the emulated coarse-pointer state remained active through touch release, detach, and the two-second settle. Chromium reported all five controls visible and within the 390×844 CSS viewport both after the gesture and at screenshot capture. The captured 780×1688 screenshot visibly shows the touch controls. A Right touch moved the player 1.3116 units; no score or win is asserted.

This verifies the exported page in Chromium mobile emulation (390×844, DPR 2, mobile and touch enabled), not on a physical phone. See [offline-mobile-touch.json](offline-mobile-touch.json) for the captured bounds, environment, request counters, and result.
