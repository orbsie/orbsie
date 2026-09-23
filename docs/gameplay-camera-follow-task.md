# Gameplay camera follow — bounded handoff

After the software near-plane clipping slice, make the playable scene follow
the authoritative player in both renderers. The current camera and terrain
selection use the saved editor navigation target while the player can move
arbitrarily far away. Preserve the editor's target, heading, and zoom so
stopping play restores the same authored view.

Use a shared pure derivation from saved navigation plus player position for
the play view. Preserve heading and distance, target the player's world-space
position, and keep every coordinate finite and bounded by the world contract.
Do not write the derived target to the project, Undo stack, or saved navigation.
The current gesture mapping reserves scene drags for editing and player input
for play; keep that separation. Disable controls that would silently change
an invisible editor target during play; published playback must still have an
understandable way to view/control the player.

WebGL `Player` owns its authoritative `state.current` and runs at frame
priority -1, before `Scene`'s camera frame. Pass a shared mutable position
reference to `Scene` so camera follow does not trigger a React render every
simulation tick. Software `animate` already advances `playerRef.current`
before updating its camera. Derive the same play view there. On reset, project
change, or play start, use the reset player's current position immediately.
On stop, restore the saved editor camera. Do not alter physics coordinates or
the player's movement direction.

Terrain must follow the active camera/player focus too. Keep its active
neighborhood bounded and avoid reallocating chunks on every sub-tile player
movement. Culling and picking must use the active view; gameplay authority
must not be culled. Verify that a distant collectible/portal can become
visible and reachable after travel and that the ground stays under the player
on both renderers. The existing 43-degree camera and terrain-aware far-plane
must remain coherent at narrow mobile aspect ratios.

Acceptance: focused pure follow/reset tests; targeted renderer integration
tests for player travel beyond the original patch, terrain focus changes,
editor-view restoration, and no per-frame project mutation; TypeScript and
formatting. Browser visual/mobile checks remain a separate milestone while
computer-use policy blocks the Orbsie URL.
