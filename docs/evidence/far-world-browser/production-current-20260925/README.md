# Far-world browser acceptance

Status: **passed**

A deterministic local browser journey creates a grouped entity at 12 km, verifies initial automatic framing and the manual Frame control, edits its geometry, reloads saved state, exports a ZIP, and verifies distant content is visible in the isolated standalone player.

Source commit: `9ca6105b3c20c41ac91dfe8cb3917a73806a639e`. Provider calls: 0. External requests: 0.

The browser creates and edits a grouped object at [12,000, 0, 0] meters, verifies the new world is auto-framed, zooms away and uses the manual Frame control, then checks Play, reload, ZIP export and a fresh standalone player. Both Chromium SwiftShader WebGL and forced Canvas2D fallback lanes are included.

The harness requires at least 500 centered teal marker pixels immediately after generation. After manual Frame, it requires another 500-pixel increase over the zoomed-out view and at least 5,000 changed central pixels.

Limitations: WebGL runs under Chromium SwiftShader; this is not native GPU evidence. The standalone runtime loads near the 12 km content and responds to its restart control. This does not demonstrate sustained gameplay traversal over a long distance. No physical mobile, growing-world performance, memory, or live provider acceptance is claimed.

See [report.json](./report.json) for assertions and request audits. Screenshots show the created, framed, edited, editor Play, reloaded, and standalone states for each lane.
