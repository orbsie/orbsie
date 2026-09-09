# Scene grouping and parenting acceptance

This specifies the next SDK acceptance cases, not completed functionality.
It supplements the grouping/parenting requirement in
`browser-modeling-plan.md`. Baked recipe composition and repeated mesh copies
remain distinct from relationships between editable scene entities.

## Required behavior

- Existing flat projects retain their positions, appearance, gameplay and
  export behavior. Adding hierarchy must not reinterpret old coordinates.
- A group has a stable identity. Children remain individually addressable;
  moving a group changes its descendants without rebuilding their baked
  assets or replacing entity IDs. Unrelated objects, player state and score
  remain intact.
- Rendering, selection feedback, interactions and collision calculations
  use consistent world transforms. The behavior of local versus world axes
  must be explicit in model-facing instructions.
- Invalid parents, cycles, excessive depth and unsupported transform cases
  fail before committing a partial scene. The last valid hierarchy remains
  usable. Resource limits must also cover hierarchy traversal.
- Reparenting and removing a parent have documented, atomic semantics.
  Neither operation may silently orphan entities. The contract must state
  whether reparenting preserves local or world transforms and how it handles
  transforms that cannot be represented exactly.
- Undo/redo and save/reload restore parent relationships and local transforms
  exactly. Independent exports preserve those relationships and gameplay
  without editor services, model credentials or an authoring interpreter.

## Deterministic transform cases

Use meters, Y-up and radians. These arithmetic checks are independent of the
renderer implementation:

| Parent | Child local position | Expected child world position |
| --- | --- | --- |
| Translation `[1,0,3]`, identity rotation/scale | `[2,0,0]` | `[3,0,3]` |
| Translation `[1,0,3]`, uniform scale `2` | `[2,0,0]` | `[5,0,3]` |
| Translation `[1,0,3]`, Y rotation `π/2`, uniform scale `2` | `[2,0,0]` | `[1,0,-1]` |

Add a nested descendant and verify its composed transform separately.
Exercise nonuniform scale plus rotation explicitly: a silently lossy
decomposition is not a passing result. The implementation review must decide
how full matrices, collision approximations and any unavailable operations
are represented before that case is accepted.

## Browser and gameplay milestone

Create a group containing a baked prop, a collectible and a platform. Edit
the group transform while playing, then target only the prop. Verify the
visible object positions, collectible interaction, platform contact/carrying
behavior, preserved player/score state, and unchanged unrelated objects.
Follow with hierarchy undo/redo, reload, export and signed-out playback.

Keep fixture evidence separate from live provider evidence. Once the
contract and browser path pass, exercise model-authored grouping and targeted
edits at the next authorized provider milestone. Existing procedural-source
or composition passes do not establish this behavior.
