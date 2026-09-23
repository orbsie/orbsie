# Visual lease versus gameplay authority — bounded handoff

Run before enabling formation resource eviction. `Player` currently checks
`isAssetGeometryReady`/`isGeneratedGeometryReady`, and the software renderer's
`playableEntities` checks decoded geometry readiness. When the last visual
hook releases a distant ready model, these paths can substitute a seed entity
and remove collision/collection authority even though the committed recipe
and metadata are still present.

Use authoritative committed geometry metadata for a ready asset or generated
model when there is no last-good displayed replacement: catalog assets have
documented bounds and generated models carry validated bounds. `touchesEntity`
and platform support already use those bounds. Retain the existing behavior
for an in-progress targeted replacement: if an older ready geometry is still
displayed, gameplay should use that older recipe until the new visual
commits, so a hidden new collision shape cannot surprise the player. A
generated recipe without model metadata remains provisional.

The future lightweight proxy must be visible at the same world transform and
at least indicate the metadata envelope while full geometry loads. Do not
couple game-program start/tick/contact rules to visual cache residency.

Acceptance: ready asset and generated model remain collectible/supportive
after a visual lease is dropped; pending replacement keeps its displayed
last-good collision; an unavailable model without validated bounds does not
invent a collision; both WebGL and software paths agree; save/reload and
published playback keep world coordinates unchanged.
