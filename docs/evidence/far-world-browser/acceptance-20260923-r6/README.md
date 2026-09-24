# Far-world browser acceptance

Status: **passed**

A deterministic local browser journey creates a grouped entity at 12 km, frames it in the editor, edits its geometry, reloads saved state, exports a ZIP, and opens that ZIP in an isolated standalone player.

Source commit: `32c327292dd9d79342c5892eed6f24a7a71d63d1`. Provider calls: 0. External requests: 0.

The browser creates and edits a grouped object at [12,000, 0, 0] meters, frames it in the editor, reloads local state, downloads the project ZIP, and opens that ZIP in a fresh local server and browser context. Both Chromium SwiftShader WebGL and forced Canvas2D fallback lanes are included.

After Frame, the harness checks the centered canvas pixels for the fixture marker's tolerant teal color signature and requires at least 500 matching pixels and a 500-pixel increase over the pre-frame view. It also requires at least 5,000 central pixels to change from the pre-frame view.

Limitations: WebGL runs under Chromium SwiftShader; this is not native GPU evidence. The standalone runtime is verified to load and respond to its restart control, and its ZIP project retains the 12 km group. The player starts at the origin, so this does not demonstrate gameplay traversal to 12 km. No physical mobile, growing-world performance, memory, or live provider acceptance is claimed.

See [report.json](./report.json) for assertions and request audits. Screenshots show the created, framed, edited, reloaded, and standalone states for each lane.
