# Far-world browser acceptance

Status: **failed**

A deterministic local browser journey creates a grouped entity at 12 km, frames it in the editor, edits its geometry, reloads saved state, exports a ZIP, and verifies distant content is visible in the isolated standalone player.

Source commit: `5f1b125e3912b5041fbec1189b08a477be9009a4`. Provider calls: 0. External requests: 0.

The browser creates and edits a grouped object at [12,000, 0, 0] meters, frames it in the editor, reloads local state, downloads the project ZIP, and checks that the object is visible in a fresh standalone player context. Both Chromium SwiftShader WebGL and forced Canvas2D fallback lanes are included.

After Frame, the harness checks the centered canvas pixels for the fixture marker's tolerant teal color signature and requires at least 500 matching pixels and a 500-pixel increase over the pre-frame view. It also requires at least 5,000 central pixels to change from the pre-frame view.

Limitations: WebGL runs under Chromium SwiftShader; this is not native GPU evidence. The standalone runtime loads near the 12 km content and responds to its restart control. This does not demonstrate sustained gameplay traversal over a long distance. No physical mobile, growing-world performance, memory, or live provider acceptance is claimed.

See [report.json](./report.json) for assertions and request audits. Screenshots show the created, framed, edited, reloaded, and standalone states for each lane.
