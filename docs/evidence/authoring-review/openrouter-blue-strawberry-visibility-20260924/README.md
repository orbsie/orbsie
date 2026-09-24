# OpenRouter blue-strawberry visibility acceptance

One isolated local browser run used `openai/gpt-6-luna`, standard service tier,
the 4,096-token output cap, and the prompt `a tree with blue strawberries`.
The harness made exactly three live calls (create, review, final review), all
HTTP 200, with no retries or blocked calls. The first review revised the saved
scene from revision 13 to 19; final review returned `revise`, so this run is
**bounded-incomplete**. Revision 19 survived reload and the provider key was
absent from browser storage.

The sanitized [report.json](report.json) shows five lathe, five cone, and five
cylinder custom parts in both snapshots, including five blue parts. This is
aggregate shape evidence, not actual rendered dimensions or object recipes.
The private final capture is at
`/tmp/orbsie-authoring-review-private-visibility-20260924/post-review-scene.png`;
the screenshots and key are excluded from this repository.

Astra inspected the final capture. All five blue fruit are visible around the
tree, with green caps and stems; this improves on the prior run, which hid most
fruit behind the canopy. The fruit still look rounded rather than
strawberry-shaped and some outer fruit appear detached from the tree. The final
`revise` verdict agrees with this visual assessment. The production
authoring-review feature remains disabled pending quality acceptance.
