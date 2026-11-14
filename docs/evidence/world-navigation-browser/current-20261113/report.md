# World navigation browser evidence

Status: **partial/failed**

Source commit: 9d57a5cab61c64fade28d30da596a12ca9064a6e
Target: https://orbsie.com
Provider calls: 0; /api/generate returned deterministic fixture NDJSON.

## Renderer checks

- **desktop-webgl-swiftshader** (WebGL / Chromium SwiftShader): fixtureReadyAndSelected: pass; visibleZoomButtons: {"original":"Zoom in, currently 600%","out":"Zoom in, currently 480%","returned":"Zoom in, currently 600%"}; failure: AssertionError: fixture marker pixel signature found 39 pixels; minimum 100
- **desktop-forced-canvas2d** (editor Canvas2D fallback): fixtureReadyAndSelected: pass; visibleZoomButtons: {"original":"Zoom in, currently 600%","out":"Zoom in, currently 480%","returned":"Zoom in, currently 600%"}; mouseBackgroundPan: {"distancePixels":64.6,"before":{"pixels":48261,"minimumPixels":100,"sampleRegion":"full canvas","pixelSignature":"G>150, B>150, B-R>30, G-R>30","centroid":{"x":639.982677524295,"y":435.7432295228031},"bounds":{"minX":520,"minY":36,"maxX":1235,"maxY":630},"imageSize":{"width":1280,"height":900},"component":"all matches"},"after":{"pixels":50601,"minimumPixels":100,"sampleRegion":"full canvas","pixelSignature":"G>150, B>150, B-R>30, G-R>30","centroid":{"x":702.0520938321378,"y":453.5891187921187},"bounds":{"minX":578,"minY":36,"maxX":1235,"maxY":652},"imageSize":{"width":1280,"height":900},"component":"all matches"}}; mouseWheelZoom: {"from":"Zoom in, currently 600%","to":"Zoom in, currently 453%"}; postWheelMarkerVisible: {"pixels":26194,"minimumPixels":25,"sampleRegion":"center 30% x 60% of canvas","pixelSignature":"G>200, B>200, B-R>10, G-R>10","centroid":{"x":686.0271817973581,"y":457.41402611285025},"bounds":{"minX":594,"minY":298,"maxX":778,"maxY":605},"imageSize":{"width":1280,"height":900},"component":"largest 8-connected color component"}; compassNorthReset: {"fromHeading":28,"toHeading":0,"preservedZoom":"Zoom in, currently 453%","markerVisible":{"pixels":26194,"minimumPixels":25,"sampleRegion":"center 30% x 60% of canvas","pixelSignature":"G>200, B>200, B-R>10, G-R>10","centroid":{"x":686.0271817973581,"y":457.41402611285025},"bounds":{"minX":594,"minY":298,"maxX":778,"maxY":605},"imageSize":{"width":1280,"height":900},"component":"largest 8-connected color component"},"targetPreservationEvidence":"Supported by the pure-state north_reset test in tests/world-navigation.test.ts; browser target is not directly measured."}; chatOverlayNavigationUnchanged: pass; chatOverlayDoesNotNavigate: {"distancePixels":0,"tolerancePixels":6}; failure: TimeoutError: page.screenshot: Timeout 20000ms exceeded.
Call log:
[2m  - taking page screenshot[22m
[2m  - waiting for fonts to load...[22m
[2m  - fonts loaded[22m

- **mobile-canvas2d-touch** (editor Canvas2D fallback): fixtureReadyAndSelected: pass; touchBackgroundDrag: {"distancePixels":47.7,"before":{"pixels":14572,"minimumPixels":100,"sampleRegion":"full canvas","pixelSignature":"G>150, B>150, B-R>30, G-R>30","centroid":{"x":194.5772714795498,"y":402.50349986275046},"bounds":{"minX":122,"minY":292,"maxX":267,"maxY":470},"imageSize":{"width":390,"height":844},"component":"all matches"},"after":{"pixels":13592,"minimumPixels":100,"sampleRegion":"full canvas","pixelSignature":"G>150, B>150, B-R>30, G-R>30","centroid":{"x":241.45526780459093,"y":411.08637433784577},"bounds":{"minX":166,"minY":306,"maxX":315,"maxY":470},"imageSize":{"width":390,"height":844},"component":"all matches"}}; touchPinchZoom: {"from":"Zoom in, currently 387%","to":"Zoom in, currently 558%"}; mobileChatOverlayDoesNotNavigate: {"distancePixels":0,"tolerancePixels":4}; mobileNavigationControlsDoNotNavigate: {"distancePixels":0,"tolerancePixels":4}; selectedIdAndSavedPositionStable: pass; mobileTouchViewport: {"navigatorMaxTouchPoints":1}; noPageOrConsoleErrors: pass

Blocked external origins: none.
Unexpected API paths: none.

Limitations: SwiftShader is software rendering; Canvas2D is the editor fallback. Touch uses Chromium CDP and reports navigator.maxTouchPoints=1, so it does not establish physical multi-touch hardware behavior. No native GPU or provider behavior is claimed.
