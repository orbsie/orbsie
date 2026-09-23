# Gameplay draw culling — bounded handoff

The editing view now filters offscreen entities in both renderers, but play
still submits every entity for drawing because project-space bounds can become
stale under game-program movement, hide/show, or position overrides. Keep
simulation and contact processing over the complete authoritative entity set;
only rendering and visual picking may be culled.

Compute conservative current bounds from effective runtime transforms and
available geometry bounds, including group hierarchy and motion. Unknown,
pending, or invalid bounds remain visible until they can be classified.
Use the active player-follow camera and its actual near/far projection.
WebGL should avoid draw submission for invisible formations without resetting
formation progress. Software should skip expensive triangle rasterization for
invisible objects but retain gameplay update and scripted interactions.
Do not let an offscreen portal or collectible be clicked through an invalid
screen projection.

WebGL `Formation` currently updates `group.current.visible` before applying
the effective transform in its frame callback. A gameplay cull must run after
that transform, using the renderer-local group matrix and renderer-local
camera; do not compare a local camera against authoritative world bounds after
render-origin rebasing. Keep forming, pending-asset, selected, and unknown-bound
objects conservative. The same mounted `Formation` should become visible when
a game rule teleports it into view without a React/project revision. Avoid a
new frustum allocation for every entity on every frame.

Focused acceptance: a moving/teleported object enters view without a project
revision; a hidden object stays hidden; a distant objective still triggers
contacts when the player reaches it; camera follow makes it visible again;
and asset loading or an unknown bound never drops authored content. Measure
drawn face/group counts on a growing scene and check the standalone player.
