# Unbounded world implementation handoff

Sep 24 status: the source audit below describes the original starting point,
not the current implementation. World-coordinate validation, default radial
gameplay removal, shared navigation and controls, chunked ground in both
renderers, render-local WebGL origin, player-follow views, draw culling, and
explicit bounded wall collision are implemented locally; see the newest entries
in `docs/development-checkpoint.md` for commits and checks. Solid collision is
opt-in for ready, bounded entities and uses conservative world-space boxes;
authored island edges and cliffs remain visual. Ready-formation resource
residency, browser/mobile performance measurements, far-distance live
creation/editing, and independent publication acceptance remain open. Do not
reintroduce the original limits while completing those checks.

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

Physical authored boundaries remain a separate acceptance gate. `stepGameplay`
now blocks horizontal movement against ready bounded entities with
`behavior.type: "solid"`, including group transforms, and reports their
contacts to game rules. Unit tests cover pass-through without opt-in, blocking,
sliding, jumping, and distant transformed walls. A deterministic headless
browser fixture has also verified an authored bounded wall in both renderers,
touch and keyboard input, and downloaded offline playback; see
`docs/evidence/solid-wall-browser/`. This is not proof of physical containment
for an island mesh or cliff: those remain visual geometry, and a conservative
axis-aligned box can overblock irregular or rotated shapes. Physical Android
and live model-authored wall acceptance remain open.

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
   loss; never recenter saved world coordinates. The bounded implementation
   contract is `docs/unbounded-terrain-task.md`.
4. Integrated acceptance: long-distance create/edit/nav/gameplay across both
   renderers, Android gestures, repeated chunk eviction, reload, independent
   export/publication, and frame-time/memory evidence on a growing scene.

Acceptance must include both renderers: create/edit far beyond original parcel,
long pan/recenter, preserved heading/north reset, desktop wheel/pan and Android
pinch/drag, gestures isolated from chat/gameplay, input during generation, undo,
save/reload, export and fresh independent publication. Keep existing authored islands
and game walls legitimate. Measure growing-world frame time/memory and repeated
chunk eviction, not a static large ground plane. No literal infinite capacity claim.
