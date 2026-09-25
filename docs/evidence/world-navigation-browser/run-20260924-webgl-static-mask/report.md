# World navigation browser evidence

Status: **passed**

Source commit: 52a4d959e0a18d76ecfcf716ca4d25a676d906cc
Target: https://orbsie.com
Provider calls: 0; /api/generate returned deterministic fixture NDJSON.
Fixture geometry: platform (stationary geometry for WebGL animation-isolation diagnostic).
Offline platform-mask calibration on the prior initial screenshot: 42,328 pixels; centroid (639.9, 529.5).

## WebGL SwiftShader checks

- Zoom buttons: Zoom in, currently 600% → Zoom in, currently 480% → Zoom in, currently 600%.
- Background pan: 70 px marker movement. Wheel zoom: Zoom in, currently 600% → Zoom in, currently 453%.
- Post-wheel marker signature: 23948 pixels (minimum 25); after north reset: 23948 pixels.
- North reset: 28° → 0°; zoom Zoom in, currently 453%; marker visible: true. Target preservation is supported by the pure-state test, not directly measured by this browser run.
- Chat overlay: pass, 0 px marker shift; navigation labels unchanged. Control overlay: pass, 0 px marker shift.
- Final selected ID and saved group/entity positions stable: pass.
- Checks not reached: none.

Blocked external origins: none. Unexpected API paths: none.

Limitations: Chromium SwiftShader software rendering only; no native GPU or Canvas2D/mobile retest. Initial marker checks retain the 100-pixel threshold; post-wheel and post-reset checks use the explicit 25-pixel minimum. Target preservation is supported by tests/world-navigation.test.ts and is not directly read by this browser harness.
