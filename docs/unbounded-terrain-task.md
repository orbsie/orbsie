# Unbounded ground and far-scene rendering — phase 3 handoff

Begin after the shared navigation state, both camera adapters, editor controls,
published-player controls, and gesture tests are accepted. The phase-one schema
permits distant positions and movement, but the renderers still present a fixed
parcel. This task supplies a visually continuous default ground without
changing the authoritative scene coordinates.

## Source boundaries to preserve

- `src/components/world.tsx` renders two fixed cylinders, a water disk,
  pebbles, and contact shadows inside the animated island group. Keep the
  planet-to-workspace transition, but replace the default workspace surface
  after arrival; authored island geometry remains an ordinary scene object.
- `src/components/software-world.tsx` paints a screen-space ellipse and
  projects every triangle from every entity on every frame. Nearby visible
  terrain and visibility/picking need explicit bounded work here too.
- WebGL `Formation` currently sets `frustumCulled={false}` for a render mesh;
  do not solve distant placement by drawing all distant objects. Preserve seed
  formation and targeted object selection when visibility changes.
- `src/lib/server/scene-review-observations.ts` accepts structural bounds only
  within ±1000. Broaden the world-space feedback contract for the phase-one
  position range while keeping its byte and object-count budgets.
- Both cameras currently use `far: 250`. The visible horizon and object culling
  must be coherent at the navigation distances the UI permits.

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
manual scene pan resumes or suspends that follow behavior.

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
