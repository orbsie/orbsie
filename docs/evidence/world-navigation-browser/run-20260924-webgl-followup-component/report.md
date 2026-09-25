# World navigation browser evidence

Status: **partial/failed**

Source commit: `52a4d959e0a18d76ecfcf716ca4d25a676d906cc`  
Target: `https://orbsie.com` · Chromium WebGL / SwiftShader · 1280×900  
Provider calls: 0; `/api/generate` returned deterministic fixture NDJSON.

- Zoom controls: 600% → 480% → 600%.
- Background pan moved the marker signature 77.2 px. Wheel zoom: 600% → 453%.
- Post-wheel signature: 18,002 pixels (minimum 25), centroid (684.7, 409.6). After north reset: 24,454 pixels, centroid (685.8, 457.7).
- North reset returned heading 28° → 0° and retained 453% zoom. The screen-space centroid shifted 48.1 px; this cannot establish whether the world target changed because the heading change alters perspective. This is an inconclusive harness assertion, not evidence of a product navigation failure.
- Chat/control overlay isolation and the final selected-ID/saved-position recheck were not reached. No blocked external origins, unexpected API paths, page errors, or console errors were recorded before the assertion.

Limitations: Chromium SwiftShader software rendering only; no native GPU or Canvas2D/mobile retest. Initial marker checks retain the 100-pixel threshold; the post-wheel check uses an explicit 25-pixel minimum. Screenshots: `desktop-webgl-swiftshader-after-wheel.png` and `desktop-webgl-swiftshader-north-reset.png`.
