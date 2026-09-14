# Unbounded world implementation handoff

Open owner requirement in prompt.md; implement after current connection/resilience
priorities with one Luna worker at a time. Source audit found explicit radial
movement clamp at gameplay.ts (radius8.4), WebGL OrbitControls with enablePan=false
and distance13..34 in world.tsx, and a separate software-world renderer/navigation
path. Removing a visible disk or adding buttons alone cannot satisfy the requirement.

Root interface decision: use one renderer-independent navigation state contract
(world-space target, heading, zoom/scale and north convention) and commands for pan,
zoom, north-reset and frame-content. Preserve target/zoom on north-reset. Translate
that state into WebGL and software camera projections instead of separate semantics.
Keep persisted entity coordinates authoritative; any floating-origin offset belongs
to rendering/physics adapters and must never rewrite saved project positions or IDs.

Replace implicit default radial gameplay confinement with streamed default ground
and explicit authored-boundary behavior. Keep the planet entrance transition intact;
activate unbounded workspace only after arrival. Terrain allocation, culling and
coordinate precision require bounded chunk lifecycle with cancellation/reuse. Budget
limits constrain resources, not the old circular placement domain. Audit model
schemas and authoring bounds before promising far-away placement.

Acceptance must include both renderers: create/edit far beyond original parcel,
long pan/recenter, preserved heading/north reset, desktop wheel/pan and Android
pinch/drag, gestures isolated from chat/gameplay, input during generation, undo,
save/reload, export and fresh independent publication. Keep existing authored islands
and game walls legitimate. Measure growing-world frame time/memory and repeated
chunk eviction, not a static large ground plane. No literal infinite capacity claim.
