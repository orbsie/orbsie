# Distant formation resource budget — bounded handoff

Run after player-follow and renderer parity. Editing frustum filtering currently
hides offscreen WebGL `Formation` groups without unmounting them; each group
still holds its mesh and particle buffers, retained previous appearance,
textures, and asset/generated-geometry lease. Culling draw calls alone does
not bound memory as authored worlds grow.

Define a conservative distance budget around the active camera. Keep seed and
actively forming objects, selected objects, objects in visual-feedback
capture, and gameplay-critical authorities available. Ready objects sufficiently
far outside the budget may release renderer-owned meshes/textures/leases, but
must remain in the project and simulation. Hysteresis should prevent
rapid allocate/dispose cycles near the boundary. Bound resident resources by
distance or a fixed count rather than total entity count.
If a ready object remains inside the camera view but falls outside the full
resource budget, draw a cheap, recognizable proxy at its true world position;
do not make it disappear or present it as a newly forming object. Selecting or
approaching that proxy should promote it to full detail.

Reappearance must show a completed object directly: unmounting `Formation`
resets `progress.current` and currently replays an orb. Persist presentation
completion by stable object ID and geometry revision, or hydrate an evicted
ready formation at progress 1. A changed geometry revision still uses the
normal targeted morph. Maintain the existing allocation cancellation and
StrictMode disposal behavior; late async asset results must not resurrect an
evicted resource. Never dispose shared cache geometry owned by another caller.
`Player` currently consults global `isAssetGeometryReady` and
`isGeneratedGeometryReady` counts when assembling collision entities. Releasing
the last visual hook can flip those counts; ensure that evicting a distant
visual does not silently remove its game authority, and that approaching it
loads any geometry needed for accurate collision before interaction.

Measure resident geometry, textures, and asset leases while panning through a
growing synthetic world, revisiting objects, selecting a distant object, and
switching play/editor modes. Verify that offscreen gameplay events still run,
formation does not replay on return, scene-review readiness reports the
correct revision, and the standalone player builds with the same resource
contract. Browser/mobile memory and frame-time measurements remain required
at the release milestone.
