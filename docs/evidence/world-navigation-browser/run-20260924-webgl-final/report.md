# World navigation browser evidence

Status: **partial/failed**

Source commit: `52a4d959e0a18d76ecfcf716ca4d25a676d906cc`  
Target: `https://orbsie.com` · Chromium WebGL / SwiftShader · 1280×900  
Provider calls: 0; `/api/generate` returned deterministic fixture NDJSON.

- Zoom controls: 600% → 480% → 600%. Background pan moved the marker signature 70.8 px. Wheel zoom: 600% → 453%.
- Marker remained visible after wheel zoom (17,484 signature pixels) and north reset (24,305). North reset returned heading 28° → 0° and retained 453% zoom.
- Chat overlay drag left navigation labels unchanged, but the marker centroid shifted 31.9 px, exceeding the 6 px stability tolerance. Control overlay isolation and the final exact saved-selection/position check were not reached.
- Initial fixture selection: ID `navigation-fixture-marker-12km`; group position `[12000, 0, 0]`; entity position `[0, 1, 0]`. Final persistence recheck was not reached.
- No page or console errors, blocked external origins, or unexpected API paths were recorded.

The browser run does not directly measure world-target preservation. That behavior is supported by the pure-state `north_reset` test in `tests/world-navigation.test.ts`. The screenshots `desktop-webgl-swiftshader-after-wheel.png` and `desktop-webgl-swiftshader-north-reset.png` are retained.

Limitations: Chromium SwiftShader software rendering only; no native GPU or Canvas2D/mobile retest. Initial marker checks use a 100-pixel minimum; post-wheel and post-reset checks use 25 pixels.
