# Distant-coordinate render precision — bounded handoff

Measure first, then repair the WebGL renderer near the ±1,000,000-unit scene
limit. At that magnitude, a Float32 world position has coarse increments
relative to the player's small meshes. The authoritative project, simulation,
saved navigation, procedural recipes, review bounds, and publication remain in
double-precision world coordinates; only renderer-local coordinates may move.

The terrain geometry already stores tile-local Float32 vertices and positions
the mesh at its world key. Choose a stable, quantized camera/player origin and
subtract it in the renderer's scene graph so the final model matrices and
camera sent to the GPU stay close to zero. Rebase only when crossing a suitable
threshold, without changing the apparent camera/object displacement. Keep
authored objects, terrain, formation particles, player, markers, lights and
shadows in the same local frame. Do not subtract the origin twice from nested
groups or baked geometry.

Picking and feedback must convert coherently: camera rays, intersections,
selected-object positions, screenshots, scene-review world bounds, and
gameplay observations should continue to refer to the correct world-space
entity IDs and coordinates. Software Canvas 2D can retain its existing
double-precision projection unless measurements show a separate problem.
Frustum culling should use the same effective camera/object positions as the
drawn frame; game logic and proximity tests must not inherit the render
origin.

Acceptance: compare camera-relative projected positions for small nearby
objects at the origin, 10 km, and near both coordinate limits; cross a rebase
boundary in each direction without a visible jump; select/edit objects,
walk/collect, save/reload, Undo, export, and signed-out published play without
coordinate drift. Record actual frame-time and memory on desktop WebGL and a
midrange Android profile. No claim of mathematically infinite precision or
distance follows from the finite schema limit.
