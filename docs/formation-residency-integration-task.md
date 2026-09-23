# Formation residency integration — bounded handoff

Run after `docs/visual-lease-gameplay-authority-task.md` passes. The pure
selector in `src/lib/formation-residency.ts` is not wired to the scene yet.
Integrate it without changing authoritative entity coordinates, revisions,
game rules, or save data. Use resolved world-space centers for grouped
entities, the active editor/player camera focus, current visible IDs, selected
ID, and the prior resident set. Recompute on meaningful view/cell or project
changes rather than setting React state every simulation frame.

Keep non-ready and actively forming `Formation` instances mounted. A ready
formation may lose its full visual resource only after it has completed its
current recipe and the same-recipe completion record exists. A nonresident
ready object in view needs a cheap proxy at the correct transform and color;
it must be selectable/clickable, and selection or approach promotes the full
formation. Make the proxy use catalog/generated bounds when available and a
conservative fallback otherwise. Reentry should hydrate the final mesh
without an orb replay. The existing asset/generated hooks should release
their leases on full-formation unmount, and stale async completions must not
attach after eviction.

Scene-review capture currently expects one readiness callback per entity.
Treat a completed same-recipe nonresident proxy as ready for the recorded
revision, but keep new/pending/failed recipes pending or failed. Do not claim a
revision visually reviewed if the intended object has never finished forming.
Keep gameplay authority independent of visual lease status; the related
metadata-bound change should already be integrated before this task.

Acceptance: 160 ready entities yield at most the configured number of full
ready formations; selected and nearby items promote on demand; repeatedly
cross the residency edge without remount thrash; revisit a completed object
without formation replay; a targeted edit triggers the normal new morph; asset
leases release; portal/collectible rules and clicks still work; scene-review
readiness and signed-out standalone playback remain correct. Browser memory,
frame-time, and mobile visual measurements remain required at release.
