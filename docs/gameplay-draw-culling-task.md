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

Focused acceptance: a moving/teleported object enters view without a project
revision; a hidden object stays hidden; a distant objective still triggers
contacts when the player reaches it; camera follow makes it visible again;
and asset loading or an unknown bound never drops authored content. Measure
drawn face/group counts on a growing scene and check the standalone player.
