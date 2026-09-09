# Scene grouping and parenting acceptance

This specifies the next SDK acceptance cases, not completed functionality.
It supplements the grouping/parenting requirement in
`browser-modeling-plan.md`. Baked recipe composition and repeated mesh copies
remain distinct from relationships between editable scene entities.

## Architecture contract

Keep project version 1 and make `groups`, entity `parentId`, and entity
`rotation` optional. Omission retains the current flat world. Groups have
stable IDs in the same namespace as entities, local position/XYZ Euler
rotation/scale, and an optional parent group. Parents initially reference
groups; entities remain independently selectable leaves. Bound the graph to
128 groups, 160 entities and 32 group levels. Group scales must be positive
and finite; existing zero and negative entity scales remain readable.

Compose exact `T * R * S` matrices from ancestors in a shared pure resolver.
Do not flatten a sheared world matrix into approximate position/rotation/scale.
Renderer and gameplay integration must consume that same resolved transform.
The visual planet/parcel transform remains outside gameplay coordinates.
Root-space game path overrides replace the world origin while preserving the
matrix's linear part. Local authoring transforms remain local to their parent.

Expose explicit group creation/removal and `set_parent` operations through
the existing revision/sequence/idempotency envelope. Require an explicit
`keepWorldTransform` boolean in model-authored reparenting. Preserving world
placement computes the inverse parent transform and rejects a result that
cannot be represented as local TRS within documented numerical tolerance.
Reject removal of a group with children. Removing or editing a leaf keeps
the existing game-reference checks. Validate the resulting graph before any
commit or journal write.

Transform all eight local bounding-box corners for broad-phase contacts.
Platform landing must test the transformed support surface and footprint;
the top of a world axis-aligned bounding box is not a valid replacement for
a rotated platform. This collision integration is a release gate, including
parent changes while the player stands on a platform. Do not advertise model
parenting tools after only the schema or matrix foundation is implemented.

The current support state retains an origin and top height. Hierarchy
integration must additionally retain the player's support-local contact point
or equivalent previous support matrix: translation deltas alone cannot carry
a player correctly when a parent rotates or scales. Transform that contact
through the old and new support poses before applying player input. Test an
off-center standing player under a 90-degree Y rotation, not just a player at
the group's origin. A removed, singular or no-longer-supporting surface must
release support safely rather than preserve an invalid grounded state.

Delivery sequence: pure matrix foundation; atomic protocol operations;
shared renderer/gameplay integration; model tool exposure and history/export
acceptance; then the authorized live-provider milestone. Each intermediate
commit is implementation progress, not evidence of the complete feature.

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

Exercise checkpoint recovery independently from operation validation: start
with a ready child under group A, begin a coarse replacement, reparent it to
group B, then remove the now-empty A and interrupt generation. The existing
flat-world checkpoint restores the entire baseline entity, which would refer
to the removed A. The hierarchy implementation must recover a valid ancestor
closure and handle namespace conflicts explicitly, preserving the last good
geometry and unrelated committed changes. Repeat through cloud journal replay
as well as local cancellation. A valid sequence of raw operations is not
proof that its recovered checkpoint is valid.

Keep fixture evidence separate from live provider evidence. Once the
contract and browser path pass, exercise model-authored grouping and targeted
edits at the next authorized provider milestone. Existing procedural-source
or composition passes do not establish this behavior.
