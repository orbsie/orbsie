# Unbounded world implementation handoff

Open owner requirement in `prompt.md`; implement after current
connection/resilience priorities with one Luna worker at a time. Source audit
found more than a visual limit: `src/lib/gameplay.ts` clamps the player to radius
8.4; `src/components/world.tsx` renders fixed cylinders at radius 8.6 and sets
`OrbitControls enablePan={false}` with distance 13..34;
`src/components/software-world.tsx` has its own fixed camera and draws an island
ellipse. `src/lib/protocol.ts` uses a shared ±100 `vector` for world position,
scale, rotation and part-local coordinates. `src/lib/server/generation.ts` still
instructs every model to stay on an island of radius 8. Removing a visible disk
or adding buttons alone cannot satisfy the requirement.

Additional review-boundary audit (Sep 22):
`src/lib/server/scene-review-observations.ts` caps reported world-space bounds
at ±1000. Farther geometry can therefore fail revision-bound visual feedback
even after the project protocol accepts it. Keep local modeling coordinates in
`src/lib/browser-modeling.ts` and `src/lib/modeling.ts` bounded separately; do
not widen their shape budgets merely to allow distant object placement.

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
schemas and authoring bounds before promising far-away placement. Split the
protocol's world-position schema from local shape/scale/rotation schemas: simply
widening the shared `vector` would also loosen mesh and transform budgets. Keep
the existing typed local geometry limits. Remove the island-only model
instructions for default worlds while allowing explicitly requested bounded
islands and authored barriers. Preserve old serialized project coordinates and
IDs through any schema migration.

Physical authored boundaries are a separate runtime gate. Current
`stepGameplay` contacts platform tops, collectibles and portals; it has no
typed wall or edge collision. An island mesh or wall-shaped model is visual
geometry today, not proof that a player cannot pass through it. Add an explicit
boundary/collider contract and gameplay evidence before claiming that a
requested bounded island or wall constrains movement. Generation guidance must
not imply unsupported physical containment.

Use sequential bounded handoffs rather than a single renderer rewrite:

1. World coordinates and gameplay: separate position validation from local
   geometry bounds, remove implicit radial movement and generation restrictions,
   define default ground versus explicit authored boundaries, and prove a
   far-away object/game path survives operations, undo, save and export.
2. Shared navigation state and UI: connect pan/zoom/compass/frame-content to
   both renderers and published playback, with desktop and touch gesture
   isolation. North reset retains target and zoom. Keep it independent of
   generation and gameplay input. The bounded implementation contract is
   `docs/unbounded-navigation-task.md`.
3. Chunked surface and precision: render only nearby terrain in WebGL and
   software, reuse/dispose chunks, cull entities for draw work without deleting
   them from authoritative project state, and keep far-away picking/contact
   correct. Introduce a render-local origin if measurements show precision
   loss; never recenter saved world coordinates.
4. Integrated acceptance: long-distance create/edit/nav/gameplay across both
   renderers, Android gestures, repeated chunk eviction, reload, independent
   export/publication, and frame-time/memory evidence on a growing scene.

Acceptance must include both renderers: create/edit far beyond original parcel,
long pan/recenter, preserved heading/north reset, desktop wheel/pan and Android
pinch/drag, gestures isolated from chat/gameplay, input during generation, undo,
save/reload, export and fresh independent publication. Keep existing authored islands
and game walls legitimate. Measure growing-world frame time/memory and repeated
chunk eviction, not a static large ground plane. No literal infinite capacity claim.
