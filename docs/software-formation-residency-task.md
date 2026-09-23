# Software renderer formation residency — bounded handoff

Run after WebGL Scene residency is accepted. `SoftwareWorld` currently mounts
one `SoftwareEntity` for every project entity (`src/components/software-world.tsx`),
so each ready asset/generated entity can retain a decoded hook lease and a cloned
`BufferGeometry` even when the Canvas draw loop culls it. Reuse the shared
`selectFormationResidents` policy and its player/editor focus convention; do not
change project data, game-program execution, collision authority, or save format.

Keep non-ready, currently forming, selected, and pending-replacement entities
fully loaded. Completed nonresident ready entities should release their full
`SoftwareEntity` lease/clone and keep a cheap local proxy entry or drawing path
that can be projected and picked at the resolved runtime transform. Prefer the
catalog/generated local bounds; fall back conservatively for unknown bounds.
The existing `playableEntities` metadata path must continue simulation when a
visual entry is absent. A proxy is visual-only and must not become a new
collision recipe or count as a fully decoded asset.

The software scene-review source currently uses `requiredGeometryReady` and
asset-error entries. A completed same-recipe proxy can satisfy visual review
for its recorded revision, but a changed recipe must remain pending until its
real geometry has loaded and drawn. Preserve last-good visual/collision during
replacement, avoid stale unmount cleanup deleting a newer entry, and promote
selected/nearby entities without a per-frame React state update. Eviction and
reentry must dispose owned clones exactly once and leave shared cache owners
untouched.

Acceptance: at least 160 completed ready entities leave at most the configured
full ready entries; distant on-screen objects stay visible and selectable;
crossing the hysteresis edge does not churn clones; a selected proxy loads its
full model; a targeted edit remains pending until loaded; offscreen gameplay
and the signed-out standalone player still work. Root runs integrated build,
browser memory/frame-time and Android acceptance at the milestone.
