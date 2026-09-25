# World navigation browser evidence

Status: **partial/failed**

Source commit: 113fbab85e9121ced56b964d37d4a738e261b70f
Target: https://orbsie.com
Provider calls: 0; /api/generate returned deterministic fixture NDJSON.

## Renderer checks

- **desktop-webgl-swiftshader** (WebGL / Chromium SwiftShader): fixtureReadyAndSelected: pass; visibleZoomButtons: {"original":"Zoom in, currently 600%","out":"Zoom in, currently 480%","returned":"Zoom in, currently 600%"}; mouseBackgroundPan: {"distancePixels":50.8,"before":{"pixels":5587,"centroid":{"x":687.3749776266333,"y":520.2276713799893},"bounds":{"minX":640,"minY":36,"maxX":1235,"maxY":624},"imageSize":{"width":1280,"height":900}},"after":{"pixels":11914,"centroid":{"x":716.3784623132449,"y":561.9043981870069},"bounds":{"minX":636,"minY":36,"maxX":1235,"maxY":654},"imageSize":{"width":1280,"height":900}}}; mouseWheelZoom: {"from":"Zoom in, currently 600%","to":"Zoom in, currently 453%"}; failure: AssertionError: fixture marker pixel signature found 39 pixels
- **desktop-forced-canvas2d** (editor Canvas2D fallback): fixtureReadyAndSelected: pass; visibleZoomButtons: {"original":"Zoom in, currently 600%","out":"Zoom in, currently 480%","returned":"Zoom in, currently 600%"}; mouseBackgroundPan: {"distancePixels":64.6,"before":{"pixels":48261,"centroid":{"x":639.982677524295,"y":435.7432295228031},"bounds":{"minX":520,"minY":36,"maxX":1235,"maxY":630},"imageSize":{"width":1280,"height":900}},"after":{"pixels":50601,"centroid":{"x":702.0520938321378,"y":453.5891187921187},"bounds":{"minX":578,"minY":36,"maxX":1235,"maxY":652},"imageSize":{"width":1280,"height":900}}}; mouseWheelZoom: {"from":"Zoom in, currently 600%","to":"Zoom in, currently 453%"}; compassNorthReset: {"fromHeading":28,"toHeading":0,"preservedZoom":"Zoom in, currently 453%","distancePixels":0,"tolerancePixels":8}; chatOverlayDoesNotNavigate: {"distancePixels":0,"tolerancePixels":4}; controlOverlayDoesNotNavigate: {"distancePixels":0.7,"tolerancePixels":4}; selectedIdAndSavedPositionStable: pass; noPageOrConsoleErrors: pass
- **mobile-canvas2d-touch** (editor Canvas2D fallback): fixtureReadyAndSelected: pass; touchBackgroundDrag: {"distancePixels":47.2,"before":{"pixels":13692,"centroid":{"x":194.57581069237511,"y":407.9810838445808},"bounds":{"minX":122,"minY":331,"maxX":267,"maxY":470},"imageSize":{"width":390,"height":844}},"after":{"pixels":13220,"centroid":{"x":241.39213313161875,"y":413.59387291981847},"bounds":{"minX":166,"minY":331,"maxX":315,"maxY":470},"imageSize":{"width":390,"height":844}}}; touchPinchZoom: {"from":"Zoom in, currently 387%","to":"Zoom in, currently 558%"}; mobileChatOverlayDoesNotNavigate: {"distancePixels":0,"tolerancePixels":4}; mobileNavigationControlsDoNotNavigate: {"distancePixels":0,"tolerancePixels":4}; selectedIdAndSavedPositionStable: pass; mobileTouchViewport: {"navigatorMaxTouchPoints":1}; noPageOrConsoleErrors: pass

Blocked external origins: none.
Unexpected API paths: none.

Limitations: SwiftShader is software rendering; Canvas2D is the editor fallback. Touch uses Chromium CDP and reports navigator.maxTouchPoints=1, so it does not establish physical multi-touch hardware behavior. On WebGL, wheel zoom reduced the marker color signature to 39 pixels below the 100-pixel threshold, so later rotation/north-reset/overlay checks were not completed there; those checks passed on desktop Canvas2D. No native GPU or provider behavior is claimed.
