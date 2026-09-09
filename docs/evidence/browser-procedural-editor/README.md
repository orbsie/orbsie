# Procedural authoring editor acceptance

`ORBSIE_PROCEDURAL=1 TEST_URL=http://localhost:3047 node scripts/verify-browser-modeling-editor.mjs docs/evidence/browser-procedural-editor`

Three synthetic provider responses exercised the actual editor, QuickJS
worker, Manifold worker, persistence and standalone exporter. The first
source created an arch; the second widened its opening. Both retained their
source and host-computed SHA-256, independently checked against canonical
UTF-8 JSON with keys `version`, `language`, `code`, `seed` in that order.
The emitted recipe and baked GLB changed while the entity ID stayed stable.

Exact geometry/source state survived undo and redo. A third source emitted
an invalid recipe and left the last finished object unchanged. Reload
restored the source, recipe and mesh without constructing a procedural
worker. The ZIP preserved the saved entity state and exact baked GLB, omitted
interpreter assets, and rendered in a separate static player context.
Editor and standalone screenshots were captured; the edited arch was
visually inspected. No external requests or page errors occurred.

Standalone readiness was observed at 4130 ms in headless Chromium using
SwiftShader. This is diagnostic evidence, not a performance-target pass.
The fixture does not prove live model-authored source, real account consent,
cloud publication or all-provider end-to-end completion.
