# Rendered game actions in the editor and standalone player

The deterministic-generation test uses real browser input and an actual downloaded ZIP. It locates the rendered cube by colored pixels, clicks its visible position and checks resulting scores. It does not inspect React internals, private store state or test hooks. Root visually inspected both action screenshots.

Both editor and exported player pass variable assignment/addition and conditional scoring, click scoring, absolute color override, hidden-object click suppression, visible position changes, a non-looping movement path, a variable closing the scoring gate, and restart restoring the original palette and variables. The score reaches 16 in both. The exported game program is unchanged; the standalone makes no external requests and neither browser reports page errors.

The initial setup failure came from running a rebuilt app through its old Next server process; `before-server-restart.*` retains that failure. `before-gameplay-focus.png` records the next setup failure: Space correctly activated the focused Play button instead of dispatching a game input. The harness now clicks the ground to give gameplay focus first. `report.json`, `editor-actions.png`, `standalone-actions.png` and `world.zip` are the successful final run.

This is fixture generation with real renderer/physics/input execution, not live-provider evidence. It does not establish collision suppression for hidden objects, multi-object path/collision interactions, collider-edit reconciliation, cloud recovery or performance budgets.
