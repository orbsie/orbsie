# Unbounded ground and far-scene rendering — phase 3 handoff

Begin after the shared navigation state, both camera adapters, editor controls,
published-player controls, and gesture tests are accepted. The phase-one schema
permits distant positions and movement, but the renderers still present a fixed
parcel. This task supplies a visually continuous default ground without
changing the authoritative scene coordinates.

Execute as bounded slices with one worker at a time: (1) a deterministic,
budgeted chunk-selection and level-of-detail contract with seam tests; (2)
WebGL ground; (3) matching software ground; (4) visible-object culling and
software picking; (5) measured precision repair and gameplay camera
tracking; (6) browser/mobile performance and published-player acceptance.
Retain a working renderer at each handoff and review each slice before the
next. A single large render rewrite would make regressions hard to isolate.

For slice 1, use signed integer keys `(lod, x, z)` on a world-aligned grid and
power-of-two chunk sizes from a 64m base. Select a fixed, bounded neighborhood
around an explicit camera/player focus; increase chunk size with camera
distance and aspect so zooming out does not allocate unbounded tiles. The
visible surface should sample appearance in world coordinates so shared edges
match across chunk keys, eviction/revisit, and LOD changes. Keep collision
height flat at the current y=0 until physics and visuals can change together.
Reject non-finite inputs, avoid 32-bit integer bitwise math on large keys, and
test negative coordinates, 10km travel, and the coordinate/zoom limits.

## Current source boundaries to preserve

- `src/components/world.tsx` keeps the planet-to-workspace transition, then
  switches from the fixed island surface to bounded world-aligned terrain.
  Authored island geometry remains an ordinary scene object. Editing-only
  frustum filtering hides offscreen formation groups without unmounting them;
  gameplay and transition formations remain mounted and visible according to
  their normal rules. This saves draw work but not geometry/asset memory.
- `src/components/software-world.tsx` paints bounded terrain polygons after
  the transition and filters offscreen entities during editing. Its entity
  triangle path still projects without near-plane clipping; an
  AABB touching the camera can still make a huge inverted path even after
  object-level culling. Clip or reject those triangles in a separate bounded
  software-rendering slice before release.
- WebGL `Formation` retains its local formation progress while hidden.
  Evicting distant ready objects later must release asset/geometry leases
  without replaying their orb formation on return or changing gameplay
  authority. Leave seeds and selected entities available when they enter view.
- Structural review bounds now accept the phase-one position range while
  retaining finite-value, byte, and object-count budgets.
- Both editing cameras extend the far plane to the selected terrain footprint.
  A player-follow camera must keep terrain selection, culling, and projection
  coherent as the player moves beyond the editor focus.

## Runtime contract

Use stable world-space integer chunk keys, deterministic geometry/materials,
and a bounded active neighborhood centered on the camera or player. Reuse
unchanged chunks, release geometry/texture/GPU resources for evicted chunks,
and cancel stale asynchronous results before attaching them. Terrain appearance
at a chunk seam must match after eviction, reload, and approach from another
direction. Do not mutate entity positions, parent transforms, project revision,
Undo state, or published project data to move a render origin.

Keep simulation authority separate from draw culling. A far entity remains in
the project and game program; proximity/contact processing remains correct when
the player reaches it. Visibility filters may skip draw and picking work only
for objects genuinely outside the current view. Picking must never select an
offscreen projected marker in software mode. Renderer-local recentering may be
used when measurements show float32 precision loss, but every raycast, camera,
pick, visual-feedback bound, and physics query must convert consistently.
Gameplay also needs a view that follows the player beyond the old parcel in
both renderers, retaining the chosen heading and zoom; a player walking away
must not simply disappear offscreen while simulation continues. Keep camera
tracking separate from authoritative player/world coordinates and define how a
manual scene pan resumes or suspends that follow behavior. The current gesture
mapping reserves scene navigation for editing and player input for play; keep
that separation for the first follow implementation and hide or disable any
map control in play that would silently change an invisible editor target.

The default ground is open in horizontal directions; an explicitly authored
island, wall, or cliff is a scene object. This slice does not claim physical
containment by those objects. A separate collision contract is required for
that behavior.

## Acceptance evidence

Exercise WebGL and forced software fallback at the initial origin, at least
10 km away, and near the supported coordinate limit. Repeatedly cross chunk
edges and return to verify seam continuity and bounded active allocations.
Create/select/edit a distant object, walk to a distant collectible or portal,
and confirm save/reload, Undo, export, and independent published playback keep
its coordinates. Record frame time and memory/allocation counts on a growing
scene, including a midrange Android profile, and report the measured precision
and resource limits rather than claiming literal infinite reach. Run focused
tests, TypeScript, production build, and the integrated browser/device checks
available at the milestone.
