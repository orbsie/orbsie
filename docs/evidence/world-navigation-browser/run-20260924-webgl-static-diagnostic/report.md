# World navigation browser evidence

Status: **partial/failed**

Source commit: `52a4d959e0a18d76ecfcf716ca4d25a676d906cc`  
Target: `https://orbsie.com` · Chromium WebGL / SwiftShader · 1280×900  
Provider calls: 0; `/api/generate` returned deterministic fixture NDJSON.

- WebGL-only fixture used the same grouped marker ID and placement with stationary `platform` geometry (`detail: refined`, static behavior); default crystal geometry remains for the other lanes.
- Zoom buttons worked: 600% → 480% → 600%.
- The platform signature contained 39 pixels, below the 100-pixel initial measurement minimum. The run stopped before background pan, wheel zoom, north reset, chat/control overlay isolation, or the final saved-selection/position check.
- This run does not distinguish crystal animation from an actual input leak because the stationary marker did not pass the initial signature gate. Only `desktop-webgl-swiftshader-initial.png` was captured.
- No provider calls, page/console errors, blocked external origins, or unexpected API paths were recorded.

Limitations: Chromium SwiftShader software rendering only; no native GPU or Canvas2D/mobile retest. The browser did not directly measure world-target preservation; the existing pure-state `north_reset` test in `tests/world-navigation.test.ts` remains the evidence for target/distance preservation.
