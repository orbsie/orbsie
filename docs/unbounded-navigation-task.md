# Shared world navigation — phase 2 handoff

Start only after the world-coordinate/gameplay slice in
`docs/unbounded-world-task.md` passes root review. This slice gives the editor
and independent published player the same camera semantics in WebGL and the
software renderer. It does not claim streamed terrain or precision at arbitrary
distance; those are phase 3.

## Current source boundaries

- `src/components/world.tsx` owns the planet-to-parcel camera transition and
  `OrbitControls`. The controls currently disable pan, restrict distance to
  13–34, and target an origin-biased view. Keep the landing animation and do
  not let navigation write over the camera before the transition settles.
- `src/components/software-world.tsx` creates a separate perspective camera
  with a fixed transition path and no navigation state. Its canvas pointer
  handlers also select objects, so navigation gestures must not become clicks.
- `src/components/orbsie.tsx` wraps either renderer in `.gameplay-region` and
  owns the chat sheet, player controls, editor modes and public view. Put
  accessible navigation buttons in this shared shell rather than duplicating
  them per renderer. Check `src/app/globals.css` for phone safe-area and sheet
  placement.

## Contract

Use one renderer-independent `WorldNavigationState` with a world-space target,
heading and zoom/distance. World +Y is up and geographic north is world -Z.
Heading is the clockwise bearing of the ground direction toward the top of the
screen from north; heading zero therefore places the camera on the +Z side of
its target looking toward -Z. Normalize heading into [0, 2π). North reset sets
heading to zero and preserves target and zoom. Frame content is a separate
action that derives a bounded view from current committed entity bounds (or
the initial workspace when empty); it may change target and zoom. Navigating
must never mutate saved entity coordinates, IDs, revision or Undo history.

Provide a single command API for pan, zoom, rotate-to-heading, north reset and
frame content. Both renderers translate it into their camera projection; UI
buttons report the same displayed heading and zoom regardless of fallback.
Zoom-in, zoom-out, compass/north and frame-content buttons need accessible
names and keyboard activation. Place them outside the chat sheet and player
controls at phone portrait/landscape sizes with touch targets at least 44px.
Use one visually quiet, shared map-control cluster in the `World` wrapper so
the editor, software fallback and standalone player retain identical controls.
On desktop, keep it below the play toolbar/HUD; on phone portrait, fit it in
the exposed scene between the top chrome and chat sheet; on short landscape,
change its layout if a vertical rail collides with the sheet or movement
buttons. Use the existing cream/green surface language and a visible focus
ring. The compass must visibly indicate current north and expose a clear
"Reset north" action; frame-content is a distinct control.

In editing mode, mouse/trackpad pan and wheel zoom work on the scene, and touch
drag pans while pinch zooms. Object drag/selection has priority when it begins
on a manipulable object. Gestures beginning on chat, overlays or game controls
must not move the world. During gameplay, keep movement/jump controls working;
navigation gestures on the scene must have an explicit, non-conflicting mapping
and must not produce accidental player input. Handle pointer cancellation,
orientation changes and renderer fallback without a stuck gesture. Respect
reduced motion when easing camera changes.

Current input seams for the gesture slice: WebGL `Formation` selects/activates
through mesh and particle `onClick`; Canvas `onPointerMissed` clears selection.
Software mode stores projected pick centers and treats movement over 8 px as
non-click. A gesture recognizer must suppress those clicks after a pan, pinch
or rotate, and must decline navigation when the pointer begins on an entity.
Player key/touch input is owned by `PlayerInputTracker` and the shell controls;
the navigation recognizer must never synthesize those inputs. Attach wheel
handling only to the scene surface, not to the chat sheet or overlay buttons.

## Evidence to return

Tests of state commands and heading convention; a rendered desktop and narrow
phone fixture exercising buttons, drag/pinch, north reset retaining target/zoom,
frame content after a long pan, object selection and gameplay input isolation.
Exercise the same commands in WebGL and forced software fallback, including
signed-out published playback. Record viewport and renderer in screenshots and
report any unsatisfied gesture or performance requirement explicitly. Run
targeted tests, typecheck and production build. No live model calls are needed.
