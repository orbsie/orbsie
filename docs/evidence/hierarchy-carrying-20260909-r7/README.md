# Parent hierarchy carrying acceptance

`scripts/verify-hierarchy-carrying.mjs` runs against the existing dev server at
`http://localhost:3047`. It intercepts `/api/trial` and `/api/generate` with a
deterministic two-request fixture, so it makes no live model, account, or
external network calls.

The browser creates a large static platform as a child of a group, sends real
ArrowUp movement and Space jump input, and records the player through the
read-only `__THREE_DEVTOOLS__` scene observer. It waits for five consecutive
stable samples on the platform, then submits a parent edit that applies a 90°
Y rotation, uniform 1.2 scale, and small translation. The expected carried
contact is computed independently by composing the recorded fixture matrices.

The final run passed with no page errors, external requests, or non-API
mutations. The carried player matched the independent expected position within
`9.5e-15` units and remained at zero measured drift across seven samples. The
Play HUD stayed `0 / 0 / Explore your garden`, and the unrelated tree entity
remained unchanged. `report.json` records app HEAD
`b889987585ca91184de8c2747a63a903d7e6201b`, runtime source commit
`0870f8388351418ef3afdfa7cf0ec9758edee9ba`, and the runtime SHA-256.

`platform-landed.png` shows the real keyboard landing. `carried-after-parent-edit.png`
shows the player after the parent pose edit. `fixture.json` records the exact
authored scene and parent transforms.

The earlier sibling bundles are preserved as harness failure evidence. The
first two attempts sampled before the keyboard jump had advanced, and the next
timing attempt used a fixed wall-time landing window instead of waiting for
consecutive stable contacts. Another attempt compared an IndexedDB structured
clone directly and hit a representation-only `assetPolicy: undefined` field.
The final harness uses explicit jump telemetry, a bounded stable-contact
sampler, and JSON-normalized authored-state comparisons; the application was
not changed.
